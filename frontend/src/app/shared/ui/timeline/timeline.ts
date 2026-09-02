import { ChangeDetectionStrategy, Component, booleanAttribute, inject, input } from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { Icon, IconName } from '../icon/icon';

export type TimelineTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

export interface TimelineItem {
  readonly id: string;

  /** Already localised. Usually a `historyAction.*` message. */
  readonly title: string;

  readonly description?: string | null;

  /** Who did it, and in what role. The audit trail is worth little without it. */
  readonly meta?: string | null;

  /** ISO instant. Rendered in the reader's locale and calendar. */
  readonly timestamp: string;

  readonly icon?: IconName;
  readonly tone?: TimelineTone;
}

/**
 * Vertical activity history.
 *
 * This is the audit trail on a case file, so it is an ordered list rather than a
 * stack of divs, and every entry carries a real `<time>` element with a machine
 * readable `datetime`. Each timestamp is shown twice: the exact date and time,
 * which is what someone quotes to the service desk, and a relative form, which
 * is what tells them at a glance whether anything has happened today.
 *
 * The order is the caller's decision. A history read newest first and a history
 * read oldest first are both correct in different places, and sorting here would
 * silently override whichever the screen chose.
 */
@Component({
  selector: 'app-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  styleUrl: './timeline.scss',
  host: {
    class: 'timeline',
    '[class.timeline--dense]': 'dense()',
  },
  template: `
    <ol class="timeline__list" [attr.aria-label]="i18n.t('a11y.timeline')">
      @for (item of items(); track item.id) {
        <li class="timeline__item">
          <span
            class="timeline__marker"
            [class.timeline__marker--brand]="item.tone === 'brand'"
            [class.timeline__marker--success]="item.tone === 'success'"
            [class.timeline__marker--warning]="item.tone === 'warning'"
            [class.timeline__marker--danger]="item.tone === 'danger'"
            aria-hidden="true"
          >
            <app-icon [name]="item.icon ?? 'circle-dot'" size="sm" />
          </span>

          <div class="timeline__content">
            <p class="timeline__title">{{ item.title }}</p>

            @if (item.description) {
              <p class="timeline__description">{{ item.description }}</p>
            }

            @if (item.meta) {
              <p class="timeline__meta">{{ item.meta }}</p>
            }

            <time class="timeline__time" [attr.datetime]="item.timestamp">
              <span>{{ i18n.formatDateTime(item.timestamp) }}</span>
              <span class="timeline__relative">{{ i18n.formatRelative(item.timestamp) }}</span>
            </time>
          </div>
        </li>
      }
    </ol>
  `,
})
export class Timeline {
  readonly items = input<readonly TimelineItem[]>([]);

  /** Compact rhythm for a side panel or a long history on a detail page. */
  readonly dense = input(false, { transform: booleanAttribute });

  protected readonly i18n = inject(I18nService);
}
