/**
 * Muamalat domain model.
 *
 * Bilingual content that originates from the back office (department names,
 * service names, workflow state labels) is carried as `en`/`ar` pairs on the
 * record itself, because it is *data*, not interface copy. Interface copy lives
 * in the message catalogues under src/assets/i18n.
 */

export type Role = 'citizen' | 'officer' | 'supervisor' | 'admin';

export const ALL_ROLES: readonly Role[] = ['citizen', 'officer', 'supervisor', 'admin'];

/** A short bilingual value stored against a record. */
export interface LocalizedText {
  readonly en: string;
  readonly ar: string;
}

export interface User {
  readonly id: string;
  readonly name: LocalizedText;
  /** Kuwaiti civil ID. Displayed isolated so it never reorders inside Arabic text. */
  readonly civilId: string;
  readonly email: string;
  readonly role: Role;
  readonly departmentId: string | null;
  readonly jobTitle: LocalizedText | null;
}

export interface Department {
  readonly id: string;
  readonly code: string;
  readonly name: LocalizedText;
}

export type ServiceFieldType = 'text' | 'textarea' | 'select' | 'date' | 'number';

export interface ServiceFieldOption {
  readonly value: string;
  readonly label: LocalizedText;
}

export interface ServiceField {
  readonly id: string;
  readonly type: ServiceFieldType;
  readonly label: LocalizedText;
  readonly hint: LocalizedText | null;
  readonly required: boolean;
  readonly options: readonly ServiceFieldOption[];
  readonly maxLength: number | null;
}

export interface DocumentRequirement {
  readonly id: string;
  readonly name: LocalizedText;
  readonly required: boolean;
  /** Accepted extensions, lower case, without the dot. */
  readonly formats: readonly string[];
  readonly maxSizeMb: number;
}

export interface ServiceDefinition {
  readonly id: string;
  readonly code: string;
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  readonly departmentId: string;
  readonly workflowKey: string;
  /** Statutory processing time in working hours. Drives every SLA calculation. */
  readonly slaHours: number;
  readonly feeKwd: number;
  readonly fields: readonly ServiceField[];
  readonly documents: readonly DocumentRequirement[];
}

// -----------------------------------------------------------------------------
// Workflow definition
// -----------------------------------------------------------------------------

/**
 * `start` and `end` are structural. `task` is human work with an owner and an
 * SLA. `decision` is a branch point that a task feeds into.
 */
export type WorkflowStateKind = 'start' | 'task' | 'decision' | 'end';

/**
 * The four stages a citizen sees on the progress tracker. Several workflow
 * states can map to the same stage.
 */
export type WorkflowStage = 'submission' | 'review' | 'approval' | 'completion';

export const WORKFLOW_STAGES: readonly WorkflowStage[] = [
  'submission',
  'review',
  'approval',
  'completion',
];

export interface WorkflowState {
  readonly id: string;
  /** Stable machine key, referenced by requests and transitions. */
  readonly key: string;
  readonly name: LocalizedText;
  readonly kind: WorkflowStateKind;
  readonly stage: WorkflowStage;
  /** Role that owns the work while a request sits in this state. */
  readonly assigneeRole: Role | null;
  /** Working hours allowed in this state before it counts against the SLA. */
  readonly slaHours: number | null;
  /** Grid position in the designer canvas, in columns and rows. */
  readonly column: number;
  readonly row: number;
}

/**
 * `forward` advances the case, `reject` closes it negatively, `moreInfo` sends
 * it back to the applicant, `escalate` raises it to a supervisor.
 */
export type TransitionKind = 'forward' | 'reject' | 'moreInfo' | 'escalate';

export interface WorkflowTransition {
  readonly id: string;
  readonly key: string;
  readonly label: LocalizedText;
  readonly fromStateKey: string;
  readonly toStateKey: string;
  readonly kind: TransitionKind;
  readonly allowedRoles: readonly Role[];
  /**
   * Guard expression evaluated by the workflow engine before the transition is
   * offered. Null means unconditional.
   */
  readonly guard: string | null;
  readonly requiresComment: boolean;
  readonly requiresAttachment: boolean;
}

export type WorkflowVersionStatus = 'draft' | 'published' | 'archived';

