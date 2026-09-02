import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { Icon, IconName } from '../icon/icon';

/**
 * What a list looks like when there is genuinely nothing in it.
 *
 * Empty is usually a fact, not a failure. "Your queue is clear" is the right
 * tone; an apology implies something went wrong and makes people look for it.
 * So there is no illustration, no exclamation, and the copy the caller passes
 * is expected to say what will appear here and when.
 *
 * Slots:
 *   [emptyStateAction]  a single primary action, where one makes sense
 */
@Component({
  selector: 'app-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  styleUrl: './empty-state.scss',
  host: {
    class: 'empty-state',
  },
  template: `
    @if (icon(); as glyph) {
      <app-icon [name]="glyph" size="xl" class="empty-state__icon" />
    }

    <p class="empty-state__title">{{ title() }}</p>

    @if (description(); as text) {
      <p class="empty-state__description">{{ text }}</p>
    }

    <div class="empty-state__action"><ng-content select="[emptyStateAction]" /></div>
  `,
})
export class EmptyState {
  readonly icon = input<IconName | null>(null);

  /** Already localised. States the fact, for example "Your queue is clear". */
  readonly title = input.required<string>();

  readonly description = input<string | null>(null);
}
