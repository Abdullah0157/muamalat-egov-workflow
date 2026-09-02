using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Muamalat.Domain.Workflow;
using Muamalat.Infrastructure.Persistence;

namespace Muamalat.Api.Endpoints;

/// <summary>
/// Workflow definition management. This is the API behind the administrator's designer:
/// definitions are read, edited and published as data, which is what allows a new government
/// service to be introduced without shipping code.
/// </summary>
public static class WorkflowEndpoints
{
    public static IEndpointRouteBuilder MapWorkflowEndpoints(this IEndpointRouteBuilder app)
    {
        // Readable by any signed in user. A citizen cannot choose a service, see
        // what a service is called, or follow their own progress tracker without
        // the definition, so gating reads behind an officer role locks citizens
        // out of the service catalogue entirely. Nothing here is sensitive: it is
        // the published description of a public government service.
        var group = app.MapGroup("/api/workflows")
            .WithTags("Workflows")
            .RequireAuthorization();

        group.MapGet("/", ListAsync)
            .WithSummary("List workflow definitions")
            .WithDescription("Returns every workflow definition, newest version first, across all keys.");

        group.MapGet("/{key}/versions/{version:int}", GetAsync)
            .WithSummary("Get a specific workflow version");

        group.MapGet("/{key}/published", GetPublishedAsync)
            .WithSummary("Get the currently published version of a workflow");

        group.MapPost("/{key}/versions/{version:int}/draft", CreateDraftAsync)
            .WithSummary("Create an editable draft from an existing version")
            .WithDescription(
                "Copies a version into a new, unpublished one. Published definitions are never " +
                "edited in place, because requests already in flight execute against the version " +
                "they were pinned to and changing it under them would rewrite the rules mid case.")
            .RequireAuthorization(Policies.Admin);

        group.MapPut("/{key}/versions/{version:int}", ReplaceDraftAsync)
            .WithSummary("Replace the states and transitions of an unpublished draft")
            .RequireAuthorization(Policies.Admin);

        group.MapPost("/{key}/versions/{version:int}/validate", ValidateAsync)
            .WithSummary("Validate a workflow definition without publishing it")
            .RequireAuthorization(Policies.Admin);

        group.MapPost("/{key}/versions/{version:int}/publish", PublishAsync)
            .WithSummary("Publish a workflow version")
            .WithDescription(
                "Publishing runs structural validation first. Any earlier published version of the " +
                "same key is unpublished in the same transaction, so exactly one version is ever live.")
            .RequireAuthorization(Policies.Admin);

        return app;
    }

    private static async Task<Ok<IReadOnlyList<WorkflowSummaryDto>>> ListAsync(
        MuamalatDbContext db,
        CancellationToken cancellationToken)
    {
        // Projected in the database rather than loading full aggregates: the list view needs
        // counts, not the states and transitions themselves.
        var definitions = await db.WorkflowDefinitions
            .AsNoTracking()
            .OrderBy(d => d.Key).ThenByDescending(d => d.Version)
            .Select(d => new WorkflowSummaryDto(
                d.Id,
                d.Key,
                d.Version,
                d.NameEn,
                d.NameAr,
                d.IsPublished,
                d.CreatedAt,
                d.States.Count,
                d.Transitions.Count))
            .ToListAsync(cancellationToken);

        return TypedResults.Ok<IReadOnlyList<WorkflowSummaryDto>>(definitions);
    }

    private static async Task<Results<Ok<WorkflowDetailDto>, NotFound<ProblemDetails>>> GetAsync(
        string key,
        int version,
        MuamalatDbContext db,
        CancellationToken cancellationToken)
    {
        var definition = await LoadAsync(db, d => d.Key == key && d.Version == version, cancellationToken);

        return definition is null
            ? TypedResults.NotFound(Problems.WorkflowNotFound(key, version))
            : TypedResults.Ok(WorkflowDetailDto.From(definition));
    }

    private static async Task<Results<Ok<WorkflowDetailDto>, NotFound<ProblemDetails>>> GetPublishedAsync(
        string key,
        MuamalatDbContext db,
        CancellationToken cancellationToken)
    {
        var definition = await LoadAsync(db, d => d.Key == key && d.IsPublished, cancellationToken);

        return definition is null
            ? TypedResults.NotFound(Problems.NoPublishedVersion(key))
            : TypedResults.Ok(WorkflowDetailDto.From(definition));
    }

