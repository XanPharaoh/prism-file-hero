export interface SupabaseEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

function authHeaders(env: SupabaseEnv): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json',
  };
}

export async function getUserPlan(env: SupabaseEnv, userId: string): Promise<'free' | 'pro' | 'business'> {
  const params = new URLSearchParams({ user_id: `eq.${userId}`, select: 'plan', limit: '1' });
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/user_plans?${params}`, { headers: authHeaders(env) });
  if (!res.ok) {
    console.warn(`[DB] getUserPlan returned ${res.status}, defaulting to free`);
    return 'free';
  }
  const rows = (await res.json()) as Array<{ plan: string }>;
  return (rows[0]?.plan ?? 'free') as 'free' | 'pro' | 'business';
}

// FIX: Uses DB-side aggregation (O(K) instead of O(N))
// Falls back to direct REST query if the RPC function doesn't exist.
export async function getComprehensiveUsage(
  env: SupabaseEnv, userId: string, month: string
): Promise<{ pagesUsed: number; byTool: Record<string, number> }> {
  const headers = authHeaders(env);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_usage_summary`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_user_id: userId, p_month: month }),
  });

  if (res.ok) {
    const rows = (await res.json()) as Array<{ tool_id: string; total_pages: number }>;
    const byTool: Record<string, number> = {};
    let pagesUsed = 0;
    rows.forEach(row => {
      pagesUsed += row.total_pages;
      byTool[row.tool_id] = row.total_pages;
    });
    return { pagesUsed, byTool };
  }

  // Fallback: RPC doesn't exist — query usage_logs directly
  console.warn(`[DB] get_usage_summary RPC returned ${res.status}, falling back to direct query`);
  const params = new URLSearchParams({ user_id: `eq.${userId}`, month: `eq.${month}`, select: 'tool_id,pages' });
  const fallbackRes = await fetch(`${env.SUPABASE_URL}/rest/v1/usage_logs?${params}`, { headers });
  if (!fallbackRes.ok) return { pagesUsed: 0, byTool: {} };
  const rows = (await fallbackRes.json()) as Array<{ tool_id: string; pages: number }>;
  const byTool: Record<string, number> = {};
  let pagesUsed = 0;
  rows.forEach(row => {
    pagesUsed += row.pages;
    byTool[row.tool_id] = (byTool[row.tool_id] ?? 0) + row.pages;
  });
  return { pagesUsed, byTool };
}

export async function getUsageByIp(env: SupabaseEnv, ipAddress: string, month: string): Promise<number> {
  const params = new URLSearchParams({ ip_address: `eq.${ipAddress}`, month: `eq.${month}`, select: 'pages' });
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/usage_logs?${params}`, { headers: authHeaders(env) });
  if (!res.ok) {
    console.warn(`[DB] getUsageByIp returned ${res.status}, defaulting to 0`);
    return 0;
  }
  const rows = (await res.json()) as Array<{ pages: number }>;
  return rows.reduce((sum, row) => sum + row.pages, 0);
}

// Phase 3: Single RPC to eliminate the Supabase waterfall (3 separate DB calls → 1)
// Returns plan, total pages used, and IP pages used in a single query.
// Falls back to individual REST queries if the RPC function doesn't exist yet.
export async function getExecutionContext(
  env: SupabaseEnv, userId: string, ipAddress: string, month: string
): Promise<{ plan: 'free' | 'pro' | 'business'; pagesUsed: number; ipPagesUsed: number }> {
  const headers = authHeaders(env);
  const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/check_execution_context`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ p_user_id: userId, p_ip_address: ipAddress, p_month: month }),
  });

  if (rpcRes.ok) {
    const rows = (await rpcRes.json()) as Array<{ plan: string; pages_used: number; ip_pages_used: number }>;
    const row = rows[0];
    return {
      plan: (row?.plan ?? 'free') as 'free' | 'pro' | 'business',
      pagesUsed: Number(row?.pages_used ?? 0),
      ipPagesUsed: Number(row?.ip_pages_used ?? 0),
    };
  }

  // Fallback: RPC function doesn't exist (404) — use individual REST queries
  console.warn(`[DB] check_execution_context RPC returned ${rpcRes.status}, falling back to individual queries`);
  const [plan, pagesUsed, ipPagesUsed] = await Promise.all([
    getUserPlan(env, userId),
    getTotalPagesUsed(env, userId, month),
    getUsageByIp(env, ipAddress, month),
  ]);
  return { plan, pagesUsed, ipPagesUsed };
}

async function getTotalPagesUsed(env: SupabaseEnv, userId: string, month: string): Promise<number> {
  const params = new URLSearchParams({ user_id: `eq.${userId}`, month: `eq.${month}`, select: 'pages' });
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/usage_logs?${params}`, { headers: authHeaders(env) });
  if (!res.ok) return 0;
  const rows = (await res.json()) as Array<{ pages: number }>;
  return rows.reduce((sum, row) => sum + row.pages, 0);
}

// FIX: Throws on failure to prevent giving away free AI pages
export async function incrementUsage(
  env: SupabaseEnv, userId: string, toolId: string, pages: number, ipAddress: string, month: string
): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/increment_usage`, {
    method: 'POST',
    headers: authHeaders(env),
    body: JSON.stringify({ p_user_id: userId, p_tool_id: toolId, p_pages: pages, p_ip_address: ipAddress, p_month: month }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error('[RPC] increment_usage failed:', errText);
    throw new Error(`Billing failed: ${errText}`); // Halt transaction!
  }
}

// FIX: Prevent SQL injection via URLSearchParams
export async function updateUserPlan(
  env: SupabaseEnv, userId: string, plan: 'free' | 'pro' | 'business',
  stripeCustomerId?: string, stripeSubscriptionId?: string, status?: string
): Promise<void> {
  const params = new URLSearchParams({ user_id: `eq.${userId}` });
  await fetch(`${env.SUPABASE_URL}/rest/v1/user_plans?${params}`, {
    method: 'PATCH',
    headers: authHeaders(env),
    body: JSON.stringify({
      plan,
      ...(stripeCustomerId && { stripe_customer_id: stripeCustomerId }),
      ...(stripeSubscriptionId && { stripe_subscription_id: stripeSubscriptionId }),
      ...(status && { subscription_status: status }),
      updated_at: new Date().toISOString(),
    }),
  });
}