using FluentAssertions;
using Muamalat.Domain.Workflow;
using static Muamalat.Tests.Workflow.CommercialLicenceRenewal;

namespace Muamalat.Tests.Workflow;

/// <summary>
/// SLA reporting drives escalation and the department's published performance figures, so
/// the boundaries are pinned exactly rather than approximately. The state used throughout
/// is SUBMITTED: a 24 hour target with an explicit 18 hour warning threshold.
/// </summary>
public class SlaEvaluationTests
{
    private static (WorkflowScenario Scenario, DateTimeOffset EnteredAt) AtSubmitted()
    {
        var scenario = new WorkflowScenario().AtSubmitted();
        return (scenario, scenario.Request.CurrentStateEnteredAt);
    }

    private static SlaSnapshot EvaluateAfter(TimeSpan elapsed)
    {
        var (scenario, enteredAt) = AtSubmitted();
        return scenario.Engine.EvaluateSla(scenario.Request, scenario.Definition, enteredAt + elapsed);
    }

    [Fact]
    public void A_request_that_has_just_arrived_is_on_track()
    {
        var snapshot = EvaluateAfter(TimeSpan.Zero);

        snapshot.StateCode.Should().Be(States.Submitted);
        snapshot.HasSla.Should().BeTrue();
        snapshot.Status.Should().Be(SlaStatus.OnTrack);
        snapshot.IsBreached.Should().BeFalse();
        snapshot.Elapsed.Should().Be(TimeSpan.Zero);
    }

    [Fact]
    public void One_tick_before_the_warning_threshold_it_is_still_on_track()
    {
        EvaluateAfter(SubmittedWarnAfter - TimeSpan.FromTicks(1))
            .Status.Should().Be(SlaStatus.OnTrack);
    }

    [Fact]
    public void Exactly_at_the_warning_threshold_it_becomes_at_risk()
    {
        EvaluateAfter(SubmittedWarnAfter).Status.Should().Be(SlaStatus.AtRisk);
    }

    [Fact]
    public void One_tick_before_the_target_it_is_still_only_at_risk()
    {
        EvaluateAfter(SubmittedSla - TimeSpan.FromTicks(1))
            .Status.Should().Be(SlaStatus.AtRisk);
    }

    [Fact]
    public void Exactly_at_the_target_it_is_breached()
    {
        var snapshot = EvaluateAfter(SubmittedSla);

        snapshot.Status.Should().Be(SlaStatus.Breached);
        snapshot.IsBreached.Should().BeTrue();
    }

    [Fact]
    public void Past_the_target_it_stays_breached_and_reports_how_far_overdue_it_is()
    {
        var snapshot = EvaluateAfter(SubmittedSla + TimeSpan.FromHours(9));

        snapshot.Status.Should().Be(SlaStatus.Breached);
        snapshot.Remaining.Should().Be(TimeSpan.FromHours(-9));
    }

    [Fact]
    public void The_due_date_is_the_target_measured_from_entering_the_state()
    {
        var (scenario, enteredAt) = AtSubmitted();

        var snapshot = scenario.Engine.EvaluateSla(scenario.Request, scenario.Definition, enteredAt + TimeSpan.FromHours(1));

        snapshot.DueAt.Should().Be(enteredAt + SubmittedSla);
        snapshot.Elapsed.Should().Be(TimeSpan.FromHours(1));
        snapshot.Remaining.Should().Be(SubmittedSla - TimeSpan.FromHours(1));
    }

    [Fact]
    public void The_escalation_role_is_published_only_once_the_target_is_missed()
    {
        EvaluateAfter(SubmittedWarnAfter).EscalateToRole.Should().BeNull();
        EvaluateAfter(SubmittedSla).EscalateToRole.Should().Be(RegistryEscalationRole);
    }

