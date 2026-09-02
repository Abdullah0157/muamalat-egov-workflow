using Muamalat.Domain.Auditing;
using Muamalat.Domain.Common;
using Muamalat.Domain.Requests;

namespace Muamalat.Domain.Workflow;

/// <summary>
/// Executes workflow transitions against a service request. This is the single place in
/// the system where a request is allowed to change state.
///
/// Two rules shape the whole design.
///
/// First, expected business outcomes are returned, not thrown. "You are not allowed to
/// approve this", "the fee is unpaid" and "this request is already closed" are normal
/// answers in a government back office, they happen thousands of times a day, and turning
/// them into exceptions would make ordinary operation look like a fault and drown the
/// error budget. Exceptions are reserved for programmer errors: a request executed against
/// the wrong workflow definition, or a definition whose data is internally inconsistent.
///
/// Second, nothing is mutated until every check has passed. All validation runs first and
/// the aggregate is only touched once the transition is certain to succeed, so a rejected
/// call can never leave a half-moved request behind, whatever the caller does with the
/// result.
///
/// The engine performs no IO. Notifications are returned as data for the application layer
/// to dispatch after the transaction commits; sending an email from inside the domain would
/// mean telling a citizen their licence was approved and then rolling the approval back.
/// </summary>
public sealed class WorkflowEngine
{
    /// <summary>
    /// Attempts to move <paramref name="request"/> along <paramref name="transitionCode"/>.
    /// </summary>
    /// <param name="definition">
    /// The workflow version the request is pinned to. Callers load it by
    /// <see cref="ServiceRequest.WorkflowDefinitionId"/>; passing any other version is a bug
    /// and throws rather than failing softly.
    /// </param>
    /// <param name="now">
    /// Injected rather than read from the clock so that SLA behaviour, state entry times and
    /// audit timestamps are all deterministic under test and consistent within one request.
    /// </param>
    /// <exception cref="ArgumentException">The definition does not match the request's pinned workflow.</exception>
    /// <exception cref="WorkflowDefinitionException">The definition is internally inconsistent.</exception>
    public ExecuteResult Execute(
        ServiceRequest request,
        WorkflowDefinition definition,
        string transitionCode,
        TransitionActor actor,
        DateTimeOffset now,
        string? comment = null)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(definition);
        ArgumentNullException.ThrowIfNull(actor);

        if (string.IsNullOrWhiteSpace(transitionCode))
            throw new ArgumentException("Transition code is required.", nameof(transitionCode));

        // (a) Wrong definition. Not a business failure: the caller loaded the wrong row.
        RequirePinnedDefinition(request, definition);

        var currentState = definition.RequireState(request.CurrentStateCode);

        // (b) Closed. Checked against both the timestamp and the state kind, because a
        // request whose stored state is terminal but whose ClosedAt is missing is corrupt
        // data that must still be refused rather than quietly moved on.
        if (request.IsClosed || currentState.Kind == StateKind.Terminal)
        {
            return ExecuteResult.Failure(
                FailureCodes.RequestClosed,
                $"Request {request.ReferenceNumber} is closed in state '{currentState.Code}' and cannot be transitioned.");
        }

        // (c) The transition must exist AND leave the state the request is actually in.
        // Both are reported with one code on purpose: telling a caller that a transition
        // exists but not from here leaks the shape of the workflow to an unprivileged user.
        var transition = definition.Transitions.SingleOrDefault(
            t => t.Code == transitionCode && t.FromStateCode == currentState.Code);

        if (transition is null)
        {
            return ExecuteResult.Failure(
                FailureCodes.TransitionNotAvailable,
                $"Transition '{transitionCode}' is not available from state '{currentState.Code}' in workflow '{definition.Key}' v{definition.Version}.");
        }

        // (d) Authorisation.
        if (!transition.IsAllowedForRoles(actor.Roles))
        {
            return ExecuteResult.Failure(
                FailureCodes.TransitionForbidden,
                $"Transition '{transition.Code}' requires one of [{string.Join(", ", transition.AllowedRoles)}].");
        }

        // (e) Mandatory reason. Checked before the guards so a rejection without a reason
        // always reports the missing reason, rather than whichever guard happened to fail
        // first; the officer would otherwise fix the wrong thing.
        if (transition.RequiresComment && string.IsNullOrWhiteSpace(comment))
        {
            return ExecuteResult.Failure(
                FailureCodes.CommentRequired,
                $"Transition '{transition.Code}' requires a comment.");
        }

