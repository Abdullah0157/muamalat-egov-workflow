using System.Buffers.Binary;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Muamalat.Api.Configuration;
using Muamalat.Api.Services;
using Muamalat.Domain.Requests;
using Muamalat.Infrastructure.Persistence;

namespace Muamalat.Api.Endpoints;

/// <summary>
/// Supporting documents: upload by the applicant, verification by an officer, and download.
///
/// File upload is the most commonly abused endpoint in a government system, so the rules here
/// are deliberately strict and fail closed: an allow-list of content types, a size ceiling, a
/// generated storage name, and a signature check that the bytes match the declared type.
/// </summary>
public static class DocumentEndpoints
{
    public static IEndpointRouteBuilder MapDocumentEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/requests/{id:guid}/documents")
            .WithTags("Documents")
            .RequireAuthorization();

        group.MapPost("/", UploadAsync)
            .WithSummary("Attach a supporting document")
            .DisableAntiforgery();

        group.MapPost("/{documentId:guid}/verify", VerifyAsync)
            .WithSummary("Mark a document as verified")
            .RequireAuthorization(Policies.Officer);

        group.MapGet("/{documentId:guid}/content", DownloadAsync)
            .WithSummary("Download a document");

        app.MapPost("/api/requests/{id:guid}/fee", MarkFeePaidAsync)
            .WithTags("Documents")
            .WithSummary("Record the application fee as paid")
            .RequireAuthorization();

