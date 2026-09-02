using FluentAssertions;
using Muamalat.Domain.Common;
using Muamalat.Domain.Requests;
using Muamalat.Domain.Workflow;

namespace Muamalat.Tests.Workflow;

/// <summary>
/// A realistic commercial licence renewal workflow, used as the fixture for the engine
/// tests. Deliberately not a toy: it has two states that can each ask the applicant for
/// more information into one shared MORE_INFO_REQUIRED state, which is the case that makes
/// the resume-after-information design decision observable.
///
/// DRAFT -> SUBMITTED -> TECHNICAL_REVIEW -> APPROVAL -> APPROVED / REJECTED
/// with a MORE_INFO_REQUIRED loop reachable from both TECHNICAL_REVIEW and APPROVAL,
/// plus WITHDRAWN from DRAFT and a supervisor escalation out of SUBMITTED.
/// </summary>
internal static class CommercialLicenceRenewal
{
    internal static class States
    {
        public const string Draft = "DRAFT";
        public const string Submitted = "SUBMITTED";
        public const string TechnicalReview = "TECHNICAL_REVIEW";
        public const string MoreInfoRequired = "MORE_INFO_REQUIRED";
        public const string Approval = "APPROVAL";
        public const string Approved = "APPROVED";
        public const string Rejected = "REJECTED";
        public const string Withdrawn = "WITHDRAWN";
    }

    internal static class Transitions
    {
        public const string Submit = "SUBMIT";
        public const string Withdraw = "WITHDRAW";
        public const string StartReview = "START_REVIEW";
        public const string EscalateRegistry = "ESCALATE_REGISTRY";
        public const string RequestInfoInReview = "REQUEST_INFO_REVIEW";
        public const string RequestInfoInApproval = "REQUEST_INFO_APPROVAL";
        public const string ProvideInfo = "PROVIDE_INFO";
        public const string SendForApproval = "SEND_FOR_APPROVAL";
        public const string Approve = "APPROVE";
        public const string Reject = "REJECT";
    }

    internal static class Roles
    {
        public const string Applicant = ServiceRequest.ApplicantRole;
        public const string RegistryOfficer = "RegistryOfficer";
        public const string RegistrySupervisor = "RegistrySupervisor";
        public const string TechnicalReviewer = "TechnicalReviewer";
        public const string LicensingApprover = "LicensingApprover";
    }

    internal static class Departments
    {
        public const string Registry = "Registry";
        public const string Technical = "TechnicalDepartment";
        public const string Licensing = "LicensingDepartment";
    }

    internal static class Documents
    {
        public const string TradeLicence = "TRADE_LICENCE";
        public const string TenancyContract = "TENANCY_CONTRACT";
    }

    public static readonly TimeSpan SubmittedSla = TimeSpan.FromHours(24);
    public static readonly TimeSpan SubmittedWarnAfter = TimeSpan.FromHours(18);
    public static readonly TimeSpan TechnicalReviewSla = TimeSpan.FromDays(3);
    public static readonly TimeSpan ApprovalSla = TimeSpan.FromDays(2);

    public const string RegistryEscalationRole = Roles.RegistrySupervisor;
    public const string TechnicalEscalationRole = "TechnicalSupervisor";
    public const string ApprovalEscalationRole = "DirectorOffice";

