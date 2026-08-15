import { describe, expect, it } from 'vitest';
import { validateClerkClaims } from '../worker/src/jwtValidation';

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
