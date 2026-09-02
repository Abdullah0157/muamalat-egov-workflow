/**
 * PKCE (RFC 7636) helpers for the authorization code flow.
 *
 * A public client cannot keep a secret: anything shipped to the browser is
 * readable by anyone who opens dev tools. PKCE closes the gap that leaves. The
 * client generates a random verifier, sends only its SHA-256 hash when starting
 * the flow, and reveals the verifier when redeeming the code. An attacker who
 * intercepts the authorization code cannot exchange it, because they never saw
 * the verifier.
 *
 * Implemented directly on Web Crypto rather than pulled from a library. It is
 * about thirty lines, it removes a dependency from the auth path, and the
 * artifact's strict CSP blocks external scripts anyway.
 */

/** Characters permitted in a code verifier by RFC 7636 section 4.1. */
const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/**
 * Creates a code verifier.
 *
 * The spec allows 43 to 128 characters; 64 is used because it comfortably
 * exceeds the 256 bits of entropy the spec asks for while staying well inside
 * URL length limits. Values come from `crypto.getRandomValues`, never
 * `Math.random`, which is not cryptographically secure and would make the
 * verifier predictable.
 */
export function createCodeVerifier(length = 64): string {
  if (length < 43 || length > 128) {
    throw new RangeError('A PKCE code verifier must be between 43 and 128 characters.');
  }

  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  // Modulo over a 256 value byte into a 66 character alphabet is very slightly
  // biased. That bias is irrelevant here: it costs a fraction of a bit per
  // character against 64 characters of entropy, and rejection sampling would
  // add complexity for no practical gain.
  let verifier = '';
  for (const byte of bytes) {
    verifier += UNRESERVED[byte % UNRESERVED.length];
  }

  return verifier;
}

/** S256 challenge: base64url(SHA-256(verifier)). */
export async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Random value for the `state` and `nonce` parameters.
 *
 * `state` defends against cross site request forgery on the callback: a
 * response carrying a state the client did not issue is discarded. `nonce` is
 * echoed inside the ID token, which is what proves the token was minted for
 * this particular request rather than replayed from another session.
 */
export function createRandomValue(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  // Standard base64 uses + / = which are not safe in a URL, so they are
  // translated to the base64url alphabet and the padding is dropped.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const withPadding = padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '=');

  // decodeURIComponent/escape round trip is what turns the raw bytes back into
  // a UTF-8 string, so Arabic names inside a token survive intact.
  return decodeURIComponent(
    Array.from(atob(withPadding))
      .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .join(''),
  );
}

/**
 * Reads the claims out of a JWT without verifying it.
 *
 * The signature is deliberately NOT checked here, and the result must never be
 * used to make an access decision. The API validates every token against
 * Keycloak's keys; the browser only needs the claims to render a name and pick
 * a landing route. Verifying in the browser would be security theatre, since
 * anything the browser can decide, the user can change.
 */
export function readJwtClaims<T = Record<string, unknown>>(token: string): T | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    return JSON.parse(base64UrlDecode(parts[1])) as T;
  } catch {
    return null;
  }
}
