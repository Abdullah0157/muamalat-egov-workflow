import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { all, el, text } from '../../shared/testing/dom';
import { setupI18n, testProviders } from '../../shared/testing/i18n';
import { SignInPage } from './sign-in-page';

describe('SignInPage', () => {
  let fixture: ComponentFixture<SignInPage>;
  let auth: AuthService;
  let i18n: I18nService;
  let router: Router;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [SignInPage],
      providers: [...testProviders(), provideRouter([])],
    }).compileComponents();
    i18n = await setupI18n();
    auth = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);

    fixture = TestBed.createComponent(SignInPage);
    await render();
  });

  it('states plainly that no credentials are collected', () => {
    expect(text(fixture, '.sign-in__title')).toBe('Sign in to Muamalat');
    expect(text(fixture, '.sign-in__intro')).toContain('does not connect to the national identity service');
  });

  it('collects no credentials at all', () => {
    // A prototype must not train anyone to type a password into it.
    expect(fixture.nativeElement.querySelector('input[type="password"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('offers one account per role, each with its own description', () => {
    const accounts = all(fixture, '.sign-in__account');
    expect(accounts.length).toBe(4);

    const badges = all(fixture, '.sign-in__account app-badge').map((b) => b.textContent?.trim());
    expect(badges).toEqual(['Citizen', 'Officer', 'Supervisor', 'Administrator']);

    for (const account of accounts) {
      expect(account.querySelector('.sign-in__account-description')?.textContent?.trim().length)
        .toBeGreaterThan(0);
    }
  });

  it('uses real buttons so the list is keyboard reachable', () => {
    for (const account of all(fixture, '.sign-in__account')) {
      expect(account.tagName).toBe('BUTTON');
      expect(account.getAttribute('type')).toBe('button');
    }
  });

  it('signs in the chosen account and routes to its landing page', () => {
    all<HTMLButtonElement>(fixture, '.sign-in__account')[1].click();

    expect(auth.isSignedIn()).toBeTrue();
    expect(auth.role()).toBe('officer');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/officer');
  });

  it('offers the language switch before anyone has signed in', async () => {
    const options = all<HTMLButtonElement>(fixture, '.sign-in__language-option');
    expect(options.map((o) => o.textContent?.trim())).toEqual(['English', 'العربية']);

    options[1].click();
    await fixture.whenStable();
    await render();

    expect(i18n.language()).toBe('ar');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(text(fixture, '.sign-in__title')).toBe('تسجيل الدخول إلى معاملات');
  });

  it('carries the prototype notice where nobody can miss it', () => {
    expect(text(fixture, '.sign-in__footer')).toContain('Prototype build');
  });
});
