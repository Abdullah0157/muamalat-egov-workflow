namespace Muamalat.Domain.Common;

/// <summary>
/// Canonical machine-readable failure codes produced by the domain.
///
/// The domain never returns prose to the caller as the primary signal: this platform is
/// bilingual (English and Arabic) and the presentation layer owns translation. A stable
/// code is the contract; the accompanying message exists for logs and for developers.
///
/// The guard codes below mirror the strings returned by
/// <see cref="Workflow.TransitionGuard.Check"/>. They are duplicated here so callers and
/// tests never hardcode literals; <c>WorkflowEngineTests</c> asserts the two stay in step.
/// </summary>
public static class FailureCodes
{
    /// <summary>The request already reached a terminal state and can no longer move.</summary>
    public const string RequestClosed = "request.closed";

    /// <summary>No transition with that code leaves the request's current state.</summary>
    public const string TransitionNotAvailable = "transition.not_available";

    /// <summary>The transition exists here but the actor holds none of its allowed roles.</summary>
    public const string TransitionForbidden = "transition.forbidden";

    /// <summary>A reason is mandatory for this transition and none was supplied.</summary>
    public const string CommentRequired = "guard.comment_required";

    public const string DocumentsNotVerified = "guard.documents_not_verified";
    public const string FeeUnpaid = "guard.fee_unpaid";
    public const string SegregationOfDuties = "guard.segregation_of_duties";
    public const string AwaitingApplicant = "guard.awaiting_applicant";

    private const string MissingDocumentPrefix = "guard.missing_document";

    /// <summary>Failure code for a required document type that has not been uploaded.</summary>
    public static string MissingDocument(string documentType) => $"{MissingDocumentPrefix}:{documentType}";
}
