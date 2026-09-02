namespace Muamalat.Domain.Workflow;

/// <summary>
/// A single stage in a workflow. Owns the SLA policy that applies while a request
/// sits in this state, and the department responsible for acting on it.
/// </summary>
public sealed class WorkflowState
{
    public Guid Id { get; private set; } = Guid.CreateVersion7();
    public Guid WorkflowDefinitionId { get; private set; }

    /// <summary>Stable machine code, e.g. "TECHNICAL_REVIEW". Unique within a definition.</summary>
    public string Code { get; private set; } = null!;

    public string NameEn { get; private set; } = null!;
    public string NameAr { get; private set; } = null!;

    public StateKind Kind { get; private set; }

    /// <summary>Department whose officers own work in this state. Null for citizen-owned states.</summary>
    public string? OwningDepartment { get; private set; }

    /// <summary>
    /// Time allowed in this state before the request is considered breached.
    /// Null means no SLA applies (typically citizen-owned states, where we are
    /// waiting on the applicant rather than on the government).
    /// </summary>
    public SlaPolicy? Sla { get; private set; }

    /// <summary>Display order in the admin designer and the citizen progress tracker.</summary>
    public int SortOrder { get; private set; }

    private WorkflowState() { } // EF Core

    internal WorkflowState(Guid workflowDefinitionId, string code, string nameEn, string nameAr, StateKind kind)
    {
        if (string.IsNullOrWhiteSpace(code)) throw new ArgumentException("State code is required.", nameof(code));

        WorkflowDefinitionId = workflowDefinitionId;
        Code = code;
        NameEn = nameEn;
        NameAr = nameAr;
        Kind = kind;
    }

    public WorkflowState OwnedBy(string department)
    {
        OwningDepartment = department;
        return this;
    }

    public WorkflowState WithSla(TimeSpan target, TimeSpan? warnAfter = null, string? escalateToRole = null)
    {
        Sla = new SlaPolicy(target, warnAfter, escalateToRole);
        return this;
    }

    public WorkflowState At(int sortOrder)
    {
        SortOrder = sortOrder;
        return this;
    }
}

/// <summary>
/// SLA rules for a state. <see cref="WarnAfter"/> drives the "at risk" indicator on the
/// supervisor console; <see cref="Target"/> is the hard breach point that triggers escalation.
/// </summary>
public sealed record SlaPolicy
{
    public TimeSpan Target { get; }

    /// <summary>When to flag the request as at risk. Defaults to 75% of the target.</summary>
    public TimeSpan WarnAfter { get; }

    /// <summary>Role notified on breach. Null means record the breach but do not escalate.</summary>
    public string? EscalateToRole { get; }

    /// <summary>
    /// Materialisation constructor for EF Core. The validating constructor below takes an
    /// optional <c>TimeSpan?</c> so callers can omit the warning threshold, but EF binds
    /// constructor parameters to mapped properties by name AND type, and cannot bind a
    /// nullable parameter to a non-nullable property. This overload exists solely to give it
    /// an exact match; it performs no validation because the values it receives were already
    /// validated before they were persisted.
    /// </summary>
    private SlaPolicy(TimeSpan target, TimeSpan warnAfter, string? escalateToRole)
    {
        Target = target;
        WarnAfter = warnAfter;
        EscalateToRole = escalateToRole;
    }

    public SlaPolicy(TimeSpan target, TimeSpan? warnAfter = null, string? escalateToRole = null)
    {
        if (target <= TimeSpan.Zero)
            throw new ArgumentOutOfRangeException(nameof(target), "SLA target must be positive.");

        var warn = warnAfter ?? TimeSpan.FromTicks((long)(target.Ticks * 0.75));

        if (warn > target)
            throw new ArgumentOutOfRangeException(nameof(warnAfter), "Warning threshold cannot exceed the SLA target.");

        Target = target;
        WarnAfter = warn;
        EscalateToRole = escalateToRole;
    }

    public SlaStatus Evaluate(DateTimeOffset enteredState, DateTimeOffset now)
    {
        var elapsed = now - enteredState;
        if (elapsed >= Target) return SlaStatus.Breached;
        if (elapsed >= WarnAfter) return SlaStatus.AtRisk;
        return SlaStatus.OnTrack;
    }

    public DateTimeOffset DueAt(DateTimeOffset enteredState) => enteredState + Target;
}

public enum SlaStatus
{
    OnTrack = 0,
    AtRisk = 1,
    Breached = 2
}
