using Muamalat.Domain.Workflow;

namespace Muamalat.Infrastructure.Seeding;

/// <summary>
/// The workflow definitions shipped with a fresh installation.
///
/// These are seed DATA, not code paths. Nothing in the engine knows that a commercial licence
/// renewal exists; it simply executes whatever definition a request is pinned to. An
/// administrator can edit any of these in the designer, or add an entirely new service, without
/// a redeploy. That is the whole point of storing workflows as data, and this file is the proof:
/// three genuinely different government services expressed purely through configuration.
/// </summary>
public static class WorkflowCatalog
{
    public const string CommercialLicenceRenewal = "commercial-licence-renewal";
    public const string BuildingPermit = "building-permit";
    public const string VehicleRegistrationTransfer = "vehicle-registration-transfer";

    public static IReadOnlyList<WorkflowDefinition> All() =>
    [
        BuildCommercialLicenceRenewal(),
        BuildBuildingPermit(),
        BuildVehicleRegistrationTransfer()
    ];

    /// <summary>
    /// Commercial licence renewal. The richest of the three: two review stages in different
    /// departments, a fee gate, a request-for-information loop, and segregation of duties so
    /// the officer who reviewed cannot also approve.
    /// </summary>
    private static WorkflowDefinition BuildCommercialLicenceRenewal()
    {
        var wf = new WorkflowDefinition(
            CommercialLicenceRenewal, version: 1,
            nameEn: "Commercial Licence Renewal",
            nameAr: "تجديد الرخصة التجارية");

        wf.AddState("SUBMITTED", "Submitted", "تم التقديم", StateKind.Start)
            .OwnedBy("Licensing")
            .WithSla(TimeSpan.FromHours(24), TimeSpan.FromHours(18), Roles.Supervisor)
            .At(1);

        wf.AddState("DOCUMENT_REVIEW", "Document Review", "مراجعة المستندات", StateKind.Intermediate)
            .OwnedBy("Licensing")
            .WithSla(TimeSpan.FromHours(48), TimeSpan.FromHours(36), Roles.Supervisor)
            .At(2);

        // No SLA here on purpose: the clock is on the applicant, not on the government.
        // Counting this time against the department would make officers look late for
        // delays they cannot influence.
        wf.AddState("MORE_INFO_REQUIRED", "More Information Required", "مطلوب معلومات إضافية", StateKind.Intermediate)
            .At(3);

        wf.AddState("TECHNICAL_REVIEW", "Technical Review", "المراجعة الفنية", StateKind.Intermediate)
            .OwnedBy("Technical Affairs")
            .WithSla(TimeSpan.FromHours(72), TimeSpan.FromHours(54), Roles.Supervisor)
            .At(4);

        wf.AddState("AWAITING_PAYMENT", "Awaiting Fee Payment", "بانتظار سداد الرسوم", StateKind.Intermediate)
            .At(5);

        wf.AddState("FINAL_APPROVAL", "Final Approval", "الاعتماد النهائي", StateKind.Intermediate)
            .OwnedBy("Licensing")
            .WithSla(TimeSpan.FromHours(24), TimeSpan.FromHours(18), Roles.Admin)
            .At(6);

        wf.AddState("APPROVED", "Approved", "تمت الموافقة", StateKind.Terminal).At(7);
        wf.AddState("REJECTED", "Rejected", "مرفوض", StateKind.Terminal).At(8);
        wf.AddState("WITHDRAWN", "Withdrawn", "تم السحب", StateKind.Terminal).At(9);

        wf.AddTransition("START_REVIEW", "SUBMITTED", "DOCUMENT_REVIEW", "Start Review", "بدء المراجعة")
            .ForRoles(Roles.Officer, Roles.Supervisor)
            .WithAction(new TransitionAction(ActionKind.AssignToDepartment, "Licensing"));

        wf.AddTransition("REQUEST_INFO", "DOCUMENT_REVIEW", "MORE_INFO_REQUIRED", "Request Information", "طلب معلومات")
            .ForRoles(Roles.Officer, Roles.Supervisor)
            .AsKind(TransitionKind.RequestInformation)
            .RequiringComment()
            .WithGuard(new TransitionGuard(GuardKind.RequiresComment))
            .WithAction(new TransitionAction(ActionKind.NotifyApplicant));

        wf.AddTransition("PROVIDE_INFO", "MORE_INFO_REQUIRED", "DOCUMENT_REVIEW", "Submit Information", "إرسال المعلومات")
            .ForRoles(Roles.Citizen)
            .AsKind(TransitionKind.ResumeAfterInfo)
            .WithGuard(new TransitionGuard(GuardKind.RequiresApplicantResponse));

        wf.AddTransition("TO_TECHNICAL", "DOCUMENT_REVIEW", "TECHNICAL_REVIEW", "Send to Technical Review", "إحالة للمراجعة الفنية")
            .ForRoles(Roles.Officer, Roles.Supervisor)
            .WithGuard(new TransitionGuard(GuardKind.RequiresDocumentType, "commercial_licence"))
            .WithGuard(new TransitionGuard(GuardKind.RequiresDocumentType, "civil_id"))
            .WithGuard(new TransitionGuard(GuardKind.RequiresAllDocumentsVerified))
            .WithAction(new TransitionAction(ActionKind.AssignToDepartment, "Technical Affairs"))
            .WithAction(new TransitionAction(ActionKind.ClearAssignment));

        wf.AddTransition("TECHNICAL_PASS", "TECHNICAL_REVIEW", "AWAITING_PAYMENT", "Approve Technically", "الموافقة الفنية")
            .ForRoles(Roles.Officer, Roles.Supervisor)
            .WithAction(new TransitionAction(ActionKind.NotifyApplicant));

        wf.AddTransition("TECHNICAL_REJECT", "TECHNICAL_REVIEW", "REJECTED", "Reject", "رفض")
            .ForRoles(Roles.Supervisor)
            .RequiringComment()
            .WithGuard(new TransitionGuard(GuardKind.RequiresComment))
            .WithAction(new TransitionAction(ActionKind.StampDecisionDate))
            .WithAction(new TransitionAction(ActionKind.NotifyApplicant));

        wf.AddTransition("CONFIRM_PAYMENT", "AWAITING_PAYMENT", "FINAL_APPROVAL", "Confirm Payment", "تأكيد السداد")
            .ForRoles(Roles.Citizen, Roles.Officer)
            .WithGuard(new TransitionGuard(GuardKind.RequiresFeePaid));

        // Segregation of duties: whoever performed the technical review may not also grant
        // the final approval. This is the control an auditor looks for first.
        wf.AddTransition("FINAL_APPROVE", "FINAL_APPROVAL", "APPROVED", "Approve", "اعتماد")
            .ForRoles(Roles.Supervisor, Roles.Admin)
            .WithGuard(new TransitionGuard(GuardKind.RequiresDifferentActorThan))
            .WithAction(new TransitionAction(ActionKind.StampDecisionDate))
            .WithAction(new TransitionAction(ActionKind.NotifyApplicant));

        wf.AddTransition("FINAL_REJECT", "FINAL_APPROVAL", "REJECTED", "Reject", "رفض")
            .ForRoles(Roles.Supervisor, Roles.Admin)
            .RequiringComment()
            .WithGuard(new TransitionGuard(GuardKind.RequiresComment))
            .WithAction(new TransitionAction(ActionKind.StampDecisionDate))
            .WithAction(new TransitionAction(ActionKind.NotifyApplicant));

        // An applicant may abandon the request while it is still with them.
        wf.AddTransition("WITHDRAW", "MORE_INFO_REQUIRED", "WITHDRAWN", "Withdraw Application", "سحب الطلب")
            .ForRoles(Roles.Citizen)
            .RequiringComment()
            .WithGuard(new TransitionGuard(GuardKind.RequiresComment));

        wf.Publish();
        return wf;
    }

    /// <summary>
    /// Building permit. Demonstrates a different shape: a single engineering review with a
    /// long SLA and an inspection step, showing the engine is not tied to one process design.
    /// </summary>
    private static WorkflowDefinition BuildBuildingPermit()
    {
        var wf = new WorkflowDefinition(
            BuildingPermit, version: 1,
            nameEn: "Building Permit",
            nameAr: "رخصة بناء");

        wf.AddState("SUBMITTED", "Submitted", "تم التقديم", StateKind.Start)
            .OwnedBy("Engineering")
            .WithSla(TimeSpan.FromHours(48), escalateToRole: Roles.Supervisor)
            .At(1);

        wf.AddState("ENGINEERING_REVIEW", "Engineering Review", "المراجعة الهندسية", StateKind.Intermediate)
            .OwnedBy("Engineering")
            .WithSla(TimeSpan.FromDays(10), TimeSpan.FromDays(7), Roles.Supervisor)
            .At(2);

        wf.AddState("MORE_INFO_REQUIRED", "More Information Required", "مطلوب معلومات إضافية", StateKind.Intermediate).At(3);

        wf.AddState("SITE_INSPECTION", "Site Inspection", "المعاينة الميدانية", StateKind.Intermediate)
            .OwnedBy("Inspection")
            .WithSla(TimeSpan.FromDays(5), TimeSpan.FromDays(3), Roles.Supervisor)
            .At(4);

        wf.AddState("APPROVED", "Permit Issued", "تم إصدار الرخصة", StateKind.Terminal).At(5);
        wf.AddState("REJECTED", "Rejected", "مرفوض", StateKind.Terminal).At(6);

        wf.AddTransition("START_REVIEW", "SUBMITTED", "ENGINEERING_REVIEW", "Start Review", "بدء المراجعة")
            .ForRoles(Roles.Officer, Roles.Supervisor)
            .WithGuard(new TransitionGuard(GuardKind.RequiresDocumentType, "site_plan"))
            .WithAction(new TransitionAction(ActionKind.AssignToDepartment, "Engineering"));

        wf.AddTransition("REQUEST_INFO", "ENGINEERING_REVIEW", "MORE_INFO_REQUIRED", "Request Information", "طلب معلومات")
            .ForRoles(Roles.Officer, Roles.Supervisor)
            .AsKind(TransitionKind.RequestInformation)
            .RequiringComment()
            .WithGuard(new TransitionGuard(GuardKind.RequiresComment))
            .WithAction(new TransitionAction(ActionKind.NotifyApplicant));

        wf.AddTransition("PROVIDE_INFO", "MORE_INFO_REQUIRED", "ENGINEERING_REVIEW", "Submit Information", "إرسال المعلومات")
            .ForRoles(Roles.Citizen)
            .AsKind(TransitionKind.ResumeAfterInfo)
            .WithGuard(new TransitionGuard(GuardKind.RequiresApplicantResponse));

        wf.AddTransition("SCHEDULE_INSPECTION", "ENGINEERING_REVIEW", "SITE_INSPECTION", "Schedule Inspection", "جدولة المعاينة")
            .ForRoles(Roles.Officer, Roles.Supervisor)
            .WithGuard(new TransitionGuard(GuardKind.RequiresAllDocumentsVerified))
            .WithAction(new TransitionAction(ActionKind.AssignToDepartment, "Inspection"))
            .WithAction(new TransitionAction(ActionKind.ClearAssignment));

        wf.AddTransition("INSPECTION_PASS", "SITE_INSPECTION", "APPROVED", "Issue Permit", "إصدار الرخصة")
            .ForRoles(Roles.Supervisor, Roles.Admin)
            .WithGuard(new TransitionGuard(GuardKind.RequiresFeePaid))
            .WithAction(new TransitionAction(ActionKind.StampDecisionDate))
            .WithAction(new TransitionAction(ActionKind.NotifyApplicant));

        wf.AddTransition("INSPECTION_FAIL", "SITE_INSPECTION", "REJECTED", "Reject", "رفض")
            .ForRoles(Roles.Supervisor, Roles.Admin)
            .RequiringComment()
            .WithGuard(new TransitionGuard(GuardKind.RequiresComment))
            .WithAction(new TransitionAction(ActionKind.StampDecisionDate))
            .WithAction(new TransitionAction(ActionKind.NotifyApplicant));

        wf.AddTransition("REJECT_AT_REVIEW", "ENGINEERING_REVIEW", "REJECTED", "Reject", "رفض")
            .ForRoles(Roles.Supervisor)
            .RequiringComment()
            .WithGuard(new TransitionGuard(GuardKind.RequiresComment))
            .WithAction(new TransitionAction(ActionKind.StampDecisionDate));

        wf.Publish();
        return wf;
    }

