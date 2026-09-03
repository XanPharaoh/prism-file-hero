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
  it('applies AI page limits to PDF-to-Excel because it can invoke the AI worker', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      expiresAt: Date.now() + 60_000,
      summary: {
        plan: 'free',
        localGlobalUsed: 0,
        localGlobalCap: 15,
        aiGlobalUsed: 0,
        aiGlobalCap: 6,
        toolBreakdown: {},
        nextResetUtc: new Date(Date.now() + 60_000).toISOString(),
        aiPagesUsed: 0,
        aiPagesLimit: 10,
        operationsUsed: 0,
        operationsLimit: 50,
        byTool: {},
        localPagesUsedToday: 14,
        aiPagesUsedToday: 6,
      },
    }));

    const result = await checkLimit('pdf-to-excel', 3, null);

    expect(result.allowed).toBe(false);
    expect(result.limitType).toBe('tool_limit');
    expect(result.daily?.featureType).toBe('ai');
    expect(result.reason).toContain('daily limit of 0 pages for PDF to Excel');
  });

  it('allows standard free tools within freemium operations limit', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      expiresAt: Date.now() + 60_000,
      summary: {
        plan: 'free',
        localGlobalUsed: 0,
        localGlobalCap: 3,
        aiGlobalUsed: 0,
        aiGlobalCap: 0,
        toolBreakdown: {},
        nextResetUtc: new Date(Date.now() + 60_000).toISOString(),
        aiPagesUsed: 0,
        aiPagesLimit: 0,
        operationsUsed: 0,
        operationsLimit: 3,
        byTool: {},
        localPagesUsedToday: 0,
        aiPagesUsedToday: 0,
      },
    }));

    const result = await checkLimit('merge', 1, null);
    expect(result.allowed).toBe(true);
    expect(result.daily?.featureType).toBe('local');
  });

  it('blocks standard free tools when freemium operations limit is reached', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      expiresAt: Date.now() + 60_000,
      summary: {
        plan: 'free',
        localGlobalUsed: 3,
        localGlobalCap: 3,
        aiGlobalUsed: 0,
        aiGlobalCap: 0,
        toolBreakdown: {},
        nextResetUtc: new Date(Date.now() + 60_000).toISOString(),
        aiPagesUsed: 0,
        aiPagesLimit: 0,
        operationsUsed: 3,
        operationsLimit: 3,
        byTool: {},
        localPagesUsedToday: 3,
        aiPagesUsedToday: 0,
      },
    }));

    const result = await checkLimit('merge', 1, null);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Monthly operation limit reached.');
  });
});
