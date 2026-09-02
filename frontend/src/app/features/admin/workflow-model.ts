import {
  Role,
  TransitionKind,
  WorkflowState,
  WorkflowStateKind,
  WorkflowTransition,
  WorkflowVersion,
} from '../../core/models/domain';

/**
 * The rules the designer edits by, as plain functions over a version.
 *
 * None of this touches Angular. A workflow is a directed graph, the questions
 * worth asking about one are graph questions, and keeping them here means they
 * can be tested against a handful of literal states rather than through a
 * rendered canvas. Every mutation returns a new `WorkflowVersion` instead of
 * changing the record that came out of the gateway, so the page can hold the
 * draft in a signal, compare it with what was loaded, and discard it by
 * throwing the signal away.
 */

export const WORKFLOW_STATE_KINDS: readonly WorkflowStateKind[] = [
  'start',
  'task',
  'decision',
  'end',
];

export const TRANSITION_KINDS: readonly TransitionKind[] = [
  'forward',
  'reject',
  'moreInfo',
  'escalate',
];

/**
 * Findings carry a code and the record they are about, never a sentence. The
 * catalogue owns the wording, and a spec can assert on `unreachable` without
 * being rewritten when the copy changes.
 */
export type ValidationCode =
  | 'noStart'
  | 'noEnd'
  | 'duplicateKey'
  | 'unreachable'
  | 'noOutgoing';

export interface ValidationFinding {
  readonly id: string;
  readonly code: ValidationCode;
  /** The state the finding is about. Null for the two whole graph findings. */
  readonly state: WorkflowState | null;
  /** Set for `duplicateKey`, where the key matters more than any one state. */
  readonly stateKey: string | null;
}

/**
 * Every state a case can actually arrive at, walking forwards from the start
 * states.
 *
 * This is the check most likely to be wrong, so it is deliberately the smallest
 * thing in this file. Three details matter. Transitions pointing at a state
 * that has since been deleted lead nowhere and are skipped, otherwise a dangling
 * reference would keep a genuinely orphaned state looking healthy. More than one
 * start state is allowed, because a draft mid edit can have two and reporting
 * every state as unreachable while the administrator is adding the second one
 * would be noise. And the walk is breadth first over an index rather than
 * recursive, so a workflow with a loop in it (every real one has at least the
 * "more information" loop) terminates.
 */
export function reachableStateKeys(
  states: readonly WorkflowState[],
  transitions: readonly WorkflowTransition[],
): ReadonlySet<string> {
  const known = new Set(states.map((state) => state.key));

  const outgoing = new Map<string, string[]>();
  for (const transition of transitions) {
    if (!known.has(transition.fromStateKey) || !known.has(transition.toStateKey)) {
      continue;
    }
    const targets = outgoing.get(transition.fromStateKey);
    if (targets) {
      targets.push(transition.toStateKey);
    } else {
      outgoing.set(transition.fromStateKey, [transition.toStateKey]);
    }
  }

  const reached = new Set<string>();
  const queue: string[] = [];
  for (const state of states) {
    if (state.kind === 'start' && !reached.has(state.key)) {
      reached.add(state.key);
      queue.push(state.key);
    }
  }

  for (let index = 0; index < queue.length; index += 1) {
    for (const target of outgoing.get(queue[index]) ?? []) {
      if (!reached.has(target)) {
        reached.add(target);
        queue.push(target);
      }
    }
  }

  return reached;
}

/**
 * Everything wrong with a draft, ordered from the structural problems to the
 * ones about a single state, which is the order an administrator would fix them
 * in.
 *
 * The unreachable check is skipped when there is no start state at all: with
 * nothing to walk from, every state is trivially unreachable, and burying
 * "there is no start state" under nine consequences of it helps nobody.
 */
export function validateWorkflow(
  states: readonly WorkflowState[],
  transitions: readonly WorkflowTransition[],
): readonly ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  const hasStart = states.some((state) => state.kind === 'start');
  if (!hasStart) {
    findings.push({ id: 'noStart', code: 'noStart', state: null, stateKey: null });
  }
  if (!states.some((state) => state.kind === 'end')) {
    findings.push({ id: 'noEnd', code: 'noEnd', state: null, stateKey: null });
  }

  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const state of states) {
    if (seen.has(state.key) && !reported.has(state.key)) {
      reported.add(state.key);
      findings.push({
        id: `duplicateKey:${state.key}`,
        code: 'duplicateKey',
        state,
        stateKey: state.key,
      });
    }
    seen.add(state.key);
  }

  if (hasStart) {
    const reachable = reachableStateKeys(states, transitions);
    for (const state of states) {
      if (!reachable.has(state.key)) {
        findings.push({
          id: `unreachable:${state.id}`,
          code: 'unreachable',
          state,
          stateKey: state.key,
        });
      }
    }
  }

  const departures = new Set(transitions.map((transition) => transition.fromStateKey));
  for (const state of states) {
    if (state.kind !== 'end' && !departures.has(state.key)) {
      findings.push({
        id: `noOutgoing:${state.id}`,
        code: 'noOutgoing',
        state,
        stateKey: state.key,
      });
    }
  }

  return findings;
}

