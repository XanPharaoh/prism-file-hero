import { WORKER_BASE_URL } from './apiConfig';
import { getAuthToken } from './authService';

/**
 * R7 — client for the server-side PayPal billing routes. The browser sends ONLY a plan + cycle
 * intent; it NEVER supplies user_id/customer_id/paypal plan id. Entitlement is READ from the server,
 * so refresh / logout-login / a second session all see the same server-derived plan. PayPal approval
 * in the browser grants nothing until a verified ACTIVE webhook (or server-side reconcile) flips it.
 */

async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAuthToken();
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(`${WORKER_BASE_URL}${path}`, { ...init, headers });
}

export type Plan = 'pro' | 'business';
export type Cycle = 'monthly' | 'annual';

export interface SubscribeResult {
  ok: boolean; status: string; plan?: Plan; subscriptionId?: string; approveUrl?: string | null;
  error?: string; configured?: boolean;
}

export async function startPayPalSubscribe(plan: Plan, cycle: Cycle): Promise<SubscribeResult> {
  try {
    const r = await authFetch('/api/billing/paypal/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan, cycle }),
    });
    const j: any = await r.json().catch(() => ({}));
    return { ok: r.ok, status: j.status ?? (r.ok ? 'pending' : 'error'), plan: j.plan ?? plan,
      subscriptionId: j.subscriptionId, approveUrl: j.approveUrl ?? null, error: j.error, configured: j.configured };
  } catch { return { ok: false, status: 'error', error: 'network' }; }
}

export interface Entitlement { entitled: boolean; plan: string; subscription_status: string | null; activeSubscriptionId?: string | null; unauthenticated?: boolean; }

export async function fetchEntitlement(): Promise<Entitlement | null> {
  try {
    const r = await authFetch('/api/billing/entitlement', { method: 'GET' });
    // A 401 is not "free": it means nobody is signed in, so the server cannot answer. Callers must
    // not present that as a payment problem.
    if (r.status === 401) return { entitled: false, plan: 'free', subscription_status: null, unauthenticated: true };
    if (!r.ok) return null;
    const j: any = await r.json();
    return { entitled: !!j.entitled, plan: j.plan ?? 'free', subscription_status: j.subscription_status ?? null, activeSubscriptionId: j.activeSubscriptionId ?? null };
  } catch { return null; }
}

export async function cancelSubscription(subscriptionId: string): Promise<{ ok: boolean; status?: string; configured?: boolean; error?: string }> {
  try {
    const r = await authFetch('/api/billing/paypal/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscriptionId }),
    });
    const j: any = await r.json().catch(() => ({}));
    return { ok: r.ok, status: j.status, configured: j.configured, error: j.error };
  } catch { return { ok: false, error: 'network' }; }
}

/** Ask the server to read authoritative PayPal state and reconcile entitlement (delayed/missing webhook). */
export async function reconcile(): Promise<{ ok: boolean; reconciled?: unknown[]; configured?: boolean; error?: string }> {
  try {
    const r = await authFetch('/api/billing/paypal/reconcile', { method: 'POST' });
    const j: any = await r.json().catch(() => ({}));
    return { ok: r.ok, reconciled: j.reconciled, configured: j.configured, error: j.error };
  } catch { return { ok: false, error: 'network' }; }
}
