using Serilog.Context;

namespace Muamalat.Api.Middleware;

/// <summary>
/// Attaches a correlation id to every request and pushes it into the Serilog context so it
/// appears on every log line produced while handling that request. The id is echoed back on
/// the response, which is what makes a citizen's "my application failed" report traceable to
/// the exact log entries without guessing at timestamps.
/// </summary>
public sealed class CorrelationIdMiddleware(RequestDelegate next)
{
    public const string HeaderName = "X-Correlation-Id";

    public async Task InvokeAsync(HttpContext context)
    {
        var correlationId = ResolveCorrelationId(context);

        context.TraceIdentifier = correlationId;
        context.Response.Headers[HeaderName] = correlationId;

        using (LogContext.PushProperty("CorrelationId", correlationId))
        {
            await next(context);
        }
    }

    /// <summary>
    /// Honours an inbound correlation id so a call chain keeps one id end to end, but only
    /// when it is well formed. Accepting arbitrary client input here would let a caller inject
    /// newlines or control characters into the log stream.
    /// </summary>
    private static string ResolveCorrelationId(HttpContext context)
    {
        if (!context.Request.Headers.TryGetValue(HeaderName, out var values))
            return Guid.CreateVersion7().ToString("N");

        var candidate = values.ToString();

        var isAcceptable =
            candidate.Length is > 0 and <= 64 &&
            candidate.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');

        return isAcceptable ? candidate : Guid.CreateVersion7().ToString("N");
    }
}
