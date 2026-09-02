import {
  DocumentVerification,
  RequestPriority,
  RequestStatus,
  SlaStatus,
  TransitionKind,
  WorkflowStateKind,
} from '../../../core/models/domain';
import { BadgeTone } from '../badge/badge';
import { IconName } from '../icon/icon';

export interface StatusPresentation {
  readonly tone: BadgeTone;
  readonly icon: IconName;
  readonly labelKey: string;
}

/**
 * The single place that decides how a domain status looks.
 *
 * Every entry pairs a tone with an icon and a label, so no status is ever
 * distinguishable by colour alone. Screens read from here rather than choosing
 * their own colours, which is what keeps a chip in the officer queue identical
 * to the same chip on the citizen's copy of the request.
 */
export function requestStatusPresentation(status: RequestStatus): StatusPresentation {
  switch (status) {
    case 'draft':
      return { tone: 'neutral', icon: 'edit', labelKey: 'status.draft' };
    case 'submitted':
      return { tone: 'info', icon: 'inbox', labelKey: 'status.submitted' };
    case 'inReview':
      return { tone: 'info', icon: 'eye', labelKey: 'status.inReview' };
    case 'moreInfo':
      return { tone: 'warning', icon: 'return-loop', labelKey: 'status.moreInfo' };
    case 'approved':
      return { tone: 'success', icon: 'check-circle', labelKey: 'status.approved' };
    case 'rejected':
      return { tone: 'danger', icon: 'x-circle', labelKey: 'status.rejected' };
    case 'completed':
      return { tone: 'success', icon: 'stamp', labelKey: 'status.completed' };
    case 'cancelled':
      return { tone: 'neutral', icon: 'close', labelKey: 'status.cancelled' };
  }
}

export function slaPresentation(status: SlaStatus): StatusPresentation {
  switch (status) {
    case 'onTrack':
      return { tone: 'success', icon: 'clock', labelKey: 'sla.onTrack' };
    case 'atRisk':
      return { tone: 'warning', icon: 'hourglass', labelKey: 'sla.atRisk' };
    case 'breached':
      return { tone: 'danger', icon: 'alert-triangle', labelKey: 'sla.breached' };
    case 'met':
      return { tone: 'success', icon: 'check-circle', labelKey: 'sla.met' };
    case 'notApplicable':
      return { tone: 'neutral', icon: 'minus', labelKey: 'sla.notApplicable' };
  }
}

export function priorityPresentation(priority: RequestPriority): StatusPresentation {
  switch (priority) {
    case 'normal':
      return { tone: 'neutral', icon: 'circle', labelKey: 'priority.normal' };
    case 'high':
      return { tone: 'warning', icon: 'arrow-up', labelKey: 'priority.high' };
    case 'urgent':
      return { tone: 'danger', icon: 'urgent', labelKey: 'priority.urgent' };
  }
}

export function verificationPresentation(state: DocumentVerification): StatusPresentation {
  switch (state) {
    case 'pending':
      return { tone: 'neutral', icon: 'clock', labelKey: 'documents.verification.pending' };
    case 'verified':
      return { tone: 'success', icon: 'file-check', labelKey: 'documents.verification.verified' };
    case 'rejected':
      return { tone: 'danger', icon: 'x-circle', labelKey: 'documents.verification.rejected' };
  }
}

export function transitionPresentation(kind: TransitionKind): StatusPresentation {
  switch (kind) {
    case 'forward':
      return { tone: 'brand', icon: 'arrow-next', labelKey: 'transitionKind.forward' };
    case 'reject':
      return { tone: 'danger', icon: 'x-circle', labelKey: 'transitionKind.reject' };
    case 'moreInfo':
      return { tone: 'warning', icon: 'return-loop', labelKey: 'transitionKind.moreInfo' };
    case 'escalate':
      return { tone: 'accent', icon: 'flag', labelKey: 'transitionKind.escalate' };
  }
}

export function stateKindPresentation(kind: WorkflowStateKind): StatusPresentation {
  switch (kind) {
    case 'start':
      return { tone: 'brand', icon: 'circle-dot', labelKey: 'stateKind.start' };
    case 'task':
      return { tone: 'neutral', icon: 'checklist', labelKey: 'stateKind.task' };
    case 'decision':
      return { tone: 'accent', icon: 'workflow', labelKey: 'stateKind.decision' };
    case 'end':
      return { tone: 'success', icon: 'check-circle', labelKey: 'stateKind.end' };
  }
}

export function roleLabelKey(role: string): string {
  return `roles.${role}`;
}