    [Fact]
    public void Each_state_is_measured_against_its_own_policy()
    {
        var scenario = new WorkflowScenario().AtTechnicalReview();
        var enteredAt = scenario.Request.CurrentStateEnteredAt;

        // Two days would already have breached SUBMITTED, but TECHNICAL_REVIEW allows three.
        var snapshot = scenario.Engine.EvaluateSla(scenario.Request, scenario.Definition, enteredAt + TimeSpan.FromDays(2));

        snapshot.StateCode.Should().Be(States.TechnicalReview);
        snapshot.DueAt.Should().Be(enteredAt + TechnicalReviewSla);
        snapshot.Status.Should().Be(SlaStatus.OnTrack);

        scenario.Engine.EvaluateSla(scenario.Request, scenario.Definition, enteredAt + TechnicalReviewSla)
            .EscalateToRole.Should().Be(TechnicalEscalationRole);
    }

    [Fact]
    public void The_clock_restarts_when_the_request_moves_on()
    {
        var scenario = new WorkflowScenario().AtSubmitted();
        var breachTime = scenario.Request.CurrentStateEnteredAt + SubmittedSla + TimeSpan.FromHours(2);

        scenario.Engine.EvaluateSla(scenario.Request, scenario.Definition, breachTime)
            .Status.Should().Be(SlaStatus.Breached);

        scenario.Advance(SubmittedSla + TimeSpan.FromHours(2));
        scenario.Engine.Execute(
            scenario.Request, scenario.Definition, Transitions.StartReview, WorkflowScenario.Registrar, scenario.Now);

        // A late registry step must not make the technical desk look late the moment it arrives.
        var snapshot = scenario.Engine.EvaluateSla(scenario.Request, scenario.Definition, scenario.Now);
        snapshot.StateCode.Should().Be(States.TechnicalReview);
        snapshot.Status.Should().Be(SlaStatus.OnTrack);
        snapshot.Elapsed.Should().Be(TimeSpan.Zero);
    }

    [Fact]
    public void A_state_with_no_policy_never_breaches()
    {
        // MORE_INFO_REQUIRED is the applicant's to answer. Measuring the government against
        // it would make departments look slow for a delay they cannot control.
        var scenario = new WorkflowScenario().AtTechnicalReview();
        scenario.Execute(Transitions.RequestInfoInReview, WorkflowScenario.Reviewer, "Send page 2.");

        var snapshot = scenario.Engine.EvaluateSla(
            scenario.Request, scenario.Definition, scenario.Now + TimeSpan.FromDays(90));

        snapshot.StateCode.Should().Be(States.MoreInfoRequired);
        snapshot.HasSla.Should().BeFalse();
        snapshot.Status.Should().Be(SlaStatus.OnTrack);
        snapshot.IsBreached.Should().BeFalse();
        snapshot.DueAt.Should().BeNull();
        snapshot.Remaining.Should().BeNull();
        snapshot.EscalateToRole.Should().BeNull();
        snapshot.Elapsed.Should().Be(TimeSpan.FromDays(90));
    }

    [Fact]
    public void A_closed_request_stops_accruing_time()
    {
        var scenario = new WorkflowScenario().AtApproval();
        scenario.Execute(Transitions.Approve, WorkflowScenario.Approver).Succeeded.Should().BeTrue();

        scenario.Engine.EvaluateSla(scenario.Request, scenario.Definition, scenario.Now + TimeSpan.FromDays(365))
            .Elapsed.Should().Be(TimeSpan.Zero);
    }

    [Fact]
    public void A_clock_that_runs_backwards_does_not_produce_negative_age()
    {
        var (scenario, enteredAt) = AtSubmitted();

        // Clock skew between application nodes must not report an age that has not happened.
        scenario.Engine.EvaluateSla(scenario.Request, scenario.Definition, enteredAt - TimeSpan.FromMinutes(5))
            .Elapsed.Should().Be(TimeSpan.Zero);
    }

    [Fact]
    public void Evaluating_against_a_different_definition_throws()
    {
        var scenario = new WorkflowScenario();

        var act = () => scenario.Engine.EvaluateSla(scenario.Request, Build(version: 2), scenario.Now);

        act.Should().Throw<ArgumentException>();
    }
}
