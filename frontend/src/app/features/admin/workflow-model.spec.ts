import { WorkflowState, WorkflowTransition, WorkflowVersion } from '../../core/models/domain';
import {
  isOnlyStartState,
  nextStateId,
  reachableStateKeys,
  transitionsTouching,
  validateWorkflow,
  withState,
  withTransition,
  withoutState,
  withoutTransition,
} from './workflow-model';

function makeState(key: string, overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    id: `state-${key}`,
    key,
    name: { en: key, ar: key },
    kind: 'task',
    stage: 'review',
    assigneeRole: 'officer',
    slaHours: null,
    column: 0,
    row: 0,
    ...overrides,
  };
}

function makeTransition(
  from: string,
  to: string,
  overrides: Partial<WorkflowTransition> = {},
): WorkflowTransition {
  return {
    id: `transition-${from}-${to}`,
    key: `${from}To${to}`,
    label: { en: `${from} to ${to}`, ar: `${from} to ${to}` },
    fromStateKey: from,
    toStateKey: to,
    kind: 'forward',
    allowedRoles: ['officer'],
    guard: null,
    requiresComment: false,
    requiresAttachment: false,
    ...overrides,
  };
}

function makeVersion(
  states: readonly WorkflowState[],
  transitions: readonly WorkflowTransition[],
): WorkflowVersion {
  return {
    id: 'draft-v1',
    version: 1,
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    publishedAt: null,
    notes: null,
    states,
    transitions,
  };
}

/** start -> review -> done, with a "more information" loop off the review. */
const STATES: readonly WorkflowState[] = [
  makeState('start', { kind: 'start' }),
  makeState('review'),
  makeState('moreInfo'),
  makeState('done', { kind: 'end' }),
];

const TRANSITIONS: readonly WorkflowTransition[] = [
  makeTransition('start', 'review'),
  makeTransition('review', 'moreInfo'),
  makeTransition('moreInfo', 'review'),
  makeTransition('review', 'done'),
];

describe('reachableStateKeys', () => {
  it('follows transitions forward from the start state', () => {
    const reached = reachableStateKeys(STATES, TRANSITIONS);
    expect([...reached].sort()).toEqual(['done', 'moreInfo', 'review', 'start']);
  });

  it('leaves out a state nothing points at', () => {
    const states = [...STATES, makeState('orphan')];
    const reached = reachableStateKeys(states, TRANSITIONS);

    expect(reached.has('orphan')).toBe(false);
    expect(reached.has('review')).toBe(true);
  });

  it('leaves out a state that can only be left, never entered', () => {
    const states = [...STATES, makeState('orphan')];
    const transitions = [...TRANSITIONS, makeTransition('orphan', 'done')];

    expect(reachableStateKeys(states, transitions).has('orphan')).toBe(false);
  });

  it('terminates on a cycle rather than following it forever', () => {
    const states = [
      makeState('start', { kind: 'start' }),
      makeState('a'),
      makeState('b'),
      makeState('end', { kind: 'end' }),
    ];
    const transitions = [
      makeTransition('start', 'a'),
      makeTransition('a', 'b'),
      makeTransition('b', 'a'),
      makeTransition('b', 'end'),
    ];

    expect(reachableStateKeys(states, transitions).size).toBe(4);
  });

  it('ignores a transition pointing at a state that no longer exists', () => {
    // A dangling reference must not make an orphan look connected.
    const states = [makeState('start', { kind: 'start' }), makeState('orphan')];
    const transitions = [makeTransition('start', 'deleted'), makeTransition('deleted', 'orphan')];

    expect([...reachableStateKeys(states, transitions)]).toEqual(['start']);
  });

  it('walks from every start state when a draft has more than one', () => {
    const states = [
      makeState('first', { kind: 'start' }),
      makeState('second', { kind: 'start' }),
      makeState('afterSecond'),
    ];
    const transitions = [makeTransition('second', 'afterSecond')];

    expect(reachableStateKeys(states, transitions).has('afterSecond')).toBe(true);
  });

  it('reaches nothing when there is no start state', () => {
    const states = STATES.map((state) => ({ ...state, kind: 'task' as const }));
    expect(reachableStateKeys(states, TRANSITIONS).size).toBe(0);
  });
});