        // (f) Data-driven guards, in the order the workflow author wrote them.
        var guardFailure = CheckGuards(request, transition, actor, comment);
        if (guardFailure is not null)
        {
            return ExecuteResult.Failure(
                guardFailure,
                $"Transition '{transition.Code}' was blocked by guard '{guardFailure}'.");
        }

        // A definition whose actions cannot be executed is caught before anything moves, so
        // the guarantee below is real rather than aspirational.
        RequireExecutableActions(transition);

        // ---- Every check has passed. From here nothing may fail, so mutation is safe. ----

        var fromStateCode = currentState.Code;
        var targetState = definition.RequireState(ResolveTargetStateCode(request, transition));

        if (transition.Kind == TransitionKind.RequestInformation)
            request.RememberInformationRequestOrigin(fromStateCode);

        request.EnterState(targetState.Code, now, targetState.Kind == StateKind.Terminal);

        // Cleared after the move, never before: ResolveTargetStateCode has to read it.
        if (transition.Kind == TransitionKind.ResumeAfterInfo)
            request.ClearInformationRequestOrigin();

        var notifications = ApplyActions(request, transition, targetState.Code, now, comment);

        var entry = request.AppendAudit(
            EventTypeFor(transition),
            actor,
            now,
            fromStateCode,
            targetState.Code,
            transition.Code,
            comment,
            new TransitionAuditPayload(
                request.WorkflowKey,
                request.WorkflowVersion,
                transition.Kind.ToString(),
                request.AssignedToDepartment,
                request.AssignedToRole,
                request.AssignedToUserId,
                request.DecisionAt is not null,
                request.IsClosed));

