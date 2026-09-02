namespace Muamalat.Domain.Common;

/// <summary>
/// Who is performing an auditable operation, resolved from the authenticated principal
/// by the application layer and passed down into the domain.
///
/// The domain deliberately does not know about ClaimsPrincipal, HttpContext or identity
/// providers. It only needs a stable user id, a display name to stamp into the audit
/// trail, and the roles that authorisation decisions are made against. That keeps the
/// workflow engine unit testable without an authentication stack.
///
/// Named for its primary use (executing a workflow transition) but shared by every
/// operation that has to be attributed to a person: uploading a document, verifying a
/// document, recording a fee payment.
/// </summary>
public sealed record TransitionActor
{
    public string UserId { get; }
    public string DisplayName { get; }

    /// <summary>
    /// Roles held by the actor for this request. Compared case insensitively, because
    /// role names arrive from external identity providers whose casing we do not control.
    /// </summary>
    public IReadOnlyList<string> Roles { get; }

    public TransitionActor(string userId, string displayName, IReadOnlyList<string> roles)
    {
        if (string.IsNullOrWhiteSpace(userId))
            throw new ArgumentException("Actor user id is required; every audited action must be attributable.", nameof(userId));
        if (string.IsNullOrWhiteSpace(displayName))
            throw new ArgumentException("Actor display name is required for the audit trail.", nameof(displayName));

        UserId = userId;
        DisplayName = displayName;
        Roles = roles.Count == 0 ? [] : roles.ToArray();
    }

    public static TransitionActor Create(string userId, string displayName, params string[] roles) =>
        new(userId, displayName, roles);

    public bool IsInRole(string role) =>
        Roles.Contains(role, StringComparer.OrdinalIgnoreCase);
}
