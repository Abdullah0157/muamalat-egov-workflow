using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Muamalat.Infrastructure.Persistence;

/// <summary>
/// Used only by the EF Core command line tools when generating migrations. The runtime
/// application configures its own context through dependency injection, so the connection
/// string here never reaches a deployed environment; it just has to be well formed enough
/// for the Npgsql provider to build a model.
/// </summary>
public sealed class MuamalatDbContextFactory : IDesignTimeDbContextFactory<MuamalatDbContext>
{
    public MuamalatDbContext CreateDbContext(string[] args)
    {
        var connectionString =
            Environment.GetEnvironmentVariable("MUAMALAT_MIGRATIONS_CONNECTION")
            ?? "Host=localhost;Port=5432;Database=muamalat;Username=muamalat;Password=muamalat";

        var options = new DbContextOptionsBuilder<MuamalatDbContext>()
            .UseNpgsql(connectionString)
            .UseSnakeCaseNamingConvention()
            .Options;

        return new MuamalatDbContext(options);
    }
}
