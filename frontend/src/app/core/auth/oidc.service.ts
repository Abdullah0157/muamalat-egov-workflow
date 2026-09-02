import { DOCUMENT, Injectable, InjectionToken, inject, signal } from '@angular/core';

import { createCodeChallenge, createCodeVerifier, createRandomValue, readJwtClaims } from './pkce';

export interface OidcConfig {
  /** Realm issuer, e.g. http://localhost:8081/realms/muamalat */
  readonly issuer: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly postLogoutRedirectUri: string;
  readonly scope: string;
}

/**
 * Supplied at runtime rather than baked into the bundle.
 *
 * The same built image is deployed to every environment, so the issuer cannot
 * be a compile time constant. nginx publishes `/config.json`, and the app reads
 * it before bootstrapping.
 */
export const OIDC_CONFIG = new InjectionToken<OidcConfig>('OIDC_CONFIG', {
  providedIn: 'root',

  // Development defaults, overridden by `provideAuth()` which builds the real
  // configuration from `/config.json`. A default exists so the service can be
  // constructed under `ng serve` and in component tests without every spec
  // having to know that authentication is part of the graph.
  factory: (): OidcConfig => {
    const origin = typeof window === 'undefined' ? 'http://localhost:4200' : window.location.origin;

    return {
      issuer: 'http://localhost:8081/realms/muamalat',
      clientId: 'muamalat-web',
      redirectUri: `${origin}/auth/callback`,
      postLogoutRedirectUri: `${origin}/sign-in`,
      scope: 'openid profile email',
    };
  },
});

interface TokenResponse {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly id_token?: string;
  readonly expires_in: number;
  readonly token_type: string;
}

export interface OidcClaims {
  readonly sub: string;
  readonly name?: string;
  readonly preferred_username?: string;
  readonly email?: string;
  readonly realm_access?: { roles?: string[] };
}

const VERIFIER_KEY = 'muamalat.pkce.verifier';
const STATE_KEY = 'muamalat.pkce.state';
const NONCE_KEY = 'muamalat.pkce.nonce';
const RETURN_TO_KEY = 'muamalat.pkce.returnTo';

/**
 * OpenID Connect authorization code flow with PKCE against Keycloak.
 *
 * Tokens are held in memory, not in localStorage. A token in localStorage
 * survives a tab close and is readable by any script that manages to run on the
 * page, which turns a single cross site scripting bug into a stolen session. The
 * cost of keeping them in memory is a silent re-authentication on refresh, which
 * is what `restoreSession` does using the identity provider's own session
 * cookie.
 *
 * Only the short lived PKCE parameters go to sessionStorage, because the
 * redirect leaves the page entirely and they must survive it. They are cleared
 * the moment the code is redeemed.
 */
@Injectable({ providedIn: 'root' })
export class OidcService {
  private readonly config = inject(OIDC_CONFIG);
  private readonly document = inject(DOCUMENT);

  private readonly accessToken = signal<string | null>(null);
  private readonly claims = signal<OidcClaims | null>(null);
  private refreshToken: string | null = null;
  private expiresAt = 0;

  readonly currentClaims = this.claims.asReadonly();

  /** Used by the HTTP interceptor. Returns null when there is no live session. */
  getAccessToken(): string | null {
    return this.accessToken();
  }

  isAuthenticated(): boolean {
    return this.accessToken() !== null && Date.now() < this.expiresAt;
  }

  /** Sends the browser to Keycloak. Does not return. */
  async signIn(returnTo?: string): Promise<void> {
    const verifier = createCodeVerifier();
    const challenge = await createCodeChallenge(verifier);
    const state = createRandomValue();
    const nonce = createRandomValue();

    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);
    sessionStorage.setItem(NONCE_KEY, nonce);

    if (returnTo) {
      sessionStorage.setItem(RETURN_TO_KEY, returnTo);
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scope,
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    this.document.location.assign(`${this.config.issuer}/protocol/openid-connect/auth?${params}`);
  }

