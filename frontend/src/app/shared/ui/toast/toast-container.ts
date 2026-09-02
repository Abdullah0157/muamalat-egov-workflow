import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { I18nService } from '../../../core/i18n/i18n.service';
import { Button } from '../button/button';
import { Icon, IconName } from '../icon/icon';
import { IconButton } from '../icon-button/icon-button';
import { Toast, ToastService, ToastTone } from './toast.service';

/** Every tone carries a glyph, so none of them is told by colour alone. */
const TONE_ICON: Readonly<Record<ToastTone, IconName>> = {
  info: 'info',
  success: 'check-circle',
  warning: 'alert-triangle',
  danger: 'alert-circle',
};

/**
 * The toast stack. Rendered once by the application shell, never by a screen.
 *
 * The live region is the container rather than each message, because a region
 * has to exist before content arrives for assistive technology to notice the
 * change. It is polite: a confirmation should wait its turn. Danger toasts
 * carry `role="alert"` individually, which makes only those assertive.
 */
@Component({
  selector: 'app-toast-container',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Icon, IconButton],
  styleUrl: './toast.scss',
  host: {
    class: 'toast-region',
    role: 'region',
    'aria-live': 'polite',
    '[attr.aria-label]': "i18n.t('toast.regionLabel')",
  },
  template: `
    @for (toast of toasts.toasts(); track toast.id) {
      <div
        class="toast"
        [class.toast--info]="toast.tone === 'info'"
        [class.toast--success]="toast.tone === 'success'"
        [class.toast--warning]="toast.tone === 'warning'"
        [class.toast--danger]="toast.tone === 'danger'"
        [attr.role]="toast.tone === 'danger' ? 'alert' : null"
        (mouseenter)="toasts.pause()"
        (mouseleave)="toasts.resume()"
        (focusin)="toasts.pause()"
        (focusout)="toasts.resume()"
      >
        <app-icon [name]="glyphFor(toast)" size="md" class="toast__icon" />

        <div class="toast__content">
          <p class="toast__title">{{ toast.title }}</p>
          @if (toast.description; as detail) {
            <p class="toast__description">{{ detail }}</p>
          }
          @if (toast.action; as action) {
            <app-button variant="link" size="sm" (pressed)="run(toast)">{{ action.label }}</app-button>
          }
        </div>

        <app-icon-button
          class="toast__dismiss"
          icon="close"
          size="sm"
          [label]="i18n.t('toast.dismiss')"
          (pressed)="toasts.dismiss(toast.id)"
        />
      </div>
    }
  `,
})
export class ToastContainer {
  protected readonly i18n = inject(I18nService);
  protected readonly toasts = inject(ToastService);

  protected glyphFor(toast: Toast): IconName {
    return TONE_ICON[toast.tone];
  }

  /** Taking the offered action answers the message, so it goes away with it. */
  protected run(toast: Toast): void {
    toast.action?.run();
    this.toasts.dismiss(toast.id);
  }
}
