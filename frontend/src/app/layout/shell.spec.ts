import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../core/auth/auth.service';
import { USER_IDS } from '../core/auth/demo-users';
import { I18nService } from '../core/i18n/i18n.service';
import { all, el, maybeEl, text } from '../shared/testing/dom';
import { setupI18n, testProviders } from '../shared/testing/i18n';
import { Shell } from './shell';

describe('Shell', () => {
  let fixture: ComponentFixture<Shell>;
  let auth: AuthService;
  let i18n: I18nService;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function createShell(): Promise<void> {
    fixture = TestBed.createComponent(Shell);
    await render();
  }

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Shell],
      providers: [...testProviders(), provideRouter([])],
    }).compileComponents();
    i18n = await setupI18n();
    auth = TestBed.inject(AuthService);
  });

  it('offers a skip link that reaches the main landmark', async () => {
    await createShell();

    const skip = el<HTMLAnchorElement>(fixture, '.u-skip-link');
    expect(skip.getAttribute('href')).toBe('#main-content');
    expect(skip.textContent?.trim()).toBe('Skip to main content');
    expect(el(fixture, '#main-content').tagName).toBe('MAIN');
  });

  it('renders the institution in the masthead', async () => {
    await createShell();

    expect(text(fixture, '.shell__brand-name')).toBe('Muamalat');
    expect(text(fixture, '.shell__brand-authority')).toBe('State of Kuwait');
  });

  it('points the brand at the landing page for the current role', async () => {
    auth.signIn(USER_IDS.supervisor);
    await createShell();

    expect(el(fixture, '.shell__brand').getAttribute('href')).toBe('/supervisor');
  });

  // ---------------------------------------------------------------------------
  // Language switching
  // ---------------------------------------------------------------------------

  it('offers each language under its own name and marks the active one', async () => {
    await createShell();

    const options = all<HTMLButtonElement>(fixture, '.shell__language-option');
    expect(options.map((option) => option.textContent?.trim())).toEqual(['English', 'العربية']);
    expect(options[0].getAttribute('aria-pressed')).toBe('true');
    expect(options[1].getAttribute('aria-pressed')).toBe('false');
    // Each option is tagged with its own language so a screen reader switches voice.
    expect(options[1].getAttribute('lang')).toBe('ar');
  });

  it('switches the document direction and the interface copy together', async () => {
    auth.signIn(USER_IDS.citizen);
    await createShell();
    expect(text(fixture, '.nav__heading')).toBe('Citizen services');

    await i18n.setLanguage('ar');
    await render();

    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
    expect(text(fixture, '.nav__heading')).toBe('خدمات المراجعين');
    expect(el(fixture, 'nav').getAttribute('aria-label')).toBe('التنقل الرئيسي');
  });

  it('activates a language when its button is pressed', async () => {
    await createShell();

    all<HTMLButtonElement>(fixture, '.shell__language-option')[1].click();
    await fixture.whenStable();
    await render();

    expect(i18n.language()).toBe('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
  });

  // ---------------------------------------------------------------------------
  // Off canvas navigation
  // ---------------------------------------------------------------------------

  it('reports the state of the navigation panel through aria-expanded', async () => {
    auth.signIn(USER_IDS.citizen);
    await createShell();

    const toggle = () => el<HTMLButtonElement>(fixture, '.shell__nav-toggle button');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().getAttribute('aria-controls')).toBe('primary-navigation');
    expect(el(fixture, 'nav').id).toBe('primary-navigation');

    toggle().click();
    await render();

    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(el(fixture, 'app-primary-nav').classList).toContain('shell__sidebar--open');
  });

  it('only renders the scrim while the panel is open', async () => {
    auth.signIn(USER_IDS.citizen);
    await createShell();
    expect(maybeEl(fixture, '.shell__scrim')).toBeNull();

    el<HTMLButtonElement>(fixture, '.shell__nav-toggle button').click();
    await render();
    expect(maybeEl(fixture, '.shell__scrim')).not.toBeNull();

    el<HTMLButtonElement>(fixture, '.shell__scrim').click();
    await render();
    expect(maybeEl(fixture, '.shell__scrim')).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Notices
  // ---------------------------------------------------------------------------

  it('shows no catalogue warning while the language loaded normally', async () => {
    await createShell();
    expect(maybeEl(fixture, '.shell__notice--warning')).toBeNull();
  });

  it('mounts the toast region once, at the shell level', async () => {
    await createShell();
    expect(all(fixture, 'app-toast-container').length).toBe(1);
  });
});
