import { DEPARTMENT_IDS } from '../auth/demo-users';
import {
  Role,
  TransitionKind,
  WorkflowDefinition,
  WorkflowStage,
  WorkflowState,
  WorkflowStateKind,
  WorkflowTransition,
  WorkflowVersion,
} from '../models/domain';

/**
 * The workflow definitions the platform runs on.
 *
 * All three follow the same skeleton that the ministry mandates:
 *
 *   START -> REVIEW -> APPROVAL -> COMPLETION
 *
 * with two structural additions that every real administrative process needs:
 * a "more information" loop that returns the file to the applicant without
 * closing it, and an escalation branch that lifts a contested case to a
 * supervisor. Rejection is a terminal branch reachable from every review state,
 * because a case can fail a check at any point.
 */

interface StateSeed {
  readonly key: string;
  readonly en: string;
  readonly ar: string;
  readonly kind: WorkflowStateKind;
  readonly stage: WorkflowStage;
  readonly assigneeRole: Role | null;
  readonly slaHours: number | null;
  readonly column: number;
  readonly row: number;
}

interface TransitionSeed {
  readonly key: string;
  readonly en: string;
  readonly ar: string;
  readonly from: string;
  readonly to: string;
  readonly kind: TransitionKind;
  readonly roles: readonly Role[];
  readonly guard?: string;
  readonly comment?: boolean;
  readonly attachment?: boolean;
}

function buildStates(workflowKey: string, seeds: readonly StateSeed[]): WorkflowState[] {
  return seeds.map((seed) => ({
    id: `${workflowKey}-state-${seed.key}`,
    key: seed.key,
    name: { en: seed.en, ar: seed.ar },
    kind: seed.kind,
    stage: seed.stage,
    assigneeRole: seed.assigneeRole,
    slaHours: seed.slaHours,
    column: seed.column,
    row: seed.row,
  }));
}

function buildTransitions(
  workflowKey: string,
  seeds: readonly TransitionSeed[],
): WorkflowTransition[] {
  return seeds.map((seed) => ({
    id: `${workflowKey}-transition-${seed.key}`,
    key: seed.key,
    label: { en: seed.en, ar: seed.ar },
    fromStateKey: seed.from,
    toStateKey: seed.to,
    kind: seed.kind,
    allowedRoles: seed.roles,
    guard: seed.guard ?? null,
    requiresComment: seed.comment ?? false,
    requiresAttachment: seed.attachment ?? false,
  }));
}

// -----------------------------------------------------------------------------
// Standard approval: the general purpose process used by most services.
// -----------------------------------------------------------------------------

const STANDARD_STATES: readonly StateSeed[] = [
  {
    key: 'submitted',
    en: 'Submitted',
    ar: 'مُقدَّم',
    kind: 'start',
    stage: 'submission',
    assigneeRole: null,
    slaHours: null,
    column: 0,
    row: 1,
  },
  {
    key: 'documentCheck',
    en: 'Document check',
    ar: 'فحص المستندات',
    kind: 'task',
    stage: 'review',
    assigneeRole: 'officer',
    slaHours: 24,
    column: 1,
    row: 1,
  },
  {
    key: 'moreInfo',
    en: 'Awaiting applicant',
    ar: 'بانتظار مقدّم الطلب',
    kind: 'task',
    stage: 'review',
    assigneeRole: 'citizen',
    slaHours: 120,
    column: 1,
    row: 2,
  },
  {
    key: 'technicalReview',
    en: 'Technical review',
    ar: 'المراجعة الفنية',
    kind: 'task',
    stage: 'review',
    assigneeRole: 'officer',
    slaHours: 48,
    column: 2,
    row: 1,
  },
  {
    key: 'supervisorApproval',
    en: 'Supervisor approval',
    ar: 'اعتماد المشرف',
    kind: 'decision',
    stage: 'approval',
    assigneeRole: 'supervisor',
    slaHours: 24,
    column: 3,
    row: 1,
  },
  {
    key: 'escalated',
    en: 'Escalated',
    ar: 'مُصعَّد',
    kind: 'task',
    stage: 'approval',
    assigneeRole: 'supervisor',
    slaHours: 12,
    column: 3,
    row: 0,
  },
  {
    key: 'issuance',
    en: 'Issuance',
    ar: 'الإصدار',
    kind: 'task',
    stage: 'completion',
    assigneeRole: 'officer',
    slaHours: 24,
    column: 4,
    row: 1,
  },
  {
    key: 'completed',
    en: 'Completed',
    ar: 'منجز',
    kind: 'end',
    stage: 'completion',
    assigneeRole: null,
    slaHours: null,
    column: 5,
    row: 1,
  },
  {
    key: 'rejected',
    en: 'Rejected',
    ar: 'مرفوض',
    kind: 'end',
    stage: 'completion',
    assigneeRole: null,
    slaHours: null,
    column: 5,
    row: 2,
  },
];

