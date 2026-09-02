import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';

import { I18nService } from '../../core/i18n/i18n.service';
import { TransitionKind, WorkflowState, WorkflowTransition } from '../../core/models/domain';
import { Badge } from '../../shared/ui/badge/badge';
import { nextControlId } from '../../shared/ui/field/field';
import { Icon } from '../../shared/ui/icon/icon';
import {
  StatusPresentation,
  stateKindPresentation,
  transitionPresentation,
} from '../../shared/ui/status/status-presentation';
import { TRANSITION_KINDS } from './workflow-model';

/** A measured node, in pixels relative to the top start corner of the stage. */
export interface NodeBox {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** One routed arrow: the path to draw, and the point its label sits on. */
export interface Wire {
  readonly id: string;
  readonly transition: WorkflowTransition;
  readonly path: string;
  readonly midX: number;
  readonly midY: number;
}

interface CanvasLayout {
  readonly width: number;
  readonly height: number;
  readonly rtl: boolean;
  readonly boxes: ReadonlyMap<string, NodeBox>;
}

const EMPTY_LAYOUT: CanvasLayout = { width: 0, height: 0, rtl: false, boxes: new Map() };

/** Radius of an orthogonal turn. Large enough to read, small enough to stay square. */
const CORNER = 10;

/** Separation between arrows that join the same pair of states in both directions. */
const LANE = 15;

/** How far a self transition bulges out of the block start edge of its state. */
const LOOP = 34;

interface CanvasNode {
  readonly state: WorkflowState;
  readonly kind: StatusPresentation;
  readonly name: string;
  readonly stage: string;
  readonly role: string | null;
  readonly sla: string | null;
}

interface WireView extends Wire {
  readonly kind: StatusPresentation;
  readonly label: string;
  /** Distance from the inline start edge, so the chip lands correctly in Arabic. */
  readonly inlineStart: number;
}

/**
 * The state and transition diagram.
 *
 * Two decisions carry the whole component.
 *
 * The nodes are a CSS grid placed by `grid-column` and `grid-row`, which are
 * logical: column one is the left hand column in English and the right hand one
 * in Arabic, so the diagram mirrors itself with no direction specific code and
 * no second layout to keep in step.
 *
 * The arrows are then drawn from measured element positions rather than from the
 * column and row numbers. Reading `getBoundingClientRect` after the grid has
 * laid itself out means the arrow between two states follows wherever the
 * browser actually put them, which is what makes every arrow point the other way
 * in Arabic for free. Deriving the geometry from the indexes instead would need
 * a mirrored copy of every calculation, and that copy would drift.
 *
 * There is deliberately no drag and drop. A diagram that has to stay readable in
 * two writing directions cannot also be a freeform pinboard, dragging is
 * unusable from a keyboard without a parallel set of commands, and a position
 * typed as two numbers is reviewable in a diff. Position is edited numerically
 * in the state form.
 */
@Component({
  selector: 'app-workflow-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Badge, Icon],
  styleUrl: './workflow-canvas.scss',
  host: { class: 'canvas' },
  template: `
    <div class="canvas__scroll">
      <div
        #stage
        class="canvas__stage"
        role="group"
        [attr.aria-label]="i18n.t('admin.canvasTitle')"
      >
        <svg
          class="canvas__wires"
          aria-hidden="true"
          preserveAspectRatio="none"
          [attr.viewBox]="viewBox()"
        >
          <defs>
            @for (kind of kinds; track kind) {
              <marker
                [attr.id]="markerId(kind)"
                viewBox="0 0 8 8"
                refX="7.2"
                refY="4"
                markerWidth="8"
                markerHeight="8"
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path [attr.class]="'canvas__head canvas__head--' + kind" d="M0.6 0.6 L7.4 4 L0.6 7.4 Z" />
              </marker>
            }
          </defs>

          @for (wire of wires(); track wire.id) {
            <path
              [attr.class]="wireClass(wire)"
              [attr.d]="wire.path"
              [attr.marker-end]="markerRef(wire.transition.kind)"
            />
          }
        </svg>

        <div class="canvas__grid">
          @for (node of nodes(); track node.state.id) {
            <button
              #node
              type="button"
              class="canvas__node"
              aria-haspopup="dialog"
              [attr.data-key]="node.state.key"
              [class.canvas__node--start]="node.state.kind === 'start'"
              [class.canvas__node--end]="node.state.kind === 'end'"
              [class.canvas__node--selected]="node.state.key === selectedStateKey()"
              [attr.aria-current]="node.state.key === selectedStateKey() ? 'true' : null"
              [style.grid-column]="node.state.column + 1"
              [style.grid-row]="node.state.row + 1"
              (click)="stateSelected.emit(node.state)"
            >
              <span class="canvas__node-top">
                <app-badge size="sm" [tone]="node.kind.tone" [icon]="node.kind.icon">
                  {{ i18n.t(node.kind.labelKey) }}
                </app-badge>
              </span>

              <span class="canvas__node-name">{{ node.name }}</span>

              <span class="canvas__node-meta">
                <span class="canvas__node-fact">{{ node.stage }}</span>
                @if (node.role; as role) {
                  <span class="canvas__node-fact">
                    <app-icon name="user" size="sm" />
                    {{ role }}
                  </span>
                }
                @if (node.sla; as sla) {
                  <span class="canvas__node-fact">
                    <app-icon name="clock" size="sm" />
                    {{ sla }}
                  </span>
                }
              </span>
            </button>
          }
        </div>

        <div class="canvas__labels">
          @for (wire of wires(); track wire.id) {
            <span
              class="canvas__anchor"
              [style.inset-inline-start.px]="wire.inlineStart"
              [style.inset-block-start.px]="wire.midY"
            >
              <button
                type="button"
                class="canvas__edge"
                aria-haspopup="dialog"
                [class.canvas__edge--selected]="wire.id === selectedTransitionId()"
                [attr.aria-current]="wire.id === selectedTransitionId() ? 'true' : null"
                (click)="transitionSelected.emit(wire.transition)"
              >
                <app-icon [name]="wire.kind.icon" size="sm" />
                <span class="canvas__edge-label">{{ wire.label }}</span>
              </button>
            </span>
          }
        </div>
      </div>
    </div>
  `,
})
export class WorkflowCanvas {
  readonly states = input.required<readonly WorkflowState[]>();
  readonly transitions = input.required<readonly WorkflowTransition[]>();

