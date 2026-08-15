export interface SupabaseEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

function authHeaders(env: SupabaseEnv): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

/** Returns an effective plan: cancelled or inactive paid subscriptions are free. */
export async function getUserPlan(env: SupabaseEnv, userId: string): Promise<'free' | 'pro' | 'business'> {
  const params = new URLSearchParams({ user_id: `eq.${userId}`, select: 'plan,subscription_status', limit: '1' });
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/user_plans?${params}`, { headers: authHeaders(env) });
  if (!response.ok) throw new Error(`getUserPlan failed: ${response.status} ${await response.text()}`);
  const row = (await response.json() as Array<{ plan: string; subscription_status: string | null }>)[0];
  if (row?.plan !== 'pro' && row?.plan !== 'business') return 'free';
  return row.subscription_status === 'active' || row.subscription_status === 'trialing' ? row.plan : 'free';
}

export async function updateUserPlan(
  env: SupabaseEnv,
  userId: string,
  plan: 'free' | 'pro' | 'business',
  paddleCustomerId?: string,
  paddleSubscriptionId?: string,
  status?: string,
): Promise<void> {
  const params = new URLSearchParams({ user_id: `eq.${userId}` });
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/user_plans?${params}`, {
    method: 'PATCH',
    headers: authHeaders(env),
    body: JSON.stringify({
      plan,
      ...(paddleCustomerId && { paddle_customer_id: paddleCustomerId }),
      ...(paddleSubscriptionId && { paddle_subscription_id: paddleSubscriptionId }),
      ...(status && { subscription_status: status }),
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error(`updateUserPlan failed: ${response.status} ${await response.text()}`);
}
