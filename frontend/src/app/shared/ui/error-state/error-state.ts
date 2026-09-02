import { ChangeDetectionStrategy, Component, booleanAttribute, computed, inject, input, output } from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { Button } from '../button/button';
import { Icon, IconName } from '../icon/icon';

export type ErrorStateTone = 'error' | 'permission' | 'notFound';

/** Three different problems that must not look like the same problem. */
const TONE_ICON: Readonly<Record<ErrorStateTone, IconName>> = {
  error: 'alert-triangle',
  permission: 'shield',
  notFound: 'help',
};

/**
 * What a section shows when it could not load.
 *
 * `description` is required, not optional. "Something went wrong" tells a user
 * nothing about whether their work survived, whether to wait or whether to call
 * anyone, so the caller has to write the sentence that does.
 *
 * A support reference is rendered in the reference style, which pins it left to
 * right and isolates it from the surrounding text. A file number that reorders
 * itself inside an Arabic sentence is a number the service desk cannot use.
 *
 * Slots:
 *   [errorStateAction]  a second action beside "try again", for example "go back"
 */
@Component({
  selector: 'app-error-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Icon],
  styleUrl: './error-state.scss',
  host: {
    class: 'error-state',
    role: 'alert',
    '[class.error-state--permission]': "tone() === 'permission'",
    '[class.error-state--not-found]': "tone() === 'notFound'",
  },
  template: `
    <app-icon [name]="glyph()" size="xl" class="error-state__icon" />

    <h2 class="error-state__title">{{ title() }}</h2>

    <p class="error-state__description">{{ description() }}</p>

    @if (supportReference(); as reference) {
      <p class="error-state__reference">
        <span class="error-state__reference-label">{{ i18n.t('errors.supportReference') }}</span>
        <span class="u-reference">{{ reference }}</span>
      </p>
    }

    <div class="error-state__actions">
      @if (retryable()) {
        <app-button variant="primary" icon="refresh" (pressed)="retry.emit()">
          {{ i18n.t('common.retry') }}
        </app-button>
      }
      <ng-content select="[errorStateAction]" />
    </div>
  `,
})
export class ErrorState {
  /** Already localised. Says what failed, not that "an error occurred". */
  readonly title = input.required<string>();

  /** Already localised. Says what it means for the user and what to do next. */
  readonly description = input.required<string>();

  readonly tone = input<ErrorStateTone>('error');

  /**
   * Off for a problem retrying cannot fix. Offering "try again" for a refused
   * permission just makes people press it twice.
   */
  readonly retryable = input(true, { transform: booleanAttribute });

  readonly supportReference = input<string | null>(null);

  readonly retry = output<void>();

  protected readonly i18n = inject(I18nService);

  protected readonly glyph = computed(() => TONE_ICON[this.tone()]);
}
