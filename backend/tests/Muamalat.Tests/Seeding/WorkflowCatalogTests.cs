using FluentAssertions;
using Muamalat.Domain.Workflow;
using Muamalat.Infrastructure.Seeding;

namespace Muamalat.Tests.Seeding;

/// <summary>
/// The seeded workflows are the first thing anyone sees when they start the system, so a
/// structurally broken one is worse than no seed at all. These tests run the same validation
/// the admin designer runs before publishing, against the shipped catalogue.
/// </summary>
public class WorkflowCatalogTests
{
    public static TheoryData<string> WorkflowKeys() =>
    [
        WorkflowCatalog.CommercialLicenceRenewal,
        WorkflowCatalog.BuildingPermit,
        WorkflowCatalog.VehicleRegistrationTransfer
    ];

    private static WorkflowDefinition Get(string key) => WorkflowCatalog.All().Single(w => w.Key == key);

    [Fact]
    public void The_catalogue_contains_three_published_workflows()
    {
        var all = WorkflowCatalog.All();

        all.Should().HaveCount(3);
        all.Should().OnlyContain(w => w.IsPublished);
        all.Select(w => w.Key).Should().OnlyHaveUniqueItems();
    }

    [Theory]
    [MemberData(nameof(WorkflowKeys))]
    public void Every_seeded_workflow_passes_structural_validation(string key)
    {
        Get(key).Validate().Should().BeEmpty();
    }

    [Theory]
    [MemberData(nameof(WorkflowKeys))]
    public void Every_seeded_workflow_is_bilingual(string key)
    {
        var wf = Get(key);

        wf.NameAr.Should().NotBeNullOrWhiteSpace();
        wf.States.Should().OnlyContain(s => !string.IsNullOrWhiteSpace(s.NameAr));
        wf.Transitions.Should().OnlyContain(t => !string.IsNullOrWhiteSpace(t.NameAr));

        // Arabic labels must actually be Arabic, not English placeholders someone forgot.
        wf.NameAr.Should().MatchRegex(@"\p{IsArabic}");
    }

    [Theory]
    [MemberData(nameof(WorkflowKeys))]
    public void Every_workflow_can_reach_a_terminal_state_from_the_start(string key)
    {
        var wf = Get(key);

        var reachable = new HashSet<string> { wf.StartState.Code };
        var queue = new Queue<string>([wf.StartState.Code]);

        while (queue.Count > 0)
        {
            foreach (var next in wf.TransitionsFrom(queue.Dequeue()).Select(t => t.ToStateCode))
            {
                if (reachable.Add(next)) queue.Enqueue(next);
            }
        }

        wf.States
            .Where(s => s.Kind == StateKind.Terminal)
            .Should().Contain(s => reachable.Contains(s.Code));
    }

    [Fact]
    public void States_where_we_wait_on_the_applicant_carry_no_sla()
    {
        // Holding a department to an SLA clock while the citizen is the one who has to act
        // would make officers look late for delays they cannot influence.
        foreach (var wf in WorkflowCatalog.All())
        {
            var waitingOnApplicant = wf.States.Where(s => s.Code == "MORE_INFO_REQUIRED");
            waitingOnApplicant.Should().OnlyContain(s => s.Sla == null);
        }
    }

    [Fact]
    public void Sla_warning_thresholds_always_precede_the_breach_target()
    {
        foreach (var state in WorkflowCatalog.All().SelectMany(w => w.States).Where(s => s.Sla is not null))
        {
            state.Sla!.WarnAfter.Should().BeLessThanOrEqualTo(state.Sla.Target);
        }
    }

    [Fact]
    public void Final_approval_on_a_licence_renewal_enforces_segregation_of_duties()
    {
        var approve = Get(WorkflowCatalog.CommercialLicenceRenewal)
            .Transitions.Single(t => t.Code == "FINAL_APPROVE");

        approve.Guards.Should().Contain(g => g.Kind == GuardKind.RequiresDifferentActorThan);
    }

    [Fact]
    public void Rejections_always_require_a_reason()
    {
        var rejections = WorkflowCatalog.All()
            .SelectMany(w => w.Transitions)
            .Where(t => t.ToStateCode is "REJECTED")
            .ToList();

        rejections.Should().NotBeEmpty();
        rejections.Should().OnlyContain(t => t.RequiresComment);
        rejections.Should().OnlyContain(t => t.Guards.Any(g => g.Kind == GuardKind.RequiresComment));
    }

    [Fact]
    public void Citizens_can_never_approve_their_own_request()
    {
        var citizenApprovals = WorkflowCatalog.All()
            .SelectMany(w => w.Transitions)
            .Where(t => t.ToStateCode is "APPROVED" or "COMPLETED")
            .Where(t => t.AllowedRoles.Contains("Citizen"));

        citizenApprovals.Should().BeEmpty();
    }

    [Fact]
    public void Information_request_loops_are_paired()
    {
        // A RequestInformation transition with no way back would strand the request with
        // the applicant forever.
        foreach (var wf in WorkflowCatalog.All())
        {
            var asks = wf.Transitions.Where(t => t.Kind == TransitionKind.RequestInformation).ToList();
            if (asks.Count == 0) continue;

            foreach (var ask in asks)
            {
                wf.TransitionsFrom(ask.ToStateCode)
                    .Should().Contain(t => t.Kind == TransitionKind.ResumeAfterInfo,
                        $"'{ask.Code}' in '{wf.Key}' must have a matching resume transition");
            }
        }
    }
}
