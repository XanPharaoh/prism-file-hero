import { getUserPlan, type SupabaseEnv } from './db';
import {
  PLAN_LIMITS,
  calculateToolCost,
  getCurrentMonthKey,
  getFeatureType,
  getGlobalCap,
  type Plan,
} from '../../services/usageConfig';

type WorkerEnv = SupabaseEnv;
type FeatureType = 'ai' | 'local';
type UsageStatus = 'PENDING' | 'SUCCESS' | 'ERROR';

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
  localGlobalUsed: number;
  localGlobalCap: number;
  aiGlobalUsed: number;
  aiGlobalCap: number;
  toolBreakdown: Record<string, number>;
  nextSastMidnight: string;
}

export interface LimitResult {
  allowed: boolean;
  reason?: string;
  plan?: Plan;
  aiPagesUsed?: number;
  aiPagesLimit?: number;
  toolUsed?: number;
  toolLimit?: number;
  globalUsed?: number;
  globalCap?: number;
  nextReset?: string;
}

function authHeaders(env: WorkerEnv): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

function trackingKey(userId: string | null, clientIp: string): string {
  return userId ?? `ip:${clientIp}`;
}

function getSastMidnightUTC(): string {
  const now = Date.now();
  const offset = 2 * 60 * 60 * 1000;
  return new Date(Math.floor((now + offset) / 86_400_000) * 86_400_000 - offset).toISOString();
}

function getNextSastMidnightUTC(): string {
  return new Date(new Date(getSastMidnightUTC()).getTime() + 86_400_000).toISOString();
}

async function callRpc<T>(env: WorkerEnv, name: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: authHeaders(env),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${name} failed: ${response.status} ${await response.text()}`);
  }
  // A void-returning function (settle_usage) answers 200 with an empty body; parsing that
  // as JSON threw, so reservations were never actually closed.
  const text = await response.text();
  return (text ? JSON.parse(text) : []) as T;
}

function toLimitResult(row: Record<string, unknown>): LimitResult {
  return {
    allowed: row.allowed === true,
    reason: typeof row.reason === 'string' ? row.reason : undefined,
    plan: row.plan as Plan | undefined,
    aiPagesUsed: Number(row.ai_pages_used ?? 0),
    aiPagesLimit: Number(row.ai_pages_limit ?? 0),
    toolUsed: Number(row.tool_used ?? 0),
    toolLimit: Number(row.tool_limit ?? 0),
    globalUsed: Number(row.global_used ?? 0),
    globalCap: Number(row.global_cap ?? 0),
    nextReset: typeof row.next_reset === 'string' ? row.next_reset : undefined,
  };
}

/** Non-consuming UX preflight. The reserve RPC remains the final authority. */
/**
 * Non-consuming preflight. A browser-executed run (local or hybrid) books no cloud pages here —
 * only a call that will actually reach a provider does, and that booking happens in the AI proxy.
 * What this check does enforce server-side is the premium gate and the plan's practical local
 * ceilings, neither of which the browser is trusted to apply.
 */
export async function checkServerLimit(
  env: WorkerEnv,
  userId: string | null,
  clientIp: string,
  toolId: string,
  pagesToProcess: number,
): Promise<LimitResult> {
  const full = calculateToolCost(toolId, pagesToProcess);
  const cost = getFeatureType(toolId) === 'ai'
    ? full
    : { aiPages: 0, operations: full.operations };
  const rows = await callRpc<Array<Record<string, unknown>>>(env, 'check_usage_limit', {
    p_user_id: userId,
    p_tracking_key: trackingKey(userId, clientIp),
    p_ip_address: clientIp,
    p_tool_id: toolId,
    p_ai_pages: cost.aiPages,
    p_operations: cost.operations,
    p_page_count: getFeatureType(toolId) === 'ai' ? cost.aiPages : pagesToProcess,
  });
  if (!rows[0]) throw new Error('check_usage_limit returned no result');
  return toLimitResult(rows[0]);
}

export async function reserveUsage(
  env: WorkerEnv,
  userId: string,
  clientIp: string,
  toolId: string,
  pagesToProcess: number,
): Promise<{ requestId: string; limit: LimitResult }> {
  const cost = calculateToolCost(toolId, pagesToProcess);
  const requestId = crypto.randomUUID();
  const rows = await callRpc<Array<Record<string, unknown>>>(env, 'reserve_usage', {
    p_request_id: requestId,
    p_user_id: userId,
    p_tracking_key: trackingKey(userId, clientIp),
    p_ip_address: clientIp,
    p_tool_id: toolId,
    p_ai_pages: cost.aiPages,
    p_operations: cost.operations,
    p_page_count: getFeatureType(toolId) === 'ai' ? cost.aiPages : pagesToProcess,
  });
  if (!rows[0]) throw new Error('reserve_usage returned no result');
  return { requestId, limit: toLimitResult(rows[0]) };
}

export async function settleUsage(env: WorkerEnv, requestId: string, status: Extract<UsageStatus, 'SUCCESS' | 'ERROR'>): Promise<void> {
  await callRpc(env, 'settle_usage', { p_request_id: requestId, p_status: status });
}

/** Records non-billable local-tool telemetry. AI usage is recorded only by reserveUsage. */
export async function reportAndSummarize(
  env: WorkerEnv,
  userId: string | null,
  clientIp: string,
  input: UsageReportInput,
): Promise<UsageSummaryRow> {
  const featureType = getFeatureType(input.toolId);
  if (featureType === 'ai') throw new Error('AI usage is recorded by the worker execution path');
  const cost = calculateToolCost(input.toolId, input.pagesProcessed);
  // A completion report from the browser is local telemetry, never proof that a provider was
  // paid; anything that would book cloud pages here is rejected rather than recorded.
  if (cost.aiPages > 0) throw new Error('Cloud pages are booked by the AI execution path');
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/usage_logs`, {
    method: 'POST',
    headers: { ...authHeaders(env), Prefer: 'return=minimal' },
    body: JSON.stringify({
      request_id: crypto.randomUUID(),
      tracking_key: trackingKey(userId, clientIp),
      user_id: userId,
      ip_address: clientIp,
      month: getCurrentMonthKey(),
      tool_id: input.toolId,
      ai_pages: cost.aiPages,
      operations: cost.operations,
      page_count: input.pagesProcessed,
      feature_type: featureType,
      file_size_bytes: input.fileSizeBytes,
      file_name: input.fileName,
      status: input.status,
      error_message: input.error ?? null,
    }),
  });
  if (!response.ok) throw new Error(`usage telemetry insert failed: ${await response.text()}`);
  return getUsageSummary(env, userId, clientIp);
}

