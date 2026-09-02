using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Testcontainers.PostgreSql;

namespace Muamalat.Tests.Integration;

/// <summary>
/// Boots the real API pipeline against a throwaway PostgreSQL container.
///
/// Only authentication is replaced. Everything else, the endpoints, EF Core mapping,
/// migrations, the hand written SQL, the workflow engine and the audit chain, is the
/// production code path. Substituting the database or the persistence layer would turn these
/// into tests of a mock rather than tests of the system.
///
/// Authentication is swapped because standing up Keycloak per test run would be slow and would
/// test Keycloak rather than Muamalat. Authorisation is NOT swapped: the real policies still
/// run against the roles this handler issues, so a role check that is wrong still fails here.
/// </summary>
public sealed class MuamalatApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:17-alpine")
        .WithDatabase("muamalat")
        .WithUsername("muamalat")
        .WithPassword("muamalat")
        .Build();

    // Implemented explicitly: xUnit's IAsyncLifetime returns Task, while WebApplicationFactory
    // already exposes a ValueTask DisposeAsync. Explicit implementation keeps both contracts
    // satisfied without one shadowing the other.
    async Task IAsyncLifetime.InitializeAsync() => await _postgres.StartAsync();

    async Task IAsyncLifetime.DisposeAsync()
    {
        await _postgres.DisposeAsync();
        await base.DisposeAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");

        // UseSetting, not ConfigureAppConfiguration.
        //
        // The application runs as Development here, so appsettings.Development.json is loaded
        // and carries a connection string pointing at the developer's local database. Values
        // added through ConfigureAppConfiguration did NOT win against it, and the suite quietly
        // ran against the developer's database instead of its own container: tests appeared to
        // pass while writing to real local data. UseSetting writes into the host builder's own
        // configuration, which takes precedence, so the container connection string is the one
        // that is used.
        builder.UseSetting("ConnectionStrings:Muamalat", _postgres.GetConnectionString());

        // The sweep runs on a timer and would fire during tests, adding noise and racing with
        // assertions about SLA events. Tests drive the procedure explicitly instead.
        builder.UseSetting("SlaSweep:Enabled", "false");

        builder.UseSetting("Authentication:Authority", "http://localhost/realms/test");
        builder.UseSetting("Authentication:Audience", "muamalat-api");
        builder.UseSetting("Authentication:AllowHttpMetadata", "true");

        builder.ConfigureTestServices(services =>
        {
            services.AddAuthentication(TestAuthHandler.SchemeName)
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>(TestAuthHandler.SchemeName, _ => { });

            services.Configure<AuthenticationOptions>(options =>
            {
                options.DefaultAuthenticateScheme = TestAuthHandler.SchemeName;
                options.DefaultChallengeScheme = TestAuthHandler.SchemeName;
            });
        });

        builder.ConfigureLogging(logging => logging.SetMinimumLevel(LogLevel.Error));
    }

    /// <summary>Creates a client acting as the given user. Roles drive the real authorisation policies.</summary>
    public HttpClient CreateClientAs(string userId, string displayName, params string[] roles)
    {
        var client = CreateClient();
        client.DefaultRequestHeaders.Add(TestAuthHandler.UserIdHeader, userId);
        client.DefaultRequestHeaders.Add(TestAuthHandler.DisplayNameHeader, displayName);
        client.DefaultRequestHeaders.Add(TestAuthHandler.RolesHeader, string.Join(',', roles));
        return client;
    }

    public HttpClient CreateAnonymousClient() => CreateClient();
}

/// <summary>
/// Issues a principal from request headers. Only ever registered by the test factory, never by
/// the application, so there is no path by which a deployed instance could authenticate this way.
/// </summary>
public sealed class TestAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "Test";
    public const string UserIdHeader = "X-Test-UserId";
    public const string DisplayNameHeader = "X-Test-DisplayName";
    public const string RolesHeader = "X-Test-Roles";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue(UserIdHeader, out var userId) || string.IsNullOrWhiteSpace(userId))
            return Task.FromResult(AuthenticateResult.NoResult());

        var displayName = Request.Headers.TryGetValue(DisplayNameHeader, out var name) && !string.IsNullOrWhiteSpace(name)
            ? name.ToString()
            : userId.ToString();

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, userId!),
            new("sub", userId!),
            new("name", displayName)
        };

        if (Request.Headers.TryGetValue(RolesHeader, out var roles))
        {
            claims.AddRange(roles.ToString()
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(r => new Claim(ClaimTypes.Role, r)));
        }

        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, SchemeName));
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, SchemeName)));
    }
}
