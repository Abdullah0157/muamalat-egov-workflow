using FluentAssertions;
using Muamalat.Domain.Auditing;
using Muamalat.Domain.Common;
using Muamalat.Domain.Requests;
using Muamalat.Domain.Workflow;
using Muamalat.Tests.Workflow;
using static Muamalat.Tests.Workflow.CommercialLicenceRenewal;

namespace Muamalat.Tests.Requests;

public class ServiceRequestTests
{
    private static readonly DateTimeOffset T0 = WorkflowScenario.T0;

    private static ServiceRequest Submit(WorkflowDefinition definition, string reference = "MW-2026-000123") =>
        ServiceRequest.Submit(
            definition, reference, "commercial-licence-renewal", "citizen-7781", "Layla Al Mansouri", T0);

    [Fact]
    public void A_new_request_starts_in_the_workflows_start_state()
    {
        var request = Submit(Build());

        request.CurrentStateCode.Should().Be(States.Draft);
        request.SubmittedAt.Should().Be(T0);
        request.CurrentStateEnteredAt.Should().Be(T0);
        request.ClosedAt.Should().BeNull();
        request.DecisionAt.Should().BeNull();
        request.IsClosed.Should().BeFalse();
        request.FeePaid.Should().BeFalse();
        request.StateBeforeInformationRequest.Should().BeNull();
        request.Documents.Should().BeEmpty();
    }

    [Fact]
    public void A_new_request_pins_the_workflow_version_it_was_lodged_under()
    {
        var definition = Build(version: 3);

        var request = Submit(definition);

        request.WorkflowDefinitionId.Should().Be(definition.Id);
        request.WorkflowKey.Should().Be(definition.Key);
        request.WorkflowVersion.Should().Be(3);
    }

    [Fact]
    public void A_new_request_opens_its_audit_chain()
    {
        var request = Submit(Build());

        request.AuditTrail.Should().ContainSingle();
        request.LatestAuditEntry!.EventType.Should().Be(AuditEventType.RequestSubmitted);
        request.LatestAuditEntry.ToStateCode.Should().Be(States.Draft);
        request.LatestAuditEntry.ActorUserId.Should().Be("citizen-7781");
        AuditChain.Verify(request.AuditTrail).IsValid.Should().BeTrue();
    }