describe('validateWorkflow', () => {
  it('reports nothing for a well formed draft', () => {
    expect(validateWorkflow(STATES, TRANSITIONS)).toEqual([]);
  });

  it('flags a state that cannot be reached from the start', () => {
    const states = [...STATES, makeState('orphan')];
    const transitions = [...TRANSITIONS, makeTransition('orphan', 'done')];

    const codes = validateWorkflow(states, transitions).map((finding) => finding.code);
    expect(codes).toContain('unreachable');
    expect(
      validateWorkflow(states, transitions).find((finding) => finding.code === 'unreachable')
        ?.stateKey,
    ).toBe('orphan');
  });

  it('flags a non end state with nowhere to go', () => {
    const states = [...STATES, makeState('deadEnd')];
    const transitions = [...TRANSITIONS, makeTransition('review', 'deadEnd')];

    const finding = validateWorkflow(states, transitions).find(
      (candidate) => candidate.code === 'noOutgoing',
    );
    expect(finding?.stateKey).toBe('deadEnd');
  });

  it('does not flag an end state for having no outgoing transition', () => {
    const codes = validateWorkflow(STATES, TRANSITIONS).map((finding) => finding.code);
    expect(codes).not.toContain('noOutgoing');
  });

  it('reports a duplicated key once, not once per copy', () => {
    const states = [...STATES, makeState('review', { id: 'state-review-copy' })];
    const duplicates = validateWorkflow(states, TRANSITIONS).filter(
      (finding) => finding.code === 'duplicateKey',
    );

    expect(duplicates.length).toBe(1);
    expect(duplicates[0].stateKey).toBe('review');
  });

  it('reports a missing start state without also calling every state unreachable', () => {
    const states = STATES.map((state) => ({ ...state, kind: 'task' as const }));
    const codes = validateWorkflow(states, TRANSITIONS).map((finding) => finding.code);

    expect(codes).toContain('noStart');
    expect(codes).not.toContain('unreachable');
  });

  it('reports a missing end state', () => {
    const states = STATES.map((state) =>
      state.kind === 'end' ? { ...state, kind: 'task' as const } : state,
    );
    const codes = validateWorkflow(states, TRANSITIONS).map((finding) => finding.code);

    expect(codes).toContain('noEnd');
  });
});

describe('workflow edits', () => {
  const version = makeVersion(STATES, TRANSITIONS);

  it('lists the transitions a state would take with it', () => {
    expect(transitionsTouching(version, 'review').map((transition) => transition.id)).toEqual([
      'transition-start-review',
      'transition-review-moreInfo',
      'transition-moreInfo-review',
      'transition-review-done',
    ]);
  });

  it('removes a state together with every transition that mentions it', () => {
    const next = withoutState(version, 'moreInfo');

    expect(next.states.map((state) => state.key)).toEqual(['start', 'review', 'done']);
    expect(next.transitions.map((transition) => transition.id)).toEqual([
      'transition-start-review',
      'transition-review-done',
    ]);
  });

  it('leaves the version it was given untouched', () => {
    withoutState(version, 'moreInfo');
    expect(version.states.length).toBe(4);
  });

  it('adds a state without disturbing the transitions', () => {
    const next = withState(version, makeState('extra'), null);

    expect(next.states.map((state) => state.key)).toContain('extra');
    expect(next.transitions).toEqual(version.transitions);
  });

  it('rewrites transition references when a key is renamed', () => {
    const renamed = { ...makeState('secondReview'), id: 'state-review' };
    const next = withState(version, renamed, 'review');

    expect(next.states.map((state) => state.key)).toEqual([
      'start',
      'secondReview',
      'moreInfo',
      'done',
    ]);
    expect(next.transitions.map((transition) => transition.fromStateKey)).toEqual([
      'start',
      'secondReview',
      'moreInfo',
      'secondReview',
    ]);
    expect(next.transitions[0].toStateKey).toBe('secondReview');
  });

  it('replaces a transition in place and appends a new one', () => {
    const edited = { ...makeTransition('start', 'review'), key: 'begin' };
    expect(withTransition(version, edited).transitions.length).toBe(4);
    expect(withTransition(version, edited).transitions[0].key).toBe('begin');

    const added = makeTransition('start', 'done');
    expect(withTransition(version, added).transitions.length).toBe(5);
  });

  it('removes a transition by id', () => {
    const next = withoutTransition(version, 'transition-review-done');
    expect(next.transitions.map((transition) => transition.id)).not.toContain(
      'transition-review-done',
    );
  });

  it('protects the last start state', () => {
    expect(isOnlyStartState(version, 'start')).toBe(true);
    expect(isOnlyStartState(version, 'review')).toBe(false);

    const twoStarts = withState(version, makeState('second', { kind: 'start' }), null);
    expect(isOnlyStartState(twoStarts, 'start')).toBe(false);
  });

  it('keeps generated ids unique even when a key is reused', () => {
    const first = nextStateId(version, 'issued');
    expect(first).toBe('draft-v1-state-issued');

    const withFirst = withState(version, { ...makeState('issued'), id: first }, null);
    expect(nextStateId(withFirst, 'issued')).toBe('draft-v1-state-issued-2');
  });
});
