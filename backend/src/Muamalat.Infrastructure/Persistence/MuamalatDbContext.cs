using Microsoft.EntityFrameworkCore;
using Muamalat.Domain.Auditing;
using Muamalat.Domain.Requests;
using Muamalat.Domain.Workflow;

namespace Muamalat.Infrastructure.Persistence;

public sealed class MuamalatDbContext(DbContextOptions<MuamalatDbContext> options) : DbContext(options)
{
    public DbSet<WorkflowDefinition> WorkflowDefinitions => Set<WorkflowDefinition>();
    public DbSet<WorkflowState> WorkflowStates => Set<WorkflowState>();
    public DbSet<WorkflowTransition> WorkflowTransitions => Set<WorkflowTransition>();
    public DbSet<AuditEntry> AuditEntries => Set<AuditEntry>();
    public DbSet<ServiceRequest> ServiceRequests => Set<ServiceRequest>();
    public DbSet<ServiceRequestDocument> ServiceRequestDocuments => Set<ServiceRequestDocument>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(MuamalatDbContext).Assembly);
        modelBuilder.UseClientGeneratedGuidKeys();
        base.OnModelCreating(modelBuilder);
    }

    /// <summary>
    /// The audit trail is append-only by design. Blocking modification here means a bug in a
    /// future service cannot quietly rewrite history: it fails loudly at save time instead.
    /// The database trigger in the migration is the real guarantee; this is the early warning
    /// that keeps developers honest during development.
    /// </summary>
    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        GuardAuditTrailIsAppendOnly();
        return base.SaveChangesAsync(cancellationToken);
    }

    public override int SaveChanges()
    {
        GuardAuditTrailIsAppendOnly();
        return base.SaveChanges();
    }

    private void GuardAuditTrailIsAppendOnly()
    {
        var violations = ChangeTracker
            .Entries<AuditEntry>()
            .Where(e => e.State is EntityState.Modified or EntityState.Deleted)
            .ToList();

        if (violations.Count == 0) return;

        // Naming the changed properties matters: "an entry was modified" sends a developer
        // hunting through the whole aggregate, whereas the property name usually identifies
        // the cause immediately.
        var detail = string.Join(", ", violations.Select(v =>
        {
            var changed = v.State == EntityState.Modified
                ? string.Join('/', v.Properties
                    .Where(p => p.IsModified)
                    .Select(p => $"{p.Metadata.Name}: '{p.OriginalValue}' -> '{p.CurrentValue}'"))
                : "entire row";

            return $"{v.Entity.Id} ({v.State}: {changed})";
        }));
        throw new InvalidOperationException(
            $"The audit trail is append-only; attempted to modify or delete {violations.Count} entry(ies): {detail}");
    }
}
