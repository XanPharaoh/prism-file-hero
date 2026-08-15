build the universal usage tracking system for Prism File Hero. 

## 1. Usage Configuration (`services/usageConfig.ts`)

```typescript
/**
 * Universal Usage Tracking Configuration
 * Defines all tools, their costs, and plan limits
 */

export type ToolID = 
  | 'merge'
  | 'split'
  | 'compress'
  | 'pdf-to-excel'
  | 'pdf-to-word'
  | 'pdf-to-jpg'
  | 'jpg-to-pdf'
  | 'ocr'
  | 'ocr-to-pdf'
  | 'ocr-to-md'
  | 'protect'
  | 'redact'
  | 'watermark'
  | 'rotate'
  | 'compare'
  | 'grammar-check'
  | 'fnb-statement';

export type Plan = 'free' | 'pro' | 'business';

export interface ToolConfig {
  id: ToolID;
  name: string;
  category: 'free' | 'ai';
  aiPagesPerPage: number; // AI pages consumed per PDF page processed
  aiPagesFlat: number;    // Flat AI page cost (e.g., compare = 2 pages)
  operationCost: number;  // Counts as 1 "operation" for free tools
}

export interface PlanLimits {
  aiPages: number;        // AI pages per month (-1 = unlimited)
  operations: number;     // Free tool operations per month (-1 = unlimited)
  maxFileSizeMB: number;  // Max file size per upload
  maxPagesPerFile: number; // Max pages per file
}

/**
 * Tool cost matrix - single source of truth
 */
export const TOOL_CONFIGS: Record<ToolID, ToolConfig> = {
  // Free client-side tools (0 AI cost, 1 operation)
  'merge': {
    id: 'merge',
    name: 'Merge PDF',
    category: 'free',
    aiPagesPerPage: 0,
    aiPagesFlat: 0,
    operationCost: 1
  },
  'split': {
    id: 'split',
    name: 'Split PDF',
    category: 'free',
    aiPagesPerPage: 0,
    aiPagesFlat: 0,
    operationCost: 1
  },
  'compress': {
    id: 'compress',
    name: 'Compress PDF',
    category: 'free',
    aiPagesPerPage: 0,
    aiPagesFlat: 0,
    operationCost: 1
  },
  'rotate': {
    id: 'rotate',
    name: 'Rotate PDF',
    category: 'free',
    aiPagesPerPage: 0,
    aiPagesFlat: 0,
    operationCost: 1
  },
  'protect': {
    id: 'protect',
    name: 'Protect PDF',
    category: 'free',
    aiPagesPerPage: 0,
    aiPagesFlat: 0,
    operationCost: 1
  },
  'watermark': {
    id: 'watermark',
    name: 'Watermark',
    category: 'free',
    aiPagesPerPage: 0,
    aiPagesFlat: 0,
    operationCost: 1
  },
  'jpg-to-pdf': {
    id: 'jpg-to-pdf',
    name: 'JPG to PDF',
    category: 'free',
    aiPagesPerPage: 0,
    aiPagesFlat: 0,
    operationCost: 1
  },
  'pdf-to-jpg': {
    id: 'pdf-to-jpg',
    name: 'PDF to JPG',
    category: 'free',
    aiPagesPerPage: 0,
    aiPagesFlat: 0,
    operationCost: 1
  },

  // AI tools (costs AI pages per page processed)
  'pdf-to-excel': {
    id: 'pdf-to-excel',
    name: 'PDF to Excel',
    category: 'ai',
    aiPagesPerPage: 1,
    aiPagesFlat: 0,
    operationCost: 0
  },
  'ocr': {
    id: 'ocr',
    name: 'OCR PDF',
    category: 'ai',
    aiPagesPerPage: 1,
    aiPagesFlat: 0,
    operationCost: 0
  },
  'ocr-to-pdf': {
    id: 'ocr-to-pdf',
    name: 'OCR to PDF',
    category: 'ai',
    aiPagesPerPage: 1,
    aiPagesFlat: 0,
    operationCost: 0
  },
  'ocr-to-md': {
    id: 'ocr-to-md',
    name: 'OCR to Markdown',
    category: 'ai',
    aiPagesPerPage: 1,
    aiPagesFlat: 0,
    operationCost: 0
  },
  'pdf-to-word': {
    id: 'pdf-to-word',
    name: 'PDF to Markdown',
    category: 'ai',
    aiPagesPerPage: 1,
    aiPagesFlat: 0,
    operationCost: 0
  },
  'redact': {
    id: 'redact',
    name: 'Redact PDF',
    category: 'ai',
    aiPagesPerPage: 1,
    aiPagesFlat: 0,
    operationCost: 0
  },
  'compare': {
    id: 'compare',
    name: 'Compare PDF',
    category: 'ai',
    aiPagesPerPage: 0,
    aiPagesFlat: 2, // Flat cost: 2 AI pages per comparison
    operationCost: 0
  },
  'grammar-check': {
    id: 'grammar-check',
    name: 'Grammar Check',
    category: 'ai',
    aiPagesPerPage: 1,
    aiPagesFlat: 0,
    operationCost: 0
  },
  'fnb-statement': {
    id: 'fnb-statement',
    name: 'FNB Statement',
    category: 'ai',
    aiPagesPerPage: 1,
    aiPagesFlat: 0,
    operationCost: 0
  }
};

/**
 * Plan limits - defines what each plan can do
 */
export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    aiPages: 10,
    operations: 50,
    maxFileSizeMB: 10,
    maxPagesPerFile: 20
  },
  pro: {
    aiPages: 500,
    operations: -1, // unlimited
    maxFileSizeMB: 50,
    maxPagesPerFile: 100
  },
  business: {
    aiPages: -1, // unlimited
    operations: -1, // unlimited
    maxFileSizeMB: 100,
    maxPagesPerFile: 500
  }
};

/**
 * Calculate total AI page cost for a tool invocation
 */
export function calculateToolCost(
  toolId: ToolID,
  pagesProcessed: number
): {
  aiPages: number;
  operations: number;
} {
  const config = TOOL_CONFIGS[toolId];
  if (!config) return { aiPages: 0, operations: 0 };

  return {
    aiPages: (config.aiPagesPerPage * pagesProcessed) + config.aiPagesFlat,
    operations: config.operationCost
  };
}

/**
 * Check if a planned invocation would exceed plan limits
 */
export function checkWithinLimit(
  plan: Plan,
  currentAiPages: number,
  currentOperations: number,
  plannedAiPages: number,
  plannedOperations: number
): {
  allowed: boolean;
  reason?: string;
  remaining?: { aiPages: number; operations: number };
} {
  const limits = PLAN_LIMITS[plan];

  // AI pages check
  if (limits.aiPages !== -1) {
    const remaining = limits.aiPages - currentAiPages;
    if (currentAiPages + plannedAiPages > limits.aiPages) {
      return {
        allowed: false,
        reason: `AI page limit reached. You've used ${currentAiPages} of ${limits.aiPages} AI pages this month. Upgrade to Pro for 500 pages/month.`,
        remaining: {
          aiPages: Math.max(0, remaining),
          operations: Math.max(0, limits.operations - currentOperations)
        }
      };
    }
  }

  // Operations check
  if (limits.operations !== -1) {
    const remaining = limits.operations - currentOperations;
    if (currentOperations + plannedOperations > limits.operations) {
      return {
        allowed: false,
        reason: `Operation limit reached. You've used ${currentOperations} of ${limits.operations} free operations this month.`,
        remaining: {
          aiPages: Math.max(0, limits.aiPages - currentAiPages),
          operations: Math.max(0, remaining)
        }
      };
    }
  }

  return {
    allowed: true,
    remaining: {
      aiPages: limits.aiPages === -1 ? -1 : limits.aiPages - currentAiPages - plannedAiPages,
      operations: limits.operations === -1 ? -1 : limits.operations - currentOperations - plannedOperations
    }
  };
}