const STANDARD_TRANSITIONS: readonly TransitionSeed[] = [
  {
    key: 'beginReview',
    en: 'Begin review',
    ar: 'بدء المراجعة',
    from: 'submitted',
    to: 'documentCheck',
    kind: 'forward',
    roles: ['officer', 'supervisor'],
  },
  {
    key: 'documentsVerified',
    en: 'Documents verified',
    ar: 'المستندات مكتملة',
    from: 'documentCheck',
    to: 'technicalReview',
    kind: 'forward',
    roles: ['officer'],
    guard: 'allRequiredDocumentsVerified',
  },
  {
    key: 'requestInformation',
    en: 'Request information',
    ar: 'طلب معلومات',
    from: 'documentCheck',
    to: 'moreInfo',
    kind: 'moreInfo',
    roles: ['officer', 'supervisor'],
    comment: true,
  },
  {
    key: 'rejectIncomplete',
    en: 'Reject as incomplete',
    ar: 'رفض لعدم الاكتمال',
    from: 'documentCheck',
    to: 'rejected',
    kind: 'reject',
    roles: ['officer', 'supervisor'],
    comment: true,
  },
  {
    key: 'informationProvided',
    en: 'Information provided',
    ar: 'تم تقديم المعلومات',
    from: 'moreInfo',
    to: 'documentCheck',
    kind: 'forward',
    roles: ['citizen'],
    attachment: true,
  },
  {
    key: 'recommendApproval',
    en: 'Recommend approval',
    ar: 'التوصية بالاعتماد',
    from: 'technicalReview',
    to: 'supervisorApproval',
    kind: 'forward',
    roles: ['officer'],
    comment: true,
  },
  {
    key: 'escalate',
    en: 'Escalate',
    ar: 'تصعيد',
    from: 'technicalReview',
    to: 'escalated',
    kind: 'escalate',
    roles: ['officer'],
    comment: true,
  },
  {
    key: 'rejectTechnical',
    en: 'Reject on technical grounds',
    ar: 'رفض لأسباب فنية',
    from: 'technicalReview',
    to: 'rejected',
    kind: 'reject',
    roles: ['officer', 'supervisor'],
    comment: true,
  },
  {
    key: 'resolveEscalation',
    en: 'Resolve escalation',
    ar: 'إنهاء التصعيد',
    from: 'escalated',
    to: 'supervisorApproval',
    kind: 'forward',
    roles: ['supervisor'],
    comment: true,
  },
  {
    key: 'approve',
    en: 'Approve',
    ar: 'اعتماد',
    from: 'supervisorApproval',
    to: 'issuance',
    kind: 'forward',
    roles: ['supervisor'],
  },
  {
    key: 'returnForReview',
    en: 'Return for review',
    ar: 'إعادة للمراجعة',
    from: 'supervisorApproval',
    to: 'technicalReview',
    kind: 'moreInfo',
    roles: ['supervisor'],
    comment: true,
  },
  {
    key: 'rejectApproval',
    en: 'Refuse',
    ar: 'رفض',
    from: 'supervisorApproval',
    to: 'rejected',
    kind: 'reject',
    roles: ['supervisor'],
    comment: true,
  },
  {
    key: 'issue',
    en: 'Issue outcome',
    ar: 'إصدار النتيجة',
    from: 'issuance',
    to: 'completed',
    kind: 'forward',
    roles: ['officer', 'supervisor'],
  },
];

// -----------------------------------------------------------------------------
// Licensing: adds a field inspection between the technical review and approval.
// -----------------------------------------------------------------------------

