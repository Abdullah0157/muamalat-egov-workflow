import { runInInjectionContext, Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';

import { AuthService } from './auth.service';
import { USER_IDS } from './demo-users';
import { redirectIfSignedIn, requireRole, routeToRoleHome } from './role.guard';

const STORAGE_KEY = 'muamalat.account';

describe('role guards', () => {
  let injector: Injector;
  let auth: AuthService;

  function run(
    guard: ReturnType<typeof requireRole> | typeof redirectIfSignedIn,
    url: string,
  ): boolean | UrlTree {
    const route = {} as ActivatedRouteSnapshot;
    const state = { url } as RouterStateSnapshot;
    return runInInjectionContext(injector, () => guard(route, state)) as boolean | UrlTree;
  }

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    injector = TestBed.inject(Injector);
    auth = TestBed.inject(AuthService);
  });

  it('sends a signed out visitor to sign in, remembering where they were going', () => {
    const result = run(requireRole('officer'), '/officer/CA-2026-00001');

    expect(result instanceof UrlTree).toBeTrue();
    const tree = result as UrlTree;
    expect(tree.toString()).toContain('/sign-in');
    expect(tree.queryParams['returnTo']).toBe('/officer/CA-2026-00001');
  });

  it('admits a user holding the required role', () => {
    auth.signIn(USER_IDS.officer);

    expect(run(requireRole('officer'), '/officer')).toBeTrue();
  });

  it('admits a user holding any one of several accepted roles', () => {
    auth.signIn(USER_IDS.supervisor);

    expect(run(requireRole('officer', 'supervisor'), '/officer')).toBeTrue();
  });

  /**
   * The denied page needs both facts to write a useful explanation, so the
   * guard has to carry them across.
   */
  it('sends the wrong role to an explanation carrying what was required', () => {
    auth.signIn(USER_IDS.citizen);

    const result = run(requireRole('admin'), '/admin');
    expect(result instanceof UrlTree).toBeTrue();

    const tree = result as UrlTree;
    expect(tree.toString()).toContain('/denied');
    expect(tree.queryParams['required']).toBe('admin');
    expect(tree.queryParams['from']).toBe('/admin');
  });

  it('keeps a signed in user away from the sign in screen', () => {
    auth.signIn(USER_IDS.admin);

    const result = run(redirectIfSignedIn, '/sign-in');
    expect((result as UrlTree).toString()).toContain('/admin');
  });

  it('leaves a signed out visitor on the sign in screen', () => {
    expect(run(redirectIfSignedIn, '/sign-in')).toBeTrue();
  });

  it('routes the root address to the landing page for the current role', () => {
    auth.signIn(USER_IDS.supervisor);

    const result = runInInjectionContext(injector, () =>
      routeToRoleHome({} as ActivatedRouteSnapshot, { url: '/' } as RouterStateSnapshot),
    ) as UrlTree;

    expect(result.toString()).toContain('/supervisor');
  });
});
