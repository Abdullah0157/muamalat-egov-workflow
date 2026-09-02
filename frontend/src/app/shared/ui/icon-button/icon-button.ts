import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input, output } from '@angular/core';

import { Icon, IconName } from '../icon/icon';

export type IconButtonVariant = 'ghost' | 'secondary' | 'danger';
export type IconButtonSize = 'sm' | 'md' | 'lg';
export type IconButtonType = 'button' | 'submit' | 'reset';

/**
 * A button whose entire label is an icon.
 *
 * `label` is required rather than optional. An icon-only control with no
 * accessible name is a defect, not a styling choice, so the type system refuses
 * to let one be built. The same text becomes the `title`, which gives sighted
 * mouse users the tooltip that tells them what the glyph means.
 *
 * Kept separate from `Button` instead of being a mode of it: the target is
 * square, the padding rules are different, and making the label mandatory here
 * is only possible when it is its own component.
 */
@Component({
  selector: 'app-icon-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  styleUrl: './icon-button.scss',
  host: {
    class: 'icon-btn-host',
  },
  template: `
    <button
      class="icon-btn"
      [class.icon-btn--ghost]="variant() === 'ghost'"
      [class.icon-btn--secondary]="variant() === 'secondary'"
      [class.icon-btn--danger]="variant() === 'danger'"
      [class.icon-btn--sm]="size() === 'sm'"
      [class.icon-btn--md]="size() === 'md'"
      [class.icon-btn--lg]="size() === 'lg'"
      [attr.type]="type()"
      [attr.aria-label]="label()"
      [attr.title]="label()"
      [disabled]="disabled()"
      [attr.aria-expanded]="ariaExpanded()"
      [attr.aria-controls]="ariaControls()"
      [attr.aria-haspopup]="ariaHasPopup()"
      [attr.aria-pressed]="ariaPressed()"
      (click)="pressed.emit($event)"
    >
      <app-icon [name]="icon()" [size]="iconSize()" />
    </button>
  `,
})
export class IconButton {
  readonly icon = input.required<IconName>();

  /** Already localised. Becomes the accessible name and the tooltip. */
  readonly label = input.required<string>();

  readonly variant = input<IconButtonVariant>('ghost');
  readonly size = input<IconButtonSize>('md');
  readonly type = input<IconButtonType>('button');
  readonly disabled = input(false, { transform: booleanAttribute });

  readonly ariaExpanded = input<'true' | 'false' | null>(null);
  readonly ariaControls = input<string | null>(null);
  readonly ariaHasPopup = input<'true' | 'menu' | 'dialog' | 'listbox' | null>(null);

  /** Set on a toggle, for example a pinned filter or a collapsed panel. */
  readonly ariaPressed = input<'true' | 'false' | null>(null);

  readonly pressed = output<MouseEvent>();

  protected readonly iconSize = computed(() => (this.size() === 'sm' ? 'sm' : 'md'));
}
