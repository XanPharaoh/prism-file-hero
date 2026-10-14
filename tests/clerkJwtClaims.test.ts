import { describe, expect, it } from 'vitest';
import { validateClerkClaims } from '../worker/src/jwtValidation';
import { resolveTrustedIssuer } from '../worker/src/index';

const config = { issuer: 'https://example.clerk.accounts.dev', audience: 'prism-worker', nowSeconds: 10_000 };
const valid = { sub: 'user_123', iss: config.issuer, aud: config.audience, exp: 10_100, iat: 9_900 };

describe('Clerk JWT claim validation', () => {
  it('accepts required signed claims and an audience array', () => {
    expect(validateClerkClaims(valid, config)).toEqual({ sub: 'user_123' });
    expect(validateClerkClaims({ ...valid, aud: ['other', config.audience], nbf: 9_990 }, config)).toEqual({ sub: 'user_123' });
  });

  it.each([
    { ...valid, exp: 9_939 }, { ...valid, iat: 10_061 }, { ...valid, nbf: 10_061 },
    { ...valid, iss: 'https://other.example' }, { ...valid, aud: 'other' }, { ...valid, sub: 1 },
    { ...valid, exp: undefined }, { ...valid, iat: undefined },
  ])('rejects invalid claim set', claim => {
    expect(validateClerkClaims(claim, config)).toBeNull();
  });

  it('does not require an audience when no audience is configured', () => {
    expect(validateClerkClaims({ ...valid, aud: undefined }, { issuer: config.issuer, nowSeconds: config.nowSeconds })).toEqual({ sub: 'user_123' });
  });
});

/**
 * Where the issuer comes from. Deriving it from CLERK_JWKS_URL made one variable the whole trust
 * anchor: whoever replaced that URL also chose which iss a token had to carry, so their own signed
 * tokens verified. A deployed Worker therefore needs the issuer stated explicitly, over https.
 */
describe('trusted issuer resolution', () => {
  const env = (over: Record<string, string>) => ({ CLERK_JWKS_URL: 'https://clerk.prismfilehero.com/.well-known/jwks.json', ...over } as any);

  it('uses the pinned https issuer', () => {
    expect(resolveTrustedIssuer(env({ CLERK_JWT_ISSUER: 'https://clerk.prismfilehero.com' })))
      .toBe('https://clerk.prismfilehero.com');
  });

  it('refuses to infer an issuer from the JWKS URL on a deployed Worker', () => {
    expect(resolveTrustedIssuer(env({}))).toBeNull();
  });

  it('refuses a non-https issuer outside localtest', () => {
    expect(resolveTrustedIssuer(env({ ENVIRONMENT: 'production', CLERK_JWT_ISSUER: 'http://127.0.0.1:8799' }))).toBeNull();
  });

  it('refuses a garbage issuer rather than falling back', () => {
    expect(resolveTrustedIssuer(env({ CLERK_JWT_ISSUER: 'not a url' }))).toBeNull();
  });

  it('allows the local stand-in to infer its own http issuer', () => {
    expect(resolveTrustedIssuer(env({ ENVIRONMENT: 'localtest', CLERK_JWKS_URL: 'http://127.0.0.1:8799/.well-known/jwks.json', CLERK_JWT_ISSUER: 'http://127.0.0.1:8799' })))
      .toBe('http://127.0.0.1:8799');
    expect(resolveTrustedIssuer({ CLERK_JWKS_URL: 'http://127.0.0.1:8799/.well-known/jwks.json', ENVIRONMENT: 'localtest' } as any))
      .toBe('http://127.0.0.1:8799');
  });
});
