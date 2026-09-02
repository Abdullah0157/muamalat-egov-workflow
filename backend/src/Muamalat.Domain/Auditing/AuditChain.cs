namespace Muamalat.Domain.Auditing;

/// <summary>
/// Verifies a request's audit chain end to end. Used by the auditor UI and by the
/// integrity tests. Pure logic over an in-memory sequence, so it is trivially testable
/// and has no dependency on EF Core or the database.
/// </summary>
public static class AuditChain
{
    public static ChainVerificationResult Verify(IReadOnlyList<AuditEntry> entriesInOrder)
    {
        if (entriesInOrder.Count == 0)
            return ChainVerificationResult.Valid(0);

        var problems = new List<ChainProblem>();

        var ordered = entriesInOrder.OrderBy(e => e.Sequence).ToList();
        var requestId = ordered[0].ServiceRequestId;

        for (var i = 0; i < ordered.Count; i++)
        {
            var entry = ordered[i];

            if (entry.ServiceRequestId != requestId)
            {
                problems.Add(new ChainProblem(entry.Sequence, ChainProblemKind.ForeignEntry,
                    "Entry belongs to a different service request."));
                continue;
            }

            // Sequence must be dense and 1-based. A gap means an entry was deleted.
            var expectedSequence = i + 1;
            if (entry.Sequence != expectedSequence)
            {
                problems.Add(new ChainProblem(entry.Sequence, ChainProblemKind.SequenceGap,
                    $"Expected sequence {expectedSequence} but found {entry.Sequence}; an entry may have been deleted."));
            }

            // The stored hash must still match a recomputation of the entry's own content.
            if (!entry.IsSelfConsistent())
            {
                problems.Add(new ChainProblem(entry.Sequence, ChainProblemKind.ContentAltered,
                    "Stored hash does not match the entry content; this entry was modified after it was written."));
            }

            // The link to the previous entry must hold.
            var expectedPreviousHash = i == 0 ? AuditEntry.GenesisHash : ordered[i - 1].Hash;
            if (entry.PreviousHash != expectedPreviousHash)
            {
                problems.Add(new ChainProblem(entry.Sequence, ChainProblemKind.BrokenLink,
                    i == 0
                        ? "First entry does not start from the genesis hash."
                        : "Previous-hash pointer does not match the preceding entry; the chain was broken or reordered."));
            }
        }

        return problems.Count == 0
            ? ChainVerificationResult.Valid(ordered.Count)
            : new ChainVerificationResult(false, ordered.Count, problems);
    }

    /// <summary>Current head hash, that is the hash of the most recent entry. Null for an empty chain.</summary>
    public static string? HeadHash(IReadOnlyList<AuditEntry> entriesInOrder) =>
        entriesInOrder.Count == 0 ? null : entriesInOrder.MaxBy(e => e.Sequence)!.Hash;
}

public sealed record ChainVerificationResult(bool IsValid, int EntryCount, IReadOnlyList<ChainProblem> Problems)
{
    public static ChainVerificationResult Valid(int count) => new(true, count, []);
}

public sealed record ChainProblem(int Sequence, ChainProblemKind Kind, string Message);

public enum ChainProblemKind
{
    ContentAltered = 0,
    BrokenLink = 1,
    SequenceGap = 2,
    ForeignEntry = 3
}
