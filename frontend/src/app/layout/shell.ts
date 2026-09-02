import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

import { AuthService } from '../core/auth/auth.service';
import { I18nService } from '../core/i18n/i18n.service';
import { LANGUAGE_CONFIG, SUPPORTED_LANGUAGES, Language } from '../core/i18n/i18n.types';
import { Icon } from '../shared/ui/icon/icon';
import { IconButton } from '../shared/ui/icon-button/icon-button';
import { ToastContainer } from '../shared/ui/toast/toast-container';
import { PrimaryNav } from './primary-nav';
import { SettingsDrawer } from './settings-drawer';
import { sectionsForRole } from './nav-model';

/**
 * The application shell.
 *
 * A solid dark masthead over a light worksurface: the arrangement a government
 * system has used since long before the web, and the one that makes it obvious
 * at a glance which parts of the screen are the institution and which parts are
 * the citizen's own file.
 *
 * The navigation is a permanent rail on a desktop and an off canvas panel below
 * the large breakpoint. It closes on navigation, because a menu that stays open
 * over the page you just asked for is a bug on a phone.
 */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, Icon, IconButton, ToastContainer, SettingsDrawer, PrimaryNav],
  styleUrl: './shell.scss',
  host: { class: 'shell-host' },
  template: `
    <a class="u-skip-link" href="#main-content">{{ i18n.t('a11y.skipToContent') }}</a>

    <header class="shell__masthead">
      <div class="shell__masthead-start">
        <app-icon-button
          class="shell__nav-toggle"
          icon="menu"
          [label]="i18n.t('nav.openMenu')"
          variant="ghost"
          [ariaExpanded]="navOpen() ? 'true' : 'false'"
          ariaControls="primary-navigation"
          (pressed)="toggleNav()"
        />

        <a class="shell__brand" [routerLink]="homeRoute()">
          <app-icon name="stamp" size="xl" class="shell__brand-mark" />
          <span class="shell__brand-text">
            <span class="shell__brand-name">{{ i18n.t('app.name') }}</span>
            <span class="shell__brand-authority">{{ i18n.t('app.authority') }}</span>
          </span>
        </a>
      </div>

      <div class="shell__masthead-end">
        <div
          class="shell__language"
          role="group"
          [attr.aria-label]="i18n.t('lang.switch')"
        >
          @for (option of languages; track option) {
            <button
              type="button"
              class="shell__language-option"
              [class.shell__language-option--active]="i18n.language() === option"
              [attr.aria-pressed]="i18n.language() === option"
              [attr.lang]="option"
              [attr.title]="i18n.t('lang.switchTo', { language: languageName(option) })"
              (click)="selectLanguage(option)"
            >
              {{ languageName(option) }}
            </button>
          }
        </div>

        <app-icon-button
          icon="settings"
          [label]="i18n.t('theme.label')"
          variant="ghost"
          ariaHasPopup="dialog"
          (pressed)="settingsOpen.set(true)"
        />
      </div>
    </header>

    @if (i18n.hasLoadFailure()) {
      <p class="shell__notice shell__notice--warning" role="status">
        <app-icon name="alert-triangle" size="sm" />
        <span>{{ i18n.t('lang.loadFailed') }}</span>
      </p>
    }

    <div class="shell__body">
      <!-- The scrim only exists while the off canvas panel is open. -->
      @if (navOpen()) {
        <button
          type="button"
          class="shell__scrim"
          [attr.aria-label]="i18n.t('common.close')"
          (click)="navOpen.set(false)"
        ></button>
      }

      <app-primary-nav
        class="shell__sidebar"
        [class.shell__sidebar--open]="navOpen()"
        [sections]="sections()"
        [user]="auth.user()"
        (signOut)="signOut()"
      />

      <main id="main-content" class="shell__main" tabindex="-1">
        <router-outlet />
      </main>
    </div>

    <app-settings-drawer [(open)]="settingsOpen" />
    <app-toast-container />
  `,
})
export class Shell {
  protected readonly i18n = inject(I18nService);
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly navOpen = signal(false);
  protected readonly settingsOpen = signal(false);
  protected readonly languages = SUPPORTED_LANGUAGES;

  protected readonly sections = computed(() => sectionsForRole(this.auth.role()));
  protected readonly homeRoute = computed(() => this.auth.homeRoute());

  constructor() {
    // Closing the panel on navigation is the difference between a usable phone
    // layout and one where every tap leaves the menu covering the answer.
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => this.navOpen.set(false));
  }

  protected toggleNav(): void {
    this.navOpen.update((open) => !open);
  }

  protected languageName(language: Language): string {
    return LANGUAGE_CONFIG[language].nativeName;
  }

  protected selectLanguage(language: Language): void {
    void this.i18n.setLanguage(language);
  }

  protected signOut(): void {
    this.auth.signOut();
    void this.router.navigate(['/sign-in']);
  }
}
