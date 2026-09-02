using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Muamalat.Domain.Auditing;

/// <summary>
/// One immutable link in a per-request hash chain.
///
/// Each entry hashes its own payload together with the hash of the entry before it.
/// Altering or deleting any historical entry invalidates every hash that follows,
/// so tampering is detectable even by someone with write access to the database.
///
/// This is tamper-EVIDENT, not tamper-PROOF. An attacker who can rewrite the whole
/// chain and is not compared against an external anchor can still forge a consistent
/// history. Production systems anchor the head hash somewhere the application cannot
/// reach (append-only log, notary, or a signed daily digest). See ARCHITECTURE.md.
/// </summary>
public sealed class AuditEntry
{
    public Guid Id { get; private set; } = Guid.CreateVersion7();

    /// <summary>The request whose history this entry belongs to. Each request has its own chain.</summary>
    public Guid ServiceRequestId { get; private set; }

    /// <summary>1-based position in the chain. Unique per request; gaps indicate deletion.</summary>
    public int Sequence { get; private set; }

    public AuditEventType EventType { get; private set; }

    public string? FromStateCode { get; private set; }
    public string? ToStateCode { get; private set; }
    public string? TransitionCode { get; private set; }

    public string ActorUserId { get; private set; } = null!;
    public string ActorDisplayName { get; private set; } = null!;
    public string ActorRoles { get; private set; } = null!;

    public string? Comment { get; private set; }

    /// <summary>Structured detail as canonical JSON. Never contains secrets or raw personal identifiers.</summary>
    public string PayloadJson { get; private set; } = null!;

    public DateTimeOffset OccurredAt { get; private set; }

    /// <summary>Hash of the preceding entry. All zeroes for the genesis entry.</summary>
    public string PreviousHash { get; private set; } = null!;

    /// <summary>SHA-256 over the canonical serialisation of this entry plus <see cref="PreviousHash"/>.</summary>
    public string Hash { get; private set; } = null!;

    public const string GenesisHash = "0000000000000000000000000000000000000000000000000000000000000000";

    private AuditEntry() { } // EF Core

    private AuditEntry(
        Guid serviceRequestId,
        int sequence,
        AuditEventType eventType,
        string actorUserId,
        string actorDisplayName,
        IEnumerable<string> actorRoles,
        DateTimeOffset occurredAt,
        string previousHash,
        string? fromStateCode,
        string? toStateCode,
        string? transitionCode,
        string? comment,
        object? payload)
    {
        ServiceRequestId = serviceRequestId;
        Sequence = sequence;
        EventType = eventType;
        ActorUserId = actorUserId;
        ActorDisplayName = actorDisplayName;
        ActorRoles = string.Join(',', actorRoles.OrderBy(r => r, StringComparer.Ordinal));
        // Truncated to microseconds BEFORE hashing.
        //
        // PostgreSQL timestamptz keeps microsecond precision; a .NET DateTimeOffset keeps
        // 100 nanosecond ticks. Hashing the un-truncated value produces a hash that can never
        // be reproduced after the row is read back, because the database silently dropped the
        // sub-microsecond digits. The chain would then fail verification for every entry, which
        // reads as tampering when it is really a precision mismatch.
        //
        // Normalising here means the value that is hashed is exactly the value that can be
        // stored, so verification holds across a save and reload.
        OccurredAt = TruncateToMicroseconds(occurredAt);
        PreviousHash = previousHash;
        FromStateCode = fromStateCode;
        ToStateCode = toStateCode;
        TransitionCode = transitionCode;
        Comment = comment;
        PayloadJson = payload is null ? "{}" : JsonSerializer.Serialize(payload, CanonicalJson);

        Hash = ComputeHash();
    }

    /// <summary>
    /// Deterministic serialisation. Property order and formatting must never change,
    /// or previously computed hashes stop reproducing and every historical chain
    /// fails verification. Treat this as a stored format, not an implementation detail.
    /// </summary>
    private static readonly JsonSerializerOptions CanonicalJson = new()
    {
        WriteIndented = false,
        PropertyNamingPolicy = null
    };

    /// <summary>
    /// Appends an entry to an existing chain. <paramref name="previous"/> is null only
    /// for the first entry of a request.
    /// </summary>
    public static AuditEntry Append(
        AuditEntry? previous,
        Guid serviceRequestId,
        AuditEventType eventType,
        string actorUserId,
        string actorDisplayName,
        IEnumerable<string> actorRoles,
        DateTimeOffset occurredAt,
        string? fromStateCode = null,
        string? toStateCode = null,
        string? transitionCode = null,
        string? comment = null,
        object? payload = null)
    {
        if (previous is not null && previous.ServiceRequestId != serviceRequestId)
            throw new InvalidOperationException("Cannot append an audit entry to another request's chain.");

        return new AuditEntry(
            serviceRequestId,
            previous is null ? 1 : previous.Sequence + 1,
            eventType,
            actorUserId,
            actorDisplayName,
            actorRoles,
            occurredAt,
            previous?.Hash ?? GenesisHash,
            fromStateCode,
            toStateCode,
            transitionCode,
            comment,
            payload);
    }

    private string ComputeHash()
    {
        // Field separator is a character that cannot appear unescaped in the JSON payload
        // or in any identifier, so distinct field combinations cannot collide by concatenation.
        var canonical = string.Join('\u001F',
            ServiceRequestId.ToString("N"),
            Sequence.ToString(),
            ((int)EventType).ToString(),
            FromStateCode ?? string.Empty,
            ToStateCode ?? string.Empty,
            TransitionCode ?? string.Empty,
            ActorUserId,
            ActorRoles,
            Comment ?? string.Empty,
            PayloadJson,
            OccurredAt.ToUniversalTime().ToString("O"),
            PreviousHash);

        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    }

    /// <summary>Recomputes this entry's hash and compares it with the stored value.</summary>
    public bool IsSelfConsistent() => Hash == ComputeHash();

    /// <summary>
    /// Drops sub-microsecond precision so the value survives a PostgreSQL round trip unchanged.
    /// See the constructor for why this must happen before the hash is computed.
    /// </summary>
    private static DateTimeOffset TruncateToMicroseconds(DateTimeOffset value)
    {
        // Converted to UTC first. PostgreSQL timestamptz stores an instant and Npgsql refuses
        // any offset other than zero, so an entry stamped in Kuwait time (+03:00) would fail to
        // persist at all. Normalising here keeps the domain able to accept a local time while
        // guaranteeing the hashed value matches the stored one.
        var utc = value.ToUniversalTime();

        const long ticksPerMicrosecond = TimeSpan.TicksPerMillisecond / 1000;
        return new DateTimeOffset(utc.Ticks - utc.Ticks % ticksPerMicrosecond, TimeSpan.Zero);
    }
}

public enum AuditEventType
{
    RequestSubmitted = 0,
    StateChanged = 1,
    DocumentUploaded = 2,
    DocumentVerified = 3,
    InformationRequested = 4,
    InformationProvided = 5,
    SlaWarning = 6,
    SlaBreached = 7,
    Escalated = 8,
    Assigned = 9,
    CommentAdded = 10,
    FeePaid = 11,
    Withdrawn = 12
}
