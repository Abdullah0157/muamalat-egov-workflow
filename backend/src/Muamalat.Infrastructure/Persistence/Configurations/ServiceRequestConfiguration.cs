using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Muamalat.Domain.Auditing;
using Muamalat.Domain.Requests;

namespace Muamalat.Infrastructure.Persistence.Configurations;

public sealed class ServiceRequestConfiguration : IEntityTypeConfiguration<ServiceRequest>
{
    public void Configure(EntityTypeBuilder<ServiceRequest> builder)
    {
        builder.ToTable("service_requests");

        builder.HasKey(r => r.Id);

        builder.Property(r => r.ReferenceNumber).HasMaxLength(32).IsRequired();
        builder.HasIndex(r => r.ReferenceNumber).IsUnique();

        // The definition a request was pinned to at submission. Key and version are stored
        // alongside the id so the reference number, the workflow it followed, and the exact
        // rule set remain readable even if a definition row is later archived.
        builder.Property(r => r.WorkflowDefinitionId).IsRequired();
        builder.Property(r => r.WorkflowKey).HasMaxLength(100).IsRequired();
        builder.Property(r => r.WorkflowVersion).IsRequired();

        builder.HasOne<Domain.Workflow.WorkflowDefinition>()
            .WithMany()
            .HasForeignKey(r => r.WorkflowDefinitionId)
            // A definition that has live requests against it must not be deletable. Losing it
            // would leave those requests with no rules to execute against.
            .OnDelete(DeleteBehavior.Restrict);

        builder.Property(r => r.CurrentStateCode).HasMaxLength(64).IsRequired();
        builder.Property(r => r.ApplicantUserId).HasMaxLength(128).IsRequired();
        builder.Property(r => r.ApplicantDisplayName).HasMaxLength(200).IsRequired();
        builder.Property(r => r.ServiceType).HasMaxLength(100).IsRequired();

        builder.Property(r => r.SubmittedAt).IsRequired();
        builder.Property(r => r.CurrentStateEnteredAt).IsRequired();
        builder.Property(r => r.ClosedAt);
        builder.Property(r => r.DecisionAt);

        builder.Property(r => r.AssignedToDepartment).HasMaxLength(100);
        builder.Property(r => r.AssignedToRole).HasMaxLength(64);
        builder.Property(r => r.AssignedToUserId).HasMaxLength(128);

        builder.Property(r => r.FeePaid).IsRequired();
        builder.Property(r => r.StateBeforeInformationRequest).HasMaxLength(64);

        // Optimistic concurrency via PostgreSQL's system xmin column. Two officers acting on
        // the same request at the same moment is a routine race in a shared work queue, and
        // without this the second write silently overwrites the first one's transition.
        builder.Property(r => r.RowVersion)
            .IsRowVersion()
            .HasColumnName("xmin")
            .HasColumnType("xid");

        // The officer queue is the hottest read in the system: open requests for a department,
        // oldest first. A partial index keeps it small by excluding closed requests, which are
        // the majority of rows once the system has been live for a while.
        builder.HasIndex(r => new { r.AssignedToDepartment, r.CurrentStateEnteredAt })
            .HasFilter("closed_at IS NULL")
            .HasDatabaseName("ix_service_requests_open_queue");

        // The citizen's "my requests" view.
        builder.HasIndex(r => new { r.ApplicantUserId, r.SubmittedAt })
            .HasDatabaseName("ix_service_requests_applicant");

        // Supervisor dashboards group open work by the state it is sitting in.
        builder.HasIndex(r => new { r.WorkflowKey, r.CurrentStateCode })
            .HasFilter("closed_at IS NULL")
            .HasDatabaseName("ix_service_requests_open_by_state");

        builder.HasMany(r => r.Documents)
            .WithOne()
            .HasForeignKey(d => d.ServiceRequestId)
            .OnDelete(DeleteBehavior.Cascade);

        // The audit trail is deliberately NOT cascade delete. If a request is ever removed,
        // the deletion must fail rather than quietly take the evidence with it.
        builder.HasMany(r => r.AuditTrail)
            .WithOne()
            .HasForeignKey(e => e.ServiceRequestId)
            .OnDelete(DeleteBehavior.Restrict);

        builder.Navigation(r => r.Documents).HasField("_documents").UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.Navigation(r => r.AuditTrail).HasField("_auditTrail").UsePropertyAccessMode(PropertyAccessMode.Field);

        // Computed conveniences on the aggregate; they are derived from other state and must
        // never be persisted as columns that could drift out of step with it.
        builder.Ignore(r => r.IsClosed);
        builder.Ignore(r => r.SubmittedDocumentTypes);
        builder.Ignore(r => r.HasUnverifiedDocuments);
        builder.Ignore(r => r.ApplicantHasResponded);
    }
}

public sealed class ServiceRequestDocumentConfiguration : IEntityTypeConfiguration<ServiceRequestDocument>
{
    public void Configure(EntityTypeBuilder<ServiceRequestDocument> builder)
    {
        builder.ToTable("service_request_documents");

        builder.HasKey(d => d.Id);

        builder.Property(d => d.DocumentType).HasMaxLength(64).IsRequired();
        builder.Property(d => d.FileName).HasMaxLength(255).IsRequired();
        builder.Property(d => d.ContentType).HasMaxLength(127).IsRequired();
        builder.Property(d => d.SizeBytes).IsRequired();

        // Storage path, never a URL. Serving documents goes through an authorised endpoint so
        // possession of a path alone never grants access to another citizen's file.
        builder.Property(d => d.StoragePath).HasMaxLength(500).IsRequired();

        builder.Property(d => d.UploadedByUserId).HasMaxLength(128).IsRequired();
        builder.Property(d => d.UploadedAt).IsRequired();

        builder.Property(d => d.IsVerified).IsRequired();
        builder.Property(d => d.VerifiedByUserId).HasMaxLength(128);
        builder.Property(d => d.VerifiedAt);

        builder.HasIndex(d => new { d.ServiceRequestId, d.DocumentType });
    }
}
