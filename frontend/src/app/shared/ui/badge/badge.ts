import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';

import { Icon, IconName } from '../icon/icon';

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
export type BadgeSize = 'sm' | 'md';

/**
 * Status chip.
 *
 * The chip always carries a word. Where a status is also encoded by colour, an
 * icon is passed as well, so the meaning survives greyscale printing, low
 * contrast displays and colour vision deficiency. There is deliberately no
 * dot-only variant for this reason.
 */
@Component({
  selector: 'app-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  styleUrl: './badge.scss',
  host: {
    class: 'badge',
    '[class.badge--neutral]': "tone() === 'neutral'",
    '[class.badge--brand]': "tone() === 'brand'",
    '[class.badge--success]': "tone() === 'success'",
    '[class.badge--warning]': "tone() === 'warning'",
    '[class.badge--danger]': "tone() === 'danger'",
    '[class.badge--info]': "tone() === 'info'",
    '[class.badge--accent]': "tone() === 'accent'",
    '[class.badge--sm]': "size() === 'sm'",
    '[class.badge--solid]': 'solid()',
  },
  template: `
    @if (icon(); as glyph) {
      <app-icon [name]="glyph" size="sm" class="badge__icon" />
    }
    <span class="badge__label"><ng-content /></span>
  `,
})
export class Badge {
  readonly tone = input<BadgeTone>('neutral');
  readonly size = input<BadgeSize>('md');
  readonly icon = input<IconName | null>(null);

  /** Filled treatment. Reserved for the single most important chip on a row. */
  readonly solid = input(false, { transform: booleanAttribute });
}
