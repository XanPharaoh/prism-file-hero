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
  // A hybrid tool that is running locally must not be blocked by the cloud-page ceilings: the
  // pages it books are the provider's, and only the AI worker knows whether it was called.
  it('governs a hybrid local run by the local ceilings, not the cloud budget', async () => {
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

    const hybrid = await checkLimit('pdf-to-excel', 3, null);
    expect(hybrid.allowed).toBe(true);
    expect(hybrid.daily?.featureType).toBe('local');

    // The same tool escalated to the provider is a cloud call and is metered as one.
    const cloud = await checkLimit('pdf-to-word', 3, null);
    expect(cloud.allowed).toBe(false);
    expect(cloud.daily?.featureType).toBe('ai');
    expect(cloud.reason).toContain('daily limit of 0 pages for PDF to Word');
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

  // Regression: the daily AI ceiling used to be read as the free-tier lockout (0) for
  // every plan, so a paid user was denied by the browser after the backend allowed it.
  it('allows a paid user an AI operation with no daily ceiling', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      expiresAt: Date.now() + 60_000,
      summary: {
        plan: 'pro',
        localGlobalUsed: 0,
        localGlobalCap: 3,
        aiGlobalUsed: 0,
        aiGlobalCap: -1,
        toolBreakdown: {},
        nextResetUtc: new Date(Date.now() + 60_000).toISOString(),
        aiPagesUsed: 0,
        aiPagesLimit: 500,
        operationsUsed: 0,
        operationsLimit: -1,
        byTool: {},
        localPagesUsedToday: 0,
        aiPagesUsedToday: 0,
      },
    }));

    const result = await checkLimit('pdf-to-word', 2, null);
    expect(result.allowed).toBe(true);
    expect(result.daily).toEqual({ featureType: 'ai', toolUsed: 0, toolLimit: -1, globalUsed: 0, globalCap: -1 });
  });

  it('keeps a paid user past the free tier daily ceiling, bounded only by the monthly budget', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      expiresAt: Date.now() + 60_000,
      summary: {
        plan: 'pro',
        localGlobalUsed: 0,
        localGlobalCap: 3,
        aiGlobalUsed: 120,
        aiGlobalCap: -1,
        toolBreakdown: { 'pdf-to-word': 120 },
        nextResetUtc: new Date(Date.now() + 60_000).toISOString(),
        aiPagesUsed: 120,
        aiPagesLimit: 500,
        operationsUsed: 12,
        operationsLimit: -1,
        byTool: {},
        localPagesUsedToday: 0,
        aiPagesUsedToday: 120,
      },
    }));

    const result = await checkLimit('pdf-to-word', 10, null);
    expect(result.allowed).toBe(true);
  });

  it('enforces the monthly AI budget for a paid user independently of the daily ceiling', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      expiresAt: Date.now() + 60_000,
      summary: {
        plan: 'pro',
        localGlobalUsed: 0,
        localGlobalCap: 3,
        aiGlobalUsed: 0,
        aiGlobalCap: 6,
        toolBreakdown: {},
        nextResetUtc: new Date(Date.now() + 60_000).toISOString(),
        aiPagesUsed: 500,
        aiPagesLimit: 500,
        operationsUsed: 4,
        operationsLimit: -1,
        byTool: {},
        localPagesUsedToday: 0,
        aiPagesUsedToday: 0,
      },
    }));

    const result = await checkLimit('pdf-to-word', 1, null);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('Monthly premium page limit reached.');
  });
});
