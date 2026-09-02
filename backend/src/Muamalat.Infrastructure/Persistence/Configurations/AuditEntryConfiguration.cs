using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Muamalat.Domain.Auditing;

namespace Muamalat.Infrastructure.Persistence.Configurations;

public sealed class AuditEntryConfiguration : IEntityTypeConfiguration<AuditEntry>
{
    public void Configure(EntityTypeBuilder<AuditEntry> builder)
    {
        builder.ToTable("audit_entries", t =>
        {
            // Defence in depth. The application never issues updates or deletes against this
            // table, but a trigger makes that a database guarantee rather than a convention
            // somebody can forget. Created in the SQL migration, referenced here for clarity.
            t.HasComment("Append-only. Updates and deletes are blocked by trigger trg_audit_entries_append_only.");
        });

        builder.HasKey(e => e.Id);

        builder.Property(e => e.ServiceRequestId).IsRequired();
        builder.Property(e => e.Sequence).IsRequired();
        builder.Property(e => e.EventType).HasConversion<int>().IsRequired();

        builder.Property(e => e.FromStateCode).HasMaxLength(64);
        builder.Property(e => e.ToStateCode).HasMaxLength(64);
        builder.Property(e => e.TransitionCode).HasMaxLength(64);

        builder.Property(e => e.ActorUserId).HasMaxLength(128).IsRequired();
        builder.Property(e => e.ActorDisplayName).HasMaxLength(200).IsRequired();
        builder.Property(e => e.ActorRoles).HasMaxLength(400).IsRequired();

        builder.Property(e => e.Comment).HasMaxLength(4000);

        // json, NOT jsonb.
        //
        // jsonb is the better choice almost everywhere: it indexes, it deduplicates keys, it
        // supports containment operators. It achieves that by parsing the document into a
        // binary form, which discards insignificant whitespace and does not preserve key order.
        // The text read back is therefore not always the text that was written.
        //
        // This column is covered by the entry's hash. A byte for byte round trip is the whole
        // point, so the storage type has to preserve the exact document. json does; jsonb does
        // not. The payload is displayed and never queried by structure, so nothing is lost.
        builder.Property(e => e.PayloadJson).HasColumnType("json").IsRequired();

        builder.Property(e => e.OccurredAt).IsRequired();

        // SHA-256 rendered as lowercase hex is always exactly 64 characters.
        builder.Property(e => e.PreviousHash).HasMaxLength(64).IsFixedLength().IsRequired();
        builder.Property(e => e.Hash).HasMaxLength(64).IsFixedLength().IsRequired();

        // The chain is read in sequence order for a single request on every audit view,
        // and this index also makes the uniqueness guarantee below cheap to enforce.
        builder.HasIndex(e => new { e.ServiceRequestId, e.Sequence })
            .IsUnique()
            .HasDatabaseName("ux_audit_entries_request_sequence");

        // Two entries may never claim the same position in a chain, and a hash must be
        // unique across the table: a duplicate would mean either a collision or a replayed row.
        builder.HasIndex(e => e.Hash).IsUnique().HasDatabaseName("ux_audit_entries_hash");
    }
}
