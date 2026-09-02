import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { ALL_USERS, USER_IDS } from '../core/auth/demo-users';
import { Role, User } from '../core/models/domain';
import { all, el, maybeEl, text } from '../shared/testing/dom';
import { setupI18n, testProviders } from '../shared/testing/i18n';
import { NavSection, sectionsForRole } from './nav-model';
import { PrimaryNav } from './primary-nav';

@Component({
  imports: [PrimaryNav],
  template: `
    <app-primary-nav
      [sections]="sections()"
      [user]="user()"
      (signOut)="signOuts.set(signOuts() + 1)"
    />
  `,
})
class Host {
  readonly sections = signal<readonly NavSection[]>([]);
  readonly user = signal<User | null>(null);
  readonly signOuts = signal(0);
}

function accountFor(id: string): User {
  const account = ALL_USERS.find((candidate) => candidate.id === id);
  if (!account) {
    throw new Error(`No sample account with id ${id}`);
  }
  return account;
}

describe('PrimaryNav', () => {
  let fixture: ComponentFixture<Host>;

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function showRole(role: Role, userId: string): Promise<void> {
    fixture.componentInstance.sections.set(sectionsForRole(role));
    fixture.componentInstance.user.set(accountFor(userId));
    await render();
  }

  function linkLabels(): (string | undefined)[] {
    return all(fixture, '.nav__link').map((link) => link.textContent?.trim());
  }

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [...testProviders(), provideRouter([])],
    }).compileComponents();
    await setupI18n();
    fixture = TestBed.createComponent(Host);
    await render();
  });

  it('is a named navigation landmark', () => {
    expect(el(fixture, 'nav').getAttribute('aria-label')).toBe('Primary navigation');
    expect(el(fixture, 'nav').id).toBe('primary-navigation');
  });

  it('renders the links as a list, not a pile of anchors', async () => {
    await showRole('citizen', USER_IDS.citizen);

    expect(maybeEl(fixture, 'ul')).not.toBeNull();
    expect(all(fixture, 'li .nav__link').length).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // Role based navigation
  // ---------------------------------------------------------------------------

  it('shows nothing to navigate when nobody is signed in', () => {
    expect(linkLabels()).toEqual([]);
    expect(maybeEl(fixture, '.nav__account')).toBeNull();
  });

  it('shows only the citizen sections to a citizen', async () => {
    await showRole('citizen', USER_IDS.citizen);

    expect(linkLabels()).toEqual(['My requests', 'New request']);
    expect(text(fixture, '.nav__heading')).toBe('Citizen services');
  });

  it('shows an officer their queue and nothing beyond it', async () => {
    await showRole('officer', USER_IDS.officer);

    expect(linkLabels()).toEqual(['Work queue']);
  });

  it('adds the oversight section for a supervisor', async () => {
    await showRole('supervisor', USER_IDS.supervisor);

    expect(linkLabels()).toEqual(['Work queue', 'Dashboard']);
  });

  it('shows an administrator the workflow definitions', async () => {
    await showRole('admin', USER_IDS.admin);

    expect(linkLabels()).toEqual(['Workflows']);
  });

  it('never leaks a section belonging to another role into the rail', async () => {
    await showRole('citizen', USER_IDS.citizen);

    expect(linkLabels()).not.toContain('Dashboard');
    expect(linkLabels()).not.toContain('Workflows');
  });

  // ---------------------------------------------------------------------------
  // Account
  // ---------------------------------------------------------------------------

  it('names the signed in account and its role', async () => {
    await showRole('admin', USER_IDS.admin);

    expect(text(fixture, '.nav__account-name')).toBe('Hessa Al Failakawi');
    expect(text(fixture, '.nav__account app-badge')).toContain('Administrator');
  });

  it('raises sign out rather than acting on its own', async () => {
    await showRole('citizen', USER_IDS.citizen);

    el<HTMLButtonElement>(fixture, '.nav__signout button').click();

    expect(fixture.componentInstance.signOuts()).toBe(1);
  });

  it('translates the section headings and the account block', async () => {
    await showRole('citizen', USER_IDS.citizen);
    await setupI18n('ar');
    await render();

    expect(text(fixture, '.nav__heading')).toBe('خدمات المراجعين');
    expect(text(fixture, '.nav__account-label')).toBe('تسجيل الدخول باسم');
    expect(text(fixture, '.nav__account-name')).toBe('فهد الصباح');
  });
});
