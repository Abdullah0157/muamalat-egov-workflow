using System.Text.RegularExpressions;

namespace Muamalat.Domain.Common;

/// <summary>
/// The human-facing reference a citizen quotes at a counter or on the phone, for example
/// "MW-2026-000123".
///
/// The domain only formats and validates it. Allocation of the numeric part belongs to
/// infrastructure (a database sequence per prefix and year), because uniqueness under
/// concurrent submissions is a storage guarantee, not something an in-memory aggregate
/// can promise.
///
/// The year is part of the reference on purpose: government archiving and retention
/// policies are organised by filing year, and support staff need to locate the right
/// archive from the reference alone.
/// </summary>
public static partial class ReferenceNumber
{
    /// <summary>Default prefix for Muamalat filed requests.</summary>
    public const string DefaultPrefix = "MW";

    /// <summary>Minimum width of the sequence segment; it grows naturally beyond 999999.</summary>
    private const int SequenceWidth = 6;

    public static string Format(int year, long sequence) => Format(DefaultPrefix, year, sequence);

    public static string Format(string prefix, int year, long sequence)
    {
        if (string.IsNullOrWhiteSpace(prefix))
            throw new ArgumentException("Reference prefix is required.", nameof(prefix));
        if (year is < 1900 or > 9999)
            throw new ArgumentOutOfRangeException(nameof(year), "Reference year must be a four digit year.");
        if (sequence < 1)
            throw new ArgumentOutOfRangeException(nameof(sequence), "Reference sequence starts at 1.");

        return $"{prefix.ToUpperInvariant()}-{year:D4}-{sequence.ToString().PadLeft(SequenceWidth, '0')}";
    }

    public static bool IsWellFormed(string? value) =>
        !string.IsNullOrWhiteSpace(value) && Pattern().IsMatch(value);

    [GeneratedRegex(@"^[A-Z]{2,6}-\d{4}-\d{6,}$", RegexOptions.CultureInvariant)]
    private static partial Regex Pattern();
}
