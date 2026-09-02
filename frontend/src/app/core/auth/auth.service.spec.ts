import { TestBed } from '@angular/core/testing';

import { AuthService } from './auth.service';
import { DEMO_USERS, USER_IDS } from './demo-users';

const STORAGE_KEY = 'muamalat.account';

describe('AuthService', () => {
  function create(): AuthService {
    TestBed.configureTestingModule({});
    return TestBed.inject(AuthService);
  }

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it('starts signed out', () => {
    const auth = create();

    expect(auth.isSignedIn()).toBeFalse();
    expect(auth.role()).toBeNull();
    expect(auth.user()).toBeNull();
  });

  it('offers one account per role on the sign in screen', () => {
    const roles = DEMO_USERS.map((user) => user.role);

    expect(new Set(roles).size).toBe(roles.length);
    expect(roles).toContain('citizen');
    expect(roles).toContain('officer');
    expect(roles).toContain('supervisor');
    expect(roles).toContain('admin');
  });

  it('signs in a known account', () => {
    const auth = create();

    expect(auth.signIn(USER_IDS.officer)).toBeTrue();
    expect(auth.isSignedIn()).toBeTrue();
    expect(auth.role()).toBe('officer');
    expect(auth.departmentId()).not.toBeNull();
  });

  it('refuses an unknown account rather than creating one', () => {
    const auth = create();

    expect(auth.signIn('usr-does-not-exist')).toBeFalse();
    expect(auth.isSignedIn()).toBeFalse();
  });

  it('answers role questions for the signed in account', () => {
    const auth = create();
    auth.signIn(USER_IDS.supervisor);

    expect(auth.hasRole('supervisor')).toBeTrue();
    expect(auth.hasRole('officer', 'supervisor')).toBeTrue();
    expect(auth.hasRole('citizen')).toBeFalse();
    expect(auth.hasRole()).toBeFalse();
  });

  it('sends each role to its own landing address', () => {
    const auth = create();

    expect(auth.homeRoute('citizen')).toBe('/citizen');
    expect(auth.homeRoute('officer')).toBe('/officer');
    expect(auth.homeRoute('supervisor')).toBe('/supervisor');
    expect(auth.homeRoute('admin')).toBe('/admin');
    expect(auth.homeRoute(null)).toBe('/sign-in');
  });

  it('remembers the account across a reload', () => {
    const first = create();
    first.signIn(USER_IDS.admin);

    TestBed.resetTestingModule();
    const second = create();

    expect(second.isSignedIn()).toBeTrue();
    expect(second.role()).toBe('admin');
  });

  it('forgets the account on sign out', () => {
    const auth = create();
    auth.signIn(USER_IDS.admin);

    auth.signOut();

    expect(auth.isSignedIn()).toBeFalse();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
