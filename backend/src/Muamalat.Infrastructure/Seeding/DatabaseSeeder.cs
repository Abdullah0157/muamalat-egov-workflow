using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Muamalat.Infrastructure.Persistence;

namespace Muamalat.Infrastructure.Seeding;

/// <summary>
/// Brings a fresh database up to a usable state: applies migrations, installs the hand written
/// SQL objects, then seeds the workflow catalogue.
///
/// Seeding is idempotent and additive. It never updates or deletes an existing definition,
/// because an administrator may have edited one and a restart must not silently revert their
/// work. A definition is seeded only when its key and version are absent entirely.
/// </summary>
public sealed class DatabaseSeeder(MuamalatDbContext db, ILogger<DatabaseSeeder> logger)
{
    public async Task InitialiseAsync(CancellationToken cancellationToken = default)
    {
        await db.Database.MigrateAsync(cancellationToken);
        logger.LogInformation("Database migrations applied.");

        await ApplySqlObjectsAsync(cancellationToken);
        await SeedWorkflowsAsync(cancellationToken);
    }

    /// <summary>
    /// Functions, triggers and supporting tables that are written by hand rather than generated.
    /// Every script is idempotent (CREATE OR REPLACE, IF NOT EXISTS), so running them on every
    /// start keeps the database in step with the code without a separate deployment step.
    /// </summary>
    private async Task ApplySqlObjectsAsync(CancellationToken cancellationToken)
    {
        var assembly = Assembly.GetExecutingAssembly();

        var scripts = assembly.GetManifestResourceNames()
            .Where(n => n.Contains(".Persistence.Sql.") && n.EndsWith(".sql", StringComparison.Ordinal))
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToList();

        if (scripts.Count == 0)
        {
            logger.LogWarning("No embedded SQL scripts were found; check the csproj EmbeddedResource glob.");
            return;
        }

        foreach (var name in scripts)
        {
            await using var stream = assembly.GetManifestResourceStream(name)
                ?? throw new InvalidOperationException($"Embedded SQL script '{name}' could not be opened.");

            using var reader = new StreamReader(stream);
            var sql = await reader.ReadToEndAsync(cancellationToken);

            await db.Database.ExecuteSqlRawAsync(sql, cancellationToken);
            logger.LogInformation("Applied SQL script {Script}.", name);
        }
    }

    private async Task SeedWorkflowsAsync(CancellationToken cancellationToken)
    {
        var seeded = 0;

        foreach (var definition in WorkflowCatalog.All())
        {
            var exists = await db.WorkflowDefinitions
                .AnyAsync(d => d.Key == definition.Key && d.Version == definition.Version, cancellationToken);

            if (exists) continue;

            db.WorkflowDefinitions.Add(definition);
            seeded++;
        }

        if (seeded == 0)
        {
            logger.LogInformation("Workflow catalogue already present; nothing seeded.");
            return;
        }

        await db.SaveChangesAsync(cancellationToken);
        logger.LogInformation("Seeded {Count} workflow definition(s).", seeded);
    }
}
