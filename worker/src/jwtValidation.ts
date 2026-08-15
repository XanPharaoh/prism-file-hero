export interface ClerkJwtValidationConfig {
  issuer: string;
  audience?: string;
  nowSeconds?: number;
}

const CLOCK_SKEW_SECONDS = 60;

function audienceMatches(value: unknown, expected: string): boolean {
  return value === expected || (Array.isArray(value) && value.every(item => typeof item === 'string') && value.includes(expected));
}

/** Validates signed Clerk JWT claims after cryptographic signature verification. */
export function validateClerkClaims(payload: Record<string, unknown>, config: ClerkJwtValidationConfig): { sub: string } | null {
  const now = config.nowSeconds ?? Date.now() / 1000;
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) return null;
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= now - CLOCK_SKEW_SECONDS) return null;
  if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat) || payload.iat > now + CLOCK_SKEW_SECONDS) return null;
  if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf) || payload.nbf > now + CLOCK_SKEW_SECONDS)) return null;
  if (payload.iss !== config.issuer) return null;
  if (config.audience && !audienceMatches(payload.aud, config.audience)) return null;
  return { sub: payload.sub };
}
