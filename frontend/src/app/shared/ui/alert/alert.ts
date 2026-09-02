import { ChangeDetectionStrategy, Component, booleanAttribute, computed, inject, input, output } from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { Icon, IconName } from '../icon/icon';
import { IconButton } from '../icon-button/icon-button';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

/** Every tone has a glyph, so the meaning survives greyscale and colour blindness. */
const TONE_ICON: Readonly<Record<AlertTone, IconName>> = {
  info: 'info',
  success: 'check-circle',
  warning: 'alert-triangle',
  danger: 'alert-circle',
};

/**
 * An inline message that belongs to the page rather than floating over it.
 *
 * A danger alert is announced immediately (`role="alert"`); the rest are polite
 * status updates, because interrupting a user to tell them something succeeded
 * is worse than letting them reach it in their own time.
 *
 * Dismissing only raises `dismissed`. The owner of the message decides whether
 * it goes away, since a banner that removes itself cannot be brought back.
 *
 * Slots:
 *   default        message body
 *   [alertActions] controls under the message
 */
@Component({
  selector: 'app-alert',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, IconButton],
  styleUrl: './alert.scss',
  host: {
    class: 'alert',
    '[attr.role]': "tone() === 'danger' ? 'alert' : 'status'",
    '[class.alert--info]': "tone() === 'info'",
    '[class.alert--success]': "tone() === 'success'",
    '[class.alert--warning]': "tone() === 'warning'",
    '[class.alert--danger]': "tone() === 'danger'",
  },
  template: `
    <app-icon [name]="glyph()" size="md" class="alert__icon" />

    <div class="alert__content">
      @if (heading(); as text) {
        <p class="alert__heading">{{ text }}</p>
      }
      <div class="alert__body"><ng-content /></div>
      <div class="alert__actions"><ng-content select="[alertActions]" /></div>
    </div>

    @if (dismissible()) {
      <app-icon-button
        class="alert__dismiss"
        icon="close"
        size="sm"
        [label]="i18n.t('common.close')"
        (pressed)="dismissed.emit()"
      />
    }
  `,
})
export class Alert {
  readonly tone = input<AlertTone>('info');

  /** Already localised. One short line; the detail goes in the body. */
  readonly heading = input<string | null>(null);

  /** Overrides the tone glyph where a more specific one reads better. */
  readonly icon = input<IconName | null>(null);

  readonly dismissible = input(false, { transform: booleanAttribute });

  readonly dismissed = output<void>();

  protected readonly i18n = inject(I18nService);

  protected readonly glyph = computed(() => this.icon() ?? TONE_ICON[this.tone()]);
}
