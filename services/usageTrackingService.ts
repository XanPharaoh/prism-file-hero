import {
  PLAN_LIMITS,
  calculateToolCost,
  getFeatureType,
  getGlobalCap,
  getNextSastMidnightDate,
  getPerToolLimit,
  getToolDisplayName,
  LOCAL_GLOBAL_CAP,
  AI_GLOBAL_CAP,
  type FeatureType,
  type Plan,
} from './usageConfig';
import { getAuthToken } from './authService';
import { isInternalDesktopDistribution } from '../src/config/distribution';

const WORKER_BASE_URL = (import.meta as any).env?.VITE_WORKER_URL || 'http://localhost:8787';
const LOCAL_CACHE_KEY = 'pfh_usage_cache_v2';
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface UsageSummary {
  plan: 'free' | 'pro' | 'business' | 'anonymous';
  localGlobalUsed: number;
  localGlobalCap: number;
  aiGlobalUsed: number;
  aiGlobalCap: number;
  toolBreakdown: Record<string, number>;
  nextResetUtc: string;
  aiPagesUsed: number;
  aiPagesLimit: number;
  operationsUsed: number;
  operationsLimit: number;
  byTool: Record<string, { pages: number; ops: number }>;
  localPagesUsedToday: number;
  aiPagesUsedToday: number;
}

export interface UsageReportPayload {
  toolId: string;
  pagesProcessed: number;
  featureType?: FeatureType;
  fileSizeBytes?: number;
  fileName?: string;
  status?: 'SUCCESS' | 'ERROR';
  error?: string;
}

export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  remaining?: { aiPages: number; operations: number };
  partial?: {
    featureType: FeatureType;
    allowedPages: number;
    blockedFromPage: number;
    limitReason: 'tool_limit' | 'global_cap';
    toolUsed: number;
    toolLimit: number;
    globalUsed: number;
    globalCap: number;
  };
  limitType?: 'tool_limit' | 'global_cap';
  matrix?: {
    featureType: FeatureType;
    requestedPages: number;
    toolUsedToday: number;
    toolLimit: number;
    globalUsedToday: number;
    globalCap: number;
    nextReset: string;
  };
  daily?: {
    featureType: FeatureType;
    toolUsed: number;
    toolLimit: number;
    globalUsed: number;
    globalCap: number;
  };
}

interface LocalCache {
  summary: UsageSummary;
  expiresAt: number;
}

export interface UsageData {
  plan: string;
  pages_used: number;
  pages_limit: number;
  operations_used: number;
  operations_limit: number;
  by_tool: Record<string, number>;
  local_pages_used_today: number;
  ai_pages_used_today: number;
  local_daily_limit: number;
  ai_daily_limit: number;
  next_sast_midnight: string;
}

function readLocalCache(): LocalCache | null {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return null;
    const cache: LocalCache = JSON.parse(raw);
    if (Date.now() > cache.expiresAt) return null;
    return cache;
  } catch {
    return null;
  }
}

function writeLocalCache(summary: UsageSummary): void {
  localStorage.setItem(
    LOCAL_CACHE_KEY,
    JSON.stringify({ summary, expiresAt: Date.now() + CACHE_TTL_MS }),
  );
}

function clearLocalCache(): void {
  localStorage.removeItem(LOCAL_CACHE_KEY);
}

async function resolveToken(providedToken?: string | null): Promise<string | null> {
  try {
    if (providedToken) return providedToken;
    return await getAuthToken();
  } catch (err) {
    console.warn('[UsageTracker] Token lookup failed:', err);
    return null;
  }
}

function normalizePlan(plan: UsageSummary['plan']): Plan {
  return plan === 'anonymous' ? 'free' : plan;
}

function getEmptySummary(hasToken: boolean): UsageSummary {
  return {
    plan: hasToken ? 'free' : 'anonymous',
    localGlobalUsed: 0,
    localGlobalCap: LOCAL_GLOBAL_CAP,
    aiGlobalUsed: 0,
    aiGlobalCap: AI_GLOBAL_CAP,
    toolBreakdown: {},
    nextResetUtc: getNextSastMidnightDate().toISOString(),
    aiPagesUsed: 0,
    aiPagesLimit: PLAN_LIMITS.free.aiPages,
    operationsUsed: 0,
    operationsLimit: PLAN_LIMITS.free.operations,
    byTool: {},
    localPagesUsedToday: 0,
    aiPagesUsedToday: 0,
  };
}

function normalizeSummary(raw: Partial<UsageSummary> | null | undefined, hasToken: boolean): UsageSummary {
  const fallback = getEmptySummary(hasToken);
  if (!raw) return fallback;

  return {
    plan: raw.plan ?? fallback.plan,
    localGlobalUsed: raw.localGlobalUsed ?? raw.localPagesUsedToday ?? fallback.localGlobalUsed,
    localGlobalCap: raw.localGlobalCap ?? fallback.localGlobalCap,
    aiGlobalUsed: raw.aiGlobalUsed ?? raw.aiPagesUsedToday ?? fallback.aiGlobalUsed,
    aiGlobalCap: raw.aiGlobalCap ?? fallback.aiGlobalCap,
    toolBreakdown: raw.toolBreakdown ?? fallback.toolBreakdown,
    nextResetUtc: raw.nextResetUtc ?? fallback.nextResetUtc,
    aiPagesUsed: raw.aiPagesUsed ?? fallback.aiPagesUsed,
    aiPagesLimit: raw.aiPagesLimit ?? fallback.aiPagesLimit,
    operationsUsed: raw.operationsUsed ?? fallback.operationsUsed,
    operationsLimit: raw.operationsLimit ?? fallback.operationsLimit,
    byTool: raw.byTool ?? fallback.byTool,
    localPagesUsedToday: raw.localPagesUsedToday ?? raw.localGlobalUsed ?? fallback.localPagesUsedToday,
    aiPagesUsedToday: raw.aiPagesUsedToday ?? raw.aiGlobalUsed ?? fallback.aiPagesUsedToday,
  };
}

function toLegacyUsageData(summary: UsageSummary): UsageData {
  return {
    plan: summary.plan,
    pages_used: summary.aiPagesUsed,
    pages_limit: summary.aiPagesLimit,
    operations_used: summary.operationsUsed,
    operations_limit: summary.operationsLimit,
    by_tool: summary.toolBreakdown,
    local_pages_used_today: summary.localGlobalUsed,
    ai_pages_used_today: summary.aiGlobalUsed,
    local_daily_limit: summary.localGlobalCap,
    ai_daily_limit: summary.aiGlobalCap,
    next_sast_midnight: summary.nextResetUtc,
  };
}

export async function checkLimit(toolId: string, requestedPages: number, _session: any): Promise<LimitCheckResult> {
  if (isInternalDesktopDistribution) return { allowed: true };
  const featureType = getFeatureType(toolId);
  const toolLimit = getPerToolLimit(featureType);
  const globalCap = getGlobalCap(featureType);
  const summary = await getUsageSummary(_session);
  const toolUsed = summary.toolBreakdown[toolId] || 0;
  const globalUsed = featureType === 'ai' ? summary.aiGlobalUsed : summary.localGlobalUsed;
  const nextReset = summary.nextResetUtc;
  const remainingToolPages = Math.max(0, toolLimit - toolUsed);
  const remainingGlobalPages = Math.max(0, globalCap - globalUsed);
  const partialAllowedPages = Math.min(remainingToolPages, remainingGlobalPages);
  const cost = calculateToolCost(toolId, requestedPages);
  const limits = PLAN_LIMITS[normalizePlan(summary.plan)];

  // Native tools are billed as operations, not per-page AI work. Never cut a
  // local PDF into a partial statement simply because it has several pages.
  if (featureType === 'local') {
    if (limits.operations !== -1 && summary.operationsUsed + cost.operations > limits.operations) {
      return { allowed: false, reason: 'Monthly operation limit reached.' };
    }
    return { allowed: true, daily: { featureType, toolUsed, toolLimit, globalUsed, globalCap } };
  }

  const hitToolLimit = toolUsed + requestedPages > toolLimit;
  const hitGlobalCap = globalUsed + requestedPages > globalCap;
  const limitReason = hitToolLimit ? 'tool_limit' : 'global_cap';

  if ((hitToolLimit || hitGlobalCap) && partialAllowedPages > 0) {
    return {
      allowed: true,
      partial: {
        featureType,
        allowedPages: partialAllowedPages,
        blockedFromPage: partialAllowedPages + 1,
        limitReason,
        toolUsed,
        toolLimit,
        globalUsed,
        globalCap,
      },
      daily: { featureType, toolUsed, toolLimit, globalUsed, globalCap },
    };
  }

  if (hitToolLimit) {
    return {
      allowed: false,
      reason: `You've reached the daily limit of ${toolLimit} pages for ${getToolDisplayName(toolId)}.`,
      limitType: 'tool_limit',
      matrix: { featureType, requestedPages, toolUsedToday: toolUsed, toolLimit, globalUsedToday: globalUsed, globalCap, nextReset },
      daily: { featureType, toolUsed, toolLimit, globalUsed, globalCap },
    };
  }

  if (hitGlobalCap) {
    return {
      allowed: false,
      reason: `You've reached your daily global ${featureType === 'ai' ? 'Premium' : 'Free'} limit of ${globalCap} pages.`,
      limitType: 'global_cap',
      matrix: { featureType, requestedPages, toolUsedToday: toolUsed, toolLimit, globalUsedToday: globalUsed, globalCap, nextReset },
      daily: { featureType, toolUsed, toolLimit, globalUsed, globalCap },
    };
  }

  if (limits.aiPages !== -1 && summary.aiPagesUsed + cost.aiPages > limits.aiPages) {
    return { allowed: false, reason: 'Monthly premium page limit reached.' };
  }

  if (limits.operations !== -1 && summary.operationsUsed + cost.operations > limits.operations) {
    return { allowed: false, reason: 'Monthly operation limit reached.' };
  }

  return { allowed: true, daily: { featureType, toolUsed, toolLimit, globalUsed, globalCap } };
}

export async function reportUsage(
  payloadOrToolId: UsageReportPayload | string,
  pagesProcessedOrSession?: number | any,
  maybeSession?: any,
): Promise<void> {
  if (isInternalDesktopDistribution) return;
  const payload: UsageReportPayload = typeof payloadOrToolId === 'string'
    ? {
        toolId: payloadOrToolId,
        pagesProcessed: typeof pagesProcessedOrSession === 'number' ? pagesProcessedOrSession : 0,
        featureType: getFeatureType(payloadOrToolId),
        status: 'SUCCESS',
      }
    : {
        ...payloadOrToolId,
        featureType: payloadOrToolId.featureType ?? getFeatureType(payloadOrToolId.toolId),
        status: payloadOrToolId.status ?? 'SUCCESS',
      };

  try {
    const token = await resolveToken();
    const response = await fetch(`${WORKER_BASE_URL}/api/usage/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      writeLocalCache(await response.json());
    }
  } catch (err) {
    console.warn('[UsageTracker] Report network error:', err);
  }
}

export async function getUsageSummary(_session: any): Promise<UsageSummary> {
  if (isInternalDesktopDistribution) {
    return { ...getEmptySummary(false), plan: 'business', localGlobalCap: -1, aiGlobalCap: -1, aiPagesLimit: -1, operationsLimit: -1 };
  }
  const token = await resolveToken();

  const cached = readLocalCache();
  if (cached) return normalizeSummary(cached.summary, !!token);

  const emptySummary = getEmptySummary(!!token);
  if (!token) return emptySummary;

  try {
    const response = await fetch(`${WORKER_BASE_URL}/api/usage/summary`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.ok) {
      const summary = normalizeSummary(await response.json(), !!token);
      writeLocalCache(summary);
      return summary;
    }
  } catch (err) {
    console.warn('[UsageTracker] Fetch summary error:', err);
  }

  return emptySummary;
}

export function invalidateOnAuthChange(): void {
  clearLocalCache();
}

export function getToolButtonLabel(toolId: string): string {
  const featureType = getFeatureType(toolId);
  const limit = getPerToolLimit(featureType);
  return featureType === 'ai' ? `Try Premium (${limit} Pages/Day)` : `Use Free (${limit} Pages/Day)`;
}

export function getDailyQuotaInfo(summary: UsageSummary, toolId: string) {
  const featureType = getFeatureType(toolId);
  return {
    featureType,
    toolUsed: summary.toolBreakdown[toolId] || 0,
    toolLimit: getPerToolLimit(featureType),
    globalUsed: featureType === 'ai' ? summary.aiGlobalUsed : summary.localGlobalUsed,
    globalCap: getGlobalCap(featureType),
  };
}

export async function fetchUsageFromServer(): Promise<UsageData | null> {
  const summary = await getUsageSummary(null);
  return toLegacyUsageData(summary);
}

export function getRemainingPages(): number {
  const summary = readLocalCache()?.summary;
  if (!summary) return 0;
  return Math.max(0, summary.aiPagesLimit - summary.aiPagesUsed);
}

export function getUsageCountForUser(_userId?: string): number {
  return 0;
}

const GUEST_TASKS_STORAGE_KEY = 'pfh_guest_tasks_count';

export function getGuestTaskCount(): number {
  try {
    const raw = localStorage.getItem(GUEST_TASKS_STORAGE_KEY);
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

export function incrementGuestTaskCount(): number {
  const current = getGuestTaskCount();
  const next = current + 1;
  try {
    localStorage.setItem(GUEST_TASKS_STORAGE_KEY, next.toString());
  } catch {
    // ignore storage error
  }
  return next;
}

export function canGuestPerformTask(): boolean {
  return getGuestTaskCount() < 1;
}

export function resetGuestTaskCount(): void {
  try {
    localStorage.removeItem(GUEST_TASKS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export { getToolDisplayName, isProTool } from './usageConfig';
