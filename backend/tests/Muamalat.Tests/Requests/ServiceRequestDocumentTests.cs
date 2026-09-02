using FluentAssertions;
using Muamalat.Tests.Workflow;
using static Muamalat.Tests.Workflow.CommercialLicenceRenewal;

namespace Muamalat.Tests.Requests;

/// <summary>
/// Documents are created and mutated only through the aggregate root, so these tests go
/// through <c>ServiceRequest</c> rather than reaching for the entity's internal constructor.
/// </summary>
public class ServiceRequestDocumentTests
{
    [Fact]
    public void An_attachment_captures_the_storage_coordinates_and_the_uploader()
    {
        var scenario = new WorkflowScenario();

        var document = scenario.AttachDocument(Documents.TradeLicence);

        document.Id.Should().NotBe(Guid.Empty);
        document.DocumentType.Should().Be(Documents.TradeLicence);
        document.FileName.Should().Be("trade_licence.pdf");
        document.ContentType.Should().Be("application/pdf");
        document.SizeBytes.Should().Be(240_512);
        document.StoragePath.Should().StartWith("s3://muamalat-docs/");
        document.UploadedByUserId.Should().Be(WorkflowScenario.Citizen.UserId);
        document.UploadedAt.Should().Be(scenario.Now);
    }

    [Fact]
    public void An_unverified_document_carries_no_verifier()
    {
        var document = new WorkflowScenario().AttachDocument(Documents.TradeLicence);

        document.IsVerified.Should().BeFalse();
        document.VerifiedByUserId.Should().BeNull();
        document.VerifiedAt.Should().BeNull();
    }

    [Theory]
    [InlineData("", "file.pdf", "application/pdf", 10L, "s3://bucket/file.pdf")]
    [InlineData("TYPE", "", "application/pdf", 10L, "s3://bucket/file.pdf")]
    [InlineData("TYPE", "file.pdf", "", 10L, "s3://bucket/file.pdf")]
    [InlineData("TYPE", "file.pdf", "application/pdf", 10L, "")]
    public void An_attachment_missing_a_required_field_is_refused(
        string documentType, string fileName, string contentType, long sizeBytes, string storagePath)
    {
        var scenario = new WorkflowScenario();

        var act = () => scenario.Request.AttachDocument(
            documentType, fileName, contentType, sizeBytes, storagePath, WorkflowScenario.Citizen, scenario.Now);

        act.Should().Throw<ArgumentException>();
    }

    [Theory]
    [InlineData(0L)]
    [InlineData(-1L)]
    public void A_zero_length_attachment_is_not_a_document(long sizeBytes)
    {
        var scenario = new WorkflowScenario();

        var act = () => scenario.Request.AttachDocument(
            "TYPE", "file.pdf", "application/pdf", sizeBytes, "s3://bucket/file.pdf",
            WorkflowScenario.Citizen, scenario.Now);

        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void Verification_is_idempotent_and_keeps_the_first_verifier()
    {
        var scenario = new WorkflowScenario();
        var document = scenario.AttachDocument(Documents.TradeLicence);
        var firstVerificationAt = scenario.Advance(TimeSpan.FromMinutes(7));

        scenario.Request.VerifyDocument(document.Id, WorkflowScenario.Reviewer, firstVerificationAt).Should().BeTrue();
        scenario.Request.VerifyDocument(document.Id, WorkflowScenario.Registrar, scenario.Advance(TimeSpan.FromHours(1)))
            .Should().BeFalse();

        document.IsVerified.Should().BeTrue();
        document.VerifiedByUserId.Should().Be(WorkflowScenario.Reviewer.UserId);
        document.VerifiedAt.Should().Be(firstVerificationAt);
    }
}