/** Transitions that leave or arrive at a state, which is what a delete takes with it. */
export function transitionsTouching(
  version: WorkflowVersion,
  stateKey: string,
): readonly WorkflowTransition[] {
  return version.transitions.filter(
    (transition) => transition.fromStateKey === stateKey || transition.toStateKey === stateKey,
  );
}

/**
 * A start state is the only entry point a running case has, so the last one
 * cannot be removed. Adding a replacement first is a deliberate two step.
 */
export function isOnlyStartState(version: WorkflowVersion, stateKey: string): boolean {
  const starts = version.states.filter((state) => state.kind === 'start');
  return starts.length === 1 && starts[0].key === stateKey;
}

/**
 * Adds or replaces a state.
 *
 * `replacingKey` is the key the state carried before the edit. When the key
 * changed, every transition that referenced the old one is rewritten, because a
 * rename that silently orphaned half the diagram would be the worst possible
 * outcome of a one character correction.
 */
export function withState(
  version: WorkflowVersion,
  state: WorkflowState,
  replacingKey: string | null,
): WorkflowVersion {
  const exists = version.states.some((candidate) => candidate.id === state.id);
  const states = exists
    ? version.states.map((candidate) => (candidate.id === state.id ? state : candidate))
    : [...version.states, state];

  const renamed = replacingKey !== null && replacingKey !== state.key;
  const transitions = renamed
    ? version.transitions.map((transition) => ({
        ...transition,
        fromStateKey:
          transition.fromStateKey === replacingKey ? state.key : transition.fromStateKey,
        toStateKey: transition.toStateKey === replacingKey ? state.key : transition.toStateKey,
      }))
    : version.transitions;

  return { ...version, states, transitions };
}

/** Removes a state together with every transition that mentions it. */
export function withoutState(version: WorkflowVersion, stateKey: string): WorkflowVersion {
  return {
    ...version,
    states: version.states.filter((state) => state.key !== stateKey),
    transitions: version.transitions.filter(
      (transition) =>
        transition.fromStateKey !== stateKey && transition.toStateKey !== stateKey,
    ),
  };
}

export function withTransition(
  version: WorkflowVersion,
  transition: WorkflowTransition,
): WorkflowVersion {
  const exists = version.transitions.some((candidate) => candidate.id === transition.id);
  return {
    ...version,
    transitions: exists
      ? version.transitions.map((candidate) =>
          candidate.id === transition.id ? transition : candidate,
        )
      : [...version.transitions, transition],
  };
}

export function withoutTransition(
  version: WorkflowVersion,
  transitionId: string,
): WorkflowVersion {
  return {
    ...version,
    transitions: version.transitions.filter((transition) => transition.id !== transitionId),
  };
}

/**
 * Ids follow the shape the seeded definitions use, so a state added in the
 * designer is indistinguishable from one that shipped with the workflow. The
 * numeric suffix only appears when a key is reused, which is an invalid draft
 * the validator already reports; unique ids simply keep the rendered list from
 * collapsing two entries into one while it is being corrected.
 */
export function nextStateId(version: WorkflowVersion, key: string): string {
  return uniqueId(
    `${version.id}-state-${key}`,
    new Set(version.states.map((state) => state.id)),
  );
}

export function nextTransitionId(version: WorkflowVersion, key: string): string {
  return uniqueId(
    `${version.id}-transition-${key}`,
    new Set(version.transitions.map((transition) => transition.id)),
  );
}

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) {
    return base;
  }
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

/** The column a new state is dropped into: past everything, so it never overlaps. */
export function nextFreeColumn(version: WorkflowVersion): number {
  return version.states.reduce((furthest, state) => Math.max(furthest, state.column + 1), 0);
}

/** Roles a new transition starts with, so the form opens on a workable default. */
export const DEFAULT_TRANSITION_ROLES: readonly Role[] = ['officer'];
