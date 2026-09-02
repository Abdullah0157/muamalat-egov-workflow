import { DOCUMENT, Injectable, computed, inject, signal } from '@angular/core';

import { Role, User } from '../models/domain';
import { DEMO_USERS } from './demo-users';

const STORAGE_KEY = 'muamalat.account';

/**
 * Session state.
 *
 * This build has no identity provider, so the "sign in" step picks one of a
 * small set of fixed accounts. Everything downstream (guards, navigation, the
 * transitions an officer is offered) reads the role from here, so replacing this
 * service with a real OpenID Connect client does not touch any feature code.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly document = inject(DOCUMENT);
  private readonly currentUser = signal<User | null>(this.readStored());

  readonly user = this.currentUser.asReadonly();
  readonly isSignedIn = computed(() => this.currentUser() !== null);
  readonly role = computed<Role | null>(() => this.currentUser()?.role ?? null);
  readonly departmentId = computed<string | null>(() => this.currentUser()?.departmentId ?? null);

  /** Accounts offered on the sign in screen. */
  readonly accounts = DEMO_USERS;

  hasRole(...roles: readonly Role[]): boolean {
    const role = this.role();
    return role !== null && roles.includes(role);
  }

  signIn(userId: string): boolean {
    const account = DEMO_USERS.find((candidate) => candidate.id === userId);
    if (!account) {
      return false;
    }
    this.currentUser.set(account);
    this.write(account.id);
    return true;
  }

  signOut(): void {
    this.currentUser.set(null);
    this.write(null);
  }

  /** Landing route for a role, used after sign in and by the root redirect. */
  homeRoute(role: Role | null = this.role()): string {
    switch (role) {
      case 'citizen':
        return '/citizen';
      case 'officer':
        return '/officer';
      case 'supervisor':
        return '/supervisor';
      case 'admin':
        return '/admin';
      default:
        return '/sign-in';
    }
  }

  private readStored(): User | null {
    try {
      const id = this.document.defaultView?.localStorage.getItem(STORAGE_KEY);
      return DEMO_USERS.find((candidate) => candidate.id === id) ?? null;
    } catch {
      return null;
    }
  }

  private write(id: string | null): void {
    try {
      const storage = this.document.defaultView?.localStorage;
      if (!storage) {
        return;
      }
      if (id === null) {
        storage.removeItem(STORAGE_KEY);
      } else {
        storage.setItem(STORAGE_KEY, id);
      }
    } catch {
      // Not remembering the account is acceptable; failing to sign in is not.
    }
  }
}