    /// <summary>Builds and publishes the definition. Publishing runs the structural validation.</summary>
    public static WorkflowDefinition Build(int version = 1)
    {
        var definition = new WorkflowDefinition(
            "commercial-licence-renewal", version, "Commercial Licence Renewal", "تجديد الرخصة التجارية");

        definition.AddState(States.Draft, "Draft", "مسودة", StateKind.Start).At(0);

        definition.AddState(States.Submitted, "Submitted", "مقدم", StateKind.Intermediate)
            .OwnedBy(Departments.Registry)
            .WithSla(SubmittedSla, SubmittedWarnAfter, RegistryEscalationRole)
            .At(1);

        definition.AddState(States.TechnicalReview, "Technical Review", "المراجعة الفنية", StateKind.Intermediate)
            .OwnedBy(Departments.Technical)
            .WithSla(TechnicalReviewSla, escalateToRole: TechnicalEscalationRole)
            .At(2);

        // No SLA: the clock belongs to the applicant here, not to the government.
        definition.AddState(States.MoreInfoRequired, "More Information Required", "مطلوب معلومات إضافية", StateKind.Intermediate)
            .At(3);

        definition.AddState(States.Approval, "Approval", "الاعتماد", StateKind.Intermediate)
            .OwnedBy(Departments.Licensing)
            .WithSla(ApprovalSla, escalateToRole: ApprovalEscalationRole)
            .At(4);

        definition.AddState(States.Approved, "Approved", "معتمد", StateKind.Terminal).At(5);
        definition.AddState(States.Rejected, "Rejected", "مرفوض", StateKind.Terminal).At(6);
        definition.AddState(States.Withdrawn, "Withdrawn", "مسحوب", StateKind.Terminal).At(7);

        definition.AddTransition(Transitions.Submit, States.Draft, States.Submitted, "Submit", "تقديم")
            .ForRoles(Roles.Applicant)
            .WithGuard(new TransitionGuard(GuardKind.RequiresDocumentType, Documents.TradeLicence))
            .WithGuard(new TransitionGuard(GuardKind.RequiresFeePaid))
            .WithAction(new TransitionAction(ActionKind.AssignToDepartment, Departments.Registry))
            .WithAction(new TransitionAction(ActionKind.NotifyRole, Roles.RegistryOfficer));

        definition.AddTransition(Transitions.Withdraw, States.Draft, States.Withdrawn, "Withdraw", "سحب")
            .ForRoles(Roles.Applicant)
            .RequiringComment()
            .WithAction(new TransitionAction(ActionKind.ClearAssignment));

        definition.AddTransition(Transitions.StartReview, States.Submitted, States.TechnicalReview, "Start Review", "بدء المراجعة")
            .ForRoles(Roles.RegistryOfficer)
            .WithAction(new TransitionAction(ActionKind.AssignToDepartment, Departments.Technical))
            .WithAction(new TransitionAction(ActionKind.AssignToRole, Roles.TechnicalReviewer))
            .WithAction(new TransitionAction(ActionKind.NotifyRole, Roles.TechnicalReviewer));

        // A supervisor pushing a stalled registry item forward once its SLA has bitten.
        definition.AddTransition(Transitions.EscalateRegistry, States.Submitted, States.TechnicalReview, "Escalate", "تصعيد")
            .AsKind(TransitionKind.Escalation)
            .ForRoles(Roles.RegistrySupervisor)
            .WithAction(new TransitionAction(ActionKind.AssignToDepartment, Departments.Technical));

        definition.AddTransition(Transitions.RequestInfoInReview, States.TechnicalReview, States.MoreInfoRequired,
                "Request Information", "طلب معلومات")
            .AsKind(TransitionKind.RequestInformation)
            .ForRoles(Roles.TechnicalReviewer)
            .RequiringComment()
            .WithAction(new TransitionAction(ActionKind.ClearAssignment))
            .WithAction(new TransitionAction(ActionKind.NotifyApplicant));

        // The second entry point into the shared waiting state. Its existence is the whole
        // reason the return path has to be data on the request rather than an authored edge.
        definition.AddTransition(Transitions.RequestInfoInApproval, States.Approval, States.MoreInfoRequired,
                "Request Information", "طلب معلومات")
            .AsKind(TransitionKind.RequestInformation)
            .ForRoles(Roles.LicensingApprover)
            .RequiringComment()
            .WithAction(new TransitionAction(ActionKind.ClearAssignment))
            .WithAction(new TransitionAction(ActionKind.NotifyApplicant));

        // Declared target is TECHNICAL_REVIEW: a real, reachable state that keeps the
        // structural validation meaningful and acts as the fallback. At runtime the
        // recorded origin wins, so a request that was sent back from APPROVAL returns there.
        definition.AddTransition(Transitions.ProvideInfo, States.MoreInfoRequired, States.TechnicalReview,
                "Provide Information", "تقديم المعلومات")
            .AsKind(TransitionKind.ResumeAfterInfo)
            .ForRoles(Roles.Applicant)
            .WithGuard(new TransitionGuard(GuardKind.RequiresApplicantResponse))
            .WithAction(new TransitionAction(ActionKind.NotifyRole, Roles.TechnicalReviewer));

        definition.AddTransition(Transitions.SendForApproval, States.TechnicalReview, States.Approval,
                "Send for Approval", "إحالة للاعتماد")
            .ForRoles(Roles.TechnicalReviewer)
            .WithGuard(new TransitionGuard(GuardKind.RequiresAllDocumentsVerified))
            .WithAction(new TransitionAction(ActionKind.AssignToDepartment, Departments.Licensing))
            .WithAction(new TransitionAction(ActionKind.AssignToRole, Roles.LicensingApprover))
            .WithAction(new TransitionAction(ActionKind.NotifyRole, Roles.LicensingApprover));

        // Segregation of duties, named form: the approver must not be whoever referred it.
        definition.AddTransition(Transitions.Approve, States.Approval, States.Approved, "Approve", "اعتماد")
            .ForRoles(Roles.LicensingApprover)
            .WithGuard(new TransitionGuard(GuardKind.RequiresDifferentActorThan, Transitions.SendForApproval))
            .WithAction(new TransitionAction(ActionKind.StampDecisionDate))
            .WithAction(new TransitionAction(ActionKind.ClearAssignment))
            .WithAction(new TransitionAction(ActionKind.NotifyApplicant));

        // Segregation of duties, unnamed form: falls back to the actor of the immediately
        // preceding transition, whichever transition that was.
        definition.AddTransition(Transitions.Reject, States.Approval, States.Rejected, "Reject", "رفض")
            .ForRoles(Roles.LicensingApprover)
            .RequiringComment()
            .WithGuard(new TransitionGuard(GuardKind.RequiresDifferentActorThan))
            .WithAction(new TransitionAction(ActionKind.StampDecisionDate))
            .WithAction(new TransitionAction(ActionKind.ClearAssignment))
            .WithAction(new TransitionAction(ActionKind.NotifyApplicant));

        definition.Publish();
        return definition;
    }
}

