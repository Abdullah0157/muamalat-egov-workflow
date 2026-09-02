import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { AuthService } from '../../core/auth/auth.service';
import { USER_IDS } from '../../core/auth/demo-users';
import { all, el, text } from '../../shared/testing/dom';
import { setupI18n, testProviders } from '../../shared/testing/i18n';
import { NotFoundPage } from './not-found-page';
import { PermissionDeniedPage } from './permission-denied-page';

describe('PermissionDeniedPage', () => {
  let fixture: ComponentFixture<PermissionDeniedPage>;
  let auth: AuthService;
  let router: Router;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [PermissionDeniedPage],
      providers: [...testProviders(), provideRouter([])],
    }).compileComponents();
    await setupI18n();
    auth = TestBed.inject(AuthService);
    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);
    spyOn(router, 'navigate').and.resolveTo(true);
  });

  /**
   * The whole point of this page: "access denied" on its own is not actionable.
   * It must name the role the area wants and the role the person holds.
   */
  it('names both the required role and the role actually held', async () => {
    auth.signIn(USER_IDS.citizen);
    fixture = TestBed.createComponent(PermissionDeniedPage);
    fixture.componentRef.setInput('required', 'admin');
    await render();

    const description = text(fixture, 'app-error-state');
    expect(description).toContain('Administrator');
    expect(description).toContain('Citizen');
    expect(description).toContain('ask your department administrator');
  });

  it('lists several accepted roles when the area accepts more than one', async () => {
    auth.signIn(USER_IDS.citizen);
    fixture = TestBed.createComponent(PermissionDeniedPage);
    fixture.componentRef.setInput('required', 'officer,supervisor');
    await render();

    const description = text(fixture, 'app-error-state');
    expect(description).toContain('Officer');
    expect(description).toContain('Supervisor');
  });

  it('offers a way out rather than a dead end', async () => {
    auth.signIn(USER_IDS.citizen);
    fixture = TestBed.createComponent(PermissionDeniedPage);
    fixture.componentRef.setInput('required', 'admin');
    await render();

    const buttons = all<HTMLButtonElement>(fixture, 'app-button button');
    expect(buttons.length).toBe(2);

    buttons[0].click();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/citizen');

    buttons[1].click();
    expect(auth.isSignedIn()).toBeFalse();
    expect(router.navigate).toHaveBeenCalledWith(['/sign-in']);
  });

  it('announces itself as an alert', async () => {
    auth.signIn(USER_IDS.citizen);
    fixture = TestBed.createComponent(PermissionDeniedPage);
    fixture.componentRef.setInput('required', 'admin');
    await render();

    expect(el(fixture, '[role="alert"]')).toBeTruthy();
  });
});

describe('NotFoundPage', () => {
  let fixture: ComponentFixture<NotFoundPage>;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [NotFoundPage],
      providers: [...testProviders(), provideRouter([])],
    }).compileComponents();
    await setupI18n();

    fixture = TestBed.createComponent(NotFoundPage);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('explains what happened rather than showing a bare error', () => {
    const content = text(fixture, 'app-error-state');
    expect(content).toContain('Page not found');
    expect(content).toContain('may have been mistyped');
  });

  it('does not offer a retry, because retrying a wrong address changes nothing', () => {
    const labels = all(fixture, 'app-button button').map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Go to the start page']);
  });
});
