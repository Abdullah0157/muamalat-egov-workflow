import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { OidcService } from '../../core/auth/oidc.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { LANGUAGE_CONFIG, SUPPORTED_LANGUAGES, Language } from '../../core/i18n/i18n.types';
import { User } from '../../core/models/domain';
import { Badge } from '../../shared/ui/badge/badge';
import { Icon } from '../../shared/ui/icon/icon';

/**
 * Account selection.
 *
 * There is no identity provider behind this build, so presenting a username and
 * password box would be theatre and would train people to type credentials into
 * a prototype. The screen says plainly what it is and offers the four accounts
 * the platform is built around.
 */
@Component({
  selector: 'app-sign-in-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Badge],
  styleUrl: './sign-in-page.scss',
  host: { class: 'sign-in-host' },
  template: `
    <div class="sign-in">
      <header class="sign-in__masthead">
        <div class="sign-in__brand">
          <app-icon name="stamp" size="xl" class="sign-in__mark" />
          <div>
            <p class="sign-in__name">{{ i18n.t('app.name') }}</p>
            <p class="sign-in__authority">{{ i18n.t('app.authority') }}</p>
          </div>
        </div>

        <div class="sign-in__language" role="group" [attr.aria-label]="i18n.t('lang.switch')">
          @for (option of languages; track option) {
            <button
              type="button"
              class="sign-in__language-option"
              [class.sign-in__language-option--active]="i18n.language() === option"
              [attr.aria-pressed]="i18n.language() === option"
              [attr.lang]="option"
              (click)="selectLanguage(option)"
            >
              {{ languageName(option) }}
            </button>
          }
        </div>
      </header>

      <main class="sign-in__panel">
        <h1 class="sign-in__title">{{ i18n.t('auth.signInTitle') }}</h1>
        <p class="sign-in__intro">{{ i18n.t('auth.signInIntro') }}</p>

        <!--
          The real way in. The demo accounts below exist so the interface can be
          explored without an identity provider, and are labelled as such rather
          than presented as equivalent options.
        -->
        <button
          type="button"
          class="sign-in__provider"
          [disabled]="redirecting()"
          (click)="signInWithProvider()"
        >
          {{ redirecting() ? i18n.t('auth.redirecting') : i18n.t('auth.signInWithProvider') }}
        </button>

        <h2 class="sign-in__legend">{{ i18n.t('auth.chooseRole') }}</h2>
        <p class="sign-in__hint">{{ i18n.t('auth.roleHint') }}</p>

        <ul class="sign-in__accounts">
          @for (account of accounts; track account.id) {
            <li>
              <button
                type="button"
                class="sign-in__account"
                [disabled]="busyId() !== null"
                (click)="choose(account)"
              >
                <span class="sign-in__account-main">
                  <span class="sign-in__account-name">{{ i18n.pick(account.name) }}</span>
                  @if (account.jobTitle; as title) {
                    <span class="sign-in__account-title">{{ i18n.pick(title) }}</span>
                  }
                  <span class="sign-in__account-description">
                    {{ i18n.t('roles.' + account.role + 'Description') }}
                  </span>
                </span>
                <span class="sign-in__account-side">
                  <app-badge tone="brand" size="sm">{{ i18n.t('roles.' + account.role) }}</app-badge>
                  @if (busyId() === account.id) {
                    <app-icon name="spinner" size="md" class="icon--spin" />
                  } @else {
                    <app-icon name="chevron-next" size="md" />
                  }
                </span>
              </button>
            </li>
          }
        </ul>
      </main>

      <footer class="sign-in__footer">
        <app-icon name="info" size="sm" />
        <p>{{ i18n.t('app.prototypeNotice') }}</p>
      </footer>
    </div>
  `,
})
export class SignInPage {
  protected readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly oidc = inject(OidcService);

  protected readonly accounts = this.auth.accounts;
  protected readonly languages = SUPPORTED_LANGUAGES;
  protected readonly busyId = signal<string | null>(null);
  protected readonly redirecting = signal(false);

  /**
   * Hands the browser to Keycloak. The deep link the visitor originally asked
   * for is carried through the redirect so authentication does not cost them
   * their place.
   */
  protected signInWithProvider(): void {
    this.redirecting.set(true);
    const returnTo = this.route.snapshot.queryParamMap.get('returnTo');
    void this.oidc.signIn(returnTo ?? undefined);
  }

  protected languageName(language: Language): string {
    return LANGUAGE_CONFIG[language].nativeName;
  }

  protected selectLanguage(language: Language): void {
    void this.i18n.setLanguage(language);
  }

  protected choose(account: User): void {
    this.busyId.set(account.id);
    this.auth.signIn(account.id);
    // Return the visitor to whatever they originally asked for, if that address
    // is still something their new role can reach.
    const returnTo = this.route.snapshot.queryParamMap.get('returnTo');
    const target = returnTo && returnTo.startsWith(this.auth.homeRoute(account.role))
      ? returnTo
      : this.auth.homeRoute(account.role);
    void this.router.navigateByUrl(target);
  }
}