export async function getUsageSummary(env: WorkerEnv, userId: string | null, clientIp: string): Promise<UsageSummaryRow> {
  const month = getCurrentMonthKey();
  const key = trackingKey(userId, clientIp);
  const params = new URLSearchParams({
    tracking_key: `eq.${key}`,
    month: `eq.${month}`,
    select: 'tool_id,ai_pages,operations,page_count,feature_type,status,created_at',
    order: 'created_at.desc',
  });
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/usage_logs?${params}`, { headers: authHeaders(env) });
  if (!response.ok) throw new Error(`usage summary read failed: ${await response.text()}`);
  const rows = await response.json() as Array<{
    tool_id: string; ai_pages: number; operations: number; page_count: number;
    feature_type: FeatureType; status: UsageStatus; created_at: string;
  }>;
  const plan = userId ? await getUserPlan(env, userId) : 'free';
  const byTool: UsageSummaryRow['byTool'] = {};
  const today = new Date(getSastMidnightUTC());
  let aiPagesUsed = 0;
  let operationsUsed = 0;
  let localGlobalUsed = 0;
  let aiGlobalUsed = 0;
  const toolBreakdown: Record<string, number> = {};

  for (const row of rows) {
    if (row.status !== 'SUCCESS') continue;
    aiPagesUsed += Number(row.ai_pages);
    operationsUsed += Number(row.operations);
    const tool = byTool[row.tool_id] ??= { aiPages: 0, operations: 0, lastUsed: row.created_at };
    tool.aiPages += Number(row.ai_pages);
    tool.operations += Number(row.operations);
    if (row.created_at > tool.lastUsed) tool.lastUsed = row.created_at;
    if (new Date(row.created_at) >= today) {
      if (row.feature_type === 'ai') aiGlobalUsed += Number(row.page_count);
      else localGlobalUsed += Number(row.page_count);
      toolBreakdown[row.tool_id] = (toolBreakdown[row.tool_id] ?? 0) + Number(row.page_count);
    }
  }

  return {
    userId, plan, month, aiPagesUsed, aiPagesLimit: PLAN_LIMITS[plan].aiPages,
    operationsUsed, operationsLimit: PLAN_LIMITS[plan].operations, byTool,
    lastSynced: new Date().toISOString(), localGlobalUsed, localGlobalCap: getGlobalCap('local', plan),
    aiGlobalUsed, aiGlobalCap: getGlobalCap('ai', plan), toolBreakdown,
    nextSastMidnight: getNextSastMidnightUTC(),
  };
}
