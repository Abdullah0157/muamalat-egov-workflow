using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;
using Muamalat.Api;
using Muamalat.Api.Configuration;
using Muamalat.Api.Endpoints;
using Muamalat.Api.Middleware;
using Muamalat.Api.Services;
using Muamalat.Domain.Workflow;
using Muamalat.Infrastructure.Persistence;
using Muamalat.Infrastructure.Seeding;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

// Serilog is configured from appsettings so log levels and sinks change without a rebuild.
builder.Host.UseSerilog((context, services, configuration) => configuration
    .ReadFrom.Configuration(context.Configuration)
    .ReadFrom.Services(services)
    .Enrich.FromLogContext());

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
builder.Services
    .AddOptions<AuthenticationOptions>()
    .Bind(builder.Configuration.GetSection(AuthenticationOptions.SectionName))
    .ValidateDataAnnotations()
    .ValidateOnStart();

builder.Services.AddSingleton<IValidateOptions<AuthenticationOptions>, AuthenticationOptionsValidator>();

builder.Services
    .AddOptions<StorageOptions>()
    .Bind(builder.Configuration.GetSection(StorageOptions.SectionName))
    .ValidateDataAnnotations()
    .ValidateOnStart();

builder.Services
    .AddOptions<SlaSweepOptions>()
    .Bind(builder.Configuration.GetSection(SlaSweepOptions.SectionName))
    .ValidateDataAnnotations()
    .ValidateOnStart();

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
var connectionString = builder.Configuration.GetConnectionString("Muamalat")
    ?? throw new InvalidOperationException("Connection string 'Muamalat' is not configured.");

builder.Services.AddDbContext<MuamalatDbContext>(options => options
    .UseNpgsql(connectionString, npgsql => npgsql.EnableRetryOnFailure())
    .UseSnakeCaseNamingConvention());

// ---------------------------------------------------------------------------
// Authentication and authorisation
// ---------------------------------------------------------------------------
var authOptions = builder.Configuration
    .GetSection(AuthenticationOptions.SectionName)
    .Get<AuthenticationOptions>() ?? new AuthenticationOptions();

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Authority = authOptions.Authority;
        options.Audience = authOptions.Audience;
        options.RequireHttpsMetadata = !authOptions.AllowHttpMetadata;

        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ClockSkew = TimeSpan.FromSeconds(authOptions.ClockSkewSeconds),

            // Keycloak emits realm roles under realm_access.roles rather than as flat "role"
            // claims, so they are flattened into ClaimTypes.Role on token validation below.
            RoleClaimType = ClaimTypes.Role,
            NameClaimType = "preferred_username"
        };

        options.Events = new JwtBearerEvents
        {
            OnTokenValidated = context =>
            {
                KeycloakRoles.Flatten(context.Principal);
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorizationBuilder()
    .AddPolicy(Policies.Citizen, p => p.RequireRole(Roles.Citizen))
    .AddPolicy(Policies.Officer, p => p.RequireRole(Roles.Officer, Roles.Supervisor, Roles.Admin))
    .AddPolicy(Policies.Supervisor, p => p.RequireRole(Roles.Supervisor, Roles.Admin))
    .AddPolicy(Policies.Admin, p => p.RequireRole(Roles.Admin));

// ---------------------------------------------------------------------------
// Cross cutting
// ---------------------------------------------------------------------------
builder.Services.AddProblemDetails(options =>
{
    // Every error response carries the correlation id, so a user-reported failure can be
    // tied to its log lines without asking them for a timestamp.
    options.CustomizeProblemDetails = context =>
    {
        context.ProblemDetails.Extensions["correlationId"] = context.HttpContext.TraceIdentifier;
        context.ProblemDetails.Instance ??= context.HttpContext.Request.Path;
    };
});

builder.Services.AddScoped<DatabaseSeeder>();
builder.Services.AddScoped<DemoDataSeeder>();
builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<ICurrentUser, CurrentUser>();
builder.Services.AddSingleton<WorkflowEngine>();

builder.Services.AddOpenApi();

builder.Services.AddHostedService<SlaSweepService>();

builder.Services.AddHealthChecks()
    .AddNpgSql(connectionString, name: "postgres", tags: ["ready"]);

builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
    .WithOrigins(builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [])
    .AllowAnyHeader()
    .AllowAnyMethod()
    .WithExposedHeaders(CorrelationIdMiddleware.HeaderName)));

var app = builder.Build();

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------
// Development convenience only. A production deployment applies migrations as a separate,
// auditable step rather than letting an application instance mutate the schema on boot.
if (app.Environment.IsDevelopment())
{
    using var scope = app.Services.CreateScope();
    await scope.ServiceProvider.GetRequiredService<DatabaseSeeder>().InitialiseAsync();

    // A demonstration caseload, so the queue, the SLA indicators and the oversight
    // dashboard have something real to show on a first run. Every case is created
    // through the workflow engine, so the audit chains genuinely verify.
    if (app.Configuration.GetValue("Demo:SeedCaseload", true))
    {
        await scope.ServiceProvider.GetRequiredService<DemoDataSeeder>()
            .SeedAsync(TimeProvider.System.GetUtcNow());
    }
}

app.UseMiddleware<CorrelationIdMiddleware>();

app.UseSerilogRequestLogging(options =>
{
    options.GetLevel = (httpContext, elapsed, ex) =>
        ex is not null || httpContext.Response.StatusCode >= 500
            ? Serilog.Events.LogEventLevel.Error
            : httpContext.Response.StatusCode >= 400
                ? Serilog.Events.LogEventLevel.Warning
                : Serilog.Events.LogEventLevel.Information;
});

app.UseExceptionHandler();
app.UseStatusCodePages();

app.UseSecurityHeaders();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

// Liveness answers "is the process up", readiness answers "can it serve traffic".
// Separating them stops an orchestrator restarting a healthy pod merely because the
// database is briefly unreachable.
app.MapWorkflowEndpoints();
app.MapRequestEndpoints();
app.MapDashboardEndpoints();

app.MapHealthChecks("/health/live", new()
{
    Predicate = _ => false
}).AllowAnonymous();

app.MapHealthChecks("/health/ready", new()
{
    Predicate = check => check.Tags.Contains("ready")
}).AllowAnonymous();

app.Run();

/// <summary>Exposed so the integration tests can drive the real pipeline with WebApplicationFactory.</summary>
public partial class Program;
