using System.Security.Claims;
using System.Text.Json;

namespace Muamalat.Api;

public static class Roles
{
    public const string Citizen = "Citizen";
    public const string Officer = "Officer";
    public const string Supervisor = "Supervisor";
    public const string Admin = "Admin";
}

public static class Policies
{
    public const string Citizen = "policy.citizen";

    /// <summary>Officer work. Supervisors and admins inherit it, so they can cover a queue.</summary>
    public const string Officer = "policy.officer";

    public const string Supervisor = "policy.supervisor";
    public const string Admin = "policy.admin";
}

/// <summary>
/// Keycloak nests realm roles inside a realm_access JSON claim rather than emitting flat role
/// claims. Without flattening, RequireRole never matches and every authorisation check fails
/// closed in a way that looks like a permissions bug rather than a claims mapping problem.
/// </summary>
public static class KeycloakRoles
{
    private const string RealmAccessClaim = "realm_access";
    private const string RolesProperty = "roles";

    public static void Flatten(ClaimsPrincipal? principal)
    {
        if (principal?.Identity is not ClaimsIdentity identity) return;

        var realmAccess = principal.FindFirst(RealmAccessClaim)?.Value;
        if (string.IsNullOrWhiteSpace(realmAccess)) return;

        foreach (var role in ExtractRoles(realmAccess))
        {
            if (!identity.HasClaim(ClaimTypes.Role, role))
                identity.AddClaim(new Claim(ClaimTypes.Role, role));
        }
    }

    private static IEnumerable<string> ExtractRoles(string realmAccessJson)
    {
        // A malformed claim must not take the request down. An unparseable realm_access means
        // the caller simply ends up with no roles, and authorisation denies them normally.
        try
        {
            using var document = JsonDocument.Parse(realmAccessJson);

            if (!document.RootElement.TryGetProperty(RolesProperty, out var roles) ||
                roles.ValueKind != JsonValueKind.Array)
            {
                return [];
            }

            return roles.EnumerateArray()
                .Where(r => r.ValueKind == JsonValueKind.String)
                .Select(r => r.GetString()!)
                .Where(r => !string.IsNullOrWhiteSpace(r))
                .ToList();
        }
        catch (JsonException)
        {
            return [];
        }
    }
}

public static class SecurityHeaderExtensions
{
    /// <summary>
    /// Baseline response headers. The API serves JSON to a separate SPA origin, so the CSP is
    /// deliberately restrictive: this endpoint has no legitimate reason to load scripts,
    /// styles, frames or images.
    /// </summary>
    public static IApplicationBuilder UseSecurityHeaders(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            var headers = context.Response.Headers;

            headers["X-Content-Type-Options"] = "nosniff";
            headers["X-Frame-Options"] = "DENY";
            headers["Referrer-Policy"] = "no-referrer";
            headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'";
            headers["Cross-Origin-Resource-Policy"] = "same-site";

            await next();
        });
}
