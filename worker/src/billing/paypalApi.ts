/**
 * R7 — PayPal Subscriptions server-side client. The Client ID/SECRET live ONLY in worker/.dev.vars
 * (local) or a wrangler secret (deploy) — never the browser. Every network call is gated on those
 * being set (a clear "not configured" rather than a silent grant). Uses the Subscriptions v1 API and
 * PayPal's DOCUMENTED webhook verification (/v1/notifications/verify-webhook-signature), which is
 * cert/transmission based and is NOT the Paddle HMAC path (that verifier is unused here).
 */
export interface PayPalEnv {
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_SECRET?: string;
  PAYPAL_ENV?: string;      // 'sandbox' (default) | 'live'
  PAYPAL_WEBHOOK_ID?: string;
}

export class BillingNotConfigured extends Error {
  constructor(m = 'PayPal is not configured (missing PAYPAL_CLIENT_ID / PAYPAL_SECRET). Billing routes are disabled until sandbox/live credentials are set server-side.') { super(m); this.name = 'BillingNotConfigured'; }
}

function apiBase(env: PayPalEnv): string {
  return env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

function requireCreds(env: PayPalEnv): { clientId: string; secret: string } {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_SECRET) throw new BillingNotConfigured();
  return { clientId: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_SECRET };
}

let tokenCache: { env: string; token: string; exp: number } | null = null;

export async function accessToken(env: PayPalEnv): Promise<string> {
  const { clientId, secret } = requireCreds(env);
  const key = `${env.PAYPAL_ENV || 'sandbox'}:${clientId}`;
  if (tokenCache && tokenCache.env === key && tokenCache.exp > Date.now() + 30_000) return tokenCache.token;
  const res = await fetch(`${apiBase(env)}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${clientId}:${secret}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`paypal oauth failed: ${res.status} ${await res.text().catch(() => '')}`);
  const j: any = await res.json();
  tokenCache = { env: key, token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}

async function call(env: PayPalEnv, path: string, init: RequestInit = {}): Promise<{ status: number; json: any; text: string }> {
  const token = await accessToken(env);
  const res = await fetch(apiBase(env) + path, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* keep text */ }
  return { status: res.status, json, text };
}

/** Create a subscription for an allowlisted plan id. custom_id = the server-verified internal user id. */
export async function createSubscription(env: PayPalEnv, opts: { planId: string; userId: string; returnUrl: string; cancelUrl: string }) {
  return call(env, '/v1/billing/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      plan_id: opts.planId,
      custom_id: opts.userId,               // echoed back on webhooks; ownership is resolved from the SERVER mapping, not this
      application_context: { return_url: opts.returnUrl, cancel_url: opts.cancelUrl, brand_name: 'Prism File Hero', user_action: 'SUBSCRIBE_NOW' },
    }),
  });
}
export function activateSubscription(env: PayPalEnv, subscriptionId: string) {
  return call(env, `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/activate`, { method: 'POST', body: JSON.stringify({}) });
}
export function getSubscription(env: PayPalEnv, subscriptionId: string) {
  return call(env, `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: 'GET' });
}
export function cancelSubscription(env: PayPalEnv, subscriptionId: string, reason = 'customer request') {
  return call(env, `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
}

/**
 * Verify a PayPal webhook using PayPal's documented mechanism. Returns true only when PayPal answers
 * verification_status=SUCCESS. The cert_url MUST be a PayPal-owned https host — we refuse others
 * before any network call to prevent SSRF via an attacker-supplied certificate URL.
 */
export async function verifyWebhook(env: PayPalEnv, headers: Headers, rawBody: string): Promise<boolean> {
  if (!env.PAYPAL_WEBHOOK_ID) return false;
  const certUrl = headers.get('paypal-cert-url') || '';
  const transmissionId = headers.get('paypal-transmission-id') || '';
  const transmissionTime = headers.get('paypal-transmission-time') || '';
  const authAlgo = headers.get('paypal-auth-algo') || '';
  const authVersion = headers.get('paypal-auth-version') || '';
  if (!certUrl || !transmissionId) return false;
  try {
    const u = new URL(certUrl);
    if (u.protocol !== 'https:') return false;
    if (!(u.hostname === 'paypal.com' || u.hostname.endsWith('.paypal.com'))) return false; // SSRF guard
  } catch { return false; }

  let event: unknown; try { event = JSON.parse(rawBody); } catch { return false; }
  const { status, json } = await call(env, '/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: JSON.stringify({
      auth_algo: authAlgo, cert_url: certUrl, transmission_id: transmissionId,
      transmission_time: transmissionTime, webhook_id: env.PAYPAL_WEBHOOK_ID, event_body: event,
    }),
  });
  return status === 200 && json?.verification_status === 'SUCCESS';
}
