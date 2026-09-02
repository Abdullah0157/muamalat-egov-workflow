using FluentAssertions;
using Muamalat.Domain.Auditing;
using Muamalat.Domain.Common;
using Muamalat.Domain.Requests;
using Muamalat.Domain.Workflow;
using static Muamalat.Tests.Workflow.CommercialLicenceRenewal;

namespace Muamalat.Tests.Workflow;

public class WorkflowEngineTests
{
    [Fact]
    public void The_fixture_workflow_is_structurally_valid()
    {
        // If the fixture itself were invalid, every failure below would be ambiguous.
        Build().Validate().Should().BeEmpty();
    }

    // -----------------------------------------------------------------------------
    // Happy path
    // -----------------------------------------------------------------------------

    [Fact]
    public void A_valid_transition_moves_the_request_and_reports_both_states()
    {
        var scenario = new WorkflowScenario().WithSubmissionPrerequisites();

        var result = scenario.Execute(Transitions.Submit, WorkflowScenario.Citizen);

        result.Succeeded.Should().BeTrue();
        result.FailureCode.Should().BeNull();
        result.FromStateCode.Should().Be(States.Draft);
        result.ToStateCode.Should().Be(States.Submitted);
        scenario.Request.CurrentStateCode.Should().Be(States.Submitted);
    }

    [Fact]
    public void Entering_a_state_restarts_the_state_clock()
    {
        var scenario = new WorkflowScenario().WithSubmissionPrerequisites();
        var before = scenario.Request.CurrentStateEnteredAt;

        scenario.Execute(Transitions.Submit, WorkflowScenario.Citizen, after: TimeSpan.FromHours(6));

        scenario.Request.CurrentStateEnteredAt.Should().Be(scenario.Now);
        scenario.Request.CurrentStateEnteredAt.Should().BeAfter(before);
    }

    [Fact]
    public void A_full_journey_ends_approved_and_closed()
    {
        var scenario = new WorkflowScenario().AtApproval();

        var result = scenario.Execute(Transitions.Approve, WorkflowScenario.Approver);

        result.Succeeded.Should().BeTrue();
        scenario.Request.CurrentStateCode.Should().Be(States.Approved);
        scenario.Request.IsClosed.Should().BeTrue();
    }

    // -----------------------------------------------------------------------------
    // (a) Definition mismatch is a programmer error, so it throws
    // -----------------------------------------------------------------------------

    [Fact]
    public void Executing_against_a_different_definition_throws()
    {
        var scenario = new WorkflowScenario();
        var otherVersion = Build(version: 2);

        var act = () => scenario.Engine.Execute(
            scenario.Request, otherVersion, Transitions.Submit, WorkflowScenario.Citizen, WorkflowScenario.T0);

        act.Should().Throw<ArgumentException>().WithMessage("*pinned*");
    }

    [Fact]
    public void Querying_available_transitions_against_a_different_definition_throws()
    {
        var scenario = new WorkflowScenario();

        var act = () => scenario.Engine.AvailableTransitions(
            scenario.Request, Build(version: 2), WorkflowScenario.Citizen);

        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void The_pinned_workflow_never_changes_as_the_request_moves()
    {
        var scenario = new WorkflowScenario().AtApproval();

        scenario.Request.WorkflowDefinitionId.Should().Be(scenario.Definition.Id);
        scenario.Request.WorkflowKey.Should().Be(scenario.Definition.Key);
        scenario.Request.WorkflowVersion.Should().Be(scenario.Definition.Version);
    }

    // -----------------------------------------------------------------------------
    // (b) Closed
    // -----------------------------------------------------------------------------

    [Fact]
    public void Entering_a_terminal_state_stamps_ClosedAt()
    {
        var scenario = new WorkflowScenario().AtApproval();

        scenario.Request.ClosedAt.Should().BeNull();
        scenario.Execute(Transitions.Approve, WorkflowScenario.Approver);

        scenario.Request.ClosedAt.Should().Be(scenario.Now);
    }

    [Fact]
    public void A_closed_request_refuses_every_further_transition()
    {
        var scenario = new WorkflowScenario().AtApproval();
        scenario.Execute(Transitions.Approve, WorkflowScenario.Approver);

        var result = scenario.Execute(Transitions.Reject, WorkflowScenario.Approver, comment: "changed my mind");

        result.Succeeded.Should().BeFalse();
        result.FailureCode.Should().Be(FailureCodes.RequestClosed);
        scenario.Request.CurrentStateCode.Should().Be(States.Approved);
    }

    [Fact]
    public void A_closed_request_offers_no_available_transitions()
    {
        var scenario = new WorkflowScenario().AtApproval();
        scenario.Execute(Transitions.Approve, WorkflowScenario.Approver);

        scenario.Engine
            .AvailableTransitions(scenario.Request, scenario.Definition, WorkflowScenario.Approver)
            .Should().BeEmpty();
    }

    // -----------------------------------------------------------------------------
    // (c) Transition availability
    // -----------------------------------------------------------------------------

    [Fact]
    public void An_unknown_transition_code_is_rejected()
    {
        var scenario = new WorkflowScenario();

        var result = scenario.Execute("TELEPORT", WorkflowScenario.Citizen);

        result.Succeeded.Should().BeFalse();
        result.FailureCode.Should().Be(FailureCodes.TransitionNotAvailable);
    }

    [Fact]
    public void A_real_transition_that_starts_somewhere_else_is_rejected()
    {
        // APPROVE exists in this workflow, but not from DRAFT.
        var scenario = new WorkflowScenario();

        var result = scenario.Execute(Transitions.Approve, WorkflowScenario.Approver);

        result.Succeeded.Should().BeFalse();
        result.FailureCode.Should().Be(FailureCodes.TransitionNotAvailable);
        scenario.Request.CurrentStateCode.Should().Be(States.Draft);
    }

    [Fact]
    public void A_blank_transition_code_is_a_programmer_error()
    {
        var scenario = new WorkflowScenario();

        var act = () => scenario.Engine.Execute(
            scenario.Request, scenario.Definition, "  ", WorkflowScenario.Citizen, WorkflowScenario.T0);

        act.Should().Throw<ArgumentException>();
    }

    // -----------------------------------------------------------------------------
    // (d) Authorisation
    // -----------------------------------------------------------------------------

    [Fact]
    public void An_actor_without_an_allowed_role_is_forbidden()
    {
        var scenario = new WorkflowScenario().AtSubmitted();

        var result = scenario.Execute(Transitions.StartReview, WorkflowScenario.Citizen);

        result.Succeeded.Should().BeFalse();
        result.FailureCode.Should().Be(FailureCodes.TransitionForbidden);
        scenario.Request.CurrentStateCode.Should().Be(States.Submitted);
    }

    [Fact]
    public void Role_matching_ignores_case_because_identity_providers_do_not_agree_on_it()
    {
        var scenario = new WorkflowScenario().AtSubmitted();
        var shoutingRegistrar = TransitionActor.Create("officer-registry-2", "Caps Lock", "REGISTRYOFFICER");

        scenario.Execute(Transitions.StartReview, shoutingRegistrar).Succeeded.Should().BeTrue();
    }

    [Fact]
    public void Available_transitions_are_filtered_by_role_and_by_current_state()
    {
        var scenario = new WorkflowScenario();

        var citizenOptions = scenario.Engine
            .AvailableTransitions(scenario.Request, scenario.Definition, WorkflowScenario.Citizen)
            .Select(t => t.Code);

        citizenOptions.Should().BeEquivalentTo([Transitions.Submit, Transitions.Withdraw]);

        scenario.Engine
            .AvailableTransitions(scenario.Request, scenario.Definition, WorkflowScenario.Registrar)
            .Should().BeEmpty();
    }

    [Fact]
    public void Available_transitions_still_list_actions_whose_guards_would_currently_fail()
    {
        // SUBMIT needs a document and a paid fee, neither of which exists yet. It must still
        // be offered so the citizen can be told what is missing rather than shown nothing.
        var scenario = new WorkflowScenario();

        scenario.Engine
            .AvailableTransitions(scenario.Request, scenario.Definition, WorkflowScenario.Citizen)
            .Select(t => t.Code)
            .Should().Contain(Transitions.Submit);
    }

    // -----------------------------------------------------------------------------
    // (e) Mandatory comment
    // -----------------------------------------------------------------------------

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void A_transition_that_requires_a_comment_rejects_a_blank_one(string? comment)
    {
        var scenario = new WorkflowScenario();

        var result = scenario.Execute(Transitions.Withdraw, WorkflowScenario.Citizen, comment);

        result.Succeeded.Should().BeFalse();
        result.FailureCode.Should().Be(FailureCodes.CommentRequired);
    }

    [Fact]
    public void A_transition_that_requires_a_comment_accepts_one_and_stores_it_in_the_audit_trail()
    {
        var scenario = new WorkflowScenario();

        var result = scenario.Execute(Transitions.Withdraw, WorkflowScenario.Citizen, "Premises sold.");

        result.Succeeded.Should().BeTrue();
        result.AuditEntry!.Comment.Should().Be("Premises sold.");
        scenario.Request.CurrentStateCode.Should().Be(States.Withdrawn);
    }

    // -----------------------------------------------------------------------------
    // (f) Guards, one pass and one fail each
    // -----------------------------------------------------------------------------

    [Fact]
    public void RequiresDocumentType_blocks_a_submission_with_the_document_missing()
    {
        var scenario = new WorkflowScenario();
        scenario.Request.MarkFeePaid(WorkflowScenario.Citizen, scenario.Advance(TimeSpan.FromMinutes(1)));

        var result = scenario.Execute(Transitions.Submit, WorkflowScenario.Citizen);

        result.Succeeded.Should().BeFalse();
        result.FailureCode.Should().Be(FailureCodes.MissingDocument(Documents.TradeLicence));
    }

    [Fact]
    public void RequiresDocumentType_is_not_satisfied_by_a_different_document()
    {
        var scenario = new WorkflowScenario();
        scenario.AttachDocument(Documents.TenancyContract);
        scenario.Request.MarkFeePaid(WorkflowScenario.Citizen, scenario.Advance(TimeSpan.FromMinutes(1)));

        scenario.Execute(Transitions.Submit, WorkflowScenario.Citizen)
            .FailureCode.Should().Be(FailureCodes.MissingDocument(Documents.TradeLicence));
    }

    [Fact]
    public void RequiresDocumentType_passes_once_the_document_is_on_file()
    {
        var scenario = new WorkflowScenario().WithSubmissionPrerequisites();

        scenario.Execute(Transitions.Submit, WorkflowScenario.Citizen).Succeeded.Should().BeTrue();
    }

    [Fact]
    public void RequiresFeePaid_blocks_an_unpaid_submission()
    {
        var scenario = new WorkflowScenario();
        scenario.AttachDocument(Documents.TradeLicence);

        var result = scenario.Execute(Transitions.Submit, WorkflowScenario.Citizen);

        result.Succeeded.Should().BeFalse();
        result.FailureCode.Should().Be(FailureCodes.FeeUnpaid);
    }

    [Fact]
    public void RequiresFeePaid_passes_once_the_fee_is_settled()
    {
        var scenario = new WorkflowScenario();
        scenario.AttachDocument(Documents.TradeLicence);
        scenario.Request.MarkFeePaid(WorkflowScenario.Citizen, scenario.Advance(TimeSpan.FromMinutes(1)));

        scenario.Execute(Transitions.Submit, WorkflowScenario.Citizen).Succeeded.Should().BeTrue();
    }

    [Fact]
    public void RequiresAllDocumentsVerified_blocks_a_referral_while_anything_is_unverified()
    {
        var scenario = new WorkflowScenario().AtTechnicalReview();
        scenario.AttachDocument(Documents.TenancyContract);

        var result = scenario.Execute(Transitions.SendForApproval, WorkflowScenario.Reviewer);

        result.Succeeded.Should().BeFalse();
        result.FailureCode.Should().Be(FailureCodes.DocumentsNotVerified);
    }

    [Fact]
    public void RequiresAllDocumentsVerified_passes_once_every_document_is_verified()
    {
        var scenario = new WorkflowScenario().AtTechnicalReview();
        scenario.AttachDocument(Documents.TenancyContract);
        scenario.VerifyAllDocuments();

        scenario.Execute(Transitions.SendForApproval, WorkflowScenario.Reviewer).Succeeded.Should().BeTrue();
    }

    [Fact]
    public void RequiresApplicantResponse_blocks_a_resume_before_the_applicant_replies()
    {
        var scenario = new WorkflowScenario().AtTechnicalReview();
        scenario.Execute(Transitions.RequestInfoInReview, WorkflowScenario.Reviewer, "Please supply the tenancy contract.");

        var result = scenario.Execute(Transitions.ProvideInfo, WorkflowScenario.Citizen);

        result.Succeeded.Should().BeFalse();
        result.FailureCode.Should().Be(FailureCodes.AwaitingApplicant);
        scenario.Request.CurrentStateCode.Should().Be(States.MoreInfoRequired);
    }

    [Fact]
    public void RequiresApplicantResponse_passes_once_the_applicant_writes_back()
    {
        var scenario = new WorkflowScenario().AtTechnicalReview();
        scenario.Execute(Transitions.RequestInfoInReview, WorkflowScenario.Reviewer, "Please supply the tenancy contract.");
        scenario.Request.RecordApplicantResponse("Contract attached.", scenario.Advance(TimeSpan.FromHours(4)));

        scenario.Execute(Transitions.ProvideInfo, WorkflowScenario.Citizen).Succeeded.Should().BeTrue();
    }

    [Fact]
    public void RequiresApplicantResponse_is_also_satisfied_by_uploading_the_missing_document()
    {
        var scenario = new WorkflowScenario().AtTechnicalReview();
        scenario.Execute(Transitions.RequestInfoInReview, WorkflowScenario.Reviewer, "Tenancy contract please.");
        scenario.AttachDocument(Documents.TenancyContract);

        scenario.Execute(Transitions.ProvideInfo, WorkflowScenario.Citizen).Succeeded.Should().BeTrue();
    }

    [Fact]
    public void RequiresDifferentActorThan_blocks_the_referrer_from_approving_their_own_referral()
    {
        // The reviewer refers the file, then puts on the approver hat and tries to approve it.
        var scenario = new WorkflowScenario().AtApproval(referredBy: WorkflowScenario.ReviewerWhoIsAlsoApprover);

        var result = scenario.Execute(Transitions.Approve, WorkflowScenario.ReviewerWhoIsAlsoApprover);

        result.Succeeded.Should().BeFalse();
        result.FailureCode.Should().Be(FailureCodes.SegregationOfDuties);
        scenario.Request.CurrentStateCode.Should().Be(States.Approval);
    }

    [Fact]
    public void RequiresDifferentActorThan_allows_a_genuinely_different_approver()
    {
        var scenario = new WorkflowScenario().AtApproval(referredBy: WorkflowScenario.ReviewerWhoIsAlsoApprover);

        scenario.Execute(Transitions.Approve, WorkflowScenario.Approver).Succeeded.Should().BeTrue();
    }

    [Fact]
    public void RequiresDifferentActorThan_looks_past_intervening_steps_to_the_named_transition()
    {
        // Referral, then a round trip to the applicant, then the referrer tries to approve.
        // The named-transition form must still find the referral and block it.
        var scenario = new WorkflowScenario().AtApproval(referredBy: WorkflowScenario.ReviewerWhoIsAlsoApprover);

        scenario.Execute(Transitions.RequestInfoInApproval, WorkflowScenario.Approver, "Confirm the trade name.");
        scenario.Request.RecordApplicantResponse("Confirmed.", scenario.Advance(TimeSpan.FromHours(2)));
        scenario.Execute(Transitions.ProvideInfo, WorkflowScenario.Citizen).Succeeded.Should().BeTrue();

        scenario.Execute(Transitions.Approve, WorkflowScenario.ReviewerWhoIsAlsoApprover)
            .FailureCode.Should().Be(FailureCodes.SegregationOfDuties);
    }

    [Fact]
    public void RequiresDifferentActorThan_without_a_parameter_excludes_the_immediately_previous_actor()
    {
        // REJECT carries the unnamed form. The last transition was the referral, so the
        // referrer cannot also be the one who rejects.
        var scenario = new WorkflowScenario().AtApproval(referredBy: WorkflowScenario.ReviewerWhoIsAlsoApprover);

        var result = scenario.Execute(
            Transitions.Reject, WorkflowScenario.ReviewerWhoIsAlsoApprover, "Trade name unavailable.");

        result.Succeeded.Should().BeFalse();
        result.FailureCode.Should().Be(FailureCodes.SegregationOfDuties);
    }

    [Fact]
    public void RequiresDifferentActorThan_without_a_parameter_allows_a_different_actor()
    {
        var scenario = new WorkflowScenario().AtApproval(referredBy: WorkflowScenario.ReviewerWhoIsAlsoApprover);

        var result = scenario.Execute(Transitions.Reject, WorkflowScenario.Approver, "Trade name unavailable.");

        result.Succeeded.Should().BeTrue();
        scenario.Request.CurrentStateCode.Should().Be(States.Rejected);
    }

    [Fact]
    public void Guards_are_evaluated_in_the_order_the_author_declared_them()
    {
        // SUBMIT declares the document guard before the fee guard. With neither satisfied,
        // the citizen must be told about the document first, matching the form they see.
        var scenario = new WorkflowScenario();

        scenario.Execute(Transitions.Submit, WorkflowScenario.Citizen)
            .FailureCode.Should().Be(FailureCodes.MissingDocument(Documents.TradeLicence));
    }

    [Fact]
    public void A_missing_comment_is_reported_before_any_guard_failure()
    {
        // REJECT requires a comment and also carries a segregation-of-duties guard that
        // would fail for this actor. The officer must be told about the reason first.
        var scenario = new WorkflowScenario().AtApproval(referredBy: WorkflowScenario.ReviewerWhoIsAlsoApprover);

        scenario.Execute(Transitions.Reject, WorkflowScenario.ReviewerWhoIsAlsoApprover)
            .FailureCode.Should().Be(FailureCodes.CommentRequired);
    }

    // -----------------------------------------------------------------------------
    // Failures must not mutate
    // -----------------------------------------------------------------------------

    [Fact]
    public void A_rejected_transition_leaves_the_request_completely_untouched()
    {
        var scenario = new WorkflowScenario().AtTechnicalReview();
        var request = scenario.Request;

        var stateBefore = request.CurrentStateCode;
        var enteredBefore = request.CurrentStateEnteredAt;
        var departmentBefore = request.AssignedToDepartment;
        var roleBefore = request.AssignedToRole;
        var auditCountBefore = request.AuditTrail.Count;

        // Guard failure: nothing has been verified yet.
        scenario.Execute(Transitions.SendForApproval, WorkflowScenario.Reviewer).Succeeded.Should().BeFalse();

        request.CurrentStateCode.Should().Be(stateBefore);
        request.CurrentStateEnteredAt.Should().Be(enteredBefore);
        request.AssignedToDepartment.Should().Be(departmentBefore);
        request.AssignedToRole.Should().Be(roleBefore);
        request.AuditTrail.Should().HaveCount(auditCountBefore);
        request.DecisionAt.Should().BeNull();
        request.ClosedAt.Should().BeNull();
    }

    // -----------------------------------------------------------------------------
    // Request information, then resume
    // -----------------------------------------------------------------------------

    [Fact]
    public void Requesting_information_records_the_state_it_was_asked_from()
    {
        var scenario = new WorkflowScenario().AtTechnicalReview();

        scenario.Execute(Transitions.RequestInfoInReview, WorkflowScenario.Reviewer, "Tenancy contract is illegible.");

        scenario.Request.CurrentStateCode.Should().Be(States.MoreInfoRequired);
        scenario.Request.StateBeforeInformationRequest.Should().Be(States.TechnicalReview);
    }

    [Fact]
    public void Resuming_returns_the_request_to_the_state_that_asked_and_clears_the_marker()
    {
        var scenario = new WorkflowScenario().AtTechnicalReview();
        scenario.Execute(Transitions.RequestInfoInReview, WorkflowScenario.Reviewer, "Tenancy contract is illegible.");
        scenario.Request.RecordApplicantResponse("Rescanned copy attached.", scenario.Advance(TimeSpan.FromHours(6)));

        var result = scenario.Execute(Transitions.ProvideInfo, WorkflowScenario.Citizen);

        result.Succeeded.Should().BeTrue();
        result.ToStateCode.Should().Be(States.TechnicalReview);
        scenario.Request.CurrentStateCode.Should().Be(States.TechnicalReview);
        scenario.Request.StateBeforeInformationRequest.Should().BeNull();
    }

    [Fact]
    public void Resuming_returns_to_APPROVAL_when_that_is_where_the_question_came_from()
    {
        // The decisive test for the resume design. PROVIDE_INFO declares TECHNICAL_REVIEW as
        // its target, but the request was sent back from APPROVAL, so the recorded origin
        // must win and the file must land back on the approver's desk, not the reviewer's.
        var scenario = new WorkflowScenario().AtApproval();
        scenario.Execute(Transitions.RequestInfoInApproval, WorkflowScenario.Approver, "Confirm the trade name.");
        scenario.Request.StateBeforeInformationRequest.Should().Be(States.Approval);

        scenario.Request.RecordApplicantResponse("Trade name confirmed.", scenario.Advance(TimeSpan.FromHours(3)));
        var result = scenario.Execute(Transitions.ProvideInfo, WorkflowScenario.Citizen);

        result.ToStateCode.Should().Be(States.Approval);
        scenario.Request.CurrentStateCode.Should().Be(States.Approval);
        scenario.Request.StateBeforeInformationRequest.Should().BeNull();
    }

    [Fact]
    public void A_second_information_round_trip_returns_to_the_second_asker()
    {
        var scenario = new WorkflowScenario().AtTechnicalReview();

        scenario.Execute(Transitions.RequestInfoInReview, WorkflowScenario.Reviewer, "First question.");
        scenario.Request.RecordApplicantResponse("First answer.", scenario.Advance(TimeSpan.FromHours(2)));
        scenario.Execute(Transitions.ProvideInfo, WorkflowScenario.Citizen)
            .ToStateCode.Should().Be(States.TechnicalReview);

        scenario.VerifyAllDocuments();
        scenario.Execute(Transitions.SendForApproval, WorkflowScenario.Reviewer).Succeeded.Should().BeTrue();

        scenario.Execute(Transitions.RequestInfoInApproval, WorkflowScenario.Approver, "Second question.");
        scenario.Request.RecordApplicantResponse("Second answer.", scenario.Advance(TimeSpan.FromHours(2)));

        scenario.Execute(Transitions.ProvideInfo, WorkflowScenario.Citizen)
            .ToStateCode.Should().Be(States.Approval);
    }

    [Fact]
    public void Resuming_with_no_recorded_origin_falls_back_to_the_declared_target()
    {
        // Reproduces a request that reached MORE_INFO_REQUIRED without the marker being set,
        // which is what legacy rows migrated from the old system look like. The declared
        // target is what keeps such a request movable instead of stranded.
        var scenario = new WorkflowScenario().AtTechnicalReview();
        scenario.Execute(Transitions.RequestInfoInReview, WorkflowScenario.Reviewer, "Question.");
        scenario.Request.RecordApplicantResponse("Answer.", scenario.Advance(TimeSpan.FromHours(1)));

        TestReflection.ForceSet(scenario.Request, nameof(ServiceRequest.StateBeforeInformationRequest), null);

        scenario.Execute(Transitions.ProvideInfo, WorkflowScenario.Citizen)
            .ToStateCode.Should().Be(States.TechnicalReview);
    }

    // -----------------------------------------------------------------------------
    // Actions
    // -----------------------------------------------------------------------------

    [Fact]
    public void AssignToDepartment_and_AssignToRole_apply_in_declaration_order()
    {
        var scenario = new WorkflowScenario().AtSubmitted();
        scenario.Request.AssignedToDepartment.Should().Be(Departments.Registry);

        scenario.Execute(Transitions.StartReview, WorkflowScenario.Registrar);

        scenario.Request.AssignedToDepartment.Should().Be(Departments.Technical);
        scenario.Request.AssignedToRole.Should().Be(Roles.TechnicalReviewer);
    }

    [Fact]
    public void Reassigning_to_a_department_releases_the_officer_who_held_the_file()
    {
        var scenario = new WorkflowScenario().AtSubmitted();
        scenario.Request.AssignToUser(WorkflowScenario.Registrar.UserId, WorkflowScenario.Supervisor, scenario.Now);
        scenario.Request.AssignedToUserId.Should().Be(WorkflowScenario.Registrar.UserId);

        scenario.Execute(Transitions.StartReview, WorkflowScenario.Registrar);

        scenario.Request.AssignedToUserId.Should().BeNull();
    }

    [Fact]
    public void ClearAssignment_hands_the_request_back_to_nobody()
    {
        var scenario = new WorkflowScenario().AtTechnicalReview();

        scenario.Execute(Transitions.RequestInfoInReview, WorkflowScenario.Reviewer, "Missing page 2.");

        scenario.Request.AssignedToDepartment.Should().BeNull();
        scenario.Request.AssignedToRole.Should().BeNull();
        scenario.Request.AssignedToUserId.Should().BeNull();
    }

    [Fact]
    public void StampDecisionDate_records_the_decision_instant()
    {
        var scenario = new WorkflowScenario().AtApproval();

        scenario.Execute(Transitions.Approve, WorkflowScenario.Approver);

        scenario.Request.DecisionAt.Should().Be(scenario.Now);
    }

    [Fact]
    public void Notifications_are_returned_as_data_and_nothing_is_sent()
    {
        var scenario = new WorkflowScenario().AtTechnicalReview();

        var result = scenario.Execute(Transitions.RequestInfoInReview, WorkflowScenario.Reviewer, "Send page 2.");

        result.Notifications.Should().ContainSingle();
        var notification = result.Notifications[0];
        notification.Audience.Should().Be(NotificationAudience.Applicant);
        notification.Recipient.Should().Be(WorkflowScenario.Citizen.UserId);
        notification.ReferenceNumber.Should().Be(scenario.Request.ReferenceNumber);
        notification.ToStateCode.Should().Be(States.MoreInfoRequired);
        notification.Comment.Should().Be("Send page 2.");
    }

    [Fact]
    public void A_role_notification_addresses_the_role_named_in_the_action()
    {
        var scenario = new WorkflowScenario().AtSubmitted();

        var result = scenario.Execute(Transitions.StartReview, WorkflowScenario.Registrar);

        result.Notifications.Should().ContainSingle()
            .Which.Should().Match<WorkflowNotification>(n =>
                n.Audience == NotificationAudience.Role && n.Recipient == Roles.TechnicalReviewer);
    }

    [Fact]
    public void A_transition_with_no_notify_action_produces_no_notifications()
    {
        // WITHDRAW clears the assignment but tells nobody: the citizen already knows.
        var result = new WorkflowScenario().Execute(Transitions.Withdraw, WorkflowScenario.Citizen, "No longer needed.");

        result.Succeeded.Should().BeTrue();
        result.Notifications.Should().BeEmpty();
    }

    [Fact]
    public void An_action_that_needs_a_parameter_but_has_none_is_a_definition_defect()
    {
        var definition = new WorkflowDefinition("broken", 1, "Broken", "معطل");
        definition.AddState("START", "Start", "بداية", StateKind.Start);
        definition.AddState("END", "End", "نهاية", StateKind.Terminal);
        definition.AddTransition("GO", "START", "END", "Go", "اذهب")
            .ForRoles(ServiceRequest.ApplicantRole)
            .WithAction(new TransitionAction(ActionKind.AssignToDepartment)); // parameter omitted
        definition.Publish();

        var scenario = new WorkflowScenario(definition);

        var act = () => scenario.Execute("GO", WorkflowScenario.Citizen);

        act.Should().Throw<WorkflowDefinitionException>().WithMessage("*requires a parameter*");

        // Caught before anything moved, so the request is not left half transitioned.
        scenario.Request.CurrentStateCode.Should().Be("START");
        scenario.Request.AuditTrail.Should().ContainSingle();
    }

    // -----------------------------------------------------------------------------
    // Audit event vocabulary
    // -----------------------------------------------------------------------------

    [Fact]
    public void An_information_request_is_audited_as_such_and_not_as_a_plain_state_change()
    {
        var scenario = new WorkflowScenario().AtTechnicalReview();

        var result = scenario.Execute(Transitions.RequestInfoInReview, WorkflowScenario.Reviewer, "Send page 2.");

        result.AuditEntry!.EventType.Should().Be(AuditEventType.InformationRequested);
    }

    [Fact]
    public void A_resume_is_audited_as_information_provided()
    {
        var scenario = new WorkflowScenario().AtTechnicalReview();
        scenario.Execute(Transitions.RequestInfoInReview, WorkflowScenario.Reviewer, "Send page 2.");
        scenario.Request.RecordApplicantResponse("Sent.", scenario.Advance(TimeSpan.FromHours(1)));

        scenario.Execute(Transitions.ProvideInfo, WorkflowScenario.Citizen)
            .AuditEntry!.EventType.Should().Be(AuditEventType.InformationProvided);
    }

    [Fact]
    public void An_escalation_is_audited_as_an_escalation()
    {
        var scenario = new WorkflowScenario().AtSubmitted();

        scenario.Execute(Transitions.EscalateRegistry, WorkflowScenario.Supervisor)
            .AuditEntry!.EventType.Should().Be(AuditEventType.Escalated);
    }

    [Fact]
    public void An_ordinary_transition_is_audited_as_a_state_change()
    {
        var scenario = new WorkflowScenario().AtSubmitted();

        scenario.Execute(Transitions.StartReview, WorkflowScenario.Registrar)
            .AuditEntry!.EventType.Should().Be(AuditEventType.StateChanged);
    }
}