const LICENSING_STATES: readonly StateSeed[] = [
  ...STANDARD_STATES.filter((state) => state.key !== 'escalated').map((state) =>
    state.column >= 3 ? { ...state, column: state.column + 1 } : state,
  ),
  {
    key: 'inspection',
    en: 'Field inspection',
    ar: 'المعاينة الميدانية',
    kind: 'task',
    stage: 'review',
    assigneeRole: 'officer',
    slaHours: 72,
    column: 3,
    row: 1,
  },
];

const LICENSING_TRANSITIONS: readonly TransitionSeed[] = [
  ...STANDARD_TRANSITIONS.filter(
    (transition) =>
      transition.from !== 'technicalReview' &&
      transition.from !== 'escalated' &&
      transition.key !== 'returnForReview',
  ),
  {
    key: 'scheduleInspection',
    en: 'Schedule inspection',
    ar: 'تحديد موعد المعاينة',
    from: 'technicalReview',
    to: 'inspection',
    kind: 'forward',
    roles: ['officer'],
    comment: true,
  },
  {
    key: 'rejectTechnical',
    en: 'Reject on technical grounds',
    ar: 'رفض لأسباب فنية',
    from: 'technicalReview',
    to: 'rejected',
    kind: 'reject',
    roles: ['officer', 'supervisor'],
    comment: true,
  },
  {
    key: 'inspectionPassed',
    en: 'Inspection passed',
    ar: 'اجتياز المعاينة',
    from: 'inspection',
    to: 'supervisorApproval',
    kind: 'forward',
    roles: ['officer'],
    comment: true,
    attachment: true,
  },
  {
    key: 'inspectionFailed',
    en: 'Inspection failed',
    ar: 'عدم اجتياز المعاينة',
    from: 'inspection',
    to: 'rejected',
    kind: 'reject',
    roles: ['officer'],
    comment: true,
  },
  {
    key: 'returnForInspection',
    en: 'Return for inspection',
    ar: 'إعادة للمعاينة',
    from: 'supervisorApproval',
    to: 'inspection',
    kind: 'moreInfo',
    roles: ['supervisor'],
    comment: true,
  },
];

// -----------------------------------------------------------------------------
// Civil document: a short process for certificates that need no technical review.
// -----------------------------------------------------------------------------

const CIVIL_STATES: readonly StateSeed[] = [
  {
    key: 'submitted',
    en: 'Submitted',
    ar: 'مُقدَّم',
    kind: 'start',
    stage: 'submission',
    assigneeRole: null,
    slaHours: null,
    column: 0,
    row: 1,
  },
  {
    key: 'documentCheck',
    en: 'Record check',
    ar: 'فحص السجل',
    kind: 'task',
    stage: 'review',
    assigneeRole: 'officer',
    slaHours: 16,
    column: 1,
    row: 1,
  },
  {
    key: 'moreInfo',
    en: 'Awaiting applicant',
    ar: 'بانتظار مقدّم الطلب',
    kind: 'task',
    stage: 'review',
    assigneeRole: 'citizen',
    slaHours: 120,
    column: 1,
    row: 2,
  },
  {
    key: 'supervisorApproval',
    en: 'Authorisation',
    ar: 'الإجازة',
    kind: 'decision',
    stage: 'approval',
    assigneeRole: 'supervisor',
    slaHours: 8,
    column: 2,
    row: 1,
  },
  {
    key: 'issuance',
    en: 'Issuance',
    ar: 'الإصدار',
    kind: 'task',
    stage: 'completion',
    assigneeRole: 'officer',
    slaHours: 8,
    column: 3,
    row: 1,
  },
  {
    key: 'completed',
    en: 'Completed',
    ar: 'منجز',
    kind: 'end',
    stage: 'completion',
    assigneeRole: null,
    slaHours: null,
    column: 4,
    row: 1,
  },
  {
    key: 'rejected',
    en: 'Rejected',
    ar: 'مرفوض',
    kind: 'end',
    stage: 'completion',
    assigneeRole: null,
    slaHours: null,
    column: 4,
    row: 2,
  },
];

