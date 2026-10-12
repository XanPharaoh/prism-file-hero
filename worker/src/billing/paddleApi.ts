/**
 * R2/R3 — Paddle API client (server-side ONLY). Every function is gated on PADDLE_API_KEY, which
 * lives in worker/.dev.vars (local) or a wrangler secret (deploy) and NEVER in the browser. The
 * browser may only choose a plan intent; the server maps it to an allowlisted price id and creates
 * the transaction/customer, so no browser-supplied customer_id/price_id/user_id is trusted.
 */
export interface PaddleEnv {
  PADDLE_API_KEY?: string;
  /** 'true' → sandbox API host. Any other value → production host. */
  PADDLE_SANDBOX?: string;
}

export class BillingNotConfigured extends Error {
  constructor(m = 'Paddle is not configured (missing PADDLE_API_KEY). Checkout/portal are disabled until a sandbox or production key is set server-side.') { super(m); this.name = 'BillingNotConfigured'; }
}

function base(env: PaddleEnv): string {
  return env.PADDLE_SANDBOX === 'true' ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';
}

export function requireKey(env: PaddleEnv): string {
  if (!env.PADDLE_API_KEY) throw new BillingNotConfigured();
  return env.PADDLE_API_KEY;
}

async function post(env: PaddleEnv, path: string, body: Record<string, unknown>): Promise<any> {
  const key = requireKey(env);
  const res = await fetch(base(env) + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`paddle ${path} failed: ${res.status} ${JSON.stringify(json?.error ?? json).slice(0, 200)}`);
  return json.data;
}

export function createCustomer(env: PaddleEnv, email: string | undefined) {
  return post(env, '/customers', { ...(email ? { email } : {}), name: 'Prism user' });
}
export function createTransaction(env: PaddleEnv, opts: { customerId: string; priceId: string; userId: string }) {
  return post(env, '/transactions', {
    customer_id: opts.customerId,
    currency: 'USD',
    items: [{ price_id: opts.priceId, quantity: 1 }],
    // custom_data carries the server-derived user id for webhook reconciliation, but the webhook
    // resolves ownership from the PERSISTED customer→user mapping, not from this field alone.
    custom_data: { user_id: opts.userId, price_id: opts.priceId },
  });
}
export function createPortalSession(env: PaddleEnv, customerId: string) {
  return post(env, '/customer-portal-sessions', { customer_id: customerId, reason: 'subscription management' });
}
