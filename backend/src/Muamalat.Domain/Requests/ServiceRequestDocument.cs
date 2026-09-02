namespace Muamalat.Domain.Requests;

/// <summary>
/// A file attached to a service request: the trade licence, the tenancy contract, the
/// engineering drawing. Part of the <see cref="ServiceRequest"/> aggregate, so it is only
/// ever created or mutated through the root.
///
/// The binary itself is never held here. Only the storage coordinates are stored, because
/// government attachments are large, are scanned for malware out of band, and are served
/// through short-lived signed URLs rather than through the database.
/// </summary>
public sealed class ServiceRequestDocument
{
    public Guid Id { get; private set; } = Guid.CreateVersion7();

    public Guid ServiceRequestId { get; private set; }

    /// <summary>
    /// Business classification, for example "TRADE_LICENCE". Workflow guards match on this
    /// value, so it is a controlled code rather than a free-text label.
    /// </summary>
    public string DocumentType { get; private set; } = null!;

    /// <summary>Original file name as supplied by the uploader, kept for display only.</summary>
    public string FileName { get; private set; } = null!;

    public string ContentType { get; private set; } = null!;
    public long SizeBytes { get; private set; }

    /// <summary>Opaque key in the object store. Never a public URL and never a local path.</summary>
    public string StoragePath { get; private set; } = null!;

    public string UploadedByUserId { get; private set; } = null!;
    public DateTimeOffset UploadedAt { get; private set; }

    /// <summary>
    /// Set once an officer confirms the document is legible, current and belongs to the
    /// applicant. The <see cref="Workflow.GuardKind.RequiresAllDocumentsVerified"/> guard
    /// reads this, which is what stops a file reaching the approval desk unchecked.
    /// </summary>
    public bool IsVerified { get; private set; }

    public string? VerifiedByUserId { get; private set; }
    public DateTimeOffset? VerifiedAt { get; private set; }

    private ServiceRequestDocument() { } // EF Core

    internal ServiceRequestDocument(
        Guid serviceRequestId,
        string documentType,
        string fileName,
        string contentType,
        long sizeBytes,
        string storagePath,
        string uploadedByUserId,
        DateTimeOffset uploadedAt)
    {
        if (string.IsNullOrWhiteSpace(documentType))
            throw new ArgumentException("Document type is required.", nameof(documentType));
        if (string.IsNullOrWhiteSpace(fileName))
            throw new ArgumentException("File name is required.", nameof(fileName));
        if (string.IsNullOrWhiteSpace(contentType))
            throw new ArgumentException("Content type is required.", nameof(contentType));
        if (string.IsNullOrWhiteSpace(storagePath))
            throw new ArgumentException("Storage path is required.", nameof(storagePath));
        if (string.IsNullOrWhiteSpace(uploadedByUserId))
            throw new ArgumentException("Uploader user id is required.", nameof(uploadedByUserId));
        if (sizeBytes <= 0)
            throw new ArgumentOutOfRangeException(nameof(sizeBytes), "An empty attachment is not a document.");

        ServiceRequestId = serviceRequestId;
        DocumentType = documentType;
        FileName = fileName;
        ContentType = contentType;
        SizeBytes = sizeBytes;
        StoragePath = storagePath;
        UploadedByUserId = uploadedByUserId;
        UploadedAt = uploadedAt;
    }

    /// <summary>
    /// Marks the document verified. Idempotent: a second call is a no-op that keeps the
    /// original verifier and timestamp, and returns false.
    ///
    /// It does not throw when the document is already verified, because two officers
    /// clicking "verify" on the same file is ordinary contention in a shared queue rather
    /// than an error the citizen should ever see. The boolean is the signal the aggregate
    /// root uses to decide whether an audit entry is warranted: re-verifying changes
    /// nothing, so it must not add noise to a tamper-evident chain.
    ///
    /// Internal by design. Verification has to be audited, and only
    /// <see cref="ServiceRequest"/> may append to the request's audit chain.
    /// </summary>
    /// <returns>True when this call performed the verification, false when it was already verified.</returns>
    internal bool Verify(string verifiedByUserId, DateTimeOffset at)
    {
        if (string.IsNullOrWhiteSpace(verifiedByUserId))
            throw new ArgumentException("Verifier user id is required.", nameof(verifiedByUserId));

        if (IsVerified) return false;

        IsVerified = true;
        VerifiedByUserId = verifiedByUserId;
        VerifiedAt = at;
        return true;
    }
}
