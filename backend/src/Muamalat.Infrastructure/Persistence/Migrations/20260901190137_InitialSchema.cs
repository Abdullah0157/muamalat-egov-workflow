using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Muamalat.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "workflow_definitions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    name_en = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    name_ar = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    is_published = table.Column<bool>(type: "boolean", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_workflow_definitions", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "service_requests",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    reference_number = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    workflow_definition_id = table.Column<Guid>(type: "uuid", nullable: false),
                    workflow_key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    workflow_version = table.Column<int>(type: "integer", nullable: false),
                    current_state_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    applicant_user_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    applicant_display_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    service_type = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    submitted_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    current_state_entered_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    closed_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    decision_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    assigned_to_department = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    assigned_to_role = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    assigned_to_user_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    fee_paid = table.Column<bool>(type: "boolean", nullable: false),
                    state_before_information_request = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_service_requests", x => x.id);
                    table.ForeignKey(
                        name: "fk_service_requests_workflow_definitions_workflow_definition_id",
                        column: x => x.workflow_definition_id,
                        principalTable: "workflow_definitions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "workflow_states",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workflow_definition_id = table.Column<Guid>(type: "uuid", nullable: false),
                    code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    name_en = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    name_ar = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    kind = table.Column<int>(type: "integer", nullable: false),
                    owning_department = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    sort_order = table.Column<int>(type: "integer", nullable: false),
                    sla_escalate_to_role = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    sla_target = table.Column<TimeSpan>(type: "interval", nullable: true),
                    sla_warn_after = table.Column<TimeSpan>(type: "interval", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_workflow_states", x => x.id);
                    table.ForeignKey(
                        name: "fk_workflow_states_workflow_definitions_workflow_definition_id",
                        column: x => x.workflow_definition_id,
                        principalTable: "workflow_definitions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "workflow_transitions",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    workflow_definition_id = table.Column<Guid>(type: "uuid", nullable: false),
                    code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    from_state_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    to_state_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    name_en = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    name_ar = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    allowed_roles = table.Column<string[]>(type: "text[]", nullable: false),
                    kind = table.Column<int>(type: "integer", nullable: false),
                    requires_comment = table.Column<bool>(type: "boolean", nullable: false),
                    actions = table.Column<string>(type: "jsonb", nullable: true),
                    guards = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_workflow_transitions", x => x.id);
                    table.ForeignKey(
                        name: "fk_workflow_transitions_workflow_definitions_workflow_definiti",
                        column: x => x.workflow_definition_id,
                        principalTable: "workflow_definitions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "audit_entries",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    service_request_id = table.Column<Guid>(type: "uuid", nullable: false),
                    sequence = table.Column<int>(type: "integer", nullable: false),
                    event_type = table.Column<int>(type: "integer", nullable: false),
                    from_state_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    to_state_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    transition_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    actor_user_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    actor_display_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    actor_roles = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    comment = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    payload_json = table.Column<string>(type: "json", nullable: false),
                    occurred_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    previous_hash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false),
                    hash = table.Column<string>(type: "character(64)", fixedLength: true, maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_audit_entries", x => x.id);
                    table.ForeignKey(
                        name: "fk_audit_entries_service_requests_service_request_id",
                        column: x => x.service_request_id,
                        principalTable: "service_requests",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                },
                comment: "Append-only. Updates and deletes are blocked by trigger trg_audit_entries_append_only.");

            migrationBuilder.CreateTable(
                name: "service_request_documents",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    service_request_id = table.Column<Guid>(type: "uuid", nullable: false),
                    document_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    file_name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    content_type = table.Column<string>(type: "character varying(127)", maxLength: 127, nullable: false),
                    size_bytes = table.Column<long>(type: "bigint", nullable: false),
                    storage_path = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    uploaded_by_user_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    uploaded_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    is_verified = table.Column<bool>(type: "boolean", nullable: false),
                    verified_by_user_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    verified_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_service_request_documents", x => x.id);
                    table.ForeignKey(
                        name: "fk_service_request_documents_service_requests_service_request_",
                        column: x => x.service_request_id,
                        principalTable: "service_requests",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ux_audit_entries_hash",
                table: "audit_entries",
                column: "hash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_audit_entries_request_sequence",
                table: "audit_entries",
                columns: new[] { "service_request_id", "sequence" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_service_request_documents_service_request_id_document_type",
                table: "service_request_documents",
                columns: new[] { "service_request_id", "document_type" });

            migrationBuilder.CreateIndex(
                name: "ix_service_requests_applicant",
                table: "service_requests",
                columns: new[] { "applicant_user_id", "submitted_at" });

            migrationBuilder.CreateIndex(
                name: "ix_service_requests_open_by_state",
                table: "service_requests",
                columns: new[] { "workflow_key", "current_state_code" },
                filter: "closed_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_service_requests_open_queue",
                table: "service_requests",
                columns: new[] { "assigned_to_department", "current_state_entered_at" },
                filter: "closed_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ix_service_requests_reference_number",
                table: "service_requests",
                column: "reference_number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_service_requests_workflow_definition_id",
                table: "service_requests",
                column: "workflow_definition_id");

            migrationBuilder.CreateIndex(
                name: "ix_workflow_definitions_key_version",
                table: "workflow_definitions",
                columns: new[] { "key", "version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_workflow_definitions_one_published_per_key",
                table: "workflow_definitions",
                column: "key",
                unique: true,
                filter: "is_published");

            migrationBuilder.CreateIndex(
                name: "ix_workflow_states_workflow_definition_id_code",
                table: "workflow_states",
                columns: new[] { "workflow_definition_id", "code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_workflow_transitions_workflow_definition_id_code",
                table: "workflow_transitions",
                columns: new[] { "workflow_definition_id", "code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_workflow_transitions_workflow_definition_id_from_state_code",
                table: "workflow_transitions",
                columns: new[] { "workflow_definition_id", "from_state_code" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "audit_entries");

            migrationBuilder.DropTable(
                name: "service_request_documents");

            migrationBuilder.DropTable(
                name: "workflow_states");

            migrationBuilder.DropTable(
                name: "workflow_transitions");

            migrationBuilder.DropTable(
                name: "service_requests");

            migrationBuilder.DropTable(
                name: "workflow_definitions");
        }
    }
}
