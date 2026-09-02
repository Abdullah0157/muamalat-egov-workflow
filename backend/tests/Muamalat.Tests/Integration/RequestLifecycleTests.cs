using System.Net;
using System.Net.Http.Json;
using FluentAssertions;

namespace Muamalat.Tests.Integration;

/// <summary>
/// End to end coverage of the citizen and officer journey through the real HTTP pipeline.
/// </summary>
[Collection("integration")]
public sealed class RequestLifecycleTests(MuamalatApiFactory factory) : IClassFixture<MuamalatApiFactory>
{
    private HttpClient Citizen => factory.CreateClientAs("citizen-1", "Fatima Al Suwaidi", "Citizen");
    private HttpClient Officer => factory.CreateClientAs("officer-1", "Noura Al Kaabi", "Officer");
    private HttpClient Admin => factory.CreateClientAs("admin-1", "Khalid Al Nuaimi", "Admin");

    [Fact]
    public async Task Anonymous_callers_are_rejected()
    {
        var response = await factory.CreateAnonymousClient().GetAsync("/api/requests/mine");
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task A_citizen_may_not_read_the_officer_queue()
    {
        var response = await Citizen.GetAsync("/api/requests/queue");
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task The_seeded_workflow_catalogue_is_served()
    {
        var response = await Admin.GetAsync("/api/workflows");
        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<List<WorkflowSummaryResponse>>();
        body.Should().NotBeNull();
        body!.Should().HaveCountGreaterThanOrEqualTo(3);
        body.Should().Contain(w => w.Key == "commercial-licence-renewal" && w.IsPublished);
    }

    [Fact]
    public async Task A_citizen_can_submit_a_request_and_it_gets_a_reference_number()
    {
        var response = await Citizen.PostAsJsonAsync("/api/requests", new
        {
            workflowKey = "commercial-licence-renewal",
            serviceType = "Commercial Licence Renewal"
        });

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var created = await response.Content.ReadFromJsonAsync<RequestDetailResponse>();
        created.Should().NotBeNull();
        created!.ReferenceNumber.Should().MatchRegex(@"^MW-\d{4}-\d{6}$");
        created.CurrentStateCode.Should().Be("SUBMITTED");
        created.IsClosed.Should().BeFalse();
        created.CurrentStateNameAr.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task Submitting_an_unknown_service_returns_not_found_not_a_server_error()
    {
        var response = await Citizen.PostAsJsonAsync("/api/requests", new { workflowKey = "no-such-service" });
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task A_submitted_request_appears_in_the_citizens_own_list()
    {
        var submit = await Citizen.PostAsJsonAsync("/api/requests", new { workflowKey = "building-permit" });
        var created = await submit.Content.ReadFromJsonAsync<RequestDetailResponse>();

        var mine = await Citizen.GetFromJsonAsync<List<RequestSummaryResponse>>("/api/requests/mine");

        mine.Should().NotBeNull();
        mine!.Should().Contain(r => r.Id == created!.Id);
    }

    [Fact]
    public async Task A_citizen_cannot_read_another_citizens_request()
    {
        var submit = await Citizen.PostAsJsonAsync("/api/requests", new { workflowKey = "building-permit" });
        var created = await submit.Content.ReadFromJsonAsync<RequestDetailResponse>();

        var otherCitizen = factory.CreateClientAs("citizen-2", "Omar Al Harthy", "Citizen");
        var response = await otherCitizen.GetAsync($"/api/requests/{created!.Id}");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task An_officer_can_see_and_work_a_submitted_request()
    {
        var submit = await Citizen.PostAsJsonAsync("/api/requests", new
        {
            workflowKey = "commercial-licence-renewal"
        });
        var created = await submit.Content.ReadFromJsonAsync<RequestDetailResponse>();

        var queue = await Officer.GetFromJsonAsync<List<RequestSummaryResponse>>("/api/requests/queue");
        queue.Should().Contain(r => r.Id == created!.Id);

        var transitions = await Officer.GetFromJsonAsync<List<AvailableTransitionResponse>>(
            $"/api/requests/{created!.Id}/transitions");

        transitions.Should().NotBeNull();
        transitions!.Should().Contain(t => t.Code == "START_REVIEW");

        var move = await Officer.PostAsJsonAsync(
            $"/api/requests/{created.Id}/transitions/START_REVIEW", new { comment = (string?)null });

        move.StatusCode.Should().Be(HttpStatusCode.OK);

        var updated = await move.Content.ReadFromJsonAsync<RequestDetailResponse>();
        updated!.CurrentStateCode.Should().Be("DOCUMENT_REVIEW");
    }

    [Fact]
    public async Task A_transition_the_caller_may_not_perform_is_refused_as_unprocessable_not_forbidden()
    {
        // The citizen can see their own request, so this is not an access failure. The action
        // itself is simply not available to their role, which is a business outcome.
        var submit = await Citizen.PostAsJsonAsync("/api/requests", new { workflowKey = "commercial-licence-renewal" });
        var created = await submit.Content.ReadFromJsonAsync<RequestDetailResponse>();

        var response = await Citizen.PostAsJsonAsync(
            $"/api/requests/{created!.Id}/transitions/START_REVIEW", new { comment = (string?)null });

        response.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task Every_state_change_is_recorded_in_a_verifiable_audit_chain()
    {
        // START_REVIEW is used rather than a transition guarded on documents: the point here is
        // the audit chain, and a guard failure would leave nothing to chain.
        var submit = await Citizen.PostAsJsonAsync("/api/requests", new { workflowKey = "commercial-licence-renewal" });
        var created = await submit.Content.ReadFromJsonAsync<RequestDetailResponse>();

        var move = await Officer.PostAsJsonAsync(
            $"/api/requests/{created!.Id}/transitions/START_REVIEW", new { comment = (string?)null });

        move.StatusCode.Should().Be(HttpStatusCode.OK);

        var audit = await Officer.GetFromJsonAsync<AuditTrailResponse>($"/api/requests/{created.Id}/audit");

        audit.Should().NotBeNull();

        // Report what actually broke. A bare "expected true but found false" on a hash chain
        // sends the next person guessing; the problem list names the entry and the reason.
        var because = string.Join(
            "; ",
            audit!.Problems.Select(p => $"seq {p.Sequence} {p.Kind}: {p.Message}"));

        audit.ChainIsValid.Should().BeTrue($"the chain must verify, but: {because}");
        audit.Problems.Should().BeEmpty();
        audit.HeadHash.Should().NotBeNullOrWhiteSpace();

        // Submission plus one transition.
        audit.Entries.Should().HaveCountGreaterThanOrEqualTo(2);
        audit.Entries.Select(e => e.Sequence).Should().BeInAscendingOrder();

        // The internal subject id must never leak to a client.
        audit.Entries.Should().OnlyContain(e => !string.IsNullOrWhiteSpace(e.ActorDisplayName));
    }

    [Fact]
    public async Task Errors_carry_a_correlation_id_so_a_report_can_be_traced_to_its_logs()
    {
        var response = await Citizen.GetAsync($"/api/requests/{Guid.CreateVersion7()}");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        response.Headers.Should().ContainKey("X-Correlation-Id");
    }

    // Response shapes, declared locally so a change to the API contract breaks these tests
    // rather than silently passing against a renamed property.
    private sealed record WorkflowSummaryResponse(string Key, int Version, bool IsPublished);

    private sealed record RequestSummaryResponse(Guid Id, string ReferenceNumber, string CurrentStateCode);

    private sealed record RequestDetailResponse(
        Guid Id, string ReferenceNumber, string CurrentStateCode,
        string CurrentStateNameAr, bool IsClosed);

    private sealed record AvailableTransitionResponse(string Code, string ToStateCode, bool RequiresComment);

    private sealed record AuditTrailResponse(
        bool ChainIsValid, string? HeadHash,
        List<ChainProblemResponse> Problems, List<AuditEntryResponse> Entries);

    private sealed record ChainProblemResponse(int Sequence, string Kind, string Message);

    private sealed record AuditEntryResponse(int Sequence, string EventType, string ActorDisplayName, string Hash);
}
