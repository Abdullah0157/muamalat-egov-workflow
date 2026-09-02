using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Muamalat.Api.Services;
using Muamalat.Domain.Auditing;
using Muamalat.Domain.Requests;
using Muamalat.Domain.Workflow;
using Muamalat.Infrastructure.Persistence;

namespace Muamalat.Api.Endpoints;

/// <summary>
/// Service request lifecycle: submission by citizens, work by officers, and the audit view.
///
/// Every state change goes through <see cref="WorkflowEngine"/>. No endpoint sets
/// CurrentStateCode directly, because a second path into the state machine is a second place
/// for guards, segregation of duties and the audit chain to be forgotten.
/// </summary>
public static class RequestEndpoints
{
    public static IEndpointRouteBuilder MapRequestEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/requests")
            .WithTags("Service requests")
            .RequireAuthorization();

        group.MapPost("/", SubmitAsync)
            .WithSummary("Submit a new service request")
            .RequireAuthorization(Policies.Citizen);

        group.MapGet("/mine", MineAsync)
            .WithSummary("List the caller's own requests")
            .RequireAuthorization(Policies.Citizen);

        group.MapGet("/queue", QueueAsync)
            .WithSummary("Officer work queue")
            .WithDescription("Open requests for a department, oldest first, with SLA status.")
            .RequireAuthorization(Policies.Officer);

        group.MapGet("/{id:guid}", GetAsync)
            .WithSummary("Get a request");

        group.MapGet("/{id:guid}/transitions", TransitionsAsync)
            .WithSummary("Transitions available to the caller on this request");

        group.MapPost("/{id:guid}/transitions/{transitionCode}", ExecuteAsync)
            .WithSummary("Execute a workflow transition");

        group.MapGet("/{id:guid}/audit", AuditAsync)
            .WithSummary("Audit trail with chain verification")
            .WithDescription(
                "Returns the request's hash-chained history together with the result of verifying " +
                "that chain, so a reviewer can see both what happened and whether the record is intact.");

