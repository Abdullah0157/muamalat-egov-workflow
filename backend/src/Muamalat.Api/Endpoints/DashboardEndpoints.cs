using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Muamalat.Domain.Workflow;
using Muamalat.Infrastructure.Persistence;

namespace Muamalat.Api.Endpoints;

/// <summary>
/// Supervisor oversight figures.
///
/// Every number here answers a question a supervisor actually asks: where is the
/// work piling up, what is about to breach, which stage is slow, and what has escalated.
/// Nothing is included because it looks impressive on a chart.
///
/// The aggregation runs in the database rather than by loading requests into memory. A
/// department with a year of history is tens of thousands of rows, and summing them in C#
/// would get linearly slower while the same work in SQL stays indexed.
/// </summary>
public static class DashboardEndpoints
{
    public static IEndpointRouteBuilder MapDashboardEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/dashboard", GetAsync)
            .WithTags("Dashboard")
            .WithSummary("Supervisor oversight figures")
            .RequireAuthorization(Policies.Supervisor);

        return app;
    }

    private static async Task<Ok<DashboardDto>> GetAsync(
        MuamalatDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken,
        string period = "last30")
    {
        var now = clock.GetUtcNow();

        var from = period switch
        {
            "last30" => now.AddDays(-30),
            "last90" => now.AddDays(-90),
            _ => (DateTimeOffset?)null,
        };

        var scoped = db.ServiceRequests.AsNoTracking();
        if (from is not null)
        {
            scoped = scoped.Where(r => r.SubmittedAt >= from);
        }

        // One pass for the headline counts. Loading the rows to count them in memory would
        // transfer the entire period's data to compute four integers.
        var totals = await scoped
            .GroupBy(_ => 1)
            .Select(g => new
            {
                Total = g.Count(),
                Open = g.Count(r => r.ClosedAt == null),
                Closed = g.Count(r => r.ClosedAt != null),
            })
            .SingleOrDefaultAsync(cancellationToken);

        // Average processing time over closed cases only. An open case has not finished, so
        // including it would drag the average toward zero and flatter the department.
        var closedDurations = await scoped
            .Where(r => r.ClosedAt != null)
            .Select(r => new { r.SubmittedAt, ClosedAt = r.ClosedAt!.Value })
            .ToListAsync(cancellationToken);

        double? averageProcessingMs = closedDurations.Count == 0
            ? null
            : closedDurations.Average(d => (d.ClosedAt - d.SubmittedAt).TotalMilliseconds);

        // Open work, with the SLA policy of the state each request currently sits in. This is
        // the only place the SLA has to be evaluated per row, because it depends on how long
        // the request has been where it is.
        var openRows = await scoped
            .Where(r => r.ClosedAt == null)
            .Select(r => new
            {
                r.Id,
                r.ReferenceNumber,
                r.WorkflowKey,
                r.WorkflowDefinitionId,
                r.CurrentStateCode,
                r.CurrentStateEnteredAt,
                r.SubmittedAt,
                r.AssignedToDepartment,
            })
            .ToListAsync(cancellationToken);

        var definitionIds = openRows.Select(r => r.WorkflowDefinitionId).Distinct().ToList();

        var states = await db.WorkflowStates
            .AsNoTracking()
            .Where(s => definitionIds.Contains(s.WorkflowDefinitionId))
            .ToListAsync(cancellationToken);

        SlaStatus? StatusOf(Guid definitionId, string stateCode, DateTimeOffset enteredAt)
        {
            var state = states.FirstOrDefault(s => s.WorkflowDefinitionId == definitionId && s.Code == stateCode);
            return state?.Sla?.Evaluate(enteredAt, now);
        }

        var evaluated = openRows
            .Select(r => new
            {
                Row = r,
                Sla = StatusOf(r.WorkflowDefinitionId, r.CurrentStateCode, r.CurrentStateEnteredAt),
            })
            .ToList();

        var atRisk = evaluated.Count(e => e.Sla == SlaStatus.AtRisk);
        var breached = evaluated.Count(e => e.Sla == SlaStatus.Breached);

        // Workload by department. Requests not yet routed to a department are grouped under
        // "Unassigned" rather than dropped, because unrouted work is exactly the kind that
        // goes unnoticed until it breaches.
        var workload = evaluated
            .GroupBy(e => e.Row.AssignedToDepartment ?? "Unassigned")
            .Select(g => new DepartmentWorkloadDto(
                g.Key,
                g.Count(),
                g.Count(e => e.Sla is null or SlaStatus.OnTrack),
                g.Count(e => e.Sla == SlaStatus.AtRisk),
                g.Count(e => e.Sla == SlaStatus.Breached)))
            .OrderByDescending(w => w.Breached).ThenByDescending(w => w.Open)
            .ToList();

        // Bottlenecks: where open work is currently sitting, and how long it has been there.
        // Measured on the current state rather than historically, because the question is
        // where cases are stuck now, not where they once paused.
        var bottlenecks = evaluated
            .GroupBy(e => e.Row.CurrentStateCode)
            .Select(g =>
            {
                var state = states.FirstOrDefault(s => s.Code == g.Key);
                return new BottleneckDto(
                    g.Key,
                    state?.NameEn ?? g.Key,
                    state?.NameAr ?? g.Key,
                    g.Average(e => (now - e.Row.CurrentStateEnteredAt).TotalMilliseconds),
                    g.Count());
            })
            .OrderByDescending(b => b.AverageMs)
            .Take(8)
            .ToList();

        // Throughput by week. Grouped in the database; the week key is computed with
        // date_trunc through EF's DateTrunc translation.
        var submittedByWeek = await scoped
            .GroupBy(r => new { r.SubmittedAt.Year, Week = r.SubmittedAt.DayOfYear / 7 })
            .Select(g => new { g.Key.Year, g.Key.Week, Count = g.Count(), First = g.Min(r => r.SubmittedAt) })
            .ToListAsync(cancellationToken);

        var closedByWeek = await scoped
            .Where(r => r.ClosedAt != null)
            .GroupBy(r => new { r.ClosedAt!.Value.Year, Week = r.ClosedAt!.Value.DayOfYear / 7 })
            .Select(g => new { g.Key.Year, g.Key.Week, Count = g.Count() })
            .ToListAsync(cancellationToken);

        var throughput = submittedByWeek
            .OrderBy(w => w.First)
            .Select(w => new ThroughputDto(
                w.First,
                w.Count,
                closedByWeek.FirstOrDefault(c => c.Year == w.Year && c.Week == w.Week)?.Count ?? 0))
            .ToList();

        // Escalations: breached cases, oldest first. These are the ones a supervisor has to
        // act on today.
        var escalated = evaluated
            .Where(e => e.Sla == SlaStatus.Breached)
            .OrderBy(e => e.Row.CurrentStateEnteredAt)
            .Take(10)
            .Select(e => new EscalationDto(
                e.Row.Id,
                e.Row.ReferenceNumber,
                e.Row.WorkflowKey,
                e.Row.AssignedToDepartment ?? "Unassigned",
                e.Row.CurrentStateEnteredAt,
                (now - e.Row.CurrentStateEnteredAt).TotalMilliseconds))
            .ToList();

        // On time rate, reconstructed from the audit trail.
        //
        // The obvious source is sla_events, but that table is written by the periodic sweep,
        // which only ever looks at OPEN requests. A case that breached and then closed between
        // two sweeps leaves no event behind, so counting events would silently overstate
        // performance, which is the worst possible direction for a service level figure to be
        // wrong in.
        //
        // The audit chain does hold the answer: it records every state entry with a timestamp,
        // so the time a case spent in each state can be replayed and compared against that
        // state's target. It is more work than reading a counter, and it is the only version
        // that is actually true.
        double? onTimeRate = null;

        var closedRequests = await scoped
            .Where(r => r.ClosedAt != null)
            .Select(r => new { r.Id, r.WorkflowDefinitionId })
            .ToListAsync(cancellationToken);

        if (closedRequests.Count > 0)
        {
            var closedIds = closedRequests.Select(r => r.Id).ToList();

            var trail = await db.AuditEntries
                .AsNoTracking()
                .Where(e => closedIds.Contains(e.ServiceRequestId) && e.ToStateCode != null)
                .OrderBy(e => e.ServiceRequestId).ThenBy(e => e.Sequence)
                .Select(e => new { e.ServiceRequestId, e.ToStateCode, e.OccurredAt })
                .ToListAsync(cancellationToken);

            var allStates = await db.WorkflowStates
                .AsNoTracking()
                .Where(s => closedRequests.Select(r => r.WorkflowDefinitionId).Contains(s.WorkflowDefinitionId))
                .ToListAsync(cancellationToken);

            var onTime = 0;

            foreach (var request in closedRequests)
            {
                var steps = trail.Where(e => e.ServiceRequestId == request.Id).ToList();
                var breachedSomewhere = false;

                // Each entry marks arrival in a state; the next entry marks departure. The last
                // state is the terminal one, which has no SLA and nothing left to measure.
                for (var i = 0; i < steps.Count - 1; i++)
                {
                    var state = allStates.FirstOrDefault(st =>
                        st.WorkflowDefinitionId == request.WorkflowDefinitionId &&
                        st.Code == steps[i].ToStateCode);

                    if (state?.Sla is null) continue;

                    if (steps[i + 1].OccurredAt - steps[i].OccurredAt >= state.Sla.Target)
                    {
                        breachedSomewhere = true;
                        break;
                    }
                }

                if (!breachedSomewhere) onTime++;
            }

            onTimeRate = (double)onTime / closedRequests.Count;
        }

        return TypedResults.Ok(new DashboardDto(
            period,
            from,
            now,
            totals?.Total ?? 0,
            totals?.Open ?? 0,
            totals?.Closed ?? 0,
            atRisk,
            breached,
            averageProcessingMs,
            onTimeRate,
            escalated.Count,
            workload,
            bottlenecks,
            throughput,
            escalated));
    }
}

public sealed record DashboardDto(
    string Period,
    DateTimeOffset? From,
    DateTimeOffset To,
    int TotalInPeriod,
    int Open,
    int Closed,
    int AtRisk,
    int Breached,
    double? AverageProcessingMs,
    double? OnTimeRate,
    int Escalations,
    IReadOnlyList<DepartmentWorkloadDto> Workload,
    IReadOnlyList<BottleneckDto> Bottlenecks,
    IReadOnlyList<ThroughputDto> Throughput,
    IReadOnlyList<EscalationDto> EscalatedCases);

public sealed record DepartmentWorkloadDto(string Department, int Open, int OnTrack, int AtRisk, int Breached);

public sealed record BottleneckDto(string StateCode, string NameEn, string NameAr, double AverageMs, int CaseCount);

public sealed record ThroughputDto(DateTimeOffset WeekStart, int Submitted, int Closed);

public sealed record EscalationDto(
    Guid RequestId,
    string Reference,
    string WorkflowKey,
    string Department,
    DateTimeOffset RaisedAt,
    double AgeMs);