  readonly selectedStateKey = input<string | null>(null);
  readonly selectedTransitionId = input<string | null>(null);

  readonly stateSelected = output<WorkflowState>();
  readonly transitionSelected = output<WorkflowTransition>();

  protected readonly i18n = inject(I18nService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly kinds = TRANSITION_KINDS;

  /** Marker ids are document scoped, so they carry an instance suffix. */
  private readonly markerPrefix = nextControlId('wire-head');

  private readonly stageRef = viewChild<ElementRef<HTMLElement>>('stage');
  private readonly nodeRefs = viewChildren<ElementRef<HTMLElement>>('node');

  /**
   * Custom equality rather than a plain signal: `measure` runs after every
   * render pass, and without this a measurement that changed nothing would still
   * publish a new object, re-render, and measure again.
   */
  private readonly layout = signal<CanvasLayout>(EMPTY_LAYOUT, { equal: sameLayout });

  /** Bumped by the observer. The measurement itself reads the DOM, not this. */
  private readonly resized = signal(0);

  protected readonly nodes = computed<readonly CanvasNode[]>(() =>
    this.states().map((state) => ({
      state,
      kind: stateKindPresentation(state.kind),
      name: this.i18n.pick(state.name),
      stage: this.i18n.t(`stage.${state.stage}`),
      role: state.assigneeRole === null ? null : this.i18n.t(`roles.${state.assigneeRole}`),
      sla: state.slaHours === null ? null : this.i18n.plural('units.hours', state.slaHours),
    })),
  );

  protected readonly wires = computed<readonly WireView[]>(() => {
    const layout = this.layout();
    return routeWires(this.transitions(), layout.boxes).map((wire) => ({
      ...wire,
      kind: transitionPresentation(wire.transition.kind),
      label: this.i18n.pick(wire.transition.label),
      // The paths live in physical pixels because an SVG coordinate system does
      // not mirror. The chips are ordinary elements, so they are placed with a
      // logical inset and the physical measurement is converted once, here.
      inlineStart: layout.rtl ? layout.width - wire.midX : wire.midX,
    }));
  });

  protected readonly viewBox = computed(() => {
    const layout = this.layout();
    return `0 0 ${Math.max(1, layout.width)} ${Math.max(1, layout.height)}`;
  });

  constructor() {
    afterNextRender(() => {
      const stage = this.stageRef()?.nativeElement;
      if (!stage || typeof ResizeObserver === 'undefined') {
        return;
      }
      const observer = new ResizeObserver(() => this.resized.update((tick) => tick + 1));
      observer.observe(stage);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });

    // Re-measured after any render that could have moved something: a state
    // added or repositioned, a transition added, the language switched (which
    // mirrors the grid), or the container resized.
    afterRenderEffect(() => {
      this.nodes();
      this.transitions();
      this.i18n.isRtl();
      this.resized();
      this.measure();
    });
  }

  protected markerId(kind: TransitionKind): string {
    return `${this.markerPrefix}-${kind}`;
  }

  protected markerRef(kind: TransitionKind): string {
    return `url(#${this.markerId(kind)})`;
  }

  protected wireClass(wire: WireView): string {
    const selected = wire.id === this.selectedTransitionId() ? ' canvas__wire--selected' : '';
    return `canvas__wire canvas__wire--${wire.transition.kind}${selected}`;
  }

  private measure(): void {
    const stage = this.stageRef()?.nativeElement;
    if (!stage) {
      return;
    }
    const frame = stage.getBoundingClientRect();
    const boxes = new Map<string, NodeBox>();

    for (const ref of this.nodeRefs()) {
      const element = ref.nativeElement;
      const key = element.dataset['key'];
      if (key === undefined) {
        continue;
      }
      const rect = element.getBoundingClientRect();
      boxes.set(key, {
        x1: rect.left - frame.left,
        y1: rect.top - frame.top,
        x2: rect.right - frame.left,
        y2: rect.bottom - frame.top,
      });
    }

    this.layout.set({
      width: frame.width,
      height: frame.height,
      rtl: this.i18n.isRtl(),
      boxes,
    });
  }
}

// -----------------------------------------------------------------------------
// Routing
//
// Exported so the geometry can be tested against literal boxes. Everything here
// works in physical pixels relative to the stage, which is the coordinate system
// an SVG uses in both writing directions.
// -----------------------------------------------------------------------------

export function routeWires(
  transitions: readonly WorkflowTransition[],
  boxes: ReadonlyMap<string, NodeBox>,
): readonly Wire[] {
  // Two states are often joined in both directions (the "more information" loop
  // is exactly that). Counting the pair first lets each arrow take its own lane
  // instead of the two drawing on top of each other.
  const lanes = new Map<string, number>();
  const drawn = new Map<string, number>();
  for (const transition of transitions) {
    const pair = pairKey(transition);
    lanes.set(pair, (lanes.get(pair) ?? 0) + 1);
  }

  const wires: Wire[] = [];
  for (const transition of transitions) {
    const from = boxes.get(transition.fromStateKey);
    const to = boxes.get(transition.toStateKey);
    if (!from || !to) {
      continue;
    }

    const pair = pairKey(transition);
    const index = drawn.get(pair) ?? 0;
    drawn.set(pair, index + 1);
    const offset = (index - ((lanes.get(pair) ?? 1) - 1) / 2) * LANE;

    const geometry =
      transition.fromStateKey === transition.toStateKey
        ? selfLoop(from)
        : routeBetween(from, to, offset);

    wires.push({ id: transition.id, transition, ...geometry });
  }
  return wires;
}

function pairKey(transition: WorkflowTransition): string {
  return [transition.fromStateKey, transition.toStateKey].sort().join(' ');
}

function routeBetween(
  from: NodeBox,
  to: NodeBox,
  offset: number,
): { path: string; midX: number; midY: number } {
  const fromCx = (from.x1 + from.x2) / 2;
  const fromCy = (from.y1 + from.y2) / 2;
  const toCx = (to.x1 + to.x2) / 2;
  const toCy = (to.y1 + to.y2) / 2;

  // A workflow is read along its columns, so leave through the inline edge
  // whenever the two states do not sit above one another.
  const alongInline = to.x1 >= from.x2 || to.x2 <= from.x1;

  if (alongInline) {
    const ahead = toCx > fromCx;
    const sx = ahead ? from.x2 : from.x1;
    const ex = ahead ? to.x1 : to.x2;
    return orthogonal(sx, fromCy + offset, ex, toCy + offset, true);
  }

  const below = toCy > fromCy;
  const sy = below ? from.y2 : from.y1;
  const ey = below ? to.y1 : to.y2;
  return orthogonal(fromCx + offset, sy, toCx + offset, ey, false);
}

/**
 * One turn, taken as a pair of quadratic corners so the arrow reads as drawn
 * rather than as two lines that happen to meet.
 */
function orthogonal(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  alongInline: boolean,
): { path: string; midX: number; midY: number } {
  const midX = (sx + ex) / 2;
  const midY = (sy + ey) / 2;
  const across = alongInline ? ey - sy : ex - sx;

  if (Math.abs(across) < 1) {
    return { path: `M ${round(sx)} ${round(sy)} L ${round(ex)} ${round(ey)}`, midX, midY };
  }

  const along = alongInline ? ex - sx : ey - sy;
  const radius = Math.min(CORNER, Math.abs(along) / 2, Math.abs(across) / 2);
  const alongStep = Math.sign(along) * radius;
  const acrossStep = Math.sign(across) * radius;

  const path = alongInline
    ? [
        `M ${round(sx)} ${round(sy)}`,
        `L ${round(midX - alongStep)} ${round(sy)}`,
        `Q ${round(midX)} ${round(sy)} ${round(midX)} ${round(sy + acrossStep)}`,
        `L ${round(midX)} ${round(ey - acrossStep)}`,
        `Q ${round(midX)} ${round(ey)} ${round(midX + alongStep)} ${round(ey)}`,
        `L ${round(ex)} ${round(ey)}`,
      ].join(' ')
    : [
        `M ${round(sx)} ${round(sy)}`,
        `L ${round(sx)} ${round(midY - alongStep)}`,
        `Q ${round(sx)} ${round(midY)} ${round(sx + acrossStep)} ${round(midY)}`,
        `L ${round(ex - acrossStep)} ${round(midY)}`,
        `Q ${round(ex)} ${round(midY)} ${round(ex)} ${round(midY + alongStep)}`,
        `L ${round(ex)} ${round(ey)}`,
      ].join(' ');

  return { path, midX, midY };
}

/** A transition back into its own state, drawn as a bulge above the node. */
function selfLoop(box: NodeBox): { path: string; midX: number; midY: number } {
  const cx = (box.x1 + box.x2) / 2;
  const top = box.y1;
  return {
    path: [
      `M ${round(cx - LANE)} ${round(top)}`,
      `C ${round(cx - LANE)} ${round(top - LOOP)}`,
      `${round(cx + LANE)} ${round(top - LOOP)}`,
      `${round(cx + LANE)} ${round(top)}`,
    ].join(' '),
    midX: cx,
    midY: top - LOOP * 0.75,
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function sameLayout(a: CanvasLayout, b: CanvasLayout): boolean {
  if (a.width !== b.width || a.height !== b.height || a.rtl !== b.rtl) {
    return false;
  }
  if (a.boxes.size !== b.boxes.size) {
    return false;
  }
  for (const [key, box] of a.boxes) {
    const other = b.boxes.get(key);
    if (
      !other ||
      other.x1 !== box.x1 ||
      other.y1 !== box.y1 ||
      other.x2 !== box.x2 ||
      other.y2 !== box.y2
    ) {
      return false;
    }
  }
  return true;
}
