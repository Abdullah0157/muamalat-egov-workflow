import { I18nService } from '../../core/i18n/i18n.service';
import { findDepartment, findService } from '../../core/data/service-catalogue';
import { findVersion, outgoingTransitions } from '../../core/data/workflow-definitions';
import {
  HistoryEntry,
  Role,
  ServiceRequest,
  WORKFLOW_STAGES,
  WorkflowStage,
  WorkflowTransition,
  WorkflowVersion,
} from '../../core/models/domain';
import { IconName } from '../../shared/ui/icon/icon';

/**
 * Turns a stored request into the shapes the shared components render.
 *
 * The citizen's progress tracker and the officer's audit trail are two views of
 * the same record, so both are built here rather than in each screen. That is
 * also what guarantees a stage reads the same on the citizen's copy as it does
 * on the officer's.
 */

export interface StageStep {
  readonly id: string;
  readonly label: string;
  readonly description: string | null;
  readonly state: 'complete' | 'current' | 'upcoming' | 'blocked';
  readonly meta: string | null;
}

export interface HistoryItem {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly meta: string | null;
  readonly timestamp: string;
  readonly icon: IconName;
  readonly tone: 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
}

export function versionFor(request: ServiceRequest): WorkflowVersion | undefined {
  return findVersion(request.workflowKey, request.workflowVersion);
}

export function serviceFor(request: ServiceRequest) {
  return findService(request.serviceId);
}

export function departmentFor(request: ServiceRequest) {
  return findDepartment(request.departmentId);
}

/** The stage a request has reached, or `submission` when nothing matches. */
export function currentStage(request: ServiceRequest): WorkflowStage {
  const version = versionFor(request);
  const state = version?.states.find((candidate) => candidate.key === request.currentStateKey);
  return state?.stage ?? 'submission';
}

/**
 * Four steps for the citizen facing tracker.
 *
 * A rejected or closed case marks every stage up to and including completion,
 * because the file really did reach the end; the outcome is carried by the meta
 * line and by the status chip beside the tracker, not by hiding a step.
 */
export function buildStageSteps(request: ServiceRequest, i18n: I18nService): StageStep[] {
  const stage = currentStage(request);
  const currentIndex = WORKFLOW_STAGES.indexOf(stage);
  const version = versionFor(request);
  const closed = request.closedAt !== null;
  const awaitingApplicant = request.status === 'moreInfo';

  return WORKFLOW_STAGES.map((candidate, index) => {
    let state: StageStep['state'];
    if (closed) {
      state = 'complete';
    } else if (index < currentIndex) {
      state = 'complete';
    } else if (index === currentIndex) {
      state = awaitingApplicant ? 'blocked' : 'current';
    } else {
      state = 'upcoming';
    }

    return {
      id: candidate,
      label: i18n.t(`stage.${candidate}`),
      description: i18n.t(`stage.${candidate}Hint`),
      state,
      meta: stageMeta(request, version, candidate, state, i18n),
    };
  });
}

function stageMeta(
  request: ServiceRequest,
  version: WorkflowVersion | undefined,
  stage: WorkflowStage,
  state: StageStep['state'],
  i18n: I18nService,
): string | null {
  if (state === 'upcoming') {
    return null;
  }
  if (state === 'blocked') {
    return i18n.t('status.moreInfo');
  }
  if (!version) {
    return null;
  }

  // The moment the file first entered this stage, read off the history.
  const entry = request.history.find((candidate) => {
    if (!candidate.toStateKey) {
      return false;
    }
    const target = version.states.find((s) => s.key === candidate.toStateKey);
    return target?.stage === stage;
  });

  return entry ? i18n.formatDate(entry.at) : null;
}

/**
 * The audit trail, newest first. Comments are folded in alongside transitions
 * so the record reads as one sequence rather than two lists a reader has to
 * merge in their head.
 */