    private static async Task<Results<Created<WorkflowDetailDto>, NotFound<ProblemDetails>>> CreateDraftAsync(
        string key,
        int version,
        MuamalatDbContext db,
        CancellationToken cancellationToken)
    {
        var source = await LoadAsync(db, d => d.Key == key && d.Version == version, cancellationToken);
        if (source is null) return TypedResults.NotFound(Problems.WorkflowNotFound(key, version));

        var nextVersion = await db.WorkflowDefinitions
            .Where(d => d.Key == key)
            .MaxAsync(d => (int?)d.Version, cancellationToken) ?? 0;

        var draft = CopyDefinition(source, nextVersion + 1);

        db.WorkflowDefinitions.Add(draft);
        await db.SaveChangesAsync(cancellationToken);

        return TypedResults.Created(
            $"/api/workflows/{key}/versions/{draft.Version}",
            WorkflowDetailDto.From(draft));
    }

    private static async Task<Results<Ok<WorkflowDetailDto>, NotFound<ProblemDetails>, Conflict<ProblemDetails>, ValidationProblem>>
        ReplaceDraftAsync(
            string key,
            int version,
            WorkflowDraftDto body,
            MuamalatDbContext db,
            CancellationToken cancellationToken)
    {
        var existing = await LoadAsync(db, d => d.Key == key && d.Version == version, cancellationToken);
        if (existing is null) return TypedResults.NotFound(Problems.WorkflowNotFound(key, version));

        // A published version is immutable. In-flight requests execute against the version they
        // were pinned to, so editing it would silently change the rules under cases that are
        // already halfway through.
        if (existing.IsPublished)
        {
            return TypedResults.Conflict(new ProblemDetails
            {
                Title = "Published workflows cannot be edited",
                Detail =
                    $"Version {version} of '{key}' is published and is being executed by live requests. " +
                    "Create a draft from it, edit that, and publish when it is ready.",
                Status = StatusCodes.Status409Conflict,
            });
        }

        var rebuilt = new WorkflowDefinition(key, version, body.NameEn, body.NameAr);
        ApplyDraft(rebuilt, body);

        var errors = rebuilt.Validate();
        if (errors.Count > 0)
        {
            return TypedResults.ValidationProblem(
                new Dictionary<string, string[]> { ["definition"] = [.. errors] },
                detail: "The edited workflow is structurally invalid.");
        }

        // Replaced wholesale rather than diffed. The designer sends the whole definition, and
        // reconciling state by state would be a large amount of code whose only purpose is to
        // arrive at the same result.
        db.WorkflowDefinitions.Remove(existing);
        await db.SaveChangesAsync(cancellationToken);

        db.WorkflowDefinitions.Add(rebuilt);
        await db.SaveChangesAsync(cancellationToken);

        return TypedResults.Ok(WorkflowDetailDto.From(rebuilt));
    }

    private static WorkflowDefinition CopyDefinition(WorkflowDefinition source, int version)
    {
        var copy = new WorkflowDefinition(source.Key, version, source.NameEn, source.NameAr);

        foreach (var state in source.States.OrderBy(s => s.SortOrder))
        {
            var added = copy.AddState(state.Code, state.NameEn, state.NameAr, state.Kind).At(state.SortOrder);

            if (state.OwningDepartment is not null) added.OwnedBy(state.OwningDepartment);
            if (state.Sla is not null) added.WithSla(state.Sla.Target, state.Sla.WarnAfter, state.Sla.EscalateToRole);
        }

        foreach (var transition in source.Transitions)
        {
            var added = copy
                .AddTransition(transition.Code, transition.FromStateCode, transition.ToStateCode,
                    transition.NameEn, transition.NameAr)
                .ForRoles([.. transition.AllowedRoles])
                .AsKind(transition.Kind);

            if (transition.RequiresComment) added.RequiringComment();

            // New instances, not the source's. Guards and actions are owned entities: EF
            // tracks each one as belonging to the transition it was loaded with, and handing
            // the same instance to a second transition tries to move it rather than copy it.
            foreach (var guard in transition.Guards)
            {
                added.WithGuard(new TransitionGuard(guard.Kind, guard.Parameter));
            }

            foreach (var action in transition.Actions)
            {
                added.WithAction(new TransitionAction(action.Kind, action.Parameter));
            }
        }

        return copy;
    }

