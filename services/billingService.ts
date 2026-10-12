import { WORKER_BASE_URL } from './apiConfig';
import { getAuthToken } from './authService';

/**
 * R3 — client for the server-side billing routes. The browser sends ONLY a plan intent; it NEVER
 * supplies user_id/customer_id/price_id — those are derived by the Worker from the verified Clerk
 * token. Entitlement is READ from the server (never trusted from localStorage), so refresh / logout
 * /login / a second session all see the same server-derived plan.
 */

async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAuthToken();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${WORKER_BASE_URL}${path}`, { ...init, headers });
}

export interface CheckoutResult {
  ok: boolean;
  status: string;              // 'pending' on success; the grant only arrives via the webhook.
  plan?: string;
  transactionId?: string;
  checkoutUrl?: string | null;
  error?: string;
  configured?: boolean;        // false → Paddle key not set (billing disabled in this build).
}

export async function startCheckout(plan: 'pro' | 'business'): Promise<CheckoutResult> {
  try {
    const r = await authFetch('/api/billing/checkout', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    const j: any = await r.json().catch(() => ({}));
    return {
      ok: r.ok, status: j.status ?? (r.ok ? 'pending' : 'error'), plan: j.plan ?? plan,
      transactionId: j.transactionId, checkoutUrl: j.checkoutUrl ?? null,
      error: j.error, configured: j.configured,
    };
  } catch { return { ok: false, status: 'error', error: 'network' }; }
}

export interface Entitlement { entitled: boolean; plan: string; subscription_status: string | null; }

export async function fetchEntitlement(): Promise<Entitlement | null> {
  try {
    const r = await authFetch('/api/billing/entitlement', { method: 'GET' });
    if (!r.ok) return null;
    const j: any = await r.json();
    return { entitled: !!j.entitled, plan: j.plan ?? 'free', subscription_status: j.subscription_status ?? null };
  } catch { return null; }
}

export async function openPortal(): Promise<{ url?: string | null; status?: string; configured?: boolean; error?: string }> {
  try {
    const r = await authFetch('/api/billing/portal', { method: 'POST' });
    const j: any = await r.json().catch(() => ({}));
    return { url: j.url ?? null, status: j.status, configured: j.configured, error: j.error };
  } catch { return { error: 'network' }; }
}
