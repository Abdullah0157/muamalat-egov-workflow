import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Icon, IconName } from '../icon/icon';

export type StatTileTone = 'neutral' | 'success' | 'warning' | 'danger' | 'brand';

/**
 * Movement since the previous period.
 *
 * `good` is separate from `direction` because the two are not the same thing on
 * an operations dashboard: processing time going down is good and breaches going
 * up is bad, and only the caller knows which measure it is looking at.
 */
export interface StatTileTrend {
  readonly direction: 'up' | 'down' | 'flat';

  /** Already localised, for example "12% fewer than last month". */
  readonly label: string;

  readonly good: boolean;
}

/**
 * One figure on a dashboard.
 *
 * The value arrives already formatted, because rounding, currency and the
 * numbering system are decisions the screen makes with `I18nService` rather than
 * a tile guesses. The `hint` is not decoration: a number on a government
 * dashboard that nobody can define is worse than no number, so every tile can
 * say what it counts.
 */
@Component({
  selector: 'app-stat-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, NgTemplateOutlet, RouterLink],
  styleUrl: './stat-tile.scss',
  host: {
    class: 'stat-tile',
    '[class.stat-tile--neutral]': "tone() === 'neutral'",
    '[class.stat-tile--success]': "tone() === 'success'",
    '[class.stat-tile--warning]': "tone() === 'warning'",
    '[class.stat-tile--danger]': "tone() === 'danger'",
    '[class.stat-tile--brand]': "tone() === 'brand'",
  },
  template: `
    <ng-template #body>
      <div class="stat-tile__head">
        @if (icon(); as glyph) {
          <span class="stat-tile__icon"><app-icon [name]="glyph" size="md" /></span>
        }
        <span class="stat-tile__label">{{ label() }}</span>
        @if (link()) {
          <app-icon name="chevron-next" size="md" class="stat-tile__chevron" />
        }
      </div>

      <p class="stat-tile__value">
        <span class="stat-tile__number">{{ value() }}</span>
        @if (unit(); as measure) {
          <span class="stat-tile__unit">{{ measure }}</span>
        }
      </p>

      @if (trend(); as movement) {
        <p
          class="stat-tile__trend"
          [class.stat-tile__trend--good]="movement.good"
          [class.stat-tile__trend--bad]="!movement.good"
        >
          <app-icon [name]="trendIcon()" size="sm" />
          <span>{{ movement.label }}</span>
        </p>
      }

      @if (hint(); as explanation) {
        <p class="stat-tile__hint">{{ explanation }}</p>
      }
    </ng-template>

    @if (link(); as target) {
      <a class="stat-tile__surface stat-tile__surface--link" [routerLink]="target">
        <ng-container [ngTemplateOutlet]="body" />
      </a>
    } @else {
      <div class="stat-tile__surface">
        <ng-container [ngTemplateOutlet]="body" />
      </div>
    }
  `,
})
export class StatTile {
  readonly label = input.required<string>();

  /** Already formatted through `I18nService`, never a raw number. */
  readonly value = input.required<string>();

  /** Short measure shown after the value, for example "hours" or "%". */
  readonly unit = input<string | null>(null);

  /** Small print saying what the figure counts. */
  readonly hint = input<string | null>(null);

  readonly tone = input<StatTileTone>('neutral');
  readonly icon = input<IconName | null>(null);
  readonly trend = input<StatTileTrend | null>(null);

  /**
   * Makes the whole tile a link. The anchor wraps the content rather than
   * sitting beside it, so the tile is one tab stop with one accessible name
   * instead of a card with a stray "view" link in the corner.
   */
  readonly link = input<unknown[] | string | null>(null);

  /** Paired with words from the caller, so direction never rests on the arrow. */
  protected readonly trendIcon = computed<IconName>(() => {
    switch (this.trend()?.direction) {
      case 'up':
        return 'arrow-up';
      case 'down':
        return 'arrow-down';
      default:
        return 'minus';
    }
  });
}
