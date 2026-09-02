using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Muamalat.Api.Configuration;
using Muamalat.Infrastructure.Persistence;

namespace Muamalat.Api.Services;

/// <summary>
/// Periodically invokes the fn_sweep_sla stored procedure, which raises at-risk and breach
/// events for open requests whose current state defines an SLA.
///
/// The work lives in the database rather than here on purpose: evaluating every open request
/// against its state's policy is a set based problem, and pulling the whole open workload into
/// memory to loop over it would get slower with every request the system accepts.
///
/// This service therefore does three things only: wake up on schedule, call the function, and
/// log the outcome. The procedure is idempotent, so an overlapping or retried run cannot raise
/// the same breach twice, which is what makes it safe to run this on more than one instance.
/// </summary>
public sealed class SlaSweepService(
    IServiceScopeFactory scopeFactory,
    IOptions<SlaSweepOptions> options,
    ILogger<SlaSweepService> logger) : BackgroundService
{
    private readonly SlaSweepOptions _options = options.Value;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Enabled)
        {
            logger.LogInformation("SLA sweep is disabled by configuration.");
            return;
        }

        var interval = TimeSpan.FromSeconds(_options.IntervalSeconds);
        logger.LogInformation("SLA sweep started with an interval of {IntervalSeconds}s.", _options.IntervalSeconds);

        using var timer = new PeriodicTimer(interval);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await SweepOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                // A failed sweep must never take the host down. The next tick retries, and the
                // procedure's idempotency means a partially observed run costs nothing.
                logger.LogError(ex, "SLA sweep failed; the next scheduled run will retry.");
            }

            if (!await timer.WaitForNextTickAsync(stoppingToken)) break;
        }

        logger.LogInformation("SLA sweep stopped.");
    }

    private async Task SweepOnceAsync(CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<MuamalatDbContext>();

        var startedAt = TimeProvider.System.GetTimestamp();

        var result = await db.Database
            .SqlQuery<SlaSweepResult>($"SELECT at_risk_raised, breaches_raised FROM fn_sweep_sla()")
            .SingleAsync(cancellationToken);

        var elapsed = TimeProvider.System.GetElapsedTime(startedAt);

        // Quiet sweeps are the normal case, so only log at Information when something happened.
        // Logging every idle tick at Information would bury the events that matter.
        if (result.AtRiskRaised > 0 || result.BreachesRaised > 0)
        {
            logger.LogInformation(
                "SLA sweep raised {AtRisk} at-risk and {Breached} breach event(s) in {ElapsedMs}ms.",
                result.AtRiskRaised, result.BreachesRaised, elapsed.TotalMilliseconds);
        }
        else
        {
            logger.LogDebug("SLA sweep found nothing to raise ({ElapsedMs}ms).", elapsed.TotalMilliseconds);
        }
    }
}

/// <summary>Projection of the fn_sweep_sla result set.</summary>
public sealed record SlaSweepResult(int AtRiskRaised, int BreachesRaised);