        return app;
    }

    private static async Task<Results<Created<DocumentDto>, NotFound<ProblemDetails>, ForbidHttpResult, ValidationProblem>>
        UploadAsync(
            Guid id,
            IFormFile file,
            [FromForm] string documentType,
            MuamalatDbContext db,
            ICurrentUser currentUser,
            IOptions<StorageOptions> storageOptions,
            TimeProvider clock,
            ILoggerFactory loggerFactory,
            CancellationToken cancellationToken)
    {
        var logger = loggerFactory.CreateLogger(typeof(DocumentEndpoints));
        var storage = storageOptions.Value;

        var request = await db.ServiceRequests
            .Include(r => r.Documents)
            .Include(r => r.AuditTrail)
            .AsSplitQuery()
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);

        if (request is null) return TypedResults.NotFound(Problems.RequestNotFound(id));

        // Only the applicant or an officer may attach to a file. A citizen adding documents to
        // someone else's application would be an obvious route to tampering with a decision.
        var isApplicant = request.ApplicantUserId == currentUser.UserId;
        if (!isApplicant && !currentUser.IsInRole(Roles.Officer) && !currentUser.IsInRole(Roles.Supervisor))
        {
            return TypedResults.Forbid();
        }

        var errors = Validate(file, documentType, storage);
        if (errors.Count > 0) return TypedResults.ValidationProblem(errors);

        // The stored name is generated, never taken from the upload. A client controlled name
        // is how path traversal and overwrite attacks get in, and the original is kept
        // separately purely for display.
        var storedName = $"{Guid.CreateVersion7():N}{ExtensionFor(file.ContentType)}";
        var relativePath = Path.Combine(request.Id.ToString("N"), storedName);
        var absolutePath = Path.Combine(storage.DocumentRoot, relativePath);

        Directory.CreateDirectory(Path.GetDirectoryName(absolutePath)!);

        await using (var target = File.Create(absolutePath))
        {
            await file.CopyToAsync(target, cancellationToken);
        }

        var document = request.AttachDocument(
            documentType,
            SafeDisplayName(file.FileName),
            file.ContentType,
            file.Length,
            relativePath,
            currentUser.Actor,
            clock.GetUtcNow());

        await db.SaveChangesAsync(cancellationToken);

        logger.LogInformation(
            "Document {DocumentType} attached to {ReferenceNumber} by {ActorUserId} ({Bytes} bytes).",
            documentType, request.ReferenceNumber, currentUser.UserId, file.Length);

        return TypedResults.Created(
            $"/api/requests/{request.Id}/documents/{document.Id}/content",
            DocumentDto.From(document));
    }

    private static async Task<Results<Ok<DocumentDto>, NotFound<ProblemDetails>, UnprocessableEntity<ProblemDetails>>>
        VerifyAsync(
            Guid id,
            Guid documentId,
            MuamalatDbContext db,
            ICurrentUser currentUser,
            TimeProvider clock,
            CancellationToken cancellationToken)
    {
        var request = await db.ServiceRequests
            .Include(r => r.Documents)
            .Include(r => r.AuditTrail)
            .AsSplitQuery()
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);

        if (request is null) return TypedResults.NotFound(Problems.RequestNotFound(id));

        var document = request.Documents.FirstOrDefault(d => d.Id == documentId);
        if (document is null) return TypedResults.NotFound(Problems.DocumentNotFound(documentId));

        // An applicant verifying their own paperwork would defeat the control entirely, so the
        // endpoint is officer-only and the domain records who confirmed it.
        if (!request.VerifyDocument(documentId, currentUser.Actor, clock.GetUtcNow()))
        {
            return TypedResults.UnprocessableEntity(new ProblemDetails
            {
                Title = "Document already verified",
                Detail = "This document has already been checked; verifying it again would add a second record of the same fact.",
                Status = StatusCodes.Status422UnprocessableEntity,
            });
        }

        await db.SaveChangesAsync(cancellationToken);
        return TypedResults.Ok(DocumentDto.From(document));
    }

    private static async Task<Results<PhysicalFileHttpResult, NotFound<ProblemDetails>, ForbidHttpResult>>
        DownloadAsync(
            Guid id,
            Guid documentId,
            MuamalatDbContext db,
            ICurrentUser currentUser,
            IOptions<StorageOptions> storageOptions,
            CancellationToken cancellationToken)
    {
        var request = await db.ServiceRequests
            .Include(r => r.Documents)
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);

        if (request is null) return TypedResults.NotFound(Problems.RequestNotFound(id));

        // Possession of a document id must never be enough. Access is decided by who the
        // caller is on this request, exactly as it is for the request itself.
        var isApplicant = request.ApplicantUserId == currentUser.UserId;
        if (!isApplicant && !currentUser.IsInRole(Roles.Officer)
            && !currentUser.IsInRole(Roles.Supervisor) && !currentUser.IsInRole(Roles.Admin))
        {
            return TypedResults.Forbid();
        }

        var document = request.Documents.FirstOrDefault(d => d.Id == documentId);
        if (document is null) return TypedResults.NotFound(Problems.DocumentNotFound(documentId));

        var root = Path.GetFullPath(storageOptions.Value.DocumentRoot);
        var absolutePath = Path.GetFullPath(Path.Combine(root, document.StoragePath));

        // Defence in depth against a stored path that somehow escapes the root. The path is
        // generated, so this should be impossible; if it ever is not, the request fails rather
        // than serving an arbitrary file from the container.
        if (!absolutePath.StartsWith(root, StringComparison.Ordinal) || !File.Exists(absolutePath))
        {
            return TypedResults.NotFound(Problems.DocumentNotFound(documentId));
        }

        return TypedResults.PhysicalFile(
            absolutePath,
            document.ContentType,
            document.FileName,

            // Never inline. A PDF or image rendered in the origin's context is a route to
            // running script against a signed in session.
            enableRangeProcessing: false);
    }

    private static async Task<Results<Ok<RequestDetailDto>, NotFound<ProblemDetails>, ForbidHttpResult, UnprocessableEntity<ProblemDetails>>>
        MarkFeePaidAsync(
            Guid id,
            MuamalatDbContext db,
            ICurrentUser currentUser,
            TimeProvider clock,
            CancellationToken cancellationToken)
    {
        var request = await db.ServiceRequests
            .Include(r => r.Documents)
            .Include(r => r.AuditTrail)
            .AsSplitQuery()
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);

        if (request is null) return TypedResults.NotFound(Problems.RequestNotFound(id));

        var isApplicant = request.ApplicantUserId == currentUser.UserId;
        if (!isApplicant && !currentUser.IsInRole(Roles.Officer))
        {
            return TypedResults.Forbid();
        }

        // This records that a payment happened; it does not take one. Money movement belongs to
        // a payment provider, and a demonstration system must not pretend otherwise.
        if (!request.MarkFeePaid(currentUser.Actor, clock.GetUtcNow()))
        {
            return TypedResults.UnprocessableEntity(new ProblemDetails
            {
                Title = "Fee already recorded",
                Detail = "The fee for this application is already recorded as paid.",
                Status = StatusCodes.Status422UnprocessableEntity,
            });
        }

        await db.SaveChangesAsync(cancellationToken);

        var definition = await db.WorkflowDefinitions
            .Include(d => d.States)
            .Include(d => d.Transitions)
            .AsSplitQuery()
            .FirstAsync(d => d.Id == request.WorkflowDefinitionId, cancellationToken);

        return TypedResults.Ok(RequestDetailDto.From(request, definition, clock.GetUtcNow()));
    }

    // -----------------------------------------------------------------------
    // Validation
    // -----------------------------------------------------------------------

    private static Dictionary<string, string[]> Validate(IFormFile file, string documentType, StorageOptions storage)
    {
        var errors = new Dictionary<string, string[]>();

        if (string.IsNullOrWhiteSpace(documentType))
        {
            errors[nameof(documentType)] = ["A document type is required."];
        }

        if (file.Length == 0)
        {
            errors[nameof(file)] = ["The file is empty."];
        }
        else if (file.Length > storage.MaxDocumentBytes)
        {
            errors[nameof(file)] =
                [$"The file is larger than the {storage.MaxDocumentBytes / (1024 * 1024)} MB limit."];
        }

        // Allow-list, not block-list. A block-list has to be told about every new dangerous
        // type before it helps; an allow-list refuses anything it was not told to accept.
        if (!storage.AllowedContentTypes.Contains(file.ContentType, StringComparer.OrdinalIgnoreCase))
        {
            errors[nameof(file.ContentType)] =
                [$"'{file.ContentType}' is not an accepted document type. Accepted: {string.Join(", ", storage.AllowedContentTypes)}."];
        }
        else if (!SignatureMatches(file))
        {
            // The declared content type is client supplied and trivially forged. Checking the
            // leading bytes stops an executable arriving labelled as a PDF.
            errors[nameof(file)] = ["The file contents do not match the declared type."];
        }

        return errors;
    }

    /// <summary>Checks the magic number against the declared type for the accepted formats.</summary>
    private static bool SignatureMatches(IFormFile file)
    {
        Span<byte> header = stackalloc byte[8];

        using var stream = file.OpenReadStream();
        var read = stream.ReadAtLeast(header, header.Length, throwOnEndOfStream: false);
        if (read < 4) return false;

        return file.ContentType.ToLowerInvariant() switch
        {
            // %PDF
            "application/pdf" => header[0] == 0x25 && header[1] == 0x50 && header[2] == 0x44 && header[3] == 0x46,

            // JPEG frames always start FF D8 FF.
            "image/jpeg" => header[0] == 0xFF && header[1] == 0xD8 && header[2] == 0xFF,

            // PNG signature, first four bytes.
            "image/png" => BinaryPrimitives.ReadUInt32BigEndian(header) == 0x89504E47,

            _ => false,
        };
    }

    private static string ExtensionFor(string contentType) => contentType.ToLowerInvariant() switch
    {
        "application/pdf" => ".pdf",
        "image/jpeg" => ".jpg",
        "image/png" => ".png",
        _ => ".bin",
    };

    /// <summary>
    /// Keeps the original name for display but strips anything that could be interpreted as a
    /// path or used to break out of a filename when the value is later rendered or logged.
    /// </summary>
    private static string SafeDisplayName(string fileName)
    {
        var name = Path.GetFileName(fileName);
        var cleaned = new string(name.Where(c => !Path.GetInvalidFileNameChars().Contains(c)).ToArray());

        return string.IsNullOrWhiteSpace(cleaned)
            ? "document"
            : cleaned[..Math.Min(cleaned.Length, 255)];
    }
}
