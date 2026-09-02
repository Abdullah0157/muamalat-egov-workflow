import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { Button } from '../../shared/ui/button/button';
import { ErrorState } from '../../shared/ui/error-state/error-state';

/** Unknown address. Offers the way back rather than a dead end. */
@Component({
  selector: 'app-not-found-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ErrorState, Button],
  host: { class: 'page' },
  template: `
    <app-error-state
      tone="notFound"
      [title]="i18n.t('errors.notFoundTitle')"
      [description]="i18n.t('errors.notFoundDescription')"
      [retryable]="false"
    >
      <app-button errorStateAction variant="primary" icon="home" (pressed)="goHome()">
        {{ i18n.t('errors.goHome') }}
      </app-button>
    </app-error-state>
  `,
})
export class NotFoundPage {
  protected readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected goHome(): void {
    void this.router.navigateByUrl(this.auth.homeRoute());
  }
}