    private static void ApplyDraft(WorkflowDefinition target, WorkflowDraftDto body)
    {
        foreach (var state in body.States.OrderBy(s => s.SortOrder))
        {
            var added = target
                .AddState(state.Code, state.NameEn, state.NameAr, Enum.Parse<StateKind>(state.Kind, ignoreCase: true))
                .At(state.SortOrder);

            if (!string.IsNullOrWhiteSpace(state.OwningDepartment)) added.OwnedBy(state.OwningDepartment);

            if (state.Sla is not null)
            {
                added.WithSla(state.Sla.Target, state.Sla.WarnAfter, state.Sla.EscalateToRole);
            }
        }

        foreach (var transition in body.Transitions)
        {
            var added = target
                .AddTransition(transition.Code, transition.FromStateCode, transition.ToStateCode,
                    transition.NameEn, transition.NameAr)
                .ForRoles([.. transition.AllowedRoles])
                .AsKind(Enum.Parse<TransitionKind>(transition.Kind, ignoreCase: true));

            if (transition.RequiresComment) added.RequiringComment();

            foreach (var guard in transition.Guards)
            {
                added.WithGuard(new TransitionGuard(Enum.Parse<GuardKind>(guard.Kind, ignoreCase: true), guard.Parameter));
            }

            foreach (var action in transition.Actions)
            {
                added.WithAction(new TransitionAction(Enum.Parse<ActionKind>(action.Kind, ignoreCase: true), action.Parameter));
            }
        }
    }

    private static async Task<Results<Ok<ValidationReportDto>, NotFound<ProblemDetails>>> ValidateAsync(
        string key,
        int version,
        MuamalatDbContext db,
        CancellationToken cancellationToken)
    {
        var definition = await LoadAsync(db, d => d.Key == key && d.Version == version, cancellationToken);

        if (definition is null)
            return TypedResults.NotFound(Problems.WorkflowNotFound(key, version));

        var errors = definition.Validate();
        return TypedResults.Ok(new ValidationReportDto(errors.Count == 0, errors));
    }

    private static async Task<Results<Ok<WorkflowDetailDto>, NotFound<ProblemDetails>, ValidationProblem>> PublishAsync(
        string key,
        int version,
        MuamalatDbContext db,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var logger = loggerFactory.CreateLogger(typeof(WorkflowEndpoints));

        var definition = await LoadAsync(db, d => d.Key == key && d.Version == version, cancellationToken);

        if (definition is null)
            return TypedResults.NotFound(Problems.WorkflowNotFound(key, version));

        var errors = definition.Validate();
        if (errors.Count > 0)
        {
            return TypedResults.ValidationProblem(
                new Dictionary<string, string[]> { ["definition"] = [.. errors] },
                detail: "The workflow definition is structurally invalid and cannot be published.");
        }

        // Unpublish and publish in one transaction. Doing this in two separate saves would
        // leave a window with either no published version (requests cannot be submitted) or
        // two of them (the unique index rejects the second write anyway, but with a much
        // less helpful error).
        // Runs inside the retrying execution strategy: it refuses transactions it did not start,
        // because a retry would otherwise replay only part of the unit of work.
        var strategy = db.Database.CreateExecutionStrategy();

        var supersededCount = await strategy.ExecuteAsync(async ct =>
        {
            await using var transaction = await db.Database.BeginTransactionAsync(ct);

            var previouslyPublished = await db.WorkflowDefinitions
                .Where(d => d.Key == key && d.IsPublished && d.Version != version)
                .ToListAsync(ct);

            foreach (var old in previouslyPublished) old.Unpublish();

            definition.Publish();

            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);

            return previouslyPublished.Count;
        }, cancellationToken);

        logger.LogInformation(
            "Published workflow {WorkflowKey} v{Version}, superseding {SupersededCount} version(s).",
            key, version, supersededCount);

        return TypedResults.Ok(WorkflowDetailDto.From(definition));
    }

    private static Task<WorkflowDefinition?> LoadAsync(
        MuamalatDbContext db,
        System.Linq.Expressions.Expression<Func<WorkflowDefinition, bool>> predicate,
        CancellationToken cancellationToken) =>
        db.WorkflowDefinitions
            .Include(d => d.States)
            .Include(d => d.Transitions)
            .FirstOrDefaultAsync(predicate, cancellationToken);
}

internal static class Problems
{
    public static ProblemDetails WorkflowNotFound(string key, int version) => new()
    {
        Title = "Workflow definition not found",
        Detail = $"No version {version} exists for workflow '{key}'.",
        Status = StatusCodes.Status404NotFound
    };