/// <summary>
/// Drives a request through the commercial licence renewal workflow so each test can start
/// from the state it actually cares about, without repeating the journey.
/// </summary>
internal sealed class WorkflowScenario
{
    public static readonly DateTimeOffset T0 = new(2026, 3, 1, 8, 0, 0, TimeSpan.FromHours(3));

    public WorkflowDefinition Definition { get; }
    public ServiceRequest Request { get; }
    public WorkflowEngine Engine { get; } = new();

    /// <summary>Advances on every step so entries have distinct, increasing timestamps.</summary>
    public DateTimeOffset Now { get; private set; } = T0;

    public static TransitionActor Citizen { get; } =
        TransitionActor.Create("citizen-7781", "Layla Al Mansouri", CommercialLicenceRenewal.Roles.Applicant);

    public static TransitionActor Registrar { get; } =
        TransitionActor.Create("officer-registry-1", "Omar Registry", CommercialLicenceRenewal.Roles.RegistryOfficer);

    public static TransitionActor Supervisor { get; } =
        TransitionActor.Create("officer-registry-sup", "Huda Supervisor", CommercialLicenceRenewal.Roles.RegistrySupervisor);

    public static TransitionActor Reviewer { get; } =
        TransitionActor.Create("officer-tech-1", "Yousef Reviewer", CommercialLicenceRenewal.Roles.TechnicalReviewer);

    public static TransitionActor Approver { get; } =
        TransitionActor.Create("officer-licensing-1", "Maryam Approver", CommercialLicenceRenewal.Roles.LicensingApprover);

    /// <summary>One person holding both hats. Exists to prove segregation of duties bites.</summary>
    public static TransitionActor ReviewerWhoIsAlsoApprover { get; } = new(
        Reviewer.UserId,
        Reviewer.DisplayName,
        [CommercialLicenceRenewal.Roles.TechnicalReviewer, CommercialLicenceRenewal.Roles.LicensingApprover]);

    public WorkflowScenario(WorkflowDefinition? definition = null)
    {
        Definition = definition ?? CommercialLicenceRenewal.Build();

        Request = ServiceRequest.Submit(
            Definition,
            ReferenceNumber.Format(2026, 123),
            "commercial-licence-renewal",
            Citizen.UserId,
            Citizen.DisplayName,
            T0);
    }

    public DateTimeOffset Advance(TimeSpan by)
    {
        Now += by;
        return Now;
    }

    public ExecuteResult Execute(string transitionCode, TransitionActor actor, string? comment = null, TimeSpan? after = null)
    {
        Advance(after ?? TimeSpan.FromMinutes(30));
        return Engine.Execute(Request, Definition, transitionCode, actor, Now, comment);
    }

    /// <summary>Uploads the mandatory attachment and settles the fee, the two SUBMIT guards.</summary>
    public WorkflowScenario WithSubmissionPrerequisites()
    {
        AttachDocument(CommercialLicenceRenewal.Documents.TradeLicence);
        Request.MarkFeePaid(Citizen, Advance(TimeSpan.FromMinutes(5)));
        return this;
    }

    public ServiceRequestDocument AttachDocument(string documentType) =>
        Request.AttachDocument(
            documentType,
            $"{documentType.ToLowerInvariant()}.pdf",
            "application/pdf",
            240_512,
            $"s3://muamalat-docs/{Request.Id:N}/{documentType}.pdf",
            Citizen,
            Advance(TimeSpan.FromMinutes(5)));

    public void VerifyAllDocuments()
    {
        foreach (var document in Request.Documents.ToList())
            Request.VerifyDocument(document.Id, Reviewer, Advance(TimeSpan.FromMinutes(2)));
    }

    /// <summary>Moves the request to SUBMITTED, satisfying both SUBMIT guards on the way.</summary>
    public WorkflowScenario AtSubmitted()
    {
        WithSubmissionPrerequisites();
        Execute(CommercialLicenceRenewal.Transitions.Submit, Citizen).Succeeded.Should().BeTrue();
        return this;
    }

    public WorkflowScenario AtTechnicalReview()
    {
        AtSubmitted();
        Execute(CommercialLicenceRenewal.Transitions.StartReview, Registrar).Succeeded.Should().BeTrue();
        return this;
    }

    /// <summary>Moves to APPROVAL, verifying documents first so the referral guard passes.</summary>
    public WorkflowScenario AtApproval(TransitionActor? referredBy = null)
    {
        AtTechnicalReview();
        VerifyAllDocuments();
        Execute(CommercialLicenceRenewal.Transitions.SendForApproval, referredBy ?? Reviewer)
            .Succeeded.Should().BeTrue();
        return this;
    }
}
