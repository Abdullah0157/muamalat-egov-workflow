import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { Role } from '../../core/models/domain';
import { Button } from '../../shared/ui/button/button';
import { ErrorState } from '../../shared/ui/error-state/error-state';

/**
 * Shown when a signed in user reaches an area their role cannot open.
 *
 * It names the role the area needs and the role they hold, because "access
 * denied" on its own tells someone nothing they can act on. The route carries
 * both facts as query parameters, which arrive here as component inputs.
 */
@Component({
  selector: 'app-permission-denied-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ErrorState, Button],
  host: { class: 'page' },
  template: `
    <app-error-state
      tone="permission"
      [title]="i18n.t('errors.permissionDeniedTitle')"
      [description]="description()"
      [retryable]="false"
    >
      <app-button errorStateAction variant="primary" icon="home" (pressed)="goHome()">
        {{ i18n.t('errors.goHome') }}
      </app-button>
      <app-button errorStateAction variant="secondary" icon="user" (pressed)="switchAccount()">
        {{ i18n.t('errors.switchAccount') }}
      </app-button>
    </app-error-state>
  `,
})
export class PermissionDeniedPage {
  /** Comma separated list of roles the guard was protecting. */
  readonly required = input<string | undefined>(undefined);

  protected readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly description = computed(() => {
    const requiredRoles = (this.required() ?? '')
      .split(',')
      .map((role) => role.trim())
      .filter((role): role is Role => role.length > 0)
      .map((role) => this.i18n.t(`roles.${role}`));

    const current = this.auth.role();
    return this.i18n.t('errors.permissionDeniedDescription', {
      required: requiredRoles.join(', ') || this.i18n.t('common.notAvailable'),
      current: current ? this.i18n.t(`roles.${current}`) : this.i18n.t('common.notAvailable'),
    });
  });

  protected goHome(): void {
    void this.router.navigateByUrl(this.auth.homeRoute());
  }

  protected switchAccount(): void {
    this.auth.signOut();
    void this.router.navigate(['/sign-in']);
  }
}