    public static ProblemDetails DocumentNotFound(Guid documentId) => new()
    {
        Title = "Document not found",
        Detail = $"No document with id '{documentId}' is attached to this request.",
        Status = StatusCodes.Status404NotFound
    };

    public static ProblemDetails ReferenceNotFound(string reference) => new()
    {
        Title = "Service request not found",
        Detail = $"No service request exists with reference '{reference}'.",
        Status = StatusCodes.Status404NotFound
    };

    public static ProblemDetails RequestNotFound(Guid id) => new()
    {
        Title = "Service request not found",
        Detail = $"No service request exists with id '{id}'.",
        Status = StatusCodes.Status404NotFound
    };

    /// <summary>
    /// A request whose pinned definition has vanished cannot be worked at all, so this is
    /// reported as a distinct condition rather than as a generic not-found. It indicates data
    /// corruption, not a bad request path, and should be investigated.
    /// </summary>
    public static ProblemDetails DefinitionMissing(string referenceNumber) => new()
    {
        Title = "Workflow definition missing",
        Detail =
            $"Request '{referenceNumber}' references a workflow definition that no longer exists. " +
            "This request cannot be processed until the definition is restored.",
        Status = StatusCodes.Status404NotFound
    };

    public static ProblemDetails NoPublishedVersion(string key) => new()
    {
        Title = "No published version",
        Detail =
            $"Workflow '{key}' has no published version. An administrator must publish one before " +
            "citizens can submit this service.",
        Status = StatusCodes.Status404NotFound
    };
}

public sealed record WorkflowSummaryDto(
    Guid Id,
    string Key,
    int Version,
    string NameEn,
    string NameAr,
    bool IsPublished,
    DateTimeOffset CreatedAt,
    int StateCount,
    int TransitionCount);

public sealed record WorkflowDetailDto(
    Guid Id,
    string Key,
    int Version,
    string NameEn,
    string NameAr,
    bool IsPublished,
    DateTimeOffset CreatedAt,
    IReadOnlyList<WorkflowStateDto> States,
    IReadOnlyList<WorkflowTransitionDto> Transitions)
{
    public static WorkflowDetailDto From(WorkflowDefinition d) => new(
        d.Id, d.Key, d.Version, d.NameEn, d.NameAr, d.IsPublished, d.CreatedAt,
        [.. d.States.OrderBy(s => s.SortOrder).Select(WorkflowStateDto.From)],
        [.. d.Transitions.Select(WorkflowTransitionDto.From)]);
}

public sealed record WorkflowStateDto(
    string Code,
    string NameEn,
    string NameAr,
    string Kind,
    string? OwningDepartment,
    int SortOrder,
    SlaDto? Sla)
{
    public static WorkflowStateDto From(WorkflowState s) => new(
        s.Code, s.NameEn, s.NameAr, s.Kind.ToString(), s.OwningDepartment, s.SortOrder,
        s.Sla is null ? null : new SlaDto(s.Sla.Target, s.Sla.WarnAfter, s.Sla.EscalateToRole));
}

public sealed record SlaDto(TimeSpan Target, TimeSpan WarnAfter, string? EscalateToRole);

public sealed record WorkflowTransitionDto(
    string Code,
    string FromStateCode,
    string ToStateCode,
    string NameEn,
    string NameAr,
    string Kind,
    bool RequiresComment,
    IReadOnlyList<string> AllowedRoles,
    IReadOnlyList<GuardDto> Guards,
    IReadOnlyList<ActionDto> Actions)
{
    public static WorkflowTransitionDto From(WorkflowTransition t) => new(
        t.Code, t.FromStateCode, t.ToStateCode, t.NameEn, t.NameAr, t.Kind.ToString(), t.RequiresComment,
        [.. t.AllowedRoles],
        [.. t.Guards.Select(g => new GuardDto(g.Kind.ToString(), g.Parameter))],
        [.. t.Actions.Select(a => new ActionDto(a.Kind.ToString(), a.Parameter))]);
}

public sealed record GuardDto(string Kind, string? Parameter);

public sealed record ActionDto(string Kind, string? Parameter);

public sealed record ValidationReportDto(bool IsValid, IReadOnlyList<string> Errors);

public sealed record WorkflowDraftDto(
    string NameEn,
    string NameAr,
    IReadOnlyList<WorkflowStateDto> States,
    IReadOnlyList<WorkflowTransitionDto> Transitions);
