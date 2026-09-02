using System.ComponentModel.DataAnnotations;

namespace Muamalat.Api.Configuration;

/// <summary>
/// Strongly typed configuration bound via the Options pattern and validated at startup.
/// Validation is eager (ValidateOnStart) so a misconfigured deployment fails immediately
/// and visibly, rather than throwing on the first request that happens to touch the setting.
/// </summary>
public sealed class AuthenticationOptions
{
    public const string SectionName = "Authentication";

    /// <summary>Keycloak realm issuer, e.g. http://localhost:8081/realms/muamalat</summary>
    [Required(AllowEmptyStrings = false)]
    public string Authority { get; init; } = string.Empty;

    /// <summary>Expected audience claim on incoming access tokens.</summary>
    [Required(AllowEmptyStrings = false)]
    public string Audience { get; init; } = string.Empty;

    /// <summary>
    /// Permitted only in Development, where Keycloak runs over plain HTTP inside the compose
    /// network. Any deployment that sets this outside Development is misconfigured, and
    /// <see cref="Validate"/> rejects it rather than silently accepting unencrypted metadata.
    /// </summary>
    public bool AllowHttpMetadata { get; init; }

    /// <summary>Clock skew allowance for token lifetime validation.</summary>
    [Range(0, 300)]
    public int ClockSkewSeconds { get; init; } = 30;
}

public sealed class StorageOptions
{
    public const string SectionName = "Storage";

    /// <summary>Root directory for uploaded supporting documents.</summary>
    [Required(AllowEmptyStrings = false)]
    public string DocumentRoot { get; init; } = string.Empty;

    [Range(1, 50 * 1024 * 1024)]
    public long MaxDocumentBytes { get; init; } = 10 * 1024 * 1024;

    /// <summary>
    /// Allow-list rather than a block-list. A block-list is a losing game: every new dangerous
    /// extension has to be discovered before it can be added, whereas an allow-list fails closed.
    /// </summary>
    public string[] AllowedContentTypes { get; init; } =
    [
        "application/pdf",
        "image/jpeg",
        "image/png"
    ];
}

public sealed class SlaSweepOptions
{
    public const string SectionName = "SlaSweep";

    public bool Enabled { get; init; } = true;

    [Range(10, 3600)]
    public int IntervalSeconds { get; init; } = 60;
}
