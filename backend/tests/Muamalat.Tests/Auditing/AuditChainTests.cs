using System.Reflection;
using FluentAssertions;
using Muamalat.Domain.Auditing;

namespace Muamalat.Tests.Auditing;

public class AuditChainTests
{
    private static readonly Guid RequestId = Guid.CreateVersion7();
    private static readonly DateTimeOffset T0 = new(2026, 3, 1, 9, 0, 0, TimeSpan.FromHours(3));

    private static List<AuditEntry> BuildChain(int length = 4)
    {
        var entries = new List<AuditEntry>();
        AuditEntry? previous = null;

        for (var i = 0; i < length; i++)
        {
            var entry = AuditEntry.Append(
                previous,
                RequestId,
                i == 0 ? AuditEventType.RequestSubmitted : AuditEventType.StateChanged,
                actorUserId: $"user-{i}",
                actorDisplayName: $"Officer {i}",
                actorRoles: ["Officer"],
                occurredAt: T0.AddHours(i),
                fromStateCode: i == 0 ? null : $"STATE_{i - 1}",
                toStateCode: $"STATE_{i}",
                transitionCode: i == 0 ? null : "APPROVE");

            entries.Add(entry);
            previous = entry;
        }

        return entries;
    }

    /// <summary>Rewrites a private setter the way a database-level tamper would.</summary>
    private static void ForceSet(AuditEntry entry, string propertyName, object? value)
    {
        typeof(AuditEntry)
            .GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance)!
            .SetValue(entry, value);
    }

    [Fact]
    public void A_freshly_built_chain_verifies()
    {
        var result = AuditChain.Verify(BuildChain());

        result.IsValid.Should().BeTrue();
        result.EntryCount.Should().Be(4);
        result.Problems.Should().BeEmpty();
    }

    [Fact]
    public void First_entry_starts_from_the_genesis_hash()
    {
        BuildChain()[0].PreviousHash.Should().Be(AuditEntry.GenesisHash);
    }

    [Fact]
    public void Each_entry_points_at_its_predecessor()
    {
        var chain = BuildChain();

        for (var i = 1; i < chain.Count; i++)
            chain[i].PreviousHash.Should().Be(chain[i - 1].Hash);
    }

    [Fact]
    public void Hashing_is_deterministic_for_identical_content()
    {
        // Two chains built from the same inputs must produce identical hashes,
        // otherwise stored hashes could never be re-verified after a restart.
        BuildChain()[2].Hash.Should().Be(BuildChain()[2].Hash);
    }

    [Fact]
    public void Altering_a_comment_is_detected()
    {
        var chain = BuildChain();
        ForceSet(chain[1], nameof(AuditEntry.Comment), "approved as a favour");

        var result = AuditChain.Verify(chain);

        result.IsValid.Should().BeFalse();
        result.Problems.Should().Contain(p =>
            p.Sequence == 2 && p.Kind == ChainProblemKind.ContentAltered);
    }

    [Fact]
    public void Altering_the_actor_is_detected()
    {
        var chain = BuildChain();
        ForceSet(chain[2], nameof(AuditEntry.ActorUserId), "someone-else");

        AuditChain.Verify(chain).Problems
            .Should().Contain(p => p.Kind == ChainProblemKind.ContentAltered);
    }

    [Fact]
    public void Backdating_an_entry_is_detected()
    {
        var chain = BuildChain();
        ForceSet(chain[3], nameof(AuditEntry.OccurredAt), T0.AddYears(-1));

        AuditChain.Verify(chain).Problems
            .Should().Contain(p => p.Kind == ChainProblemKind.ContentAltered);
    }

    [Fact]
    public void Deleting_an_entry_from_the_middle_is_detected()
    {
        var chain = BuildChain();
        chain.RemoveAt(1); // remove sequence 2

        var result = AuditChain.Verify(chain);

        result.IsValid.Should().BeFalse();
        result.Problems.Should().Contain(p => p.Kind == ChainProblemKind.SequenceGap);
        result.Problems.Should().Contain(p => p.Kind == ChainProblemKind.BrokenLink);
    }

    [Fact]
    public void Reordering_entries_is_detected()
    {
        var chain = BuildChain();
        (chain[1], chain[2]) = (chain[2], chain[1]);

        // Verify sorts by sequence, so a swap of list position alone must not
        // change the outcome; the chain is still genuinely intact here.
        AuditChain.Verify(chain).IsValid.Should().BeTrue();

        // But swapping the recorded sequence numbers is real tampering, and must fail.
        ForceSet(chain[1], nameof(AuditEntry.Sequence), 99);
        AuditChain.Verify(chain).IsValid.Should().BeFalse();
    }

    [Fact]
    public void An_entry_from_another_request_is_rejected()
    {
        var chain = BuildChain();
        ForceSet(chain[2], nameof(AuditEntry.ServiceRequestId), Guid.CreateVersion7());

        AuditChain.Verify(chain).Problems
            .Should().Contain(p => p.Kind == ChainProblemKind.ForeignEntry);
    }

    [Fact]
    public void Appending_to_a_foreign_chain_throws()
    {
        var chain = BuildChain();

        var act = () => AuditEntry.Append(
            chain[^1],
            Guid.CreateVersion7(), // different request
            AuditEventType.StateChanged,
            "user-x", "Officer X", ["Officer"], T0.AddHours(9));

        act.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void An_empty_chain_is_trivially_valid()
    {
        AuditChain.Verify([]).IsValid.Should().BeTrue();
        AuditChain.HeadHash([]).Should().BeNull();
    }

    [Fact]
    public void Head_hash_is_the_hash_of_the_latest_entry()
    {
        var chain = BuildChain();
        AuditChain.HeadHash(chain).Should().Be(chain[^1].Hash);
    }
}
