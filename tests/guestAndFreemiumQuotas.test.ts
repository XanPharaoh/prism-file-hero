import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isFreeTool,
  isAiTool,
  isProTool,
  TOOL_COSTS,
  LOCAL_PER_TOOL_LIMIT,
  LOCAL_GLOBAL_CAP,
  AI_PER_TOOL_LIMIT,
  AI_GLOBAL_CAP,
  PLAN_LIMITS,
} from '../services/usageConfig';
import {
  getGuestTaskCount,
  incrementGuestTaskCount,
  canGuestPerformTask,
  resetGuestTaskCount,
} from '../services/usageTrackingService';

describe('Tool Tier Classification', () => {
  it('identifies everyday tools as standard free tools', () => {
    expect(isFreeTool('merge')).toBe(true);
    expect(isFreeTool('split')).toBe(true);
    expect(isFreeTool('compress')).toBe(true);
  });

  it('identifies financial and AI tools as pro/ai tools', () => {
    expect(isAiTool('pdf-to-excel')).toBe(true);
    expect(isAiTool('ocr')).toBe(true);
  });

  it('has valid tool cost entries with category and featureType', () => {
    expect(TOOL_COSTS['merge'].category).toBe('free');
    expect(TOOL_COSTS['pdf-to-excel'].category).toBe('ai');
  });

  it('provides isProTool helper identifying pro and ai tools', () => {
    expect(isProTool('pdf-to-excel')).toBe(true);
    expect(isProTool('ocr')).toBe(true);
    expect(isProTool('merge')).toBe(false);
  });
});

describe('Freemium Quota Limits', () => {
  it('enforces 3 daily operations for free tier', () => {
    expect(LOCAL_PER_TOOL_LIMIT).toBe(3);
    expect(LOCAL_GLOBAL_CAP).toBe(3);
    expect(PLAN_LIMITS.free.operations).toBe(3);
  });

  it('locks AI tools on free tier', () => {
    expect(AI_PER_TOOL_LIMIT).toBe(0);
    expect(AI_GLOBAL_CAP).toBe(0);
    expect(PLAN_LIMITS.free.aiPages).toBe(0);
  });

  it('maintains pro tier limits', () => {
    expect(PLAN_LIMITS.pro.operations).toBe(-1);
    expect(PLAN_LIMITS.pro.aiPages).toBe(500);
  });
});

describe('Guest Task Quota in localStorage', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
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

  it('allows 1 free guest task before requiring sign in', () => {
    expect(getGuestTaskCount()).toBe(0);
    expect(canGuestPerformTask()).toBe(true);

    incrementGuestTaskCount();
    expect(getGuestTaskCount()).toBe(1);
    expect(canGuestPerformTask()).toBe(false);

    resetGuestTaskCount();
    expect(getGuestTaskCount()).toBe(0);
    expect(canGuestPerformTask()).toBe(true);
  });
});
