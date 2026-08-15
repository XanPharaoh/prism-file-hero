import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Force the public distribution so the limit-checking logic is always exercised
// regardless of the VITE_DISTRIBUTION env var at build time.
vi.mock('../src/config/distribution', () => ({
  distribution: 'public',
  isInternalDesktopDistribution: false,
  isPublicDistribution: true,
}));

import { checkLimit } from '../services/usageTrackingService';

const CACHE_KEY = 'pfh_usage_cache_v2';
const storage = new Map<string, string>();

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});

afterEach(() => {
  storage.clear();
  vi.unstubAllGlobals();
});

describe('usageTrackingService', () => {
  it('does not partially cap native PDF-to-Excel statements by page count', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      expiresAt: Date.now() + 60_000,
      summary: {
        plan: 'free',
        localGlobalUsed: 14,
        localGlobalCap: 15,
        aiGlobalUsed: 6,
        aiGlobalCap: 6,
        toolBreakdown: { 'pdf-to-excel': 4 },
        nextResetUtc: new Date(Date.now() + 60_000).toISOString(),
        aiPagesUsed: 6,
        aiPagesLimit: 10,
        operationsUsed: 1,
        operationsLimit: 50,
        byTool: {},
        localPagesUsedToday: 14,
        aiPagesUsedToday: 6,
      },
    }));

    const result = await checkLimit('pdf-to-excel', 4, null);

    expect(result.allowed).toBe(true);
    expect(result.partial).toBeUndefined();
    expect(result.daily?.featureType).toBe('local');
  });
});