const CIVIL_TRANSITIONS: readonly TransitionSeed[] = [
  {
    key: 'beginReview',
    en: 'Begin review',
    ar: 'بدء المراجعة',
    from: 'submitted',
    to: 'documentCheck',
    kind: 'forward',
    roles: ['officer', 'supervisor'],
  },
  {
    key: 'recordsMatch',
    en: 'Records match',
    ar: 'مطابقة السجل',
    from: 'documentCheck',
    to: 'supervisorApproval',
    kind: 'forward',
    roles: ['officer'],
    guard: 'allRequiredDocumentsVerified',
  },
  {
    key: 'requestInformation',
    en: 'Request information',
    ar: 'طلب معلومات',
    from: 'documentCheck',
    to: 'moreInfo',
    kind: 'moreInfo',
    roles: ['officer'],
    comment: true,
  },
  {
    key: 'informationProvided',
    en: 'Information provided',
    ar: 'تم تقديم المعلومات',
    from: 'moreInfo',
    to: 'documentCheck',
    kind: 'forward',
    roles: ['citizen'],
    attachment: true,
  },
  {
    key: 'rejectIncomplete',
    en: 'Reject as incomplete',
    ar: 'رفض لعدم الاكتمال',
    from: 'documentCheck',
    to: 'rejected',
    kind: 'reject',
    roles: ['officer', 'supervisor'],
    comment: true,
  },
  {
    key: 'approve',
    en: 'Authorise',
    ar: 'إجازة',
    from: 'supervisorApproval',
    to: 'issuance',
    kind: 'forward',
    roles: ['supervisor'],
  },
  {
    key: 'rejectApproval',
    en: 'Refuse',
    ar: 'رفض',
    from: 'supervisorApproval',
    to: 'rejected',
    kind: 'reject',
    roles: ['supervisor'],
    comment: true,
  },
  {
    key: 'issue',
    en: 'Issue certificate',
    ar: 'إصدار الشهادة',
    from: 'issuance',
    to: 'completed',
    kind: 'forward',
    roles: ['officer', 'supervisor'],
  },
];

function makeVersion(
  workflowKey: string,
  version: number,
  status: WorkflowVersion['status'],
  createdAt: string,
  publishedAt: string | null,
  notes: { en: string; ar: string } | null,
  states: readonly StateSeed[],
  transitions: readonly TransitionSeed[],
): WorkflowVersion {
  return {
    id: `${workflowKey}-v${version}`,
    version,
    status,
    createdAt,
    publishedAt,
    notes,
    states: buildStates(`${workflowKey}-v${version}`, states),
    transitions: buildTransitions(`${workflowKey}-v${version}`, transitions),
  };
}

export const WORKFLOW_KEYS = {
  standard: 'standard-approval',
  licensing: 'licence-issuance',
  civil: 'civil-document',
} as const;

