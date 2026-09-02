import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { OidcService } from '../../core/auth/oidc.service';
import { I18nService } from '../../core/i18n/i18n.service';

/**
 * Lands the browser after Keycloak redirects back, exchanges the authorization
 * code for tokens, and forwards the user to wherever they were originally
 * heading.
 *
 * Deliberately has no visible chrome beyond a status line. This route exists for
 * a fraction of a second on success, and dressing it up would produce a flash of
 * layout before the real screen arrives.
 */
@Component({
  selector: 'app-auth-callback',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="callback" role="status" aria-live="polite">
      @if (error(); as message) {
        <h1 class="callback__title">{{ i18n.t('auth.callback.failedTitle') }}</h1>
        <p class="callback__message">{{ message }}</p>
        <button type="button" class="callback__retry" (click)="retry()">
          {{ i18n.t('auth.callback.retry') }}
        </button>
      } @else {
        <p class="callback__message">{{ i18n.t('auth.callback.signingIn') }}</p>
      }
    </main>
  `,
  styles: `
    .callback {
      display: grid;
      gap: var(--space-4);
      justify-items: center;
      align-content: center;
      min-block-size: 60vh;
      padding-inline: var(--space-6);
      text-align: center;
    }

    .callback__title {
      font-size: var(--text-xl);
      font-weight: 600;
    }

    .callback__message {
      color: var(--color-text-muted);
      max-inline-size: 46ch;
    }

    .callback__retry {
      font: inherit;
      cursor: pointer;
      padding: var(--space-2) var(--space-4);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-md);
      background: var(--color-surface);
      color: var(--color-text);
    }

    .callback__retry:focus-visible {
      outline: 2px solid var(--color-focus);
      outline-offset: 2px;
    }
  `,
})
export class AuthCallback {
  private readonly oidc = inject(OidcService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly i18n = inject(I18nService);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.complete();
  }

  private async complete(): Promise<void> {
    try {
      const { returnTo } = await this.oidc.completeSignIn(window.location.search);

      const claims = this.oidc.currentClaims();
      if (!claims) {
        this.error.set(this.i18n.t('auth.callback.noClaims'));
        return;
      }

      const user = this.auth.signInFromClaims(claims);

      // replaceUrl keeps the callback out of history, so the browser back
      // button does not return the user to a URL carrying a spent code.
      await this.router.navigateByUrl(returnTo ?? this.auth.homeRoute(user.role), {
        replaceUrl: true,
      });
    } catch (cause) {
      this.error.set(cause instanceof Error ? cause.message : String(cause));
    }
  }

  protected retry(): void {
    void this.oidc.signIn();
  }
}