    /// <summary>
    /// Vehicle registration transfer. Deliberately short: a two step service proving the same
    /// engine handles a trivial process without ceremony.
    /// </summary>
    private static WorkflowDefinition BuildVehicleRegistrationTransfer()
    {
        var wf = new WorkflowDefinition(
            VehicleRegistrationTransfer, version: 1,
            nameEn: "Vehicle Registration Transfer",
            nameAr: "نقل ملكية مركبة");

        wf.AddState("SUBMITTED", "Submitted", "تم التقديم", StateKind.Start)
            .OwnedBy("Traffic")
            .WithSla(TimeSpan.FromHours(8), TimeSpan.FromHours(6), Roles.Supervisor)
            .At(1);

        wf.AddState("VERIFICATION", "Verification", "التحقق", StateKind.Intermediate)
            .OwnedBy("Traffic")
            .WithSla(TimeSpan.FromHours(24), TimeSpan.FromHours(18), Roles.Supervisor)
            .At(2);

        wf.AddState("COMPLETED", "Transfer Completed", "تم نقل الملكية", StateKind.Terminal).At(3);
        wf.AddState("REJECTED", "Rejected", "مرفوض", StateKind.Terminal).At(4);

        wf.AddTransition("VERIFY", "SUBMITTED", "VERIFICATION", "Begin Verification", "بدء التحقق")
            .ForRoles(Roles.Officer, Roles.Supervisor)
            .WithGuard(new TransitionGuard(GuardKind.RequiresDocumentType, "vehicle_ownership"))
            .WithAction(new TransitionAction(ActionKind.AssignToDepartment, "Traffic"));

        wf.AddTransition("COMPLETE", "VERIFICATION", "COMPLETED", "Complete Transfer", "إتمام النقل")
            .ForRoles(Roles.Officer, Roles.Supervisor)
            .WithGuard(new TransitionGuard(GuardKind.RequiresAllDocumentsVerified))
            .WithGuard(new TransitionGuard(GuardKind.RequiresFeePaid))
            .WithAction(new TransitionAction(ActionKind.StampDecisionDate))
            .WithAction(new TransitionAction(ActionKind.NotifyApplicant));

        wf.AddTransition("REJECT", "VERIFICATION", "REJECTED", "Reject", "رفض")
            .ForRoles(Roles.Officer, Roles.Supervisor)
            .RequiringComment()
            .WithGuard(new TransitionGuard(GuardKind.RequiresComment))
            .WithAction(new TransitionAction(ActionKind.StampDecisionDate));

        wf.Publish();
        return wf;
    }

    /// <summary>Role names duplicated here so the Domain and Infrastructure layers stay free of an API dependency.</summary>
    private static class Roles
    {
        public const string Citizen = "Citizen";
        public const string Officer = "Officer";
        public const string Supervisor = "Supervisor";
        public const string Admin = "Admin";
    }
}
