using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Muamalat.Domain.Auditing;
using Muamalat.Infrastructure.Persistence;

namespace Muamalat.Tests.Integration;

/// <summary>
/// The hash chain is only worth anything if it still verifies after a save and reload.
/// These tests pin the round trip itself, isolated from the HTTP response shape, because a
/// mismatch here presents as "tampering detected" and would send someone hunting for an
/// attacker rather than for a storage bug.
///
/// Audit entries are created through the real submission path rather than inserted directly:
/// the table has a foreign key to service_requests, and an orphan entry is correctly refused.
/// </summary>
public sealed class AuditPersistenceTests(MuamalatApiFactory factory) : IClassFixture<MuamalatApiFactory>
{
    private HttpClient Citizen => factory.CreateClientAs("citizen-audit", "Fatima Al Suwaidi", "Citizen");

    private async Task<Guid> SubmitRequestAsync()
    {
        var response = await Citizen.PostAsJsonAsync("/api/requests", new
        {
            workflowKey = "commercial-licence-renewal"
        });

        response.EnsureSuccessStatusCode();

        var created = await response.Content.ReadFromJsonAsync<CreatedRequest>();
        return created!.Id;
    }

    private MuamalatDbContext NewContext() =>
        factory.Services.CreateScope().ServiceProvider.GetRequiredService<MuamalatDbContext>();

    [Fact]
    public async Task An_audit_entry_still_verifies_after_a_database_round_trip()
    {
        var requestId = await SubmitRequestAsync();

        await using var db = NewContext();

        var entries = await db.AuditEntries
            .AsNoTracking()
            .Where(e => e.ServiceRequestId == requestId)
            .OrderBy(e => e.Sequence)
            .ToListAsync();

        entries.Should().NotBeEmpty();

        foreach (var entry in entries)
        {
            entry.IsSelfConsistent().Should()
                .BeTrue($"entry {entry.Sequence} must reproduce its stored hash after reloading");
        }

        AuditChain.Verify(entries).IsValid.Should().BeTrue();
    }

    [Fact]
    public async Task The_payload_document_survives_storage_byte_for_byte()
    {
        // jsonb would reorder keys and strip spacing, changing the text the hash covers.
        // This test is what keeps the column on json.
        var requestId = await SubmitRequestAsync();

        await using var db = NewContext();

        var payload = await db.AuditEntries
            .AsNoTracking()
            .Where(e => e.ServiceRequestId == requestId)
            .OrderBy(e => e.Sequence)
            .Select(e => e.PayloadJson)
            .FirstAsync();

        payload.Should().NotBeNullOrWhiteSpace();

        // The engine writes WorkflowKey first. jsonb would sort keys by length then bytes,
        // so this ordering assertion is what actually detects a regression to jsonb.
        payload.Should().StartWith("{\"WorkflowKey\"");
        payload.Should().NotContain(": ", "jsonb reformats with spacing that the hash did not cover");
    }

    [Fact]
    public async Task Timestamps_are_stored_at_the_precision_they_were_hashed_at()
    {
        var requestId = await SubmitRequestAsync();

        await using var db = NewContext();

        var occurredAt = await db.AuditEntries
            .AsNoTracking()
            .Where(e => e.ServiceRequestId == requestId)
            .Select(e => e.OccurredAt)
            .FirstAsync();

        // PostgreSQL timestamptz holds microseconds. A value carrying sub-microsecond ticks
        // would be silently truncated on write and would no longer match its own hash.
        const long ticksPerMicrosecond = TimeSpan.TicksPerMillisecond / 1000;
        (occurredAt.Ticks % ticksPerMicrosecond).Should().Be(0);
        occurredAt.Offset.Should().Be(TimeSpan.Zero);
    }

    [Fact]
    public async Task The_database_refuses_to_update_or_delete_an_audit_entry()
    {
        var requestId = await SubmitRequestAsync();

        await using var db = NewContext();

        // Raw SQL, bypassing the application's own guard, so this exercises the database
        // trigger rather than the DbContext check.
        var update = async () => await db.Database.ExecuteSqlRawAsync(
            "UPDATE audit_entries SET comment = 'rewritten' WHERE service_request_id = {0}", requestId);

        await update.Should().ThrowAsync<Exception>("the append-only trigger must reject updates");

        var delete = async () => await db.Database.ExecuteSqlRawAsync(
            "DELETE FROM audit_entries WHERE service_request_id = {0}", requestId);

        await delete.Should().ThrowAsync<Exception>("the append-only trigger must reject deletes");
    }

    [Fact]
    public async Task The_database_refuses_to_truncate_the_audit_table()
    {
        await using var db = NewContext();

        var truncate = async () => await db.Database.ExecuteSqlRawAsync("TRUNCATE TABLE audit_entries");

        await truncate.Should().ThrowAsync<Exception>(
            "TRUNCATE does not fire row triggers, so it needs its own statement level guard");
    }

    [Fact]
    public async Task A_request_cannot_be_deleted_while_its_audit_trail_exists()
    {
        // Restrict, not cascade. Deleting a request must fail loudly rather than quietly
        // taking the evidence with it.
        var requestId = await SubmitRequestAsync();

        await using var db = NewContext();

        var delete = async () => await db.Database.ExecuteSqlRawAsync(
            "DELETE FROM service_requests WHERE id = {0}", requestId);

        await delete.Should().ThrowAsync<Exception>();
    }

    [Fact]
    public async Task Appending_a_second_entry_leaves_the_first_one_untouched()
    {
        var requestId = await SubmitRequestAsync();

        Snapshot before;
        await using (var first = NewContext())
        {
            before = await first.AuditEntries.AsNoTracking()
                .Where(e => e.ServiceRequestId == requestId && e.Sequence == 1)
                .Select(e => new Snapshot(e.Hash, e.PreviousHash, e.PayloadJson, e.OccurredAt, e.ActorRoles, e.Comment))
                .SingleAsync();
        }

        var officer = factory.CreateClientAs("officer-audit", "Noura Al Kaabi", "Officer");
        var move = await officer.PostAsJsonAsync(
            $"/api/requests/{requestId}/transitions/START_REVIEW", new { comment = (string?)null });
        move.EnsureSuccessStatusCode();

        await using var db = NewContext();

        var after = await db.AuditEntries.AsNoTracking()
            .Where(e => e.ServiceRequestId == requestId && e.Sequence == 1)
            .Select(e => new Snapshot(e.Hash, e.PreviousHash, e.PayloadJson, e.OccurredAt, e.ActorRoles, e.Comment))
            .SingleAsync();

        after.Should().BeEquivalentTo(before, "appending to a chain must never rewrite an earlier link");

        var entries = await db.AuditEntries.AsNoTracking()
            .Where(e => e.ServiceRequestId == requestId)
            .OrderBy(e => e.Sequence)
            .ToListAsync();

        entries.Should().HaveCount(2);

        var verification = AuditChain.Verify(entries);
        var because = string.Join("; ", verification.Problems.Select(p => $"seq {p.Sequence} {p.Kind}"));
        verification.IsValid.Should().BeTrue($"chain must hold after a transition, but: {because}");
    }

    private sealed record CreatedRequest(Guid Id, string ReferenceNumber);

    private sealed record Snapshot(
        string Hash, string PreviousHash, string PayloadJson,
        DateTimeOffset OccurredAt, string ActorRoles, string? Comment);
}
