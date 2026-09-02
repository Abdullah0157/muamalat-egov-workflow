using Muamalat.Domain.Auditing;
using Muamalat.Domain.Common;
using Muamalat.Domain.Workflow;

namespace Muamalat.Domain.Requests;

/// <summary>
/// A citizen's application for a government service, and the aggregate root of this domain.
///
/// It owns three things that must stay consistent with one another: where the request sits
/// in its workflow, the documents attached to it, and its tamper-evident audit chain. They
/// are one aggregate precisely because a state change and its audit entry must be written
/// in the same transaction; splitting them would allow a moved request with no record of
/// who moved it, which is the one outcome an auditor will not accept.
///
/// The request does not drive itself. <see cref="WorkflowEngine"/> is the only component
/// permitted to move it between states, which is why the state-machine mutators here are
/// internal while ordinary citizen and officer operations are public.
/// </summary>
public sealed class ServiceRequest
{
    /// <summary>The role every citizen implicitly holds on their own request.</summary>
    public const string ApplicantRole = "Applicant";

    /// <summary>
    /// Version 7 UUID: time-ordered, so primary key inserts stay sequential and the index
    /// does not fragment the way random v4 keys do at government submission volumes.
    /// </summary>
    public Guid Id { get; private set; } = Guid.CreateVersion7();

    /// <summary>Human-facing reference, for example "MW-2026-000123". Quoted by the citizen at the counter.</summary>
    public string ReferenceNumber { get; private set; } = null!;

    /// <summary>
    /// The exact workflow version this request executes against, pinned when it was lodged
    /// and never changed afterwards. Publishing a new version of a workflow must not alter
    /// the rules under requests that are already halfway through the old one; a citizen is
    /// entitled to be judged by the process that was in force when they applied.
    /// </summary>
    public Guid WorkflowDefinitionId { get; private set; }

    /// <summary>Denormalised from the pinned definition so history and reporting survive a definition purge.</summary>
    public string WorkflowKey { get; private set; } = null!;

    public int WorkflowVersion { get; private set; }

    public string CurrentStateCode { get; private set; } = null!;

    public string ApplicantUserId { get; private set; } = null!;

    /// <summary>Snapshot of the applicant's name at submission; a later name change must not rewrite history.</summary>
    public string ApplicantDisplayName { get; private set; } = null!;

    /// <summary>The service being applied for, for example "commercial-licence-renewal".</summary>
    public string ServiceType { get; private set; } = null!;

    public DateTimeOffset SubmittedAt { get; private set; }

    /// <summary>When the request entered <see cref="CurrentStateCode"/>. The SLA clock starts here.</summary>
    public DateTimeOffset CurrentStateEnteredAt { get; private set; }

    /// <summary>Set when the request enters a terminal state. Null means still in flight.</summary>
    public DateTimeOffset? ClosedAt { get; private set; }

    /// <summary>
    /// The legally significant date the decision was rendered, stamped by the
    /// <see cref="ActionKind.StampDecisionDate"/> action. Kept separate from
    /// <see cref="ClosedAt"/> because appeal windows and licence validity run from the
    /// decision, and a workflow may keep a decided request open for fee collection or
    /// certificate issuance before it actually closes.
    /// </summary>
    public DateTimeOffset? DecisionAt { get; private set; }

    /// <summary>Owning department queue. Null when nobody owns the request, typically while the citizen holds it.</summary>
    public string? AssignedToDepartment { get; private set; }

    /// <summary>
    /// Role queue within the department. Assignment narrows in three steps, department then
    /// role then individual, so work can be routed before a named officer exists.
    /// </summary>
    public string? AssignedToRole { get; private set; }

    /// <summary>Named officer currently holding the request. Null while it sits in a shared queue.</summary>
    public string? AssignedToUserId { get; private set; }

    public bool FeePaid { get; private set; }

    /// <summary>
    /// The state the request was in when an officer asked the applicant for more
    /// information. Recorded so a <see cref="TransitionKind.ResumeAfterInfo"/> transition
    /// can send the request back to the desk that actually asked, instead of guessing.
    /// Several states can feed one shared "more information required" state, so the return
    /// path genuinely is data rather than something the workflow author can hardcode.
    /// Cleared once the request resumes.
    /// </summary>
    public string? StateBeforeInformationRequest { get; private set; }