        return app;
    }

    // -----------------------------------------------------------------------
    // Citizen
    // -----------------------------------------------------------------------

    private static async Task<Results<Created<RequestDetailDto>, NotFound<ProblemDetails>, ValidationProblem>>
        SubmitAsync(
            SubmitRequestDto body,
            MuamalatDbContext db,
            ICurrentUser currentUser,
            TimeProvider clock,
            ILoggerFactory loggerFactory,
            CancellationToken cancellationToken)
    {
        var logger = loggerFactory.CreateLogger(typeof(RequestEndpoints));

        if (string.IsNullOrWhiteSpace(body.WorkflowKey))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                [nameof(body.WorkflowKey)] = ["A service must be selected."]
            });
        }

        var definition = await db.WorkflowDefinitions
            .Include(d => d.States)
            .Include(d => d.Transitions)
            .FirstOrDefaultAsync(d => d.Key == body.WorkflowKey && d.IsPublished, cancellationToken);

        if (definition is null)
            return TypedResults.NotFound(Problems.NoPublishedVersion(body.WorkflowKey));

        var actor = currentUser.Actor;
        var now = clock.GetUtcNow();

        // The connection is configured with EnableRetryOnFailure, and the retrying execution
        // strategy refuses transactions it did not start: a retry would otherwise replay only
        // part of the unit of work. Everything transactional therefore runs inside the strategy,
        // which reruns the whole block on a transient failure.
        var strategy = db.Database.CreateExecutionStrategy();

        var request = await strategy.ExecuteAsync(async ct =>
        {
            // Allocated inside the same transaction as the insert, so a failed submission does
            // not burn a reference number and leave a gap in the citizen-visible sequence.
            await using var transaction = await db.Database.BeginTransactionAsync(ct);

            var referenceNumber = await db.Database
                .SqlQuery<string>($"SELECT fn_next_reference_number({now}) AS \"Value\"")
                .SingleAsync(ct);

            var created = ServiceRequest.Submit(
                definition,
                referenceNumber,
                body.ServiceType ?? definition.NameEn,
                actor.UserId,
                actor.DisplayName,
                now);

            db.ServiceRequests.Add(created);
            await db.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);

            return created;
        }, cancellationToken);

        logger.LogInformation(
            "Request {ReferenceNumber} submitted by {ActorUserId} on workflow {WorkflowKey} v{Version}.",
            request.ReferenceNumber, actor.UserId, definition.Key, definition.Version);

        return TypedResults.Created(
            $"/api/requests/{request.Id}",
            RequestDetailDto.From(request, definition, now));
    }

    private static async Task<Ok<IReadOnlyList<RequestSummaryDto>>> MineAsync(
        MuamalatDbContext db,
        ICurrentUser currentUser,
        CancellationToken cancellationToken,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20)
    {
        var userId = currentUser.UserId;

        var requests = await db.ServiceRequests
            .AsNoTracking()
            .Where(r => r.ApplicantUserId == userId)
            .OrderByDescending(r => r.SubmittedAt)
            .Skip((Math.Max(page, 1) - 1) * Paging.Clamp(pageSize))
            .Take(Paging.Clamp(pageSize))
            .Select(r => new RequestSummaryDto(
                r.Id, r.ReferenceNumber, r.ServiceType, r.WorkflowKey,
                r.CurrentStateCode, r.SubmittedAt, r.CurrentStateEnteredAt,
                r.ClosedAt, r.AssignedToDepartment, null))
            .ToListAsync(cancellationToken);

        return TypedResults.Ok<IReadOnlyList<RequestSummaryDto>>(requests);
    }

    // -----------------------------------------------------------------------
    // Officer
    // -----------------------------------------------------------------------

    private static async Task<Ok<IReadOnlyList<RequestSummaryDto>>> QueueAsync(
        MuamalatDbContext db,
        TimeProvider clock,
        CancellationToken cancellationToken,
        [FromQuery] string? department = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20)
    {
        var size = Paging.Clamp(pageSize);

        // Oldest first: the queue is worked front to back, and the request that has been
        // waiting longest is the one closest to breaching its SLA.
        var query = db.ServiceRequests
            .AsNoTracking()
            .Where(r => r.ClosedAt == null);

        if (!string.IsNullOrWhiteSpace(department))
            query = query.Where(r => r.AssignedToDepartment == department);

        var rows = await query
            .OrderBy(r => r.CurrentStateEnteredAt)
            .Skip((Math.Max(page, 1) - 1) * size)
            .Take(size)
            .Select(r => new
            {
                r.Id, r.ReferenceNumber, r.ServiceType, r.WorkflowKey, r.WorkflowVersion,
                r.CurrentStateCode, r.SubmittedAt, r.CurrentStateEnteredAt, r.ClosedAt,
                r.AssignedToDepartment, r.WorkflowDefinitionId
            })
            .ToListAsync(cancellationToken);

        // SLA policies for exactly the states on this page, fetched in one query rather than
        // per row. Without this the queue would issue an extra query per request (N+1).
        var stateKeys = rows.Select(r => new { r.WorkflowDefinitionId, r.CurrentStateCode }).Distinct().ToList();
        var definitionIds = stateKeys.Select(k => k.WorkflowDefinitionId).Distinct().ToList();
        var stateCodes = stateKeys.Select(k => k.CurrentStateCode).Distinct().ToList();

        var states = await db.WorkflowStates
            .AsNoTracking()
            .Where(s => definitionIds.Contains(s.WorkflowDefinitionId) && stateCodes.Contains(s.Code))
            .ToListAsync(cancellationToken);

        var now = clock.GetUtcNow();

        var result = rows.Select(r =>
        {
            var state = states.FirstOrDefault(s =>
                s.WorkflowDefinitionId == r.WorkflowDefinitionId && s.Code == r.CurrentStateCode);

            var sla = state?.Sla is null
                ? null
                : new SlaStatusDto(
                    state.Sla.Evaluate(r.CurrentStateEnteredAt, now).ToString(),
                    state.Sla.DueAt(r.CurrentStateEnteredAt));

            return new RequestSummaryDto(
                r.Id, r.ReferenceNumber, r.ServiceType, r.WorkflowKey,
                r.CurrentStateCode, r.SubmittedAt, r.CurrentStateEnteredAt,
                r.ClosedAt, r.AssignedToDepartment, sla);
        }).ToList();

        return TypedResults.Ok<IReadOnlyList<RequestSummaryDto>>(result);
    }

    // -----------------------------------------------------------------------
    // Shared
    // -----------------------------------------------------------------------

    private static async Task<Results<Ok<RequestDetailDto>, NotFound<ProblemDetails>, ForbidHttpResult>>
        GetAsync(
            Guid id,
            MuamalatDbContext db,
            ICurrentUser currentUser,
            TimeProvider clock,
            CancellationToken cancellationToken)
    {
        var request = await LoadAsync(db, id, cancellationToken);
        if (request is null) return TypedResults.NotFound(Problems.RequestNotFound(id));

        if (!CanView(request, currentUser)) return TypedResults.Forbid();

        var definition = await LoadDefinitionAsync(db, request.WorkflowDefinitionId, cancellationToken);
        if (definition is null) return TypedResults.NotFound(Problems.DefinitionMissing(request.ReferenceNumber));

        return TypedResults.Ok(RequestDetailDto.From(request, definition, clock.GetUtcNow()));
    }

    private static async Task<Results<Ok<IReadOnlyList<AvailableTransitionDto>>, NotFound<ProblemDetails>, ForbidHttpResult>>
        TransitionsAsync(
            Guid id,
            MuamalatDbContext db,
            ICurrentUser currentUser,
            WorkflowEngine engine,
            CancellationToken cancellationToken)
    {
        var request = await LoadAsync(db, id, cancellationToken);
        if (request is null) return TypedResults.NotFound(Problems.RequestNotFound(id));
        if (!CanView(request, currentUser)) return TypedResults.Forbid();

        var definition = await LoadDefinitionAsync(db, request.WorkflowDefinitionId, cancellationToken);
        if (definition is null) return TypedResults.NotFound(Problems.DefinitionMissing(request.ReferenceNumber));

        var available = engine.AvailableTransitions(request, definition, currentUser.Actor)
            .Select(t => new AvailableTransitionDto(
                t.Code, t.NameEn, t.NameAr, t.ToStateCode, t.RequiresComment, t.Kind.ToString()))
            .ToList();

        return TypedResults.Ok<IReadOnlyList<AvailableTransitionDto>>(available);
    }

    private static async Task<Results<Ok<RequestDetailDto>, NotFound<ProblemDetails>, ForbidHttpResult, Conflict<ProblemDetails>, UnprocessableEntity<ProblemDetails>>>
        ExecuteAsync(
            Guid id,
            string transitionCode,
            ExecuteTransitionDto? body,
            MuamalatDbContext db,
            ICurrentUser currentUser,
            WorkflowEngine engine,
            TimeProvider clock,
            ILoggerFactory loggerFactory,
            CancellationToken cancellationToken)
    {
        var logger = loggerFactory.CreateLogger(typeof(RequestEndpoints));

        var request = await LoadAsync(db, id, cancellationToken);
        if (request is null) return TypedResults.NotFound(Problems.RequestNotFound(id));
        if (!CanView(request, currentUser)) return TypedResults.Forbid();

        var definition = await LoadDefinitionAsync(db, request.WorkflowDefinitionId, cancellationToken);
        if (definition is null) return TypedResults.NotFound(Problems.DefinitionMissing(request.ReferenceNumber));

        var actor = currentUser.Actor;
        var now = clock.GetUtcNow();

        var result = engine.Execute(request, definition, transitionCode, actor, now, body?.Comment);

        if (!result.Succeeded)
        {
            // Business rejections are 422 rather than 400: the payload was well formed, the
            // action simply is not permitted in the request's current situation. The client
            // localises FailureCode, so the message here is for logs and developers.
            logger.LogInformation(
                "Transition {TransitionCode} on {ReferenceNumber} refused for {ActorUserId}: {FailureCode}",
                transitionCode, request.ReferenceNumber, actor.UserId, result.FailureCode);

            return TypedResults.UnprocessableEntity(new ProblemDetails
            {
                Title = "Transition not permitted",
                Detail = result.FailureMessage,
                Status = StatusCodes.Status422UnprocessableEntity,
                Extensions = { ["failureCode"] = result.FailureCode }
            });
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Two officers acted on the same request at once. The loser is told to reload
            // rather than being allowed to overwrite a decision they never saw.
            logger.LogWarning(
                "Concurrent update on {ReferenceNumber}; {ActorUserId} lost the race on {TransitionCode}.",
                request.ReferenceNumber, actor.UserId, transitionCode);

            return TypedResults.Conflict(new ProblemDetails
            {
                Title = "Request was modified by someone else",
                Detail =
                    "Another user acted on this request while you were working on it. " +
                    "Reload the request to see the current state before trying again.",
                Status = StatusCodes.Status409Conflict
            });
        }

        logger.LogInformation(
            "Request {ReferenceNumber} moved {FromState} to {ToState} via {TransitionCode} by {ActorUserId}.",
            request.ReferenceNumber, result.FromStateCode, result.ToStateCode, transitionCode, actor.UserId);

        return TypedResults.Ok(RequestDetailDto.From(request, definition, now));
    }

    private static async Task<Results<Ok<AuditTrailDto>, NotFound<ProblemDetails>, ForbidHttpResult>>
        AuditAsync(
            Guid id,
            MuamalatDbContext db,
            ICurrentUser currentUser,
            CancellationToken cancellationToken)
    {
        var request = await LoadAsync(db, id, cancellationToken);
        if (request is null) return TypedResults.NotFound(Problems.RequestNotFound(id));
        if (!CanView(request, currentUser)) return TypedResults.Forbid();

        var entries = request.AuditTrail.OrderBy(e => e.Sequence).ToList();
        var verification = AuditChain.Verify(entries);

        return TypedResults.Ok(new AuditTrailDto(
            request.Id,
            request.ReferenceNumber,
            verification.IsValid,
            AuditChain.HeadHash(entries),
            [.. verification.Problems.Select(p => new ChainProblemDto(p.Sequence, p.Kind.ToString(), p.Message))],
            [.. entries.Select(AuditEntryDto.From)]));
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private static Task<ServiceRequest?> LoadAsync(MuamalatDbContext db, Guid id, CancellationToken ct) =>
        db.ServiceRequests
            .Include(r => r.Documents)
            .Include(r => r.AuditTrail)
            // Two collection includes in one SQL statement multiply the rows together. Split
            // query issues one statement per collection instead, which stays linear as a
            // request accumulates documents and audit entries.
            .AsSplitQuery()
            .FirstOrDefaultAsync(r => r.Id == id, ct);

    private static Task<WorkflowDefinition?> LoadDefinitionAsync(MuamalatDbContext db, Guid id, CancellationToken ct) =>
        db.WorkflowDefinitions
            .Include(d => d.States)
            .Include(d => d.Transitions)
            .AsSplitQuery()
            .FirstOrDefaultAsync(d => d.Id == id, ct);

    /// <summary>
    /// A citizen may only see their own request. Officers and above may see any request,
    /// because a work queue is meaningless if you cannot open what is in it.
    /// </summary>
    private static bool CanView(ServiceRequest request, ICurrentUser user) =>
        request.ApplicantUserId == user.UserId
        || user.IsInRole(Roles.Officer)
        || user.IsInRole(Roles.Supervisor)
        || user.IsInRole(Roles.Admin);
}

