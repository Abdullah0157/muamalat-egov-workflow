import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { WorkflowState, WorkflowTransition } from '../../core/models/domain';
import { all, el, maybeEl } from '../../shared/testing/dom';
import { setupI18n, testProviders } from '../../shared/testing/i18n';
import { NodeBox, WorkflowCanvas, routeWires } from './workflow-canvas';

function makeState(key: string, overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    id: `state-${key}`,
    key,
    name: { en: key, ar: `${key} ar` },
    kind: 'task',
    stage: 'review',
    assigneeRole: 'officer',
    slaHours: 24,
    column: 1,
    row: 1,
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
    label: { en: `${from} to ${to}`, ar: `${from} to ${to} ar` },
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

const STATES: readonly WorkflowState[] = [
  makeState('submitted', { kind: 'start', column: 0, row: 1, assigneeRole: null, slaHours: null }),
  makeState('review', { column: 1, row: 1 }),
  makeState('done', { kind: 'end', column: 2, row: 1, assigneeRole: null, slaHours: null }),
];

const TRANSITIONS: readonly WorkflowTransition[] = [
  makeTransition('submitted', 'review'),
  makeTransition('review', 'done'),
];

@Component({
  imports: [WorkflowCanvas],
  template: `
    <app-workflow-canvas
      [states]="states()"
      [transitions]="transitions()"
      [selectedStateKey]="selectedStateKey()"
      [selectedTransitionId]="selectedTransitionId()"
      (stateSelected)="pickedState.set($event.key)"
      (transitionSelected)="pickedTransition.set($event.id)"
    />
  `,
})
class Host {
  readonly states = signal<readonly WorkflowState[]>(STATES);
  readonly transitions = signal<readonly WorkflowTransition[]>(TRANSITIONS);
  readonly selectedStateKey = signal<string | null>(null);
  readonly selectedTransitionId = signal<string | null>(null);
  readonly pickedState = signal<string | null>(null);
  readonly pickedTransition = signal<string | null>(null);
}

describe('WorkflowCanvas', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [...testProviders()],
    }).compileComponents();
    await setupI18n();

    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('renders one focusable node per state', () => {
    const nodes = all<HTMLButtonElement>(fixture, '.canvas__node');
    expect(nodes.length).toBe(3);
    expect(nodes.every((node) => node.tagName === 'BUTTON')).toBe(true);
  });

  it('shows the name, the kind, the stage, the owner and the service level on a node', () => {
    const node = all<HTMLElement>(fixture, '.canvas__node')[1];
    const content = node.textContent ?? '';

    expect(content).toContain('review');
    expect(content).toContain('Task');
    expect(content).toContain('Review');
    expect(content).toContain('Officer');
    expect(content).toContain('24 hours');
  });

  it('places nodes with logical grid coordinates, which is what mirrors in Arabic', () => {
    const nodes = all<HTMLElement>(fixture, '.canvas__node');
    expect(nodes[0].style.gridColumnStart).toBe('1');
    expect(nodes[0].style.gridRowStart).toBe('2');
    expect(nodes[2].style.gridColumnStart).toBe('3');
  });

  it('marks the start and end states apart from the rest', () => {
    const nodes = all<HTMLElement>(fixture, '.canvas__node');
    expect(nodes[0].classList).toContain('canvas__node--start');
    expect(nodes[1].classList).not.toContain('canvas__node--start');
    expect(nodes[2].classList).toContain('canvas__node--end');
  });

  it('exposes the selected node through aria-current, not colour alone', async () => {
    fixture.componentInstance.selectedStateKey.set('review');
    fixture.detectChanges();
    await fixture.whenStable();

    const nodes = all<HTMLElement>(fixture, '.canvas__node');
    expect(nodes[1].getAttribute('aria-current')).toBe('true');
    expect(nodes[0].getAttribute('aria-current')).toBeNull();
    expect(nodes[1].classList).toContain('canvas__node--selected');
  });

  it('names the diagram for assistive technology', () => {
    const stage = el(fixture, '.canvas__stage');
    expect(stage.getAttribute('role')).toBe('group');
    expect(stage.getAttribute('aria-label')).toBe('States and transitions');
  });

  it('emits the state when a node is activated', () => {
    all<HTMLButtonElement>(fixture, '.canvas__node')[1].click();
    expect(fixture.componentInstance.pickedState()).toBe('review');
  });

  it('gives every transition a focusable chip that emits when activated', () => {
    const chips = all<HTMLButtonElement>(fixture, '.canvas__edge');
    expect(chips.length).toBe(2);
    expect(chips[0].textContent).toContain('submitted to review');

    chips[1].click();
    expect(fixture.componentInstance.pickedTransition()).toBe('transition-review-done');
  });

  it('draws an arrow for every transition once the nodes have been measured', () => {
    const wires = all<SVGPathElement>(fixture, '.canvas__wire');
    expect(wires.length).toBe(2);
    expect(wires[0].getAttribute('d')?.startsWith('M')).toBe(true);
    expect(wires[0].getAttribute('marker-end')).toContain('url(#');
  });

  it('adds a node and an arrow when the model grows', async () => {
    fixture.componentInstance.states.update((states) => [
      ...states,
      makeState('appeal', { column: 1, row: 2 }),
    ]);
    fixture.componentInstance.transitions.update((transitions) => [
      ...transitions,
      makeTransition('review', 'appeal'),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(all(fixture, '.canvas__node').length).toBe(4);
    expect(all(fixture, '.canvas__wire').length).toBe(3);
  });

  it('keeps the logical placement in Arabic, so the grid does the mirroring', async () => {
    await setupI18n('ar');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const nodes = all<HTMLElement>(fixture, '.canvas__node');
    expect(nodes[0].style.gridColumnStart).toBe('1');
    expect(nodes[2].style.gridColumnStart).toBe('3');
    expect(nodes[1].textContent).toContain('review ar');
    // The chips are placed with a logical inset, so they follow the mirrored grid.
    expect(maybeEl<HTMLElement>(fixture, '.canvas__anchor')?.style.insetInlineStart).toBeTruthy();
  });
});

