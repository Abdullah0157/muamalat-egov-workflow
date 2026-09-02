using System.Security.Claims;
using Muamalat.Domain.Common;

namespace Muamalat.Api.Services;

/// <summary>
/// Translates the authenticated principal into the domain's <see cref="TransitionActor"/>.
///
/// Identity is taken from the token and never from the request body. An endpoint that let the
/// caller name themselves would let any citizen act as an officer simply by editing a field,
/// and would make the audit trail worthless because it records whoever the caller claimed to be.
/// </summary>
public interface ICurrentUser
{
    TransitionActor Actor { get; }
    string UserId { get; }
    bool IsInRole(string role);
}

public sealed class CurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    public TransitionActor Actor
    {
        get
        {
            var principal = Principal;

            // The subject claim is the stable identifier. preferred_username can be changed by
            // the user in Keycloak, so using it as the key would break the link between a
            // person and their history the moment they rename themselves.
            var userId =
                principal.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? principal.FindFirstValue("sub")
                ?? throw new InvalidOperationException("Authenticated principal has no subject claim.");

            var displayName =
                principal.FindFirstValue("name")
                ?? principal.FindFirstValue("preferred_username")
                ?? userId;

            var roles = principal.FindAll(ClaimTypes.Role)
                .Select(c => c.Value)
                .Distinct(StringComparer.Ordinal)
                .ToList();

            return new TransitionActor(userId, displayName, roles);
        }
    }

    public string UserId => Actor.UserId;

    public bool IsInRole(string role) => Principal.IsInRole(role);

    private ClaimsPrincipal Principal =>
        accessor.HttpContext?.User is { Identity.IsAuthenticated: true } user
            ? user
            : throw new InvalidOperationException("No authenticated user on the current request.");
}
