namespace Muamalat.Domain.Workflow;

/// <summary>
/// A versioned, data-driven workflow. Definitions are stored in the database and
/// edited by administrators; no stage or transition is hardcoded in application code.
///
/// Versioning matters: an in-flight request must keep executing against the definition
/// version it started on, otherwise editing a workflow would silently change the rules
/// under requests that are already halfway through it.
/// </summary>
public sealed class WorkflowDefinition
{
    public Guid Id { get; private set; } = Guid.CreateVersion7();

    /// <summary>Stable key shared by every version of the same workflow, e.g. "commercial-licence-renewal".</summary>
    public string Key { get; private set; } = null!;

    public int Version { get; private set; }

    public string NameEn { get; private set; } = null!;
    public string NameAr { get; private set; } = null!;

    /// <summary>Only one version of a given <see cref="Key"/> may be published at a time.</summary>
    public bool IsPublished { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; } = DateTimeOffset.UtcNow;

    private readonly List<WorkflowState> _states = [];
    public IReadOnlyList<WorkflowState> States => _states;

    private readonly List<WorkflowTransition> _transitions = [];
    public IReadOnlyList<WorkflowTransition> Transitions => _transitions;

    /// <summary>Optimistic concurrency token; two admins editing the same definition must not silently clobber each other.</summary>
    public uint RowVersion { get; private set; }

    private WorkflowDefinition() { } // EF Core

    public WorkflowDefinition(string key, int version, string nameEn, string nameAr)
    {
        if (string.IsNullOrWhiteSpace(key)) throw new ArgumentException("Workflow key is required.", nameof(key));
        if (version < 1) throw new ArgumentOutOfRangeException(nameof(version), "Version starts at 1.");

        Key = key;
        Version = version;
        NameEn = nameEn;
        NameAr = nameAr;
    }

    public WorkflowState AddState(string code, string nameEn, string nameAr, StateKind kind)
    {
        if (_states.Any(s => s.Code == code))
            throw new WorkflowDefinitionException($"State '{code}' is already defined in workflow '{Key}' v{Version}.");

        if (kind == StateKind.Start && _states.Any(s => s.Kind == StateKind.Start))
            throw new WorkflowDefinitionException($"Workflow '{Key}' v{Version} already has a start state.");

        var state = new WorkflowState(Id, code, nameEn, nameAr, kind);
        _states.Add(state);
        return state;
    }

    public WorkflowTransition AddTransition(
        string code,
        string fromStateCode,
        string toStateCode,
        string nameEn,
        string nameAr)
    {
        var from = RequireState(fromStateCode);
        var to = RequireState(toStateCode);

        if (from.Kind == StateKind.Terminal)
            throw new WorkflowDefinitionException($"State '{fromStateCode}' is terminal and cannot have outgoing transitions.");

        if (_transitions.Any(t => t.Code == code))
            throw new WorkflowDefinitionException($"Transition '{code}' is already defined in workflow '{Key}' v{Version}.");

        var transition = new WorkflowTransition(Id, code, from.Code, to.Code, nameEn, nameAr);
        _transitions.Add(transition);
        return transition;
    }

    public WorkflowState StartState =>
        _states.SingleOrDefault(s => s.Kind == StateKind.Start)
        ?? throw new WorkflowDefinitionException($"Workflow '{Key}' v{Version} has no start state.");

    public WorkflowState RequireState(string code) =>
        _states.SingleOrDefault(s => s.Code == code)
        ?? throw new WorkflowDefinitionException($"State '{code}' is not defined in workflow '{Key}' v{Version}.");

    public IReadOnlyList<WorkflowTransition> TransitionsFrom(string stateCode) =>
        _transitions.Where(t => t.FromStateCode == stateCode).ToList();

    /// <summary>
    /// Structural validation, run before a definition may be published. A workflow that
    /// can strand a request in a dead end is a production incident waiting to happen,
    /// so this is enforced at publish time rather than discovered at runtime.
    /// </summary>
    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();

        var starts = _states.Where(s => s.Kind == StateKind.Start).ToList();
        if (starts.Count == 0) errors.Add("Workflow has no start state.");
        if (starts.Count > 1) errors.Add("Workflow has more than one start state.");

        if (!_states.Any(s => s.Kind == StateKind.Terminal))
            errors.Add("Workflow has no terminal state.");

        foreach (var state in _states.Where(s => s.Kind != StateKind.Terminal))
        {
            if (!_transitions.Any(t => t.FromStateCode == state.Code))
                errors.Add($"State '{state.Code}' is not terminal but has no outgoing transition (dead end).");
        }

        // Every non-start state must be reachable from the start state.
        if (starts.Count == 1)
        {
            var reachable = ReachableFrom(starts[0].Code);
            foreach (var state in _states.Where(s => !reachable.Contains(s.Code)))
                errors.Add($"State '{state.Code}' is unreachable from the start state.");
        }

        foreach (var transition in _transitions)
        {
            if (_states.All(s => s.Code != transition.ToStateCode))
                errors.Add($"Transition '{transition.Code}' targets undefined state '{transition.ToStateCode}'.");

            if (transition.AllowedRoles.Count == 0)
                errors.Add($"Transition '{transition.Code}' has no allowed roles; nobody could ever execute it.");
        }

        return errors;
    }

    private HashSet<string> ReachableFrom(string startCode)
    {
        var seen = new HashSet<string> { startCode };
        var queue = new Queue<string>();
        queue.Enqueue(startCode);

        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            foreach (var next in _transitions.Where(t => t.FromStateCode == current).Select(t => t.ToStateCode))
            {
                if (seen.Add(next)) queue.Enqueue(next);
            }
        }

        return seen;
    }

    public void Publish()
    {
        var errors = Validate();
        if (errors.Count > 0)
            throw new WorkflowDefinitionException(
                $"Workflow '{Key}' v{Version} cannot be published:{Environment.NewLine}- " +
                string.Join($"{Environment.NewLine}- ", errors));

        IsPublished = true;
    }

    public void Unpublish() => IsPublished = false;
}

public enum StateKind
{
    /// <summary>Entry point. Exactly one per definition.</summary>
    Start = 0,

    /// <summary>Normal working state; a request sits here awaiting action.</summary>
    Intermediate = 1,

    /// <summary>End of the line. No outgoing transitions (approved, rejected, withdrawn).</summary>
    Terminal = 2
}

public sealed class WorkflowDefinitionException(string message) : Exception(message);
