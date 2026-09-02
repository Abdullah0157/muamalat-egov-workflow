using Microsoft.Extensions.Options;

namespace Muamalat.Api.Configuration;

/// <summary>
/// Enforces the rules that data annotations cannot express, in particular that plaintext
/// OIDC metadata is only ever tolerated in Development. Registered with ValidateOnStart so
/// a bad deployment refuses to boot instead of running with weakened token validation.
/// </summary>
public sealed class AuthenticationOptionsValidator(IHostEnvironment environment)
    : IValidateOptions<AuthenticationOptions>
{
    public ValidateOptionsResult Validate(string? name, AuthenticationOptions options)
    {
        var failures = new List<string>();

        if (!Uri.TryCreate(options.Authority, UriKind.Absolute, out var authority))
        {
            failures.Add($"{nameof(options.Authority)} must be an absolute URI.");
        }
        else
        {
            if (authority.Scheme is not ("http" or "https"))
                failures.Add($"{nameof(options.Authority)} must use http or https.");

            if (authority.Scheme == "http" && !options.AllowHttpMetadata)
                failures.Add(
                    $"{nameof(options.Authority)} uses http but {nameof(options.AllowHttpMetadata)} is false.");
        }

        if (options.AllowHttpMetadata && !environment.IsDevelopment())
        {
            failures.Add(
                $"{nameof(options.AllowHttpMetadata)} may only be enabled in Development. " +
                $"Current environment is '{environment.EnvironmentName}'.");
        }

        return failures.Count == 0
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(failures);
    }
}
