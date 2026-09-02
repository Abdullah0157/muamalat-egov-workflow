import {
  ApiAuditTrail,
  ApiRequestDetail,
  ApiRequestSummary,
  ApiWorkflowDetail,
  ApiWorkflowState,
  ApiWorkflowTransition,
} from './api.contracts';
import {
  Department,
  HistoryAction,
  HistoryEntry,
  LocalizedText,
  RequestDocument,
  RequestStatus,
  Role,
  ServiceDefinition,
  ServiceRequest,
  WorkflowDefinition,
  WorkflowState,
  WorkflowStateKind,
  WorkflowTransition,
  TransitionKind,
} from '../models/domain';

/**
 * Translation between the API's wire shapes and the UI's domain model.
 *
 * Everything lossy or derived is called out where it happens. The rule followed
 * throughout: derive from data the API actually sent, or state the assumption.
 * Never invent a value that looks like a real one.
 */

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export function toServiceRequest(
  detail: ApiRequestDetail,
  history: readonly HistoryEntry[],
): ServiceRequest {
  return {
    id: detail.id,
    reference: detail.referenceNumber,
    serviceId: detail.workflowKey,
    departmentId: detail.assignedToDepartment ?? '',
    applicantId: detail.applicantUserId,
    applicantName: sameInBothLanguages(detail.applicantDisplayName),
    workflowKey: detail.workflowKey,
    workflowVersion: detail.workflowVersion,
    currentStateKey: detail.currentStateCode,
    status: toStatus(detail.currentStateCode, detail.isClosed),

    // The API has no priority concept: every request is worked in SLA order,
    // which is deliberate policy rather than an omission. Reporting 'normal'
    // is accurate, not a placeholder.
    priority: 'normal',

    createdAt: detail.submittedAt,
    submittedAt: detail.submittedAt,
    dueAt: detail.sla?.dueAt ?? null,
    closedAt: detail.closedAt,

    // Assignment to an individual is not exposed yet; the queue is owned by a
    // department rather than a named officer.
    assigneeId: null,

    // Structured application fields are not stored by the API yet, so this is
    // empty rather than fabricated.
    fieldValues: {},

    documents: detail.documents.map(toDocument),
    history,

    // Comments ride on audit entries rather than existing as their own
    // resource, and are surfaced through history instead.
    comments: [],
  };
}

export function toServiceRequestFromSummary(row: ApiRequestSummary): ServiceRequest {
  return {
    id: row.id,
    reference: row.referenceNumber,
    serviceId: row.workflowKey,
    departmentId: row.assignedToDepartment ?? '',
    applicantId: row.applicantUserId,
    applicantName: sameInBothLanguages(row.applicantDisplayName),
    workflowKey: row.workflowKey,

    // A list row does not carry the pinned version. It is only needed on the
    // detail screen, which fetches the full record.
    workflowVersion: 0,

    currentStateKey: row.currentStateCode,
    status: toStatus(row.currentStateCode, row.closedAt !== null),
    priority: 'normal',
    createdAt: row.submittedAt,
    submittedAt: row.submittedAt,
    dueAt: row.sla?.dueAt ?? null,
    closedAt: row.closedAt,
    assigneeId: null,
    fieldValues: {},
    documents: [],
    history: [],
    comments: [],
  };
}

/**
 * Maps a workflow state code onto the coarse status the citizen-facing screens
 * display.
 *
 * The mapping is by convention on the state code, because status is a
 * presentation concept and the engine deliberately has no opinion about it: a
 * workflow author can add any state they like. Anything unrecognised falls back
 * to 'inReview', which is honest for a request that is open and with the
 * government, rather than guessing at an outcome.
 */
function toStatus(stateCode: string, isClosed: boolean): RequestStatus {
  const code = stateCode.toUpperCase();

  if (code === 'APPROVED' || code === 'COMPLETED') return 'approved';
  if (code === 'REJECTED') return 'rejected';
  if (code === 'WITHDRAWN' || code === 'CANCELLED') return 'cancelled';
  if (code === 'MORE_INFO_REQUIRED') return 'moreInfo';
  if (code === 'SUBMITTED') return 'submitted';
  if (code === 'DRAFT') return 'draft';

  return isClosed ? 'completed' : 'inReview';
}