internal static class Paging
{
    /// <summary>
    /// Caps page size so a caller cannot ask for the entire table in one request. Silent
    /// clamping rather than a 400, because a client asking for too much still gets useful data.
    /// </summary>
    public static int Clamp(int pageSize) => Math.Clamp(pageSize, 1, 100);
}

public sealed record SubmitRequestDto(string WorkflowKey, string? ServiceType);

public sealed record ExecuteTransitionDto(string? Comment);

public sealed record RequestSummaryDto(
    Guid Id,
    string ReferenceNumber,
    string ServiceType,
    string WorkflowKey,
    string CurrentStateCode,
    DateTimeOffset SubmittedAt,
    DateTimeOffset CurrentStateEnteredAt,
    DateTimeOffset? ClosedAt,
    string? AssignedToDepartment,
    SlaStatusDto? Sla);

public sealed record SlaStatusDto(string Status, DateTimeOffset DueAt);

public sealed record RequestDetailDto(
    Guid Id,
    string ReferenceNumber,
    string ServiceType,
    string WorkflowKey,
    int WorkflowVersion,
    string CurrentStateCode,
    string CurrentStateNameEn,
    string CurrentStateNameAr,
    bool IsClosed,
    DateTimeOffset SubmittedAt,
    DateTimeOffset CurrentStateEnteredAt,
    DateTimeOffset? ClosedAt,
    DateTimeOffset? DecisionAt,
    string? AssignedToDepartment,
    bool FeePaid,
    SlaStatusDto? Sla,
    IReadOnlyList<DocumentDto> Documents)
{
    public static RequestDetailDto From(ServiceRequest r, WorkflowDefinition d, DateTimeOffset now)
    {
        var state = d.States.FirstOrDefault(s => s.Code == r.CurrentStateCode);

        var sla = state?.Sla is null || r.IsClosed
            ? null
            : new SlaStatusDto(
                state.Sla.Evaluate(r.CurrentStateEnteredAt, now).ToString(),
                state.Sla.DueAt(r.CurrentStateEnteredAt));

        return new RequestDetailDto(
            r.Id, r.ReferenceNumber, r.ServiceType, r.WorkflowKey, r.WorkflowVersion,
            r.CurrentStateCode, state?.NameEn ?? r.CurrentStateCode, state?.NameAr ?? r.CurrentStateCode,
            r.IsClosed, r.SubmittedAt, r.CurrentStateEnteredAt, r.ClosedAt, r.DecisionAt,
            r.AssignedToDepartment, r.FeePaid, sla,
            [.. r.Documents.Select(DocumentDto.From)]);
    }
}

