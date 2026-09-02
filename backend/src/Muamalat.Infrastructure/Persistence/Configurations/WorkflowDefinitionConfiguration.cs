using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Muamalat.Domain.Workflow;

namespace Muamalat.Infrastructure.Persistence.Configurations;

public sealed class WorkflowDefinitionConfiguration : IEntityTypeConfiguration<WorkflowDefinition>
{
    public void Configure(EntityTypeBuilder<WorkflowDefinition> builder)
    {
        builder.ToTable("workflow_definitions");

        builder.HasKey(d => d.Id);

        builder.Property(d => d.Key).HasMaxLength(100).IsRequired();
        builder.Property(d => d.Version).IsRequired();
        builder.Property(d => d.NameEn).HasMaxLength(200).IsRequired();
        builder.Property(d => d.NameAr).HasMaxLength(200).IsRequired();
        builder.Property(d => d.IsPublished).IsRequired();
        builder.Property(d => d.CreatedAt).IsRequired();

        // A workflow key may have many versions, but each version exists exactly once.
        builder.HasIndex(d => new { d.Key, d.Version }).IsUnique();

        // Only one version of a given key may be published at a time. Enforced in the
        // database rather than only in application code, because a race between two
        // administrators publishing different versions would otherwise leave the system
        // with two live definitions and no deterministic answer for which one applies.
        builder.HasIndex(d => d.Key)
            .IsUnique()
            .HasFilter("is_published")
            .HasDatabaseName("ux_workflow_definitions_one_published_per_key");

        builder.Property(d => d.RowVersion)
            .IsRowVersion()
            .HasColumnName("xmin")
            .HasColumnType("xid");

        builder.HasMany(d => d.States)
            .WithOne()
            .HasForeignKey(s => s.WorkflowDefinitionId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(d => d.Transitions)
            .WithOne()
            .HasForeignKey(t => t.WorkflowDefinitionId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.Navigation(d => d.States).HasField("_states").UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.Navigation(d => d.Transitions).HasField("_transitions").UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}

public sealed class WorkflowStateConfiguration : IEntityTypeConfiguration<WorkflowState>
{
    public void Configure(EntityTypeBuilder<WorkflowState> builder)
    {
        builder.ToTable("workflow_states");

        builder.HasKey(s => s.Id);

        builder.Property(s => s.Code).HasMaxLength(64).IsRequired();
        builder.Property(s => s.NameEn).HasMaxLength(200).IsRequired();
        builder.Property(s => s.NameAr).HasMaxLength(200).IsRequired();
        builder.Property(s => s.Kind).HasConversion<int>().IsRequired();
        builder.Property(s => s.OwningDepartment).HasMaxLength(100);
        builder.Property(s => s.SortOrder).IsRequired();

        builder.HasIndex(s => new { s.WorkflowDefinitionId, s.Code }).IsUnique();

        // SlaPolicy is a value object with no identity of its own, so it maps into the
        // owning row rather than a separate table. Null Sla means no SLA applies, which
        // is why every column here is nullable.
        builder.ComplexProperty(s => s.Sla, sla =>
        {
            sla.IsRequired(false);
            sla.Property(p => p.Target).HasColumnName("sla_target");
            sla.Property(p => p.WarnAfter).HasColumnName("sla_warn_after");
            sla.Property(p => p.EscalateToRole).HasColumnName("sla_escalate_to_role").HasMaxLength(64);
        });
    }
}

public sealed class WorkflowTransitionConfiguration : IEntityTypeConfiguration<WorkflowTransition>
{
    public void Configure(EntityTypeBuilder<WorkflowTransition> builder)
    {
        builder.ToTable("workflow_transitions");

        builder.HasKey(t => t.Id);

        builder.Property(t => t.Code).HasMaxLength(64).IsRequired();
        builder.Property(t => t.FromStateCode).HasMaxLength(64).IsRequired();
        builder.Property(t => t.ToStateCode).HasMaxLength(64).IsRequired();
        builder.Property(t => t.NameEn).HasMaxLength(200).IsRequired();
        builder.Property(t => t.NameAr).HasMaxLength(200).IsRequired();
        builder.Property(t => t.Kind).HasConversion<int>().IsRequired();
        builder.Property(t => t.RequiresComment).IsRequired();

        builder.HasIndex(t => new { t.WorkflowDefinitionId, t.Code }).IsUnique();
        builder.HasIndex(t => new { t.WorkflowDefinitionId, t.FromStateCode });

        // Roles, guards and actions are configuration data belonging to a single transition.
        // They are never queried independently, so storing them as JSON keeps the workflow
        // designer's read and write path to a single row instead of four joins.
        builder.PrimitiveCollection<IReadOnlyList<string>>("AllowedRoles")
            .HasField("_allowedRoles")
            .UsePropertyAccessMode(PropertyAccessMode.Field)
            .HasColumnName("allowed_roles")
            .IsRequired();

        builder.OwnsMany(t => t.Guards, guards =>
        {
            guards.ToJson("guards");
            guards.Property(g => g.Kind).HasConversion<int>();
        });

        builder.OwnsMany(t => t.Actions, actions =>
        {
            actions.ToJson("actions");
            actions.Property(a => a.Kind).HasConversion<int>();
        });

        builder.Navigation(t => t.Guards).HasField("_guards").UsePropertyAccessMode(PropertyAccessMode.Field);
        builder.Navigation(t => t.Actions).HasField("_actions").UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}