export const WORKFLOW_DEFINITIONS: readonly WorkflowDefinition[] = [
  {
    id: 'wf-standard-approval',
    key: WORKFLOW_KEYS.standard,
    name: { en: 'Standard approval', ar: 'الاعتماد القياسي' },
    description: {
      en: 'General purpose process: document check, technical review, supervisor approval, issuance. Carries the escalation branch.',
      ar: 'مسار عام: فحص المستندات، مراجعة فنية، اعتماد المشرف، ثم الإصدار. يتضمن مسار التصعيد.',
    },
    departmentId: DEPARTMENT_IDS.civilAffairs,
    versions: [
      makeVersion(
        WORKFLOW_KEYS.standard,
        1,
        'archived',
        '2024-01-15T08:00:00.000Z',
        '2024-02-01T08:00:00.000Z',
        {
          en: 'First release. No escalation branch.',
          ar: 'الإصدار الأول. بدون مسار التصعيد.',
        },
        STANDARD_STATES.filter((state) => state.key !== 'escalated'),
        STANDARD_TRANSITIONS.filter(
          (transition) => transition.from !== 'escalated' && transition.key !== 'escalate',
        ),
      ),
      makeVersion(
        WORKFLOW_KEYS.standard,
        2,
        'published',
        '2025-05-02T08:00:00.000Z',
        '2025-06-01T08:00:00.000Z',
        {
          en: 'Adds the escalation branch and a 24 hour limit on the document check.',
          ar: 'إضافة مسار التصعيد وحد ٢٤ ساعة لفحص المستندات.',
        },
        STANDARD_STATES,
        STANDARD_TRANSITIONS,
      ),
      makeVersion(
        WORKFLOW_KEYS.standard,
        3,
        'draft',
        '2026-08-11T08:00:00.000Z',
        null,
        {
          en: 'Draft under review: tightens the supervisor approval window to 16 hours.',
          ar: 'مسودة قيد الدراسة: تقليص مدة اعتماد المشرف إلى ١٦ ساعة.',
        },
        STANDARD_STATES.map((state) =>
          state.key === 'supervisorApproval' ? { ...state, slaHours: 16 } : state,
        ),
        STANDARD_TRANSITIONS,
      ),
    ],
  },
  {
    id: 'wf-licence-issuance',
    key: WORKFLOW_KEYS.licensing,
    name: { en: 'Licence issuance', ar: 'إصدار التراخيص' },
    description: {
      en: 'Used where a physical premises must be inspected before a licence can be granted.',
      ar: 'يُستخدم عندما يتطلب الترخيص معاينة الموقع قبل منحه.',
    },
    departmentId: DEPARTMENT_IDS.commerce,
    versions: [
      makeVersion(
        WORKFLOW_KEYS.licensing,
        1,
        'published',
        '2025-03-10T08:00:00.000Z',
        '2025-04-01T08:00:00.000Z',
        {
          en: 'Adds a field inspection between technical review and approval.',
          ar: 'إضافة معاينة ميدانية بين المراجعة الفنية والاعتماد.',
        },
        LICENSING_STATES,
        LICENSING_TRANSITIONS,
      ),
    ],
  },
  {
    id: 'wf-civil-document',
    key: WORKFLOW_KEYS.civil,
    name: { en: 'Civil document', ar: 'الوثائق المدنية' },
    description: {
      en: 'Short process for certificates issued from an existing record, with no technical review.',
      ar: 'مسار قصير للشهادات الصادرة عن سجل قائم، بدون مراجعة فنية.',
    },
    departmentId: DEPARTMENT_IDS.civilAffairs,
    versions: [
      makeVersion(
        WORKFLOW_KEYS.civil,
        1,
        'published',
        '2025-01-08T08:00:00.000Z',
        '2025-01-20T08:00:00.000Z',
        null,
        CIVIL_STATES,
        CIVIL_TRANSITIONS,
      ),
    ],
  },
];

/** The version a new request is filed against. */
export function publishedVersion(definition: WorkflowDefinition): WorkflowVersion {
  const published = definition.versions.find((version) => version.status === 'published');
  return published ?? definition.versions[definition.versions.length - 1];
}

/**
 * Workflow definitions currently in play.
 *
 * The fixtures below are the starting point, so the interface works with no
 * backend. When the app runs against the API, the definitions it fetches are
 * registered here instead: they describe workflow versions this build has never
 * seen, and without them an officer would be offered no actions at all, because
 * the transitions available on a case come from its definition rather than from
 * a hardcoded list.
 */
const registry = new Map<string, WorkflowDefinition>(
  WORKFLOW_DEFINITIONS.map((definition) => [definition.key, definition]),
);

/** Replaces what is known about a workflow with the authoritative server copy. */
export function registerWorkflows(definitions: readonly WorkflowDefinition[]): void {
  for (const definition of definitions) {
    registry.set(definition.key, definition);
  }
}

export function findWorkflow(key: string): WorkflowDefinition | undefined {
  return registry.get(key);
}

export function findVersion(key: string, version: number): WorkflowVersion | undefined {
  const workflow = findWorkflow(key);
  if (!workflow) return undefined;

  return (
    workflow.versions.find((candidate) => candidate.version === version) ??
    workflow.versions.find((candidate) => candidate.status === 'published') ??
    workflow.versions[workflow.versions.length - 1]
  );
}

export function findState(
  version: WorkflowVersion,
  stateKey: string,
): WorkflowState | undefined {
  return version.states.find((state) => state.key === stateKey);
}

/** Transitions leaving a state, in definition order. */
export function outgoingTransitions(
  version: WorkflowVersion,
  stateKey: string,
): readonly WorkflowTransition[] {
  return version.transitions.filter((transition) => transition.fromStateKey === stateKey);
}