/**
 * Get current month key for database queries
 */
export function getCurrentMonthKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 7); // "2026-06"
}

/**
 * Check if tool is an AI tool
 */
export function isAiTool(toolId: ToolID): boolean {
  return TOOL_CONFIGS[toolId]?.category === 'ai';
}

/**
 * Get all AI tool IDs
 */
export function getAiToolIds(): ToolID[] {
  return (Object.keys(TOOL_CONFIGS) as ToolID[]).filter(
    id => TOOL_CONFIGS[id].category === 'ai'
  );
}
```

## 2. Client-Side Usage Tracking Service (`services/usageTrackingService.ts`)

```typescript
/**
 * Universal Usage Tracking Service (Client-Side)
 * Handles pre-flight checks, post-flight reporting, and usage display
 */

import type { ToolID, Plan } from './usageConfig';
import {
  TOOL_CONFIGS,
  PLAN_LIMITS,
  calculateToolCost,
  checkWithinLimit,
  getCurrentMonthKey,
  isAiTool
} from './usageConfig';

const WORKER_BASE_URL = (import.meta as any).env?.VITE_WORKER_URL || 'http://localhost:8787';
const LOCAL_CACHE_KEY = 'prism_usage_cache_v2';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface UsageSummary {
  userId: string | null;
  plan: Plan;
  month: string;
  aiPagesUsed: number;
  aiPagesLimit: number;
  operationsUsed: number;
  operationsLimit: number;
  byTool: Record<string, {
    aiPages: number;
    operations: number;
    lastUsed: string;
  }>;
  lastSynced: string;
}

