/**
 * Wire shapes returned by the Muamalat API.
 *
 * Declared separately from the UI's domain model on purpose. The API speaks in
 * workflow terms (state codes, transition codes, hash chains) while the screens
 * speak in citizen terms (statuses, history, SLA). Keeping the two apart means a
 * change to either one produces a compile error in `api.mappers.ts`, which is
 * exactly one place to fix, rather than silently mismatching field by field
 * across the application.
 */

export interface ApiSlaStatus {
  readonly status: 'OnTrack' | 'AtRisk' | 'Breached';
  readonly dueAt: string;
}

export interface ApiDocument {
  readonly id: string;
  readonly documentType: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly uploadedAt: string;
  readonly isVerified: boolean;
  readonly verifiedAt: string | null;
}

export interface ApiRequestSummary {
  readonly id: string;
  readonly referenceNumber: string;
  readonly serviceType: string;
  readonly workflowKey: string;
  readonly applicantUserId: string;
  readonly applicantDisplayName: string;
  readonly currentStateCode: string;
  readonly submittedAt: string;
  readonly currentStateEnteredAt: string;
  readonly closedAt: string | null;
  readonly assignedToDepartment: string | null;
  readonly sla: ApiSlaStatus | null;
}

export interface ApiRequestDetail {
  readonly id: string;
  readonly referenceNumber: string;
  readonly serviceType: string;
  readonly workflowKey: string;
  readonly workflowVersion: number;
  readonly applicantUserId: string;
  readonly applicantDisplayName: string;
  readonly currentStateCode: string;
  readonly currentStateNameEn: string;
  readonly currentStateNameAr: string;
  readonly isClosed: boolean;
  readonly submittedAt: string;
  readonly currentStateEnteredAt: string;
  readonly closedAt: string | null;
  readonly decisionAt: string | null;
  readonly assignedToDepartment: string | null;
  readonly feePaid: boolean;
  readonly sla: ApiSlaStatus | null;
  readonly documents: readonly ApiDocument[];
}

export interface ApiAuditEntry {
  readonly sequence: number;
  readonly eventType: string;
  readonly fromStateCode: string | null;
  readonly toStateCode: string | null;
  readonly transitionCode: string | null;
  readonly actorDisplayName: string;
  readonly actorRoles: string;
  readonly comment: string | null;
  readonly occurredAt: string;
  readonly hash: string;
}

export interface ApiAuditTrail {
  readonly requestId: string;
  readonly referenceNumber: string;
  readonly chainIsValid: boolean;
  readonly headHash: string | null;
  readonly problems: readonly { sequence: number; kind: string; message: string }[];
  readonly entries: readonly ApiAuditEntry[];
}

export interface ApiWorkflowSummary {
  readonly id: string;
  readonly key: string;
  readonly version: number;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly isPublished: boolean;
  readonly createdAt: string;
  readonly stateCount: number;
  readonly transitionCount: number;
}

export interface ApiWorkflowState {
  readonly code: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly kind: 'Start' | 'Intermediate' | 'Terminal';
  readonly owningDepartment: string | null;
  readonly sortOrder: number;
  readonly sla: {
    readonly target: string;
    readonly warnAfter: string;
    readonly escalateToRole: string | null;
  } | null;
}

export interface ApiWorkflowTransition {
  readonly code: string;
  readonly fromStateCode: string;
  readonly toStateCode: string;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly kind: 'Normal' | 'RequestInformation' | 'ResumeAfterInfo' | 'Escalation';
  readonly requiresComment: boolean;
  readonly allowedRoles: readonly string[];
  readonly guards: readonly { kind: string; parameter: string | null }[];
  readonly actions: readonly { kind: string; parameter: string | null }[];
}

export interface ApiWorkflowDetail {
  readonly id: string;
  readonly key: string;
  readonly version: number;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly isPublished: boolean;
  readonly createdAt: string;
  readonly states: readonly ApiWorkflowState[];
  readonly transitions: readonly ApiWorkflowTransition[];
}