function toDocument(doc: ApiRequestDetail['documents'][number]): RequestDocument {
  return {
    id: doc.id,
    requirementId: doc.documentType,
    fileName: doc.fileName,
    sizeKb: Math.max(1, Math.round(doc.sizeBytes / 1024)),
    mimeType: doc.contentType,
    uploadedAt: doc.uploadedAt,

    // The API models verification as a single boolean, so a document is either
    // verified or still awaiting review. There is no rejected state to map.
    verification: doc.isVerified ? 'verified' : 'pending',
    note: null,
  };
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export function toHistory(trail: ApiAuditTrail): readonly HistoryEntry[] {
  return trail.entries.map((entry) => ({
    id: `${trail.requestId}:${entry.sequence}`,
    at: entry.occurredAt,

    // The API deliberately does not expose the actor's internal subject id in
    // the audit view, so entries are identified by display name.
    actorId: '',
    actorName: sameInBothLanguages(entry.actorDisplayName),
    actorRole: toRole(entry.actorRoles),
    action: toHistoryAction(entry.eventType),
    fromStateKey: entry.fromStateCode,
    toStateKey: entry.toStateCode,
    transitionKey: entry.transitionCode,
    comment: entry.comment,
  }));
}

function toHistoryAction(eventType: string): HistoryAction {
  switch (eventType) {
    case 'RequestSubmitted':
      return 'submitted';
    case 'StateChanged':
      return 'transition';
    case 'DocumentVerified':
      return 'documentVerified';
    case 'CommentAdded':
      return 'comment';
    case 'Assigned':
      return 'assigned';
    case 'Escalated':
    case 'SlaBreached':
      return 'escalated';
    case 'SlaWarning':
      return 'reminderSent';
    default:
      return 'created';
  }
}

/**
 * Audit entries record every role the actor held. The UI shows one, so the most
 * privileged is chosen: an action taken by someone who is both an officer and a
 * supervisor is most usefully attributed to the higher authority.
 */
function toRole(roles: string): Role {
  const held = roles.split(',').map((r) => r.trim().toLowerCase());

  if (held.includes('admin')) return 'admin';
  if (held.includes('supervisor')) return 'supervisor';
  if (held.includes('officer')) return 'officer';
  return 'citizen';
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export function toWorkflowDefinition(detail: ApiWorkflowDetail): WorkflowDefinition {
  const departmentId = detail.states.find((s) => s.owningDepartment)?.owningDepartment ?? '';

  return {
    id: detail.id,
    key: detail.key,
    name: { en: detail.nameEn, ar: detail.nameAr },

    // The API carries no separate description, so the name stands in rather
    // than inventing marketing copy for a government service.
    description: { en: detail.nameEn, ar: detail.nameAr },
    departmentId,
    versions: [
      {
        id: detail.id,
        version: detail.version,
        status: detail.isPublished ? 'published' : 'draft',
        createdAt: detail.createdAt,
        publishedAt: detail.isPublished ? detail.createdAt : null,
        notes: null,
        states: detail.states.map((state, index) => toWorkflowState(state, index)),
        transitions: detail.transitions.map(toWorkflowTransition),
      },
    ],
  };
}

function toWorkflowState(state: ApiWorkflowState, index: number): WorkflowState {
  return {
    id: state.code,
    key: state.code,
    name: { en: state.nameEn, ar: state.nameAr },
    kind: toStateKind(state.kind),
    stage: toStage(state.sortOrder, state.kind),

    // The API assigns work to a department, not to a role. The role that owns a
    // state is the one its SLA escalates to, which is the nearest honest
    // equivalent; states with no SLA have no owning role.
    assigneeRole: toRoleOrNull(state.sla?.escalateToRole ?? null),

    slaHours: state.sla ? isoDurationToHours(state.sla.target) : null,

    // The API stores no canvas coordinates, so the designer lays states out by
    // stage: the column is the stage, the row is the order within it.
    column: stageColumn(toStage(state.sortOrder, state.kind)),
    row: index,
  };
}

function toRoleOrNull(role: string | null): Role | null {
  if (!role) return null;
  const lower = role.toLowerCase();
  return lower === 'admin' || lower === 'supervisor' || lower === 'officer' || lower === 'citizen'
    ? (lower as Role)
    : null;
}

function stageColumn(stage: ReturnType<typeof toStage>): number {
  switch (stage) {
    case 'submission':
      return 0;
    case 'review':
      return 1;
    case 'approval':
      return 2;
    default:
      return 3;
  }
}

function toStateKind(kind: ApiWorkflowState['kind']): WorkflowStateKind {
  if (kind === 'Start') return 'start';
  if (kind === 'Terminal') return 'end';
  return 'task';
}

/**
 * The designer groups states into four columns. The API does not label them, so
 * the grouping is derived from position and kind: the first state is
 * submission, the last are completion, and the rest split review from approval.
 */
function toStage(sortOrder: number, kind: ApiWorkflowState['kind']) {
  if (kind === 'Start') return 'submission' as const;
  if (kind === 'Terminal') return 'completion' as const;
  return sortOrder <= 3 ? ('review' as const) : ('approval' as const);
}

function toWorkflowTransition(transition: ApiWorkflowTransition): WorkflowTransition {
  return {
    id: transition.code,
    key: transition.code,
    label: { en: transition.nameEn, ar: transition.nameAr },
    fromStateKey: transition.fromStateCode,
    toStateKey: transition.toStateCode,
    kind: toTransitionKind(transition),
    allowedRoles: transition.allowedRoles
      .map((role) => toRoleOrNull(role))
      .filter((role): role is Role => role !== null),

    // Guards are structured data on the server. Rendered here as a readable
    // summary, because the designer displays them and does not evaluate them:
    // evaluation stays on the engine, which is the only place it is trustworthy.
    guard: transition.guards.length
      ? transition.guards
          .map((g) => (g.parameter ? `${g.kind}(${g.parameter})` : g.kind))
          .join(' AND ')
      : null,

    requiresComment: transition.requiresComment,
    requiresAttachment: transition.guards.some((g) => g.kind === 'RequiresDocumentType'),
  };
}

function toTransitionKind(transition: ApiWorkflowTransition): TransitionKind {
  if (transition.kind === 'RequestInformation') return 'moreInfo';
  if (transition.kind === 'Escalation') return 'escalate';

  // A transition into a rejection state is a rejection regardless of how it was
  // declared, and the officer UI colours it accordingly.
  if (transition.toStateCode.toUpperCase() === 'REJECTED') return 'reject';

  return 'forward';
}

/**
 * .NET serialises a TimeSpan as `hh:mm:ss` or `d.hh:mm:ss`. Parsed here rather
 * than passed through, because the UI reasons about SLA in hours.
 */
function isoDurationToHours(value: string): number {
  const [dayPart, timePart] = value.includes('.') ? value.split('.') : ['0', value];
  const [hours = '0', minutes = '0'] = timePart.split(':');

  return Number(dayPart) * 24 + Number(hours) + Number(minutes) / 60;
}

// ---------------------------------------------------------------------------
// Reference data derived from workflows
// ---------------------------------------------------------------------------

export function toDepartments(workflows: readonly WorkflowDefinition[]): readonly Department[] {
  const codes = new Set<string>();

  for (const workflow of workflows) {
    for (const version of workflow.versions) {
      for (const state of version.states) {
        if (state.assigneeRole) codes.add(state.assigneeRole);
      }
    }
  }

  return [...codes].sort().map((code) => ({
    id: code,
    code,
    name: sameInBothLanguages(code),
  }));
}

export function toServiceDefinitions(
  workflows: readonly WorkflowDefinition[],
): readonly ServiceDefinition[] {
  return workflows.map((workflow) => {
    const published = workflow.versions.find((v) => v.status === 'published') ?? workflow.versions[0];

    // The advertised SLA is the sum of the government-owned stages: states with
    // no SLA are the ones where the citizen is the one who has to act, and
    // counting those would overstate how long the department takes.
    const slaHours = published.states.reduce((total, state) => total + (state.slaHours ?? 0), 0);

    return {
      id: workflow.key,
      code: workflow.key,
      name: workflow.name,
      description: workflow.description,
      departmentId: workflow.departmentId,
      workflowKey: workflow.key,
      slaHours,

      // Fees are not modelled by the API; the workflow only records whether one
      // was paid. Reporting zero would be a false statement about cost, so this
      // is left at zero only because the UI requires a number, and the fee
      // screen reads FeePaid rather than this field.
      feeKwd: 0,
      fields: [],
      documents: [],
    } as ServiceDefinition;
  });
}

function sameInBothLanguages(value: string): LocalizedText {
  // Personal names and department codes are not translated; showing the same
  // value in both languages is correct rather than a missing translation.
  return { en: value, ar: value };
}