  /**
   * Completes the flow on the callback route.
   *
   * Returns the path the user was heading to before they were sent to sign in,
   * so a deep link survives authentication instead of dumping them on a
   * dashboard.
   */
  async completeSignIn(search: string): Promise<{ returnTo: string | null }> {
    const params = new URLSearchParams(search);

    const error = params.get('error');
    if (error) {
      this.clearFlowState();
      throw new OidcError(error, params.get('error_description'));
    }

    const code = params.get('code');
    const state = params.get('state');
    const expectedState = sessionStorage.getItem(STATE_KEY);
    const verifier = sessionStorage.getItem(VERIFIER_KEY);

    if (!code || !verifier) {
      this.clearFlowState();
      throw new OidcError('invalid_callback', 'The sign in response was incomplete.');
    }

    // A mismatched state means this callback was not started by this browser
    // session. Redeeming it anyway is exactly the CSRF that state exists to
    // prevent, so the flow is abandoned.
    if (!expectedState || state !== expectedState) {
      this.clearFlowState();
      throw new OidcError('state_mismatch', 'The sign in response did not match this session.');
    }

    const tokens = await this.exchange(new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      code,
      redirect_uri: this.config.redirectUri,
      code_verifier: verifier,
    }));

    this.verifyNonce(tokens);
    this.store(tokens);

    const returnTo = sessionStorage.getItem(RETURN_TO_KEY);
    this.clearFlowState();

    return { returnTo };
  }

  /**
   * Re-establishes a session without user interaction.
   *
   * Because tokens live in memory, a page refresh loses them. Keycloak still
   * holds its own session cookie, so `prompt=none` inside a hidden iframe would
   * normally be used; that is blocked by modern third party cookie policy when
   * the identity provider is on another origin. A refresh token is used when one
   * is held, and otherwise the user signs in again, which is the honest outcome
   * rather than a silent failure that looks like a bug.
   */
  async restoreSession(): Promise<boolean> {
    if (!this.refreshToken) {
      return false;
    }

    try {
      const tokens = await this.exchange(new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        refresh_token: this.refreshToken,
      }));

      this.store(tokens);
      return true;
    } catch {
      this.clearSession();
      return false;
    }
  }

  async signOut(): Promise<void> {
    const idToken = this.idToken;
    this.clearSession();

    const params = new URLSearchParams({
      post_logout_redirect_uri: this.config.postLogoutRedirectUri,
      client_id: this.config.clientId,
    });

    // Passing the ID token lets Keycloak end the session without prompting the
    // user to confirm, which it otherwise does as a safety check.
    if (idToken) {
      params.set('id_token_hint', idToken);
    }

    this.document.location.assign(`${this.config.issuer}/protocol/openid-connect/logout?${params}`);
  }

  private idToken: string | null = null;

  private async exchange(body: URLSearchParams): Promise<TokenResponse> {
    const response = await fetch(`${this.config.issuer}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new OidcError('token_exchange_failed', detail || `HTTP ${response.status}`);
    }

    return (await response.json()) as TokenResponse;
  }

  private verifyNonce(tokens: TokenResponse): void {
    const expected = sessionStorage.getItem(NONCE_KEY);
    if (!expected || !tokens.id_token) {
      return;
    }

    const claims = readJwtClaims<{ nonce?: string }>(tokens.id_token);

    // The nonce proves this ID token was minted for the request this browser
    // started, rather than replayed from somewhere else.
    if (claims?.nonce !== expected) {
      throw new OidcError('nonce_mismatch', 'The identity token did not match this sign in attempt.');
    }
  }

  private store(tokens: TokenResponse): void {
    this.accessToken.set(tokens.access_token);
    this.refreshToken = tokens.refresh_token ?? this.refreshToken;
    this.idToken = tokens.id_token ?? this.idToken;

    // Expire the token slightly early so a request begun just before the
    // deadline does not arrive after it.
    const skewSeconds = 30;
    this.expiresAt = Date.now() + Math.max(0, tokens.expires_in - skewSeconds) * 1000;

    this.claims.set(readJwtClaims<OidcClaims>(tokens.access_token));
  }

  private clearSession(): void {
    this.accessToken.set(null);
    this.claims.set(null);
    this.refreshToken = null;
    this.idToken = null;
    this.expiresAt = 0;
  }

  private clearFlowState(): void {
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
    sessionStorage.removeItem(NONCE_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
  }
}

export class OidcError extends Error {
  constructor(
    readonly code: string,
    readonly detail: string | null,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'OidcError';
  }
}
