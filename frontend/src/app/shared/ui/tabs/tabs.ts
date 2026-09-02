import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  booleanAttribute,
  contentChildren,
  effect,
  inject,
  input,
  model,
  signal,
} from '@angular/core';

import { Badge } from '../badge/badge';
import { nextControlId } from '../field/field';
import { Icon, IconName } from '../icon/icon';

/**
 * One tab and its panel.
 *
 * The ids and the selected flag are pushed in by the enclosing `app-tabs`
 * rather than being inputs, because a panel has no meaning on its own and
 * duplicating the wiring is how `aria-controls` ends up pointing at nothing.
 *
 * Shares the tab strip's stylesheet: the panel needs three rules and a second
 * file in this folder would only hide where they live.
 */
@Component({
  selector: 'app-tab-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './tabs.scss',
  host: {
    class: 'tab-panel',
    role: 'tabpanel',
    '[attr.id]': 'panelId()',
    '[attr.aria-labelledby]': 'tabId()',
    // A scrollable panel has to be reachable by keyboard even when it holds no
    // control of its own, which is what the tab stop is for.
    '[attr.tabindex]': 'active() ? 0 : null',
    '[hidden]': '!active()',
  },
  template: `
    @if (active()) {
      <ng-content />
    }
  `,
})
export class TabPanel {
  /** Already localised by the caller: this is a label, not a message key. */
  readonly label = input.required<string>();

  readonly icon = input<IconName | null>(null);
  readonly disabled = input(false, { transform: booleanAttribute });

  /** A short count or state shown after the label, for example "12". */
  readonly badge = input<string | null>(null);

  readonly active = signal(false);
  readonly panelId = signal<string | null>(null);
  readonly tabId = signal<string | null>(null);
}

/**
 * The ARIA tabs pattern, in full.
 *
 * Only the selected panel renders its content, so a tabbed record page does not
 * pay for four panels of forms to show one. Arrow keys move and select in one
 * step (automatic activation), which is the right choice when switching panel
 * is cheap.
 *
 * Arrow keys follow the writing direction, not the key cap. In Arabic the strip
 * runs right to left, so ArrowLeft moves to the next tab. Reading the resolved
 * direction from the element rather than from the active language means the
 * component is also correct inside an island of the opposite direction.
 */
@Component({
  selector: 'app-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Badge, Icon],
  styleUrl: './tabs.scss',
  host: {
    class: 'tabs',
  },
  template: `
    <div class="tabs__strip u-scroll-x">
      <div
        class="tabs__list"
        role="tablist"
        [attr.aria-label]="ariaLabel()"
        (keydown)="handleKeydown($event)"
      >
        @for (panel of panels(); track panel) {
          <button
            type="button"
            class="tabs__tab"
            role="tab"
            [id]="tabIdFor($index)"
            [class.tabs__tab--selected]="$index === selectedIndex()"
            [attr.aria-selected]="$index === selectedIndex()"
            [attr.aria-controls]="panelIdFor($index)"
            [attr.tabindex]="$index === selectedIndex() ? 0 : -1"
            [disabled]="panel.disabled()"
            (click)="select($index)"
          >
            @if (panel.icon(); as glyph) {
              <app-icon [name]="glyph" size="md" />
            }
            <span class="tabs__label">{{ panel.label() }}</span>
            @if (panel.badge(); as count) {
              <app-badge size="sm">{{ count }}</app-badge>
            }
          </button>
        }
      </div>
    </div>

    <div class="tabs__panels"><ng-content /></div>
  `,
})
export class Tabs {
  readonly selectedIndex = model(0);

  /** Names the strip when the surrounding heading does not already. */
  readonly ariaLabel = input<string | null>(null);

  protected readonly panels = contentChildren(TabPanel);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly instanceId = nextControlId('tabs');

  constructor() {
    // One writer for the wiring, so a tab and its panel cannot disagree.
    effect(() => {
      const selected = this.selectedIndex();
      this.panels().forEach((panel, index) => {
        panel.tabId.set(this.tabIdFor(index));
        panel.panelId.set(this.panelIdFor(index));
        panel.active.set(index === selected);
      });
    });
  }

  protected tabIdFor(index: number): string {
    return `${this.instanceId}-tab-${index}`;
  }

  protected panelIdFor(index: number): string {
    return `${this.instanceId}-panel-${index}`;
  }

  protected select(index: number): void {
    if (this.panels()[index]?.disabled()) {
      return;
    }
    this.selectedIndex.set(index);
  }

  protected handleKeydown(event: KeyboardEvent): void {
    const target = this.targetFor(event.key);
    if (target === null) {
      return;
    }
    event.preventDefault();
    this.select(target);
    this.focusTab(target);
  }

  private targetFor(key: string): number | null {
    if (this.panels().length === 0) {
      return null;
    }
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      const forwardKey = this.isRtl() ? 'ArrowLeft' : 'ArrowRight';
      return this.step(key === forwardKey ? 1 : -1);
    }
    if (key === 'Home') {
      return this.edge(1);
    }
    if (key === 'End') {
      return this.edge(-1);
    }
    return null;
  }

  /** Wraps around the ends and steps over disabled tabs. */
  private step(delta: number): number | null {
    const panels = this.panels();
    let index = this.selectedIndex();
    for (let attempt = 0; attempt < panels.length; attempt += 1) {
      index = (index + delta + panels.length) % panels.length;
      if (!panels[index].disabled()) {
        return index;
      }
    }
    return null;
  }

  private edge(direction: number): number | null {
    const panels = this.panels();
    const order = panels.map((_, index) => (direction > 0 ? index : panels.length - 1 - index));
    return order.find((index) => !panels[index].disabled()) ?? null;
  }

  private focusTab(index: number): void {
    this.host.nativeElement.querySelector<HTMLElement>(`#${this.tabIdFor(index)}`)?.focus();
  }

  private isRtl(): boolean {
    return getComputedStyle(this.host.nativeElement).direction === 'rtl';
  }
}
