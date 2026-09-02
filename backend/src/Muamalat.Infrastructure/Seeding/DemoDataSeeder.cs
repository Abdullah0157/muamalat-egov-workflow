using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Muamalat.Domain.Common;
using Muamalat.Domain.Requests;
using Muamalat.Domain.Workflow;
using Muamalat.Infrastructure.Persistence;

namespace Muamalat.Infrastructure.Seeding;

/// <summary>
/// Populates a demonstration deployment with a realistic caseload.
///
/// Every request is created through <see cref="ServiceRequest.Submit"/> and moved by the real
/// <see cref="WorkflowEngine"/>, never by writing rows directly. That matters for two reasons:
/// the audit chains are genuine and verify, and the seeded data cannot drift into states the
/// engine would never produce. Fabricated rows would make the dashboard a lie and the audit
/// view a prop.
///
/// Submission times are spread across the last several weeks so SLA status varies naturally:
/// some cases are comfortable, some are close, some have breached. Nothing is forced.
/// </summary>
public sealed class DemoDataSeeder(
    MuamalatDbContext db,
    WorkflowEngine engine,
    ILogger<DemoDataSeeder> logger)
{
    // Fixed seed. The demo must look identical on every machine, otherwise a screenshot in the
    // README will not match what a reviewer sees when they run it.
    private readonly Random _random = new(20260902);

    /// <summary>
    /// The first two identifiers are the fixed Keycloak subjects of the demonstration citizen
    /// accounts, declared in infra/keycloak/realm-muamalat.json. Signing in as either of them
    /// therefore shows a real caseload rather than an empty list, which is the difference
    /// between a demonstration and a screenshot of nothing.
    ///
    /// The remaining applicants exist only to give the officer queue a realistic spread of
    /// names; nobody signs in as them.
    /// </summary>
    private static readonly (string Id, string Name)[] Applicants =
    [
        ("11111111-0000-4000-8000-000000000001", "Fatima Al Suwaidi"),
        ("11111111-0000-4000-8000-000000000002", "Omar Al Harthy"),
        ("demo-citizen-3", "Hessa Al Otaibi"),
        ("demo-citizen-4", "Abdulaziz Al Rashidi"),
        ("demo-citizen-5", "Latifa Al Sabah"),
        ("demo-citizen-6", "Bader Al Ajmi"),
        ("demo-citizen-7", "Munira Al Failakawi"),
        ("demo-citizen-8", "Saad Al Enezi"),
    ];

    private static readonly TransitionActor Officer =
        TransitionActor.Create("11111111-0000-4000-8000-000000000003", "Noura Al Kaabi", "Officer");

    private static readonly TransitionActor SecondOfficer =
        TransitionActor.Create("11111111-0000-4000-8000-000000000004", "Yousef Al Mazrouei", "Officer");

    private static readonly TransitionActor Supervisor =
        TransitionActor.Create("11111111-0000-4000-8000-000000000005", "Mariam Al Balushi", "Supervisor", "Officer");

    public async Task SeedAsync(DateTimeOffset now, CancellationToken cancellationToken = default)
    {
        if (await db.ServiceRequests.AnyAsync(r => r.ReferenceNumber.Contains("-9"), cancellationToken))
        {
            logger.LogInformation("Demonstration caseload already present; nothing seeded.");
            return;
        }

        var definitions = await db.WorkflowDefinitions
            .Include(d => d.States)
            .Include(d => d.Transitions)
            .Where(d => d.IsPublished)
            .ToListAsync(cancellationToken);

        if (definitions.Count == 0)
        {
            logger.LogWarning("No published workflows; the demonstration caseload cannot be seeded.");
            return;
        }

        var created = 0;

        foreach (var definition in definitions)
        {
            // Enough per service that the queue needs paging and the dashboard has something
            // to average, without turning a demo start-up into a long wait.
            for (var i = 0; i < 14; i++)
            {
                // Weighted towards recent submissions. A uniform spread across a month
                // would put almost every case past its statutory window, which reads as a
                // department in crisis rather than a system working normally.
                var submittedAt = now.AddHours(-AgeInHours());
                var request = Submit(definition, submittedAt, created);

                // Most applicants supply their paperwork and pay the fee, which is what lets a
                // case reach a decision at all. Leaving a minority incomplete is deliberate:
                // those are the requests that sit in the queue waiting on the citizen, and a
                // demo without them would not show the officer why work stalls.
                var applicantIsThorough = _random.Next(100) < 75;

                if (applicantIsThorough)
                {
                    SupplyPaperwork(request, definition, submittedAt);
                }

                Advance(request, definition, submittedAt, now);

                db.ServiceRequests.Add(request);
                created++;
            }
        }

        await db.SaveChangesAsync(cancellationToken);
        logger.LogInformation("Seeded {Count} demonstration requests.", created);
    }

    private ServiceRequest Submit(WorkflowDefinition definition, DateTimeOffset submittedAt, int index)
    {
        var applicant = Applicants[index % Applicants.Length];

        return ServiceRequest.Submit(
            definition,
            $"MW-{submittedAt.Year}-{(900000 + index):D6}",
            definition.NameEn,
            applicant.Id,
            applicant.Name,
            submittedAt);
    }

    /// <summary>
    /// Attaches the documents the workflow's guards ask for, has an officer verify them, and
    /// records the fee as paid.
    ///
    /// The document types are read off the guards themselves rather than hardcoded, so a
    /// workflow edited in the designer seeds correctly without this file changing. That is the
    /// same principle the engine follows: the definition is the source of truth.
    /// </summary>
    private void SupplyPaperwork(ServiceRequest request, WorkflowDefinition definition, DateTimeOffset submittedAt)
    {
        var requiredTypes = definition.Transitions
            .SelectMany(t => t.Guards)
            .Where(g => g.Kind == GuardKind.RequiresDocumentType && g.Parameter is not null)
            .Select(g => g.Parameter!)
            .Distinct()
            .ToList();

        var uploadedAt = submittedAt.AddMinutes(_random.Next(5, 180));

        foreach (var type in requiredTypes)
        {
            var document = request.AttachDocument(
                type,
                $"{type}.pdf",
                "application/pdf",
                _random.Next(80_000, 3_000_000),
                $"demo/{request.Id:N}/{type}.pdf",
                ApplicantActor(request),
                uploadedAt);

            // Verified by an officer, not by the applicant: a citizen confirming their own
            // paperwork would defeat the control the guard exists to enforce.
            request.VerifyDocument(document.Id, Officer, uploadedAt.AddHours(_random.Next(1, 12)));
        }

        request.MarkFeePaid(ApplicantActor(request), uploadedAt.AddMinutes(_random.Next(1, 90)));
    }

    private static TransitionActor ApplicantActor(ServiceRequest request) =>
        TransitionActor.Create(request.ApplicantUserId, request.ApplicantDisplayName, "Citizen");

    /// <summary>
    /// Walks a request forward a random number of steps, always through the engine.
    ///
    /// Transitions blocked by a guard are skipped rather than forced: a seeded case that
    /// bypassed a document requirement would sit in a state the real system could never
    /// have produced.
    /// </summary>
    private void Advance(ServiceRequest request, WorkflowDefinition definition, DateTimeOffset from, DateTimeOffset now)
    {
        var steps = _random.Next(0, 8);
        var at = from;

        for (var step = 0; step < steps; step++)
        {
            if (request.IsClosed) return;

            // Time passes between steps, which is what gives the seeded data a spread of SLA
            // positions instead of every case looking identical.
            //
            // The gap is bounded by how much time is actually left before now. Picking a fixed
            // range instead would overshoot for a case submitted an hour ago, and it would
            // never advance at all: the queue would then be dominated by untouched submissions,
            // which is not what a working department looks like.
            var hoursAvailable = (now - at).TotalHours;
            if (hoursAvailable < 1) return;

            at = at.AddHours(_random.NextDouble() * Math.Min(36, hoursAvailable));

            var actor = ChooseActor(step);

            var options = engine.AvailableTransitions(request, definition, actor)
                .Where(t => t.Kind != TransitionKind.RequestInformation || _random.Next(4) == 0)
                .ToList();

            if (options.Count == 0) return;

            var transition = options[_random.Next(options.Count)];

            var comment = transition.RequiresComment
                ? "Additional supporting documents are required before this application can proceed."
                : null;

            var result = engine.Execute(request, definition, transition.Code, actor, at, comment);

            // A guard refusal is a legitimate outcome, not an error. The case simply stays
            // where it is, which is exactly what happens in the real system.
            if (!result.Succeeded) return;
        }
    }

    /// <summary>
    /// How long ago a demonstration case was submitted.
    ///
    /// Most work in a functioning department is recent and inside its window; a minority is
    /// slipping and a few have genuinely breached. That shape is what makes the oversight
    /// dashboard worth looking at, and a uniform random spread does not produce it.
    /// </summary>
    private int AgeInHours()
    {
        var roll = _random.Next(100);

        if (roll < 55) return _random.Next(1, 20);      // comfortably inside the window
        if (roll < 80) return _random.Next(20, 44);     // approaching or just past a one day SLA
        if (roll < 93) return _random.Next(44, 120);    // late
        return _random.Next(120, 24 * 25);              // long overdue, the cases that need a supervisor
    }

    /// <summary>
    /// Alternates the acting officer so segregation of duties guards behave as they would in
    /// practice: the person who reviewed is not automatically the person who approves.
    /// </summary>
    private TransitionActor ChooseActor(int step) => step switch
    {
        0 => Officer,
        1 => SecondOfficer,
        _ => Supervisor,
    };
}