export function buildHistoryItems(request: ServiceRequest, i18n: I18nService): HistoryItem[] {
  const version = versionFor(request);

  const fromHistory: HistoryItem[] = request.history.map((entry) => ({
    id: entry.id,
    title: historyTitle(entry, version, i18n),
    description: entry.comment,
    meta: `${i18n.pick(entry.actorName)}, ${i18n.t(`roles.${entry.actorRole}`)}`,
    timestamp: entry.at,
    ...historyAppearance(entry),
  }));

  const fromComments: HistoryItem[] = request.comments
    // A comment recorded alongside a transition is already shown on that entry.
    .filter((comment) => !request.history.some((entry) => entry.comment === comment.body))
    .map((comment) => ({
      id: comment.id,
      title: i18n.t('historyAction.comment'),
      description: comment.body,
      meta: `${i18n.pick(comment.authorName)}, ${i18n.t(`roles.${comment.authorRole}`)}`,
      timestamp: comment.at,
      icon: 'comment' as IconName,
      tone: 'neutral' as const,
    }));

  return [...fromHistory, ...fromComments].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

function historyTitle(
  entry: HistoryEntry,
  version: WorkflowVersion | undefined,
  i18n: I18nService,
): string {
  if (entry.transitionKey && version) {
    const transition = version.transitions.find(
      (candidate) => candidate.key === entry.transitionKey,
    );
    if (transition) {
      return i18n.pick(transition.label);
    }
  }
  return i18n.t(`historyAction.${entry.action}`);
}

function historyAppearance(entry: HistoryEntry): {
  icon: IconName;
  tone: HistoryItem['tone'];
} {
  switch (entry.action) {
    case 'submitted':
    case 'created':
      return { icon: 'send', tone: 'brand' };
    case 'escalated':
      return { icon: 'flag', tone: 'warning' };
    case 'documentVerified':
      return { icon: 'file-check', tone: 'success' };
    case 'documentRejected':
      return { icon: 'x-circle', tone: 'danger' };
    case 'comment':
      return { icon: 'comment', tone: 'neutral' };
    case 'assigned':
      return { icon: 'user', tone: 'neutral' };
    case 'reminderSent':
      return { icon: 'mail', tone: 'neutral' };
    default:
      return { icon: 'arrow-next', tone: 'brand' };
  }
}

/**
 * The transitions a role may take from where the case currently sits.
 *
 * Read straight from the published workflow rather than from a hardcoded list,
 * which is the whole point of having a workflow definition: changing the
 * definition changes the buttons an officer sees.
 */
export function availableTransitions(
  request: ServiceRequest,
  role: Role | null,
): readonly WorkflowTransition[] {
  const version = versionFor(request);
  if (!version || role === null || request.closedAt !== null) {
    return [];
  }
  return outgoingTransitions(version, request.currentStateKey).filter((transition) =>
    transition.allowedRoles.includes(role),
  );
}

/** The role a case is waiting on, for the "no actions available" explanation. */
export function waitingOnRole(request: ServiceRequest): Role | null {
  const version = versionFor(request);
  const state = version?.states.find((candidate) => candidate.key === request.currentStateKey);
  return state?.assigneeRole ?? null;
}

export function stateName(request: ServiceRequest, i18n: I18nService): string {
  const version = versionFor(request);
  const state = version?.states.find((candidate) => candidate.key === request.currentStateKey);
  return state ? i18n.pick(state.name) : request.currentStateKey;
}

export function stateNameByKey(
  version: WorkflowVersion | undefined,
  stateKey: string,
  i18n: I18nService,
): string {
  const state = version?.states.find((candidate) => candidate.key === stateKey);
  return state ? i18n.pick(state.name) : stateKey;
}

/** True when every required document has been verified. */
export function allRequiredDocumentsVerified(request: ServiceRequest): boolean {
  const service = serviceFor(request);
  if (!service) {
    return false;
  }
  return service.documents
    .filter((requirement) => requirement.required)
    .every((requirement) =>
      request.documents.some(
        (document) =>
          document.requirementId === requirement.id && document.verification === 'verified',
      ),
    );
}
