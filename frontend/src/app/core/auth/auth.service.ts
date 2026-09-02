import { DOCUMENT, Injectable, computed, inject, signal } from '@angular/core';

import { Role, User } from '../models/domain';
import { DEMO_USERS } from './demo-users';
import { OidcClaims } from './oidc.service';

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

  /**
   * Establishes the session from a verified access token's claims.
   *
   * The role comes from `realm_access.roles`, which Keycloak signs. It is used
   * here only to decide navigation and which controls to render; the API
   * re-derives it from the same token on every call. A user who edits their
   * role in the browser changes what they see and nothing they can do.
   */
  signInFromClaims(claims: OidcClaims): User {
    const user = toUser(claims);
    this.currentUser.set(user);

    // Deliberately not persisted. The identity provider owns the session, and
    // writing it here would leave a stale account visible after the token has
    // expired or been revoked.
    this.write(null);

    return user;
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

/**
 * Maps Keycloak claims onto the application's user model.
 *
 * Fields the identity provider does not carry are left empty rather than
 * invented. A fabricated civil ID on a government screen is a serious defect,
 * not a cosmetic one.
 */
function toUser(claims: OidcClaims): User {
  const displayName = claims.name ?? claims.preferred_username ?? claims.sub;

  return {
    id: claims.sub,

    // Names are not translated. Showing the same value in both languages is
    // correct here rather than a missing translation.
    name: { en: displayName, ar: displayName },
    civilId: '',
    email: claims.email ?? '',
    role: toRole(claims.realm_access?.roles ?? []),

    // Department membership is a workflow concept the token does not carry; the
    // API assigns work by department on the request itself.
    departmentId: null,
    jobTitle: null,
  };
}

/**
 * Picks the single role the UI renders from the set the token grants.
 *
 * The most privileged wins, because a supervisor who also holds Officer should
 * land on the supervisor console rather than being demoted by claim ordering.
 */
function toRole(roles: readonly string[]): Role {
  const held = roles.map((role) => role.toLowerCase());

  if (held.includes('admin')) return 'admin';
  if (held.includes('supervisor')) return 'supervisor';
  if (held.includes('officer')) return 'officer';
  return 'citizen';
}