        return ExecuteResult.Success(fromStateCode, targetState.Code, entry, notifications);
    }

    /// <summary>
    /// Transitions the actor may attempt from the request's current state.
    ///
    /// Filtered by role but deliberately NOT by guards. A caseworker needs to see that
    /// "Send for approval" is the next step and that it is blocked because a document is
    /// still unverified; hiding the button instead makes the system look broken and
    /// generates a support call. Callers render the action, then call
    /// <see cref="Execute"/> and surface the returned failure code as the reason.
    /// </summary>
    public IReadOnlyList<WorkflowTransition> AvailableTransitions(
        ServiceRequest request,
        WorkflowDefinition definition,
        TransitionActor actor)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(definition);
        ArgumentNullException.ThrowIfNull(actor);

        RequirePinnedDefinition(request, definition);

        var currentState = definition.RequireState(request.CurrentStateCode);
        if (request.IsClosed || currentState.Kind == StateKind.Terminal) return [];

        return definition.TransitionsFrom(currentState.Code)
            .Where(t => t.IsAllowedForRoles(actor.Roles))
            .ToList();
    }

    /// <summary>
    /// Reports where the request stands against the SLA of the state it is sitting in.
    ///
    /// Read only. It records no audit entry and raises no escalation of its own: this is
    /// called on every console refresh, and a query that writes would flood the chain. The
    /// background SLA sweep uses the same snapshot to decide when to escalate once.
    /// </summary>
    public SlaSnapshot EvaluateSla(ServiceRequest request, WorkflowDefinition definition, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(definition);

        RequirePinnedDefinition(request, definition);

        var state = definition.RequireState(request.CurrentStateCode);

        // A closed request stops accruing time. Otherwise every historical approval would
        // drift into breach and the department's performance figures would be fiction.
        var reference = request.ClosedAt is { } closedAt && closedAt < now ? closedAt : now;

        // Defensive against clock skew between application nodes; a negative age would make
        // an on-track request look like it had not started.
        var elapsed = reference > request.CurrentStateEnteredAt
            ? reference - request.CurrentStateEnteredAt
            : TimeSpan.Zero;

        if (state.Sla is null)
        {
            // No SLA is not a breach. Citizen-owned states such as "more information
            // required" have none, because the government is not the party being measured.
            return new SlaSnapshot
            {
                StateCode = state.Code,
                HasSla = false,
                Status = SlaStatus.OnTrack,
                Elapsed = elapsed
            };
        }

        var status = state.Sla.Evaluate(request.CurrentStateEnteredAt, reference);
        var dueAt = state.Sla.DueAt(request.CurrentStateEnteredAt);

        return new SlaSnapshot
        {
            StateCode = state.Code,
            HasSla = true,
            Status = status,
            DueAt = dueAt,
            Elapsed = elapsed,
            Remaining = dueAt - reference,
            EscalateToRole = status == SlaStatus.Breached ? state.Sla.EscalateToRole : null
        };
    }

    /// <summary>
    /// Resolves where a transition actually lands.
    ///
    /// For everything except <see cref="TransitionKind.ResumeAfterInfo"/> this is simply the
    /// authored target.
    ///
    /// For a resume, the recorded <see cref="ServiceRequest.StateBeforeInformationRequest"/>
    /// wins over the authored target when it is present. That is the design decision, and
    /// the alternative (a blank or sentinel ToStateCode meaning "wherever you came from")
    /// was rejected because it cannot be expressed: <see cref="WorkflowDefinition.AddTransition"/>
    /// requires a real target state, and <see cref="WorkflowDefinition.Validate"/> would then
    /// flag the sentinel as an unreachable dead end at publish time. Structural validation is
    /// worth more than syntactic tidiness.
    ///
    /// So a resume transition declares a genuine target, which stays meaningful in two ways:
    /// it keeps reachability analysis honest, and it is the fallback when no origin was
    /// recorded. The recorded origin takes precedence, which is what lets several review
    /// states share one "more information required" state and each get its own file back,
    /// without the author enumerating one resume transition per origin.
    /// </summary>
    private static string ResolveTargetStateCode(ServiceRequest request, WorkflowTransition transition)
    {
        if (transition.Kind != TransitionKind.ResumeAfterInfo) return transition.ToStateCode;

        var origin = request.StateBeforeInformationRequest;
        return string.IsNullOrWhiteSpace(origin) ? transition.ToStateCode : origin;
    }

    /// <summary>
    /// Runs the transition's guards and returns the first failure code, or null when all pass.
    ///
    /// The context is rebuilt per guard rather than once, because
    /// <see cref="GuardKind.RequiresDifferentActorThan"/> is parameterised: which earlier
    /// actor counts as "the previous one" depends on that guard's own parameter.
    /// </summary>
    private static string? CheckGuards(
        ServiceRequest request,
        WorkflowTransition transition,
        TransitionActor actor,
        string? comment)
    {
        if (transition.Guards.Count == 0) return null;

        var context = BuildGuardContext(request, actor, comment);

        foreach (var guard in transition.Guards)
        {
            var scoped = guard.Kind == GuardKind.RequiresDifferentActorThan
                ? context with { PreviousActorUserId = ResolvePreviousActor(request, guard.Parameter) }
                : context;

            var failure = guard.Check(scoped);
            if (failure is not null) return failure;
        }

        return null;
    }

    private static GuardContext BuildGuardContext(ServiceRequest request, TransitionActor actor, string? comment) =>
        new()
        {
            RequestId = request.Id,
            ActorUserId = actor.UserId,
            ActorRoles = actor.Roles,
            Comment = comment,
            SubmittedDocumentTypes = request.SubmittedDocumentTypes,
            HasUnverifiedDocuments = request.HasUnverifiedDocuments,
            FeePaid = request.FeePaid,
            ApplicantHasResponded = request.ApplicantHasResponded
        };

    /// <summary>
    /// Finds the actor a segregation-of-duties guard must exclude.
    ///
    /// With a parameter, it is the actor of the most recent execution of the named
    /// transition, so a workflow can say precisely "the approver must not be whoever sent
    /// this for approval" even when unrelated steps happened in between. Without one, it
    /// falls back to the actor of the immediately preceding transition.
    ///
    /// Only entries carrying a transition code count. Uploading a document, paying a fee or
    /// being assigned a case are not decisions, and letting them shadow the real previous
    /// decision maker would silently disable the control.
    /// </summary>
    private static string? ResolvePreviousActor(ServiceRequest request, string? transitionCode)
    {
        var trail = request.AuditTrail;

        for (var i = trail.Count - 1; i >= 0; i--)
        {
            var entry = trail[i];
            if (entry.TransitionCode is null) continue;

            if (string.IsNullOrWhiteSpace(transitionCode)) return entry.ActorUserId;
            if (string.Equals(entry.TransitionCode, transitionCode, StringComparison.Ordinal)) return entry.ActorUserId;
        }

        return null;
    }

    /// <summary>
    /// Applies the transition's actions in the order the author declared them. Order is
    /// significant and intentional: AssignToDepartment widens the assignment back out, so a
    /// workflow that wants a department and a role queue writes the department first.
    /// </summary>
    private static IReadOnlyList<WorkflowNotification> ApplyActions(
        ServiceRequest request,
        WorkflowTransition transition,
        string toStateCode,
        DateTimeOffset now,
        string? comment)
    {
        if (transition.Actions.Count == 0) return [];

        var notifications = new List<WorkflowNotification>();

        foreach (var action in transition.Actions)
        {
            switch (action.Kind)
            {
                case ActionKind.AssignToDepartment:
                    request.AssignToDepartment(RequireParameter(transition, action));
                    break;

                case ActionKind.AssignToRole:
                    request.AssignToRole(RequireParameter(transition, action));
                    break;

                case ActionKind.ClearAssignment:
                    request.ClearAssignment();
                    break;

                case ActionKind.StampDecisionDate:
                    request.StampDecision(now);
                    break;

                // Both audiences carry the actor's comment. For the applicant it is the
                // instruction they have to act on; for the receiving role it is the handover
                // note. Neither is a message body: the template and the language are chosen
                // downstream from the transition and state codes.
                case ActionKind.NotifyApplicant:
                    notifications.Add(new WorkflowNotification
                    {
                        Audience = NotificationAudience.Applicant,
                        Recipient = request.ApplicantUserId,
                        ServiceRequestId = request.Id,
                        ReferenceNumber = request.ReferenceNumber,
                        TransitionCode = transition.Code,
                        ToStateCode = toStateCode,
                        Comment = comment
                    });
                    break;

                case ActionKind.NotifyRole:
                    notifications.Add(new WorkflowNotification
                    {
                        Audience = NotificationAudience.Role,
                        Recipient = RequireParameter(transition, action),
                        ServiceRequestId = request.Id,
                        ReferenceNumber = request.ReferenceNumber,
                        TransitionCode = transition.Code,
                        ToStateCode = toStateCode,
                        Comment = comment
                    });
                    break;

                // Unreachable while RequireExecutableActions runs first. Kept so that adding
                // an ActionKind without teaching this switch about it fails loudly instead
                // of silently dropping the effect the workflow author asked for.
                default:
                    throw new WorkflowDefinitionException(UnsupportedAction(transition, action.Kind));
            }
        }

        return notifications;
    }

    /// <summary>
    /// Rejects an unexecutable definition before the request is touched.
    ///
    /// Action parameters cannot be checked at publish time, because
    /// <see cref="WorkflowDefinition.Validate"/> is structural and knows nothing about what
    /// individual engine versions require of each action. Checking here, ahead of the
    /// mutation, is what keeps a failed execution free of side effects.
    /// </summary>
    private static void RequireExecutableActions(WorkflowTransition transition)
    {
        foreach (var action in transition.Actions)
        {
            switch (action.Kind)
            {
                case ActionKind.AssignToDepartment:
                case ActionKind.AssignToRole:
                case ActionKind.NotifyRole:
                    RequireParameter(transition, action);
                    break;

                case ActionKind.ClearAssignment:
                case ActionKind.StampDecisionDate:
                case ActionKind.NotifyApplicant:
                    break;

                default:
                    throw new WorkflowDefinitionException(UnsupportedAction(transition, action.Kind));
            }
        }
    }

    private static string UnsupportedAction(WorkflowTransition transition, ActionKind kind) =>
        $"Action kind '{kind}' on transition '{transition.Code}' is not supported by this engine version.";

    /// <summary>
    /// A parameterised action with no parameter is a defect in the stored definition, not
    /// something the acting officer can do anything about, so it throws.
    /// </summary>
    private static string RequireParameter(WorkflowTransition transition, TransitionAction action) =>
        string.IsNullOrWhiteSpace(action.Parameter)
            ? throw new WorkflowDefinitionException(
                $"Action '{action.Kind}' on transition '{transition.Code}' requires a parameter but none is configured.")
            : action.Parameter;

    /// <summary>
    /// Maps the transition to the audit vocabulary auditors read. Information requests and
    /// resumes are distinguished from ordinary state changes because "how long did we leave
    /// the citizen waiting" is a reported statistic, and deriving it from generic state
    /// changes after the fact is guesswork.
    /// </summary>
    private static AuditEventType EventTypeFor(WorkflowTransition transition) => transition.Kind switch
    {
        TransitionKind.RequestInformation => AuditEventType.InformationRequested,
        TransitionKind.ResumeAfterInfo => AuditEventType.InformationProvided,
        TransitionKind.Escalation => AuditEventType.Escalated,
        _ => AuditEventType.StateChanged
    };

    private static void RequirePinnedDefinition(ServiceRequest request, WorkflowDefinition definition)
    {
        if (request.WorkflowDefinitionId == definition.Id) return;

        throw new ArgumentException(
            $"Request {request.ReferenceNumber} is pinned to workflow '{request.WorkflowKey}' v{request.WorkflowVersion} " +
            $"({request.WorkflowDefinitionId}) but was executed against '{definition.Key}' v{definition.Version} ({definition.Id}).",
            nameof(definition));
    }
}