export interface UsageReportPayload {
  toolId: ToolID;
  pagesProcessed: number;
  fileSizeBytes: number;
  fileName: string;
  status: 'SUCCESS' | 'ERROR';
  error?: string;
}

export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  cost: { aiPages: number; operations: number };
  remaining: { aiPages: number; operations: number };
}

// Local cache layer
interface LocalCache {
  summary: UsageSummary | null;
  expiresAt: number;
}

function readLocalCache(userId: string | null): UsageSummary | null {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) return null;
    
    const cache: LocalCache = JSON.parse(raw);
    if (cache.expiresAt < Date.now()) return null;
    if (cache.summary?.userId !== userId) return null;
    
    return cache.summary;
  } catch {
    return null;
  }
}

function writeLocalCache(summary: UsageSummary): void {
  try {
    const cache: LocalCache = {
      summary,
      expiresAt: Date.now() + CACHE_TTL_MS
    };
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage full or disabled
  }
}

function clearLocalCache(): void {
  try {
    localStorage.removeItem(LOCAL_CACHE_KEY);
  } catch {}
}

function emptySummary(userId: string | null, plan: Plan = 'free'): UsageSummary {
  return {
    userId,
    plan,
    month: getCurrentMonthKey(),
    aiPagesUsed: 0,
    aiPagesLimit: PLAN_LIMITS[plan].aiPages,
    operationsUsed: 0,
    operationsLimit: PLAN_LIMITS[plan].operations,
    byTool: {},
    lastSynced: new Date().toISOString()
  };
}

async function authHeaders(session: any): Promise<HeadersInit> {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  return headers;
}

/**
 * PRE-FLIGHT: Check if a planned tool invocation is within limits
 * Call this BEFORE starting any tool processing
 */
export async function checkLimit(
  toolId: ToolID,
  pagesToProcess: number,
  session: any
): Promise<LimitCheckResult> {
  const cost = calculateToolCost(toolId, pagesToProcess);
  const summary = await getUsageSummary(session);

  const check = checkWithinLimit(
    summary.plan,
    summary.aiPagesUsed,
    summary.operationsUsed,
    cost.aiPages,
    cost.operations
  );

  return {
    allowed: check.allowed,
    reason: check.reason,
    cost,
    remaining: check.remaining ?? { aiPages: 0, operations: 0 }
  };
}

