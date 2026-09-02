using FluentAssertions;
using Muamalat.Domain.Auditing;
using static Muamalat.Tests.Workflow.CommercialLicenceRenewal;

namespace Muamalat.Tests.Workflow;

/// <summary>
/// The audit chain is the artefact an auditor actually inspects, so these tests treat it as
/// a product feature rather than a side effect: it must grow predictably, it must never
/// grow on a failed action, and it must still verify after a long, realistic journey.
/// </summary>
public class WorkflowAuditTrailTests
{
    [Fact]
    public void Submitting_a_request_opens_the_chain_with_a_genesis_entry()
    {
        var request = new WorkflowScenario().Request;

        request.AuditTrail.Should().ContainSingle();
        request.AuditTrail[0].Sequence.Should().Be(1);
        request.AuditTrail[0].EventType.Should().Be(AuditEventType.RequestSubmitted);
        request.AuditTrail[0].PreviousHash.Should().Be(AuditEntry.GenesisHash);
        AuditChain.Verify(request.AuditTrail).IsValid.Should().BeTrue();
    }

    [Fact]
    public void A_successful_transition_adds_exactly_one_entry()
    {
        var scenario = new WorkflowScenario().WithSubmissionPrerequisites();
        var before = scenario.Request.AuditTrail.Count;

        scenario.Execute(Transitions.Submit, WorkflowScenario.Citizen).Succeeded.Should().BeTrue();

        scenario.Request.AuditTrail.Should().HaveCount(before + 1);
    }

    [Fact]
    public void A_failed_transition_adds_nothing()
    {
        var scenario = new WorkflowScenario();
        var before = scenario.Request.AuditTrail.Count;

        scenario.Execute(Transitions.Submit, WorkflowScenario.Citizen).Succeeded.Should().BeFalse();
        scenario.Execute("NONSENSE", WorkflowScenario.Citizen).Succeeded.Should().BeFalse();
        scenario.Execute(Transitions.Approve, WorkflowScenario.Approver).Succeeded.Should().BeFalse();

        scenario.Request.AuditTrail.Should().HaveCount(before);
    }

    [Fact]
    public void The_entry_records_where_the_request_came_from_and_where_it_went()
    {
        var scenario = new WorkflowScenario().AtSubmitted();

        var entry = scenario.Execute(Transitions.StartReview, WorkflowScenario.Registrar).AuditEntry!;

        entry.FromStateCode.Should().Be(States.Submitted);
        entry.ToStateCode.Should().Be(States.TechnicalReview);
        entry.TransitionCode.Should().Be(Transitions.StartReview);
        entry.ActorUserId.Should().Be(WorkflowScenario.Registrar.UserId);
        entry.ActorDisplayName.Should().Be(WorkflowScenario.Registrar.DisplayName);
        entry.OccurredAt.Should().Be(scenario.Now);
    }

    [Fact]
    public void Sequences_stay_dense_and_each_entry_links_to_its_predecessor()
    {
        var scenario = FullJourney();
        var trail = scenario.Request.AuditTrail;

        trail.Select(e => e.Sequence).Should().BeEquivalentTo(Enumerable.Range(1, trail.Count));

        for (var i = 1; i < trail.Count; i++)
            trail[i].PreviousHash.Should().Be(trail[i - 1].Hash);
    }

    [Fact]
    public void The_chain_still_verifies_after_a_full_multi_step_journey()
    {
        var scenario = FullJourney();

        var result = AuditChain.Verify(scenario.Request.AuditTrail);

        result.IsValid.Should().BeTrue();
        result.Problems.Should().BeEmpty();
        result.EntryCount.Should().Be(scenario.Request.AuditTrail.Count);
        AuditChain.HeadHash(scenario.Request.AuditTrail)
            .Should().Be(scenario.Request.LatestAuditEntry!.Hash);
    }

    [Fact]
    public void A_journey_with_an_information_round_trip_records_the_whole_story_in_order()
    {
        var scenario = FullJourney();

        scenario.Request.AuditTrail.Select(e => e.EventType).Should().ContainInOrder(
            AuditEventType.RequestSubmitted,
            AuditEventType.DocumentUploaded,
            AuditEventType.FeePaid,
            AuditEventType.StateChanged,      // SUBMIT
            AuditEventType.StateChanged,      // START_REVIEW
            AuditEventType.InformationRequested,
            AuditEventType.InformationProvided, // the applicant's written reply
            AuditEventType.InformationProvided, // the resume transition itself
            AuditEventType.DocumentVerified,
            AuditEventType.StateChanged,      // SEND_FOR_APPROVAL
            AuditEventType.StateChanged);     // APPROVE
    }

    [Fact]
    public void Tampering_with_a_transition_entry_breaks_verification()
    {
        // Guards the end to end path: entries written by the engine must be as tamper
        // evident as ones built by hand in the auditing tests.
        var scenario = FullJourney();
        var trail = scenario.Request.AuditTrail;

        TestReflection.ForceSet(trail[3], nameof(AuditEntry.ActorUserId), "someone-who-was-not-there");

        var result = AuditChain.Verify(trail);

        result.IsValid.Should().BeFalse();
        result.Problems.Should().Contain(p => p.Kind == ChainProblemKind.ContentAltered);
    }

    [Fact]
    public void Every_entry_in_the_chain_belongs_to_its_own_request()
    {
        var scenario = FullJourney();

        scenario.Request.AuditTrail.Should().OnlyContain(e => e.ServiceRequestId == scenario.Request.Id);
    }

    /// <summary>Submit, review, one information round trip, referral, approval.</summary>
    private static WorkflowScenario FullJourney()
    {
        var scenario = new WorkflowScenario().AtTechnicalReview();

        scenario.Execute(Transitions.RequestInfoInReview, WorkflowScenario.Reviewer, "The trade licence scan is illegible.");
        scenario.Request.RecordApplicantResponse("Rescanned and attached.", scenario.Advance(TimeSpan.FromHours(5)));
        scenario.Execute(Transitions.ProvideInfo, WorkflowScenario.Citizen).Succeeded.Should().BeTrue();

        scenario.VerifyAllDocuments();
        scenario.Execute(Transitions.SendForApproval, WorkflowScenario.Reviewer).Succeeded.Should().BeTrue();
        scenario.Execute(Transitions.Approve, WorkflowScenario.Approver).Succeeded.Should().BeTrue();

        return scenario;
    }
}