/// <summary>
/// Outcome of an attempted transition. A class rather than a record: it carries a
/// collection, and structural equality over a list would be quietly wrong.
/// </summary>
public sealed class ExecuteResult
{
    public bool Succeeded { get; private init; }

    /// <summary>Stable machine code from <see cref="FailureCodes"/> or from a guard. Null on success.</summary>
    public string? FailureCode { get; private init; }

    /// <summary>Developer-facing detail for logs. Never shown to a citizen; the UI localises the code.</summary>
    public string? FailureMessage { get; private init; }

    public string? FromStateCode { get; private init; }
    public string? ToStateCode { get; private init; }

    /// <summary>The audit entry written for this transition. Null on failure, since nothing happened.</summary>
    public AuditEntry? AuditEntry { get; private init; }

    /// <summary>
    /// Messages the application layer should dispatch after the transaction commits. The
    /// engine describes who to tell; it never performs the delivery.
    /// </summary>
    public IReadOnlyList<WorkflowNotification> Notifications { get; private init; } = [];

    internal static ExecuteResult Success(
        string fromStateCode,
        string toStateCode,
        AuditEntry auditEntry,
        IReadOnlyList<WorkflowNotification> notifications) =>
        new()
        {
            Succeeded = true,
            FromStateCode = fromStateCode,
            ToStateCode = toStateCode,
            AuditEntry = auditEntry,
            Notifications = notifications
        };

