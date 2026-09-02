import { ServiceRequest, SlaState, SlaStatus } from '../models/domain';

/**
 * A case is flagged at risk once three quarters of its window has gone. That
 * threshold is a policy decision rather than a technical one, so it lives here
 * as a named constant and is used by the queue, the dashboard and the chips.
 */
export const AT_RISK_THRESHOLD = 0.75;

/**
 * Terminal statuses. `approved` is deliberately absent: a decision has been
 * taken but the outcome has not been issued, so the case is still open work and
 * still consuming its service level window.
 */
export const CLOSED_STATUSES: ReadonlySet<string> = new Set([
  'rejected',
  'completed',
  'cancelled',
]);

export function isClosed(request: ServiceRequest): boolean {
  return CLOSED_STATUSES.has(request.status);
}

export function isOpen(request: ServiceRequest): boolean {
  return !isClosed(request);
}

/**
 * Derives the service level state of a request.
 *
 * A closed case is judged against the moment it closed, not against now, so a
 * case that finished inside its window keeps reading as met however long ago it
 * was. An unsubmitted draft has no window at all.
 */
export function slaStateFor(request: ServiceRequest, now: Date): SlaState {
  if (!request.submittedAt || !request.dueAt) {
    return { status: 'notApplicable', remainingMs: null, dueAt: null, elapsedFraction: 0 };
  }

  const submittedAt = new Date(request.submittedAt).getTime();
  const dueAt = new Date(request.dueAt).getTime();
  const windowMs = Math.max(1, dueAt - submittedAt);
  const reference = request.closedAt ? new Date(request.closedAt).getTime() : now.getTime();
  const remainingMs = dueAt - reference;
  const elapsedFraction = Math.min(1, Math.max(0, (reference - submittedAt) / windowMs));

  if (isClosed(request)) {
    return {
      status: remainingMs >= 0 ? 'met' : 'breached',
      remainingMs,
      dueAt: request.dueAt,
      elapsedFraction,
    };
  }

  let status: SlaStatus;
  if (remainingMs < 0) {
    status = 'breached';
  } else if (elapsedFraction >= AT_RISK_THRESHOLD) {
    status = 'atRisk';
  } else {
    status = 'onTrack';
  }

  return { status, remainingMs, dueAt: request.dueAt, elapsedFraction };
}

/** Milliseconds a closed case took from submission to closure. */
export function processingTimeMs(request: ServiceRequest): number | null {
  if (!request.submittedAt || !request.closedAt) {
    return null;
  }
  return new Date(request.closedAt).getTime() - new Date(request.submittedAt).getTime();
}

/**
 * Time spent in each workflow state, read off the history.
 *
 * The final open state is measured up to `now`, which is what makes a case that
 * has been sitting in one state for a week show up in the bottleneck table.
 */
export function dwellTimesByState(
  request: ServiceRequest,
  now: Date,
): ReadonlyMap<string, number> {
  const dwell = new Map<string, number>();
  const transitions = request.history.filter(
    (entry) => entry.action === 'transition' && entry.toStateKey !== null,
  );
  if (transitions.length === 0) {
    return dwell;
  }

  for (let index = 0; index < transitions.length; index += 1) {
    const entry = transitions[index];
    const stateKey = entry.toStateKey;
    if (!stateKey) {
      continue;
    }
    const enteredAt = new Date(entry.at).getTime();
    const next = transitions[index + 1];
    const leftAt = next ? new Date(next.at).getTime() : closingReference(request, now);
    const elapsed = Math.max(0, leftAt - enteredAt);
    dwell.set(stateKey, (dwell.get(stateKey) ?? 0) + elapsed);
  }

  return dwell;
}

function closingReference(request: ServiceRequest, now: Date): number {
  return request.closedAt ? new Date(request.closedAt).getTime() : now.getTime();
}

/** Adds a number of hours to an instant. */
export function addHours(from: Date | string, hours: number): Date {
  const base = from instanceof Date ? from.getTime() : new Date(from).getTime();
  return new Date(base + hours * 3600_000);
}
