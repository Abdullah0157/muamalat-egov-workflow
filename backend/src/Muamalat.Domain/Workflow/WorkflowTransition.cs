namespace Muamalat.Domain.Workflow;

/// <summary>
/// A permitted move between two states, together with the roles allowed to execute it,
/// the guards that must pass, and the actions applied on success.
///
/// Guards and actions are stored as data (a kind plus parameters) rather than as code,
/// so an administrator can compose them in the designer without a redeploy.
/// </summary>
public sealed class WorkflowTransition
{
    public Guid Id { get; private set; } = Guid.CreateVersion7();
    public Guid WorkflowDefinitionId { get; private set; }

    /// <summary>Stable machine code, e.g. "APPROVE". Unique within a definition.</summary>
    public string Code { get; private set; } = null!;

    public string FromStateCode { get; private set; } = null!;
    public string ToStateCode { get; private set; } = null!;

    public string NameEn { get; private set; } = null!;
    public string NameAr { get; private set; } = null!;

    private readonly List<string> _allowedRoles = [];
    public IReadOnlyList<string> AllowedRoles => _allowedRoles;

    private readonly List<TransitionGuard> _guards = [];
    public IReadOnlyList<TransitionGuard> Guards => _guards;

    private readonly List<TransitionAction> _actions = [];
    public IReadOnlyList<TransitionAction> Actions => _actions;

    /// <summary>
    /// Marks this transition as the "request more information" path. The engine records
    /// where the request came from so <see cref="TransitionKind.ResumeAfterInfo"/> can
    /// return it to the correct state rather than guessing.
    /// </summary>
    public TransitionKind Kind { get; private set; } = TransitionKind.Normal;

    /// <summary>Requires the actor to supply a reason. Enforced for rejections and info requests.</summary>
    public bool RequiresComment { get; private set; }

    private WorkflowTransition() { } // EF Core

    internal WorkflowTransition(
        Guid workflowDefinitionId,
        string code,
        string fromStateCode,
        string toStateCode,
        string nameEn,
        string nameAr)
    {
        if (string.IsNullOrWhiteSpace(code)) throw new ArgumentException("Transition code is required.", nameof(code));

        WorkflowDefinitionId = workflowDefinitionId;
        Code = code;
        FromStateCode = fromStateCode;
        ToStateCode = toStateCode;
        NameEn = nameEn;
        NameAr = nameAr;
    }

    public WorkflowTransition ForRoles(params string[] roles)
    {
        foreach (var role in roles)
        {
            if (!_allowedRoles.Contains(role)) _allowedRoles.Add(role);
        }
        return this;
    }

    public WorkflowTransition WithGuard(TransitionGuard guard)
    {
        _guards.Add(guard);
        return this;
    }

    public WorkflowTransition WithAction(TransitionAction action)
    {
        _actions.Add(action);
        return this;
    }

    public WorkflowTransition AsKind(TransitionKind kind)
    {
        Kind = kind;
        return this;
    }

    public WorkflowTransition RequiringComment()
    {
        RequiresComment = true;
        return this;
    }

    public bool IsAllowedForRoles(IEnumerable<string> actorRoles) =>
        actorRoles.Any(r => _allowedRoles.Contains(r, StringComparer.OrdinalIgnoreCase));
}

public enum TransitionKind
{
    Normal = 0,

    /// <summary>Sends the request back to the applicant for more information.</summary>
    RequestInformation = 1,

    /// <summary>Applicant has responded; return the request to the state that asked.</summary>
    ResumeAfterInfo = 2,

    /// <summary>Escalation path, normally driven by the SLA sweep rather than by a person.</summary>
    Escalation = 3
}

/// <summary>
/// A precondition evaluated against the request before a transition is permitted.
/// Data-driven: <see cref="Kind"/> selects the rule, <see cref="Parameter"/> configures it.
/// </summary>
public sealed record TransitionGuard(GuardKind Kind, string? Parameter = null)
{
    /// <summary>Returns null when the guard passes, or a machine-readable failure code when it does not.</summary>
    public string? Check(GuardContext context) => Kind switch
    {
        GuardKind.RequiresDocumentType =>
            context.SubmittedDocumentTypes.Contains(Parameter ?? string.Empty, StringComparer.OrdinalIgnoreCase)
                ? null
                : $"guard.missing_document:{Parameter}",

        GuardKind.RequiresAllDocumentsVerified =>
            context.HasUnverifiedDocuments ? "guard.documents_not_verified" : null,

        GuardKind.RequiresFeePaid =>
            context.FeePaid ? null : "guard.fee_unpaid",

        GuardKind.RequiresComment =>
            string.IsNullOrWhiteSpace(context.Comment) ? "guard.comment_required" : null,

        GuardKind.RequiresDifferentActorThan =>
            context.ActorUserId == context.PreviousActorUserId && context.PreviousActorUserId is not null
                ? "guard.segregation_of_duties"
                : null,

        GuardKind.RequiresApplicantResponse =>
            context.ApplicantHasResponded ? null : "guard.awaiting_applicant",

        _ => throw new WorkflowDefinitionException($"Unknown guard kind '{Kind}'.")
    };
}

public enum GuardKind
{
    RequiresDocumentType = 0,
    RequiresAllDocumentsVerified = 1,
    RequiresFeePaid = 2,
    RequiresComment = 3,

    /// <summary>Segregation of duties: the approver must not be the person who reviewed.</summary>
    RequiresDifferentActorThan = 4,

    RequiresApplicantResponse = 5
}

/// <summary>Read-only view of the request handed to guards. Guards never mutate state.</summary>
public sealed record GuardContext
{
    public required Guid RequestId { get; init; }
    public required string ActorUserId { get; init; }
    public required IReadOnlyList<string> ActorRoles { get; init; }
    public string? Comment { get; init; }
    public string? PreviousActorUserId { get; init; }
    public IReadOnlyList<string> SubmittedDocumentTypes { get; init; } = [];
    public bool HasUnverifiedDocuments { get; init; }
    public bool FeePaid { get; init; }
    public bool ApplicantHasResponded { get; init; }
}

/// <summary>An effect applied to the request after a transition succeeds.</summary>
public sealed record TransitionAction(ActionKind Kind, string? Parameter = null);

public enum ActionKind
{
    AssignToDepartment = 0,
    AssignToRole = 1,
    ClearAssignment = 2,
    NotifyApplicant = 3,
    NotifyRole = 4,
    StampDecisionDate = 5
}