    internal static ExecuteResult Failure(string failureCode, string failureMessage) =>
        new()
        {
            Succeeded = false,
            FailureCode = failureCode,
            FailureMessage = failureMessage
        };
}

/// <summary>
/// A notification the transition asked for, described as data. Holds no message body and no
/// channel: the template, the language (English or Arabic) and the delivery route are
/// application concerns that change far more often than the workflow does.
/// </summary>
public sealed record WorkflowNotification
{
    public required NotificationAudience Audience { get; init; }

    /// <summary>The applicant's user id, or a role name, depending on <see cref="Audience"/>.</summary>
    public required string Recipient { get; init; }

    public required Guid ServiceRequestId { get; init; }
    public required string ReferenceNumber { get; init; }
    public required string TransitionCode { get; init; }
    public required string ToStateCode { get; init; }

    /// <summary>The actor's comment, when the transition carried one.</summary>
    public string? Comment { get; init; }
}

public enum NotificationAudience
{
    Applicant = 0,
    Role = 1
}

/// <summary>
/// Where a request stands against the SLA of its current state, at a given instant.
/// </summary>
public sealed record SlaSnapshot
{
    public required string StateCode { get; init; }

    /// <summary>False for states with no SLA policy, where <see cref="Status"/> is meaningless.</summary>
    public required bool HasSla { get; init; }

    public required SlaStatus Status { get; init; }

    /// <summary>Deadline for leaving this state. Null when the state has no SLA.</summary>
    public DateTimeOffset? DueAt { get; init; }

    /// <summary>Time spent in the current state, frozen at <c>ClosedAt</c> once the request closes.</summary>
    public required TimeSpan Elapsed { get; init; }

    /// <summary>Time left before <see cref="DueAt"/>. Negative once breached, which is the overdue amount.</summary>
    public TimeSpan? Remaining { get; init; }

    /// <summary>Role to escalate to. Populated only when breached, and only if the policy names one.</summary>
    public string? EscalateToRole { get; init; }

    public bool IsBreached => HasSla && Status == SlaStatus.Breached;
}

/// <summary>
/// Audit payload for a transition. Hashed into the chain, so it is a stored format:
/// property order is fixed by this positional record and must never be rearranged, and
/// properties may only be appended.
/// </summary>
public sealed record TransitionAuditPayload(
    string WorkflowKey,
    int WorkflowVersion,
    string TransitionKind,
    string? AssignedToDepartment,
    string? AssignedToRole,
    string? AssignedToUserId,
    bool DecisionStamped,
    bool Closed);