    private readonly List<ServiceRequestDocument> _documents = [];
    public IReadOnlyList<ServiceRequestDocument> Documents => _documents;

    private readonly List<AuditEntry> _auditTrail = [];

    /// <summary>The request's hash chain, in sequence order. Append only.</summary>
    public IReadOnlyList<AuditEntry> AuditTrail => _auditTrail;

    /// <summary>
    /// Optimistic concurrency token, mapped by EF Core. Two officers acting on the same
    /// request from two consoles must not silently overwrite each other; the loser gets a
    /// concurrency exception and re-reads.
    /// </summary>
    public uint RowVersion { get; private set; }

    public bool IsClosed => ClosedAt is not null;

    /// <summary>Head of the audit chain, or null before the first entry exists.</summary>
    public AuditEntry? LatestAuditEntry => _auditTrail.Count == 0 ? null : _auditTrail[^1];

    /// <summary>Distinct document types on file, matched case insensitively by document guards.</summary>
    public IReadOnlyList<string> SubmittedDocumentTypes =>
        _documents.Select(d => d.DocumentType).Distinct(StringComparer.OrdinalIgnoreCase).ToList();

    public bool HasUnverifiedDocuments => _documents.Any(d => !d.IsVerified);

    /// <summary>
    /// True once the applicant has taken a recorded action since the request entered its
    /// current state: a written response or a new attachment.
    ///
    /// Derived from the audit chain rather than stored in a flag. The chain is already the
    /// authoritative record of who did what and when, and a duplicate boolean would be one
    /// more thing that can drift out of step with it. Entering a new state naturally resets
    /// the answer, which is exactly the semantics the "awaiting applicant" guard needs.
    /// </summary>
    public bool ApplicantHasResponded =>
        _auditTrail.Any(e =>
            e.OccurredAt >= CurrentStateEnteredAt &&
            string.Equals(e.ActorUserId, ApplicantUserId, StringComparison.Ordinal) &&
            e.EventType is AuditEventType.InformationProvided
                or AuditEventType.DocumentUploaded
                or AuditEventType.CommentAdded);

    private ServiceRequest() { } // EF Core

    /// <summary>
    /// Lodges a new request against a published workflow and opens its audit chain.
    ///
    /// The request starts in the definition's start state. In this system a row exists only
    /// once the citizen has actually lodged the application, so <see cref="SubmittedAt"/> is
    /// set here; a start state such as DRAFT models "lodged but not yet released to the
    /// department", during which the citizen can still attach documents or withdraw.
    /// </summary>
    public static ServiceRequest Submit(
        WorkflowDefinition definition,
        string referenceNumber,
        string serviceType,
        string applicantUserId,
        string applicantDisplayName,
        DateTimeOffset submittedAt)
    {
        ArgumentNullException.ThrowIfNull(definition);

        // An unpublished definition has not passed structural validation, so it may contain
        // dead ends or unreachable states. Letting a citizen onto one would strand them.
        if (!definition.IsPublished)
            throw new WorkflowDefinitionException(
                $"Workflow '{definition.Key}' v{definition.Version} is not published and cannot accept requests.");

        // Qualified: this type also has an instance property called ReferenceNumber, and the
        // simple name would bind to that member rather than to the helper in a static context.
        if (!Muamalat.Domain.Common.ReferenceNumber.IsWellFormed(referenceNumber))
            throw new ArgumentException(
                $"Reference number '{referenceNumber}' is not well formed; expected a value such as 'MW-2026-000123'.",
                nameof(referenceNumber));

        if (string.IsNullOrWhiteSpace(serviceType))
            throw new ArgumentException("Service type is required.", nameof(serviceType));
        if (string.IsNullOrWhiteSpace(applicantUserId))
            throw new ArgumentException("Applicant user id is required.", nameof(applicantUserId));
        if (string.IsNullOrWhiteSpace(applicantDisplayName))
            throw new ArgumentException("Applicant display name is required.", nameof(applicantDisplayName));

        var startState = definition.StartState;

        var request = new ServiceRequest
        {
            ReferenceNumber = referenceNumber,
            WorkflowDefinitionId = definition.Id,
            WorkflowKey = definition.Key,
            WorkflowVersion = definition.Version,
            CurrentStateCode = startState.Code,
            ServiceType = serviceType,
            ApplicantUserId = applicantUserId,
            ApplicantDisplayName = applicantDisplayName,
            SubmittedAt = submittedAt,
            CurrentStateEnteredAt = submittedAt
        };

        request.AppendAudit(
            AuditEventType.RequestSubmitted,
            request.Applicant,
            submittedAt,
            toStateCode: startState.Code,
            payload: new RequestSubmittedPayload(
                definition.Key,
                definition.Version,
                serviceType,
                referenceNumber,
                startState.Code));

        return request;
    }