export interface WorkflowVersion {
  readonly id: string;
  readonly version: number;
  readonly status: WorkflowVersionStatus;
  readonly createdAt: string;
  readonly publishedAt: string | null;
  readonly notes: LocalizedText | null;
  readonly states: readonly WorkflowState[];
  readonly transitions: readonly WorkflowTransition[];
}

export interface WorkflowDefinition {
  readonly id: string;
  readonly key: string;
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  readonly departmentId: string;
  readonly versions: readonly WorkflowVersion[];
}

// -----------------------------------------------------------------------------
// Requests
// -----------------------------------------------------------------------------

export type RequestStatus =
  | 'draft'
  | 'submitted'
  | 'inReview'
  | 'moreInfo'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'cancelled';

export type RequestPriority = 'normal' | 'high' | 'urgent';

export type DocumentVerification = 'pending' | 'verified' | 'rejected';

export interface RequestDocument {
  readonly id: string;
  readonly requirementId: string;
  readonly fileName: string;
  readonly sizeKb: number;
  readonly mimeType: string;
  readonly uploadedAt: string;
  readonly verification: DocumentVerification;
  /** Reviewer note, only present when verification is `rejected`. */
  readonly note: string | null;
}

export type HistoryAction =
  | 'created'
  | 'submitted'
  | 'assigned'
  | 'transition'
  | 'comment'
  | 'documentVerified'
  | 'documentRejected'
  | 'escalated'
  | 'reminderSent';

export interface HistoryEntry {
  readonly id: string;
  readonly at: string;
  readonly actorId: string;
  readonly actorName: LocalizedText;
  readonly actorRole: Role;
  readonly action: HistoryAction;
  readonly fromStateKey: string | null;
  readonly toStateKey: string | null;
  readonly transitionKey: string | null;
  readonly comment: string | null;
}

export interface RequestComment {
  readonly id: string;
  readonly at: string;
  readonly authorId: string;
  readonly authorName: LocalizedText;
  readonly authorRole: Role;
  readonly body: string;
  /** Internal notes are not shown to the applicant. */
  readonly internal: boolean;
}

export interface ServiceRequest {
  readonly id: string;
  /** Public reference number printed on receipts. Always rendered LTR. */
  readonly reference: string;
  readonly serviceId: string;
  readonly departmentId: string;
  readonly applicantId: string;
  readonly applicantName: LocalizedText;
  readonly workflowKey: string;
  readonly workflowVersion: number;
  readonly currentStateKey: string;
  readonly status: RequestStatus;
  readonly priority: RequestPriority;
  readonly createdAt: string;
  readonly submittedAt: string | null;
  /** SLA deadline derived from submittedAt plus the service SLA. */
  readonly dueAt: string | null;
  readonly closedAt: string | null;
  readonly assigneeId: string | null;
  readonly fieldValues: Readonly<Record<string, string>>;
  readonly documents: readonly RequestDocument[];
  readonly history: readonly HistoryEntry[];
  readonly comments: readonly RequestComment[];
}

// -----------------------------------------------------------------------------
// Derived values
// -----------------------------------------------------------------------------

/**
 * `met` is a closed request that finished inside its window, `breached` is past
 * the deadline, `atRisk` has less than a quarter of its window left.
 */
export type SlaStatus = 'onTrack' | 'atRisk' | 'breached' | 'met' | 'notApplicable';

export interface SlaState {
  readonly status: SlaStatus;
  /** Milliseconds remaining. Negative once breached. Null when not applicable. */
  readonly remainingMs: number | null;
  readonly dueAt: string | null;
  /** 0 to 1, how much of the SLA window has elapsed. Clamped at 1. */
  readonly elapsedFraction: number;
}

/** A draft being assembled by the citizen wizard before it becomes a request. */
export interface RequestDraft {
  readonly serviceId: string;
  readonly fieldValues: Record<string, string>;
  readonly documents: readonly DraftDocument[];
  readonly priority: RequestPriority;
  readonly contactPhone: string;
  readonly acknowledged: boolean;
}

export interface DraftDocument {
  readonly requirementId: string;
  readonly fileName: string;
  readonly sizeKb: number;
  readonly mimeType: string;
}
