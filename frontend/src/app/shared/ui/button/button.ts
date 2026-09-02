import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input, output } from '@angular/core';
import { Params, RouterLink } from '@angular/router';

import { Icon, IconName } from '../icon/icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonType = 'button' | 'submit' | 'reset';

/**
 * The product's only text button.
 *
 * Renders a real `<button>`, so keyboard activation, form submission and
 * assistive technology behaviour come from the platform rather than from
 * handlers. A busy button keeps its label and stays in place, because swapping
 * the label for a spinner moves focus and removes the one piece of context a
 * user needs while waiting.
 */
@Component({
  selector: 'app-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  styleUrl: './button.scss',
  host: {
    class: 'btn-host',
    '[class.btn-host--block]': 'block()',
  },
  template: `
    <!--
      A control that goes somewhere is an anchor, so it gets middle click, open
      in a new tab and a status bar preview. A control that does something is a
      button. Both wear the same clothes; only the element differs.
    -->
    @if (link(); as target) {
      <a
        class="btn"
        [class.btn--primary]="variant() === 'primary'"
        [class.btn--secondary]="variant() === 'secondary'"
        [class.btn--ghost]="variant() === 'ghost'"
        [class.btn--danger]="variant() === 'danger'"
        [class.btn--link]="variant() === 'link'"
        [class.btn--sm]="size() === 'sm'"
        [class.btn--md]="size() === 'md'"
        [class.btn--lg]="size() === 'lg'"
        [class.btn--disabled]="disabled()"
        [routerLink]="target"
        [queryParams]="queryParams()"
        [attr.aria-disabled]="disabled() ? 'true' : null"
        [attr.tabindex]="disabled() ? -1 : null"
      >
        @if (icon(); as leading) {
          <app-icon [name]="leading" [size]="iconSize()" class="btn__icon" />
        }
        <span class="btn__label"><ng-content /></span>
        @if (trailingIcon(); as trailing) {
          <app-icon [name]="trailing" [size]="iconSize()" class="btn__icon" />
        }
      </a>
    } @else {
      <button
        class="btn"
        [class.btn--primary]="variant() === 'primary'"
      [class.btn--secondary]="variant() === 'secondary'"
      [class.btn--ghost]="variant() === 'ghost'"
      [class.btn--danger]="variant() === 'danger'"
      [class.btn--link]="variant() === 'link'"
        [class.btn--sm]="size() === 'sm'"
        [class.btn--md]="size() === 'md'"
        [class.btn--lg]="size() === 'lg'"
        [attr.type]="type()"
        [disabled]="disabled() || busy()"
        [attr.aria-busy]="busy() ? 'true' : null"
        [attr.aria-expanded]="ariaExpanded()"
        [attr.aria-controls]="ariaControls()"
        [attr.aria-haspopup]="ariaHasPopup()"
        (click)="pressed.emit($event)"
      >
        @if (busy()) {
          <app-icon name="spinner" [size]="iconSize()" class="icon--spin btn__icon" />
        } @else if (icon(); as leading) {
          <app-icon [name]="leading" [size]="iconSize()" class="btn__icon" />
        }

        <span class="btn__label"><ng-content /></span>

        @if (trailingIcon(); as trailing) {
          <app-icon [name]="trailing" [size]="iconSize()" class="btn__icon" />
        }
      </button>
    }
  `,
})
export class Button {
  readonly variant = input<ButtonVariant>('secondary');
  readonly size = input<ButtonSize>('md');
  readonly type = input<ButtonType>('button');
  readonly disabled = input(false, { transform: booleanAttribute });

  /** Shows a spinner and blocks activation while an action is in flight. */
  readonly busy = input(false, { transform: booleanAttribute });

  /** Stretches to the width of its container. Used in narrow layouts. */
  readonly block = input(false, { transform: booleanAttribute });

  /**
   * Router target. When set, the control renders as an anchor instead of a
   * button, so navigation keeps middle click, open in a new tab and the
   * browser's own status bar preview. Left null for controls that perform an
   * action rather than navigate.
   */
  readonly link = input<string | unknown[] | null>(null);

  readonly queryParams = input<Params | null>(null);

  readonly icon = input<IconName | null>(null);
  readonly trailingIcon = input<IconName | null>(null);

  readonly ariaExpanded = input<'true' | 'false' | null>(null);
  readonly ariaControls = input<string | null>(null);
  readonly ariaHasPopup = input<'true' | 'menu' | 'dialog' | 'listbox' | null>(null);

  readonly pressed = output<MouseEvent>();

  protected readonly iconSize = computed(() => (this.size() === 'lg' ? 'lg' : 'md'));
}