/**
 * POST-FLIGHT: Report a completed (or failed) tool invocation to the Worker
 * Call this AFTER the tool finishes (success or error)
 * Fire-and-forget: errors are logged but don't throw
 */
export async function reportUsage(
  payload: UsageReportPayload,
  session: any
): Promise<void> {
  try {
    const headers = await authHeaders(session);
    const response = await fetch(`${WORKER_BASE_URL}/api/usage/report`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.warn(`[UsageTracker] Report failed: ${response.status}`);
      return;
    }

    // Server returns updated summary - use it to refresh cache
    const updatedSummary: UsageSummary = await response.json();
    writeLocalCache(updatedSummary);
  } catch (err) {
    console.warn('[UsageTracker] Report network error:', err);
  }
}

/**
 * GET USAGE SUMMARY: Fetch current usage for display
 * Returns cached data if fresh, otherwise fetches from Worker
 */
export async function getUsageSummary(session: any): Promise<UsageSummary> {
  const userId = session?.user?.id ?? null;

  // Try local cache first
  const cached = readLocalCache(userId);
  if (cached) return cached;

  // Anonymous users get empty summary
  if (!session?.access_token) {
    const summary = emptySummary(null, 'free');
    writeLocalCache(summary);
    return summary;
  }

  // Authenticated: fetch from Worker
  try {
    const headers = await authHeaders(session);
    const response = await fetch(`${WORKER_BASE_URL}/api/usage/summary`, {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      console.warn(`[UsageTracker] Summary fetch failed: ${response.status}`);
      return emptySummary(userId);
    }

    const summary: UsageSummary = await response.json();
    writeLocalCache(summary);
    return summary;
  } catch (err) {
    console.warn('[UsageTracker] Summary fetch network error:', err);
    return emptySummary(userId);
  }
}

/**
 * FORCE REFRESH: Bypass cache and fetch fresh data from Worker
 */
export async function refreshUsage(session: any): Promise<UsageSummary> {
  clearLocalCache();
  return getUsageSummary(session);
}

/**
 * INVALIDATE ON LOGOUT: Clear all cached usage data
 */
export function invalidateOnAuthChange(): void {
  clearLocalCache();
}

/**
 * Format usage for display
 */
export function formatUsage(used: number, limit: number): string {
  if (limit === -1) return `${used} (Unlimited)`;
  return `${used} / ${limit}`;
}

/**
 * Usage percentage for progress bars (0-100)
 */
export function usagePercent(used: number, limit: number): number {
  if (limit === -1) return used > 0 ? 10 : 0;
  if (limit === 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

/**
 * Get tool display name
 */
export function getToolDisplayName(toolId: ToolID): string {
  return TOOL_CONFIGS[toolId]?.name ?? toolId;
}

/**
 * Should show AI badge for this tool
 */
export function shouldShowAiBadge(toolId: ToolID): boolean {
  return isAiTool(toolId);
}

// Legacy API (for backwards compatibility)
export const FREE_LIMIT = PLAN_LIMITS.free.aiPages;

export function logUsage(params: {
  toolId: ToolID;
  status: 'SUCCESS' | 'ERROR';
  fileName: string;
  fileSize: number;
  userId?: string;
  error?: string;
}): void {
  console.warn('[UsageTracker] logUsage() is deprecated. Use reportUsage() with session.');
}

export function hasExceededFreeLimit(userId?: string): boolean {
  return false;
}

export function getUsageCountForUser(userId?: string): number {
  return 0;
}
```

## 3. Server-Side Usage Tracker (`worker/src/usageTracker.ts`)

```typescript
/**
 * Server-Side Usage Tracker (Authoritative)
 * Handles JWT authentication, plan enforcement, and usage logging
 */

import { Env, getUserPlan } from './db';
import {
  TOOL_CONFIGS,
  PLAN_LIMITS,
  calculateToolCost,
  getCurrentMonthKey,
  type Plan
} from '../../services/usageConfig';

export interface UsageReportInput {
  toolId: string;
  pagesProcessed: number;
  fileSizeBytes: number;
  fileName: string;
  status: 'SUCCESS' | 'ERROR';
  error?: string;
}

export interface UsageSummaryRow {
  userId: string | null;
  plan: Plan;
  month: string;
  aiPagesUsed: number;
  aiPagesLimit: number;
  operationsUsed: number;
  operationsLimit: number;
  byTool: Record<string, { aiPages: number; operations: number; lastUsed: string }>;
  lastSynced: string;
}

interface UsageLogRow {
  tool_id: string;
  ai_pages: number;
  operations: number;
  file_size_bytes: number;
  status: string;
  created_at: string;
}

export function getClientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown';
}

/**
 * Record a tool invocation and return updated summary
 */
export async function reportAndSummarize(
  env: Env,
  userId: string | null,
  clientIp: string,
  input: UsageReportInput
): Promise<UsageSummaryRow> {
  const month = getCurrentMonthKey();
  const cost = calculateToolCost(input.toolId as any, input.pagesProcessed);
  const trackingKey = userId ?? `ip:${clientIp}`;

  // Insert usage log row
  await env.DB.prepare(`
    INSERT INTO usage_logs (
      tracking_key, user_id, month, tool_id,
      ai_pages, operations, file_size_bytes,
      file_name, status, error_message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      trackingKey,
      userId,
      month,
      input.toolId,
      cost.aiPages,
      cost.operations,
      input.fileSizeBytes,
      input.fileName,
      input.status,
      input.error ?? null,
      new Date().toISOString()
    )
    .run();

  return getUsageSummary(env, userId, clientIp);
}

/**
 * Build complete usage summary for a user or IP
 */
export async function getUsageSummary(
  env: Env,
  userId: string | null,
  clientIp: string
): Promise<UsageSummaryRow> {
  const month = getCurrentMonthKey();
  const trackingKey = userId ?? `ip:${clientIp}`;

  let plan: Plan = 'free';
  if (userId) {
    plan = await getUserPlan(env, userId);
  }

  // Aggregate all logs for this tracking key + month
  const { results } = await env.DB.prepare(`
    SELECT tool_id, ai_pages, operations, file_size_bytes, status, created_at
    FROM usage_logs
    WHERE tracking_key = ? AND month = ?
    ORDER BY created_at DESC
  `)
    .bind(trackingKey, month)
    .all<UsageLogRow>();

  const rows = results ?? [];

  let aiPagesUsed = 0;
  let operationsUsed = 0;
  const byTool: Record<string, { aiPages: number; operations: number; lastUsed: string }> = {};

  for (const row of rows) {
    if (row.status === 'SUCCESS') {
      aiPagesUsed += row.ai_pages;
      operationsUsed += row.operations;
    }

    if (!byTool[row.tool_id]) {
      byTool[row.tool_id] = { aiPages: 0, operations: 0, lastUsed: row.created_at };
    }
    if (row.status === 'SUCCESS') {
      byTool[row.tool_id].aiPages += row.ai_pages;
      byTool[row.tool_id].operations += row.operations;
    }
    if (row.created_at > byTool[row.tool_id].lastUsed) {
      byTool[row.tool_id].lastUsed = row.created_at;
    }
  }

  const limits = PLAN_LIMITS[plan];

  return {
    userId,
    plan,
    month,
    aiPagesUsed,
    aiPagesLimit: limits.aiPages,
    operationsUsed,
    operationsLimit: limits.operations,
    byTool,
    lastSynced: new Date().toISOString()
  };
}

/**
 * Pre-flight server-side limit check
 */
export async function checkServerLimit(
  env: Env,
  userId: string | null,
  clientIp: string,
  toolId: string,
  pagesToProcess: number
): Promise<{ allowed: boolean; reason?: string }> {
  const summary = await getUsageSummary(env, userId, clientIp);
  const cost = calculateToolCost(toolId as any, pagesToProcess);
  const limits = PLAN_LIMITS[summary.plan];

  if (limits.aiPages !== -1 && summary.aiPagesUsed + cost.aiPages > limits.aiPages) {
    return {
      allowed: false,
      reason: `AI page limit reached (${summary.aiPagesUsed}/${limits.aiPages} this month). Upgrade for more.`
    };
  }

  if (limits.operations !== -1 && summary.operationsUsed + cost.operations > limits.operations) {
    return {
      allowed: false,
      reason: `Operation limit reached (${summary.operationsUsed}/${limits.operations} this month).`
    };
  }

  // Anonymous IP abuse check
  if (!userId && cost.aiPages > 0) {
    const ANONYMOUS_AI_CAP = 5;
    if (summary.aiPagesUsed + cost.aiPages > ANONYMOUS_AI_CAP) {
      return {
        allowed: false,
        reason: 'Sign in to use AI tools. Anonymous AI usage is limited.'
      };
    }
  }

  return { allowed: true };
}
```

## 4. Integration Example (App.tsx usage)

```typescript
import {
  checkLimit,
  reportUsage,
  getUsageSummary,
  refreshUsage,
  invalidateOnAuthChange,
  formatUsage,
  usagePercent
} from './services/usageTrackingService';

// In your App component:
const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);

// Sync usage on auth change
useEffect(() => {
  let cancelled = false;
  (async () => {
    const summary = await getUsageSummary(session);
    if (!cancelled) setUsageSummary(summary);
  })();
  return () => { cancelled = true; };
}, [session]);

// In your runHero function:
const runHero = async () => {
  if (!selectedTool || batch.length === 0 || isProcessing) return;

  // PRE-FLIGHT: Check limits
  const estimatedPages = batch.length;
  const limitCheck = await checkLimit(selectedTool, estimatedPages, session);

  if (!limitCheck.allowed) {
    setToast({
      message: limitCheck.reason ?? 'Usage limit reached',
      type: 'error'
    });
    setShowUpgradeCTA(true);
    return;
  }

  setIsProcessing(true);

  try {
    for (const item of batch) {
      // Process item...
      const pagesProcessed = /* actual pages processed */;

      // POST-FLIGHT: Report usage
      await reportUsage({
        toolId: selectedTool,
        pagesProcessed,
        fileSizeBytes: item.fileSize,
        fileName: item.fileName,
        status: 'SUCCESS'
      }, session);

      const updated = await refreshUsage(session);
      setUsageSummary(updated);
    }
  } catch (err: any) {
    await reportUsage({
      toolId: selectedTool,
      pagesProcessed: 0,
      fileSizeBytes: batch[0]?.fileSize ?? 0,
      fileName: batch[0]?.fileName ?? 'unknown',
      status: 'ERROR',
      error: err.message
    }, session);
    throw err;
  } finally {
    setIsProcessing(false);
  }
};

// Display usage in AccountPanel:
{usageSummary && (
  <div className="text-xs text-slate-500">
    <div>AI Pages: {formatUsage(usageSummary.aiPagesUsed, usageSummary.aiPagesLimit)}</div>
    <div className="w-32 h-1.5 bg-slate-200 rounded-full overflow-hidden">
      <div
        className="h-full bg-indigo-500 transition-all"
        style={{ width: `${usagePercent(usageSummary.aiPagesUsed, usageSummary.aiPagesLimit)}%` }}
      />
    </div>
  </div>
)}
```

make sure to update my complete source code with updates.md