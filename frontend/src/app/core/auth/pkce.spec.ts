import { base64UrlEncode, createCodeChallenge, createCodeVerifier, createRandomValue, readJwtClaims } from './pkce';

describe('PKCE code verifier', () => {
  it('produces a verifier of the requested length', () => {
    expect(createCodeVerifier(43).length).toBe(43);
    expect(createCodeVerifier(64).length).toBe(64);
    expect(createCodeVerifier(128).length).toBe(128);
  });

  it('refuses lengths outside the range the spec allows', () => {
    // Shorter than 43 characters weakens the entropy the exchange relies on.
    expect(() => createCodeVerifier(42)).toThrowError(RangeError);
    expect(() => createCodeVerifier(129)).toThrowError(RangeError);
  });

  it('uses only characters that survive a URL unescaped', () => {
    expect(createCodeVerifier()).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('does not repeat', () => {
    // A predictable verifier defeats the entire purpose: an attacker holding an
    // intercepted code could then redeem it.
    const seen = new Set(Array.from({ length: 50 }, () => createCodeVerifier()));
    expect(seen.size).toBe(50);
  });
});

describe('PKCE code challenge', () => {
  it('matches the worked example from RFC 7636', async () => {
    // Appendix B of the specification. If this fails, the challenge sent to
    // Keycloak is wrong and every sign in will be rejected.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

    expect(await createCodeChallenge(verifier)).toBe(expected);
  });

  it('is stable for the same verifier', async () => {
    const verifier = createCodeVerifier();
    expect(await createCodeChallenge(verifier)).toBe(await createCodeChallenge(verifier));
  });

  it('differs for different verifiers', async () => {
    const a = await createCodeChallenge(createCodeVerifier());
    const b = await createCodeChallenge(createCodeVerifier());
    expect(a).not.toBe(b);
  });

  it('emits base64url, never standard base64', async () => {
    const challenge = await createCodeChallenge(createCodeVerifier());

    // A + / or = in a query parameter would be re-encoded in transit and no
    // longer match what the server computes.
    expect(challenge).not.toContain('+');
    expect(challenge).not.toContain('/');
    expect(challenge).not.toContain('=');
  });
});

describe('state and nonce', () => {
  it('are unpredictable', () => {
    const seen = new Set(Array.from({ length: 50 }, () => createRandomValue()));
    expect(seen.size).toBe(50);
  });

  it('are URL safe', () => {
    expect(createRandomValue()).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
});

describe('base64url encoding', () => {
  it('drops padding and swaps the unsafe alphabet', () => {
    // 0xFB 0xFF encodes to +/8= in standard base64.
    expect(base64UrlEncode(new Uint8Array([251, 255, 254]))).toBe('-__-');
  });
});

describe('reading JWT claims', () => {
  function token(payload: Record<string, unknown>): string {
    const encode = (value: unknown) =>
      base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));

    return `${encode({ alg: 'RS256' })}.${encode(payload)}.signature-not-checked`;
  }

  it('reads the payload', () => {
    const claims = readJwtClaims<{ sub: string }>(token({ sub: 'citizen-1' }));
    expect(claims?.sub).toBe('citizen-1');
  });

  it('preserves Arabic names', () => {
    // A naive atob would mangle multi-byte characters and show a Kuwaiti user a
    // corrupted version of their own name.
    const claims = readJwtClaims<{ name: string }>(token({ name: 'فاطمة السويدي' }));
    expect(claims?.name).toBe('فاطمة السويدي');
  });

  it('returns null for a value that is not a JWT', () => {
    expect(readJwtClaims('not-a-token')).toBeNull();
    expect(readJwtClaims('a.b')).toBeNull();
  });

  it('returns null when the payload is not valid JSON', () => {
    const malformed = `${base64UrlEncode(new TextEncoder().encode('{}'))}.###.sig`;
    expect(readJwtClaims(malformed)).toBeNull();
  });
});