    /// <summary>The applicant as an actor, for operations the citizen performs on their own request.</summary>
    public TransitionActor Applicant => new(ApplicantUserId, ApplicantDisplayName, [ApplicantRole]);

    /// <summary>
    /// Attaches a document and records the upload in the audit chain. Duplicate document
    /// types are allowed on purpose: applicants routinely upload a corrected replacement,
    /// and deleting the superseded file would destroy evidence an auditor may need.
    /// </summary>
    public ServiceRequestDocument AttachDocument(
        string documentType,
        string fileName,
        string contentType,
        long sizeBytes,
        string storagePath,
        TransitionActor uploader,
        DateTimeOffset at)
    {
        ArgumentNullException.ThrowIfNull(uploader);
        RequireOpen(nameof(AttachDocument));

        var document = new ServiceRequestDocument(
            Id, documentType, fileName, contentType, sizeBytes, storagePath, uploader.UserId, at);

        _documents.Add(document);

        AppendAudit(
            AuditEventType.DocumentUploaded,
            uploader,
            at,
            toStateCode: CurrentStateCode,
            payload: new DocumentPayload(document.Id, document.DocumentType, document.SizeBytes));

        return document;
    }

    /// <summary>
    /// Verifies an attached document. Returns false when it was already verified, in which
    /// case nothing changes and no audit entry is written; a repeat click must not pollute
    /// the chain.
    /// </summary>
    public bool VerifyDocument(Guid documentId, TransitionActor verifier, DateTimeOffset at)
    {
        ArgumentNullException.ThrowIfNull(verifier);
        RequireOpen(nameof(VerifyDocument));

        var document = _documents.SingleOrDefault(d => d.Id == documentId)
            ?? throw new InvalidOperationException($"Document {documentId} does not belong to request {ReferenceNumber}.");

        if (!document.Verify(verifier.UserId, at)) return false;

        AppendAudit(
            AuditEventType.DocumentVerified,
            verifier,
            at,
            toStateCode: CurrentStateCode,
            payload: new DocumentPayload(document.Id, document.DocumentType, document.SizeBytes));

        return true;
    }

    /// <summary>
    /// Records that the service fee has been settled. Returns false when it was already
    /// paid, so a duplicate payment callback from the gateway is harmless.
    /// </summary>
    public bool MarkFeePaid(TransitionActor actor, DateTimeOffset at)
    {
        ArgumentNullException.ThrowIfNull(actor);
        RequireOpen(nameof(MarkFeePaid));

        if (FeePaid) return false;

        FeePaid = true;
        AppendAudit(AuditEventType.FeePaid, actor, at, toStateCode: CurrentStateCode);
        return true;
    }

    /// <summary>
    /// Records the applicant's written reply to an information request. This is what
    /// satisfies <see cref="GuardKind.RequiresApplicantResponse"/>, so the officer is never
    /// left guessing whether the citizen actually came back.
    /// </summary>
    public AuditEntry RecordApplicantResponse(string comment, DateTimeOffset at)
    {
        if (string.IsNullOrWhiteSpace(comment))
            throw new ArgumentException("An applicant response must say something.", nameof(comment));

        RequireOpen(nameof(RecordApplicantResponse));

        return AppendAudit(
            AuditEventType.InformationProvided,
            Applicant,
            at,
            toStateCode: CurrentStateCode,
            comment: comment);
    }