describe('routeWires', () => {
  const left: NodeBox = { x1: 0, y1: 0, x2: 100, y2: 60 };
  const right: NodeBox = { x1: 200, y1: 0, x2: 300, y2: 60 };
  const below: NodeBox = { x1: 0, y1: 120, x2: 100, y2: 180 };

  function boxes(entries: Record<string, NodeBox>): ReadonlyMap<string, NodeBox> {
    return new Map(Object.entries(entries));
  }

  it('joins two aligned states with a straight line between their facing edges', () => {
    const [wire] = routeWires(
      [makeTransition('a', 'b')],
      boxes({ a: left, b: right }),
    );
    expect(wire.path).toBe('M 100 30 L 200 30');
    expect(wire.midX).toBe(150);
  });

  it('leaves through the near edge when the target is behind the source', () => {
    const [wire] = routeWires([makeTransition('b', 'a')], boxes({ a: left, b: right }));
    expect(wire.path).toBe('M 200 30 L 100 30');
  });

  it('routes along the block axis when the states sit above one another', () => {
    const [wire] = routeWires([makeTransition('a', 'c')], boxes({ a: left, c: below }));
    expect(wire.path).toBe('M 50 60 L 50 120');
  });

  it('turns a corner when the states are on different rows and columns', () => {
    const offset: NodeBox = { x1: 200, y1: 120, x2: 300, y2: 180 };
    const [wire] = routeWires([makeTransition('a', 'd')], boxes({ a: left, d: offset }));

    expect(wire.path.startsWith('M 100 30')).toBe(true);
    expect(wire.path).toContain('Q');
    expect(wire.path.endsWith('L 200 150')).toBe(true);
  });

  it('gives two arrows between the same pair their own lanes', () => {
    const wires = routeWires(
      [makeTransition('a', 'b'), makeTransition('b', 'a')],
      boxes({ a: left, b: right }),
    );

    expect(wires.length).toBe(2);
    expect(wires[0].path).not.toBe(wires[1].path);
    expect(wires[0].midY).not.toBe(wires[1].midY);
  });

  it('skips a transition whose endpoints have not been measured', () => {
    expect(routeWires([makeTransition('a', 'missing')], boxes({ a: left }))).toEqual([]);
  });

  it('draws a transition back into its own state as a loop', () => {
    const [wire] = routeWires([makeTransition('a', 'a')], boxes({ a: left }));
    expect(wire.path.startsWith('M')).toBe(true);
    expect(wire.path).toContain('C');
    expect(wire.midY).toBeLessThan(left.y1);
  });
});