    [Fact]
    public void A_request_cannot_be_lodged_against_an_unpublished_workflow()
    {
        var draftDefinition = new WorkflowDefinition("half-built", 1, "Half Built", "غير مكتمل");
        draftDefinition.AddState("START", "Start", "بداية", StateKind.Start);

        var act = () => Submit(draftDefinition);

        act.Should().Throw<WorkflowDefinitionException>().WithMessage("*not published*");
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("123456")]
    [InlineData("MW-26-000123")]
    [InlineData("MW-2026-123")]
    public void A_malformed_reference_number_is_rejected(string reference)
    {
        var act = () => Submit(Build(), reference);

        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Reference_numbers_are_formatted_for_the_counter_and_the_filing_year()
    {
        var reference = ReferenceNumber.Format(2026, 123);

        reference.Should().Be("MW-2026-000123");
        ReferenceNumber.IsWellFormed(reference).Should().BeTrue();
        Submit(Build(), reference).ReferenceNumber.Should().Be(reference);
    }

    // -----------------------------------------------------------------------------
    // Documents
    // -----------------------------------------------------------------------------

    [Fact]
    public void Attaching_a_document_records_it_and_audits_the_upload()
    {
        var scenario = new WorkflowScenario();

        var document = scenario.AttachDocument(Documents.TradeLicence);

        scenario.Request.Documents.Should().ContainSingle().Which.Should().BeSameAs(document);
        document.ServiceRequestId.Should().Be(scenario.Request.Id);
        document.IsVerified.Should().BeFalse();
        scenario.Request.LatestAuditEntry!.EventType.Should().Be(AuditEventType.DocumentUploaded);
        scenario.Request.SubmittedDocumentTypes.Should().BeEquivalentTo([Documents.TradeLicence]);
        scenario.Request.HasUnverifiedDocuments.Should().BeTrue();
    }

    [Fact]
    public void Verifying_a_document_audits_it_and_clears_the_unverified_flag()
    {
        var scenario = new WorkflowScenario();
        var document = scenario.AttachDocument(Documents.TradeLicence);

        var verified = scenario.Request.VerifyDocument(
            document.Id, WorkflowScenario.Reviewer, scenario.Advance(TimeSpan.FromMinutes(10)));

        verified.Should().BeTrue();
        document.IsVerified.Should().BeTrue();
        document.VerifiedByUserId.Should().Be(WorkflowScenario.Reviewer.UserId);
        document.VerifiedAt.Should().Be(scenario.Now);
        scenario.Request.HasUnverifiedDocuments.Should().BeFalse();
        scenario.Request.LatestAuditEntry!.EventType.Should().Be(AuditEventType.DocumentVerified);
    }

    [Fact]
    public void Verifying_a_document_twice_changes_nothing_and_writes_no_second_entry()
    {
        var scenario = new WorkflowScenario();
        var document = scenario.AttachDocument(Documents.TradeLicence);
        scenario.Request.VerifyDocument(document.Id, WorkflowScenario.Reviewer, scenario.Advance(TimeSpan.FromMinutes(5)));
        var entriesAfterFirst = scenario.Request.AuditTrail.Count;

        var second = scenario.Request.VerifyDocument(
            document.Id, WorkflowScenario.Registrar, scenario.Advance(TimeSpan.FromMinutes(5)));

        second.Should().BeFalse();
        document.VerifiedByUserId.Should().Be(WorkflowScenario.Reviewer.UserId);
        scenario.Request.AuditTrail.Should().HaveCount(entriesAfterFirst);
    }

    [Fact]
    public void Verifying_a_document_that_belongs_to_another_request_is_refused()
    {
        var scenario = new WorkflowScenario();
        var strayDocument = new WorkflowScenario().AttachDocument(Documents.TradeLicence);

        var act = () => scenario.Request.VerifyDocument(strayDocument.Id, WorkflowScenario.Reviewer, scenario.Now);

        act.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void A_replacement_upload_of_the_same_type_is_kept_alongside_the_original()
    {
        var scenario = new WorkflowScenario();
        scenario.AttachDocument(Documents.TradeLicence);
        scenario.AttachDocument(Documents.TradeLicence);

        scenario.Request.Documents.Should().HaveCount(2);
        scenario.Request.SubmittedDocumentTypes.Should().ContainSingle();
    }

    // -----------------------------------------------------------------------------
    // Fee, assignment and applicant responses
    // -----------------------------------------------------------------------------

    [Fact]
    public void Paying_the_fee_is_audited_once_and_a_repeat_callback_is_ignored()
    {
        var scenario = new WorkflowScenario();

        scenario.Request.MarkFeePaid(WorkflowScenario.Citizen, scenario.Advance(TimeSpan.FromMinutes(1)))
            .Should().BeTrue();
        var entries = scenario.Request.AuditTrail.Count;

        scenario.Request.MarkFeePaid(WorkflowScenario.Citizen, scenario.Advance(TimeSpan.FromMinutes(1)))
            .Should().BeFalse();

        scenario.Request.FeePaid.Should().BeTrue();
        scenario.Request.AuditTrail.Should().HaveCount(entries);
    }

    [Fact]
    public void Assigning_the_request_to_an_officer_is_audited()
    {
        var scenario = new WorkflowScenario().AtSubmitted();

        scenario.Request.AssignToUser(
            WorkflowScenario.Registrar.UserId, WorkflowScenario.Supervisor, scenario.Advance(TimeSpan.FromMinutes(3)));

        scenario.Request.AssignedToUserId.Should().Be(WorkflowScenario.Registrar.UserId);
        scenario.Request.LatestAuditEntry!.EventType.Should().Be(AuditEventType.Assigned);
        scenario.Request.LatestAuditEntry.ActorUserId.Should().Be(WorkflowScenario.Supervisor.UserId);
    }

    [Fact]
    public void The_applicant_is_only_counted_as_having_responded_since_entering_the_current_state()
    {
        var scenario = new WorkflowScenario();
        scenario.Request.RecordApplicantResponse("Anything to say.", scenario.Advance(TimeSpan.FromMinutes(1)));
        scenario.Request.ApplicantHasResponded.Should().BeTrue();

        scenario.WithSubmissionPrerequisites();
        scenario.Execute(Transitions.Submit, WorkflowScenario.Citizen).Succeeded.Should().BeTrue();

        // Moving states resets the question, which is exactly what the awaiting-applicant
        // guard needs on the next information request.
        scenario.Request.ApplicantHasResponded.Should().BeFalse();
    }

    [Fact]
    public void An_officers_comment_does_not_count_as_an_applicant_response()
    {
        var scenario = new WorkflowScenario().AtTechnicalReview();

        scenario.Execute(Transitions.RequestInfoInReview, WorkflowScenario.Reviewer, "We need page 2.");

        scenario.Request.ApplicantHasResponded.Should().BeFalse();
    }

    [Fact]
    public void An_empty_applicant_response_is_refused()
    {
        var scenario = new WorkflowScenario();

        var act = () => scenario.Request.RecordApplicantResponse("   ", scenario.Now);

        act.Should().Throw<ArgumentException>();
    }

    // -----------------------------------------------------------------------------
    // Closed requests
    // -----------------------------------------------------------------------------

    [Fact]
    public void A_closed_request_accepts_no_further_document_fee_or_assignment_changes()
    {
        var scenario = new WorkflowScenario().AtApproval();
        scenario.Execute(Transitions.Approve, WorkflowScenario.Approver).Succeeded.Should().BeTrue();
        var request = scenario.Request;

        var attach = () => scenario.AttachDocument(Documents.TenancyContract);
        var pay = () => request.MarkFeePaid(WorkflowScenario.Citizen, scenario.Now);
        var assign = () => request.AssignToUser("officer-x", WorkflowScenario.Supervisor, scenario.Now);
        var respond = () => request.RecordApplicantResponse("Too late.", scenario.Now);

        attach.Should().Throw<InvalidOperationException>();
        pay.Should().Throw<InvalidOperationException>();
        assign.Should().Throw<InvalidOperationException>();
        respond.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void The_applicant_actor_carries_the_snapshot_taken_at_submission()
    {
        var request = Submit(Build());

        request.Applicant.UserId.Should().Be(request.ApplicantUserId);
        request.Applicant.DisplayName.Should().Be(request.ApplicantDisplayName);
        request.Applicant.IsInRole(ServiceRequest.ApplicantRole).Should().BeTrue();
    }
}