    /// <summary>
    /// Assigns the request to a named officer, for example when a supervisor allocates work
    /// from a departmental queue. Separate from the workflow's own assignment actions
    /// because it happens between transitions, without moving the request.
    /// </summary>
    public AuditEntry AssignToUser(string userId, TransitionActor actor, DateTimeOffset at)
    {
        if (string.IsNullOrWhiteSpace(userId))
            throw new ArgumentException("Assignee user id is required.", nameof(userId));

        ArgumentNullException.ThrowIfNull(actor);
        RequireOpen(nameof(AssignToUser));

        AssignedToUserId = userId;

        return AppendAudit(
            AuditEventType.Assigned,
            actor,
            at,
            toStateCode: CurrentStateCode,
            payload: new AssignmentPayload(AssignedToDepartment, AssignedToRole, AssignedToUserId));
    }

    // ---------------------------------------------------------------------------------
    // State-machine mutators. Internal so that WorkflowEngine is the only caller: every
    // move has to be guarded, ordered and audited, and a public setter here would let the
    // application layer bypass all three.
    // ---------------------------------------------------------------------------------

    internal void EnterState(string stateCode, DateTimeOffset now, bool isTerminal)
    {
        CurrentStateCode = stateCode;
        CurrentStateEnteredAt = now;

        // Closing is one way. Re-entering a terminal state is impossible anyway, since a
        // closed request refuses every transition, but the guard keeps the first close
        // authoritative if that ever changes.
        if (isTerminal && ClosedAt is null) ClosedAt = now;
    }

    internal void RememberInformationRequestOrigin(string stateCode) => StateBeforeInformationRequest = stateCode;

    internal void ClearInformationRequestOrigin() => StateBeforeInformationRequest = null;

    /// <summary>
    /// Routes the request to a department. Clears the narrower role and individual
    /// assignments: handing a file to another department cannot leave it claimed by an
    /// officer who no longer owns it. A transition that wants both applies
    /// AssignToDepartment first and AssignToRole second, and actions run in author order.
    /// </summary>
    internal void AssignToDepartment(string department)
    {
        AssignedToDepartment = department;
        AssignedToRole = null;
        AssignedToUserId = null;
    }

    internal void AssignToRole(string role)
    {
        AssignedToRole = role;
        AssignedToUserId = null;
    }

    internal void ClearAssignment()
    {
        AssignedToDepartment = null;
        AssignedToRole = null;
        AssignedToUserId = null;
    }

    /// <summary>Stamps the decision date. The first decision wins; a later action must not backdate or overwrite it.</summary>
    internal void StampDecision(DateTimeOffset at) => DecisionAt ??= at;

    /// <summary>
    /// Appends an entry to this request's hash chain. Internal because the chain is the
    /// aggregate's integrity guarantee: only the root and the workflow engine may extend
    /// it, and nothing may ever edit or remove an existing link.
    /// </summary>
    internal AuditEntry AppendAudit(
        AuditEventType eventType,
        TransitionActor actor,
        DateTimeOffset occurredAt,
        string? fromStateCode = null,
        string? toStateCode = null,
        string? transitionCode = null,
        string? comment = null,
        object? payload = null)
    {
        var entry = AuditEntry.Append(
            LatestAuditEntry,
            Id,
            eventType,
            actor.UserId,
            actor.DisplayName,
            actor.Roles,
            occurredAt,
            fromStateCode,
            toStateCode,
            transitionCode,
            comment,
            payload);

        _auditTrail.Add(entry);
        return entry;
    }

    private void RequireOpen(string operation)
    {
        if (IsClosed)
            throw new InvalidOperationException(
                $"Request {ReferenceNumber} was closed on {ClosedAt:O}; '{operation}' is no longer permitted.");
    }
}

/// <summary>
/// Audit payloads are a stored format, not an implementation detail: they are hashed into
/// the chain, so renaming or reordering a property silently invalidates every historical
/// entry. Positional records fix the serialised order at the declaration site. Add new
/// properties only at the end, and never remove one.
/// </summary>
public sealed record RequestSubmittedPayload(
    string WorkflowKey,
    int WorkflowVersion,
    string ServiceType,
    string ReferenceNumber,
    string StartStateCode);

/// <inheritdoc cref="RequestSubmittedPayload"/>
public sealed record DocumentPayload(Guid DocumentId, string DocumentType, long SizeBytes);

/// <inheritdoc cref="RequestSubmittedPayload"/>
public sealed record AssignmentPayload(string? Department, string? Role, string? UserId);