public sealed record DocumentDto(
    Guid Id,
    string DocumentType,
    string FileName,
    string ContentType,
    long SizeBytes,
    DateTimeOffset UploadedAt,
    bool IsVerified,
    DateTimeOffset? VerifiedAt)
{
    public static DocumentDto From(ServiceRequestDocument d) => new(
        d.Id, d.DocumentType, d.FileName, d.ContentType, d.SizeBytes, d.UploadedAt, d.IsVerified, d.VerifiedAt);
}

public sealed record AvailableTransitionDto(
    string Code,
    string NameEn,
    string NameAr,
    string ToStateCode,
    bool RequiresComment,
    string Kind);

public sealed record AuditTrailDto(
    Guid RequestId,
    string ReferenceNumber,
    bool ChainIsValid,
    string? HeadHash,
    IReadOnlyList<ChainProblemDto> Problems,
    IReadOnlyList<AuditEntryDto> Entries);

public sealed record ChainProblemDto(int Sequence, string Kind, string Message);

public sealed record AuditEntryDto(
    int Sequence,
    string EventType,
    string? FromStateCode,
    string? ToStateCode,
    string? TransitionCode,
    string ActorDisplayName,
    string ActorRoles,
    string? Comment,
    DateTimeOffset OccurredAt,
    string Hash)
{
    public static AuditEntryDto From(AuditEntry e) => new(
        e.Sequence, e.EventType.ToString(), e.FromStateCode, e.ToStateCode, e.TransitionCode,
        // ActorUserId is deliberately not exposed: the display name and roles are what a
        // reviewer needs, and the internal subject id is of no use to a client.
        e.ActorDisplayName, e.ActorRoles, e.Comment, e.OccurredAt, e.Hash);
}
