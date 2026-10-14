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
 * Paid-through window for a subscription, read from PayPal's authoritative subscription object.
 * `next_billing_time` is when PayPal will charge again — the end of the period already paid for — and
 * `last_payment.time` identifies WHICH sale that period belongs to. Both are needed: a redelivered
 * older sale must not adopt the newest window, so a caller may apply `end` only to the payment
 * PayPal's own snapshot names (see canBindWindow for the clock-drift tolerance). Nulls when PayPal
 * answers nothing; no date is invented and the payment stays pending reconciliation.
 *
 * Measured: the real first-payment sale carried no billing_period_* dates. Whether renewals include
 * them is NOT established here (that needs a real renewal), so this path must serve any payment
 * missing them.
 */
export async function coverageWindow(env: PayPalEnv, subscriptionId: string): Promise<{ start: string | null; end: string | null; lastPaymentTime: string | null }> {
  const g = await getSubscription(env, subscriptionId);
  if (g.status !== 200 || !g.json) return { start: null, end: null, lastPaymentTime: null };
  const bi = (g.json.billing_info ?? {}) as any;
  const lastPaymentTime: string | null = bi.last_payment?.time ?? null;
  return { start: lastPaymentTime ?? g.json.start_time ?? null, end: bi.next_billing_time ?? null, lastPaymentTime };
}

/**
 * May the subscription's current window be bound to this payment?
 *
 * Two conditions, in order:
 *   1. PayPal must actually be naming a window that opens after this sale (`next_billing_time` in
 *      the future relative to the sale). Without that there is nothing correct to bind, so the
 *      payment stays pending reconciliation.
 *   2. The sale must be the payment PayPal itself counts. `last_payment.time` and the sale stamp are
 *      written by different PayPal services, so a genuine renewal can arrive seconds apart from the
 *      snapshot it belongs to; exact equality silently dropped that coverage and left paid customers
 *      on free ceilings. A ±15 minute tolerance absorbs the drift while a sale from a previous cycle
 *      (minutes-to-days away in the wrong direction) stays outside it.
 *
 * When PayPal reports no `last_payment` at all there is nothing to compare against; the window
 * length is then the guard, since no subscription period is longer than a year plus slack.
 */
export const MAX_PAYMENT_CLOCK_DRIFT_MS = 15 * 60 * 1000;

export function canBindWindow(
  saleTime: string | null | undefined,
  lastPaymentTime: string | null | undefined,
  nextBillingTime: string | null | undefined,
): boolean {
  if (!saleTime || !nextBillingTime) return false;
  const saleMs = Date.parse(saleTime);
  const nextMs = Date.parse(nextBillingTime);
  if (!Number.isFinite(saleMs) || !Number.isFinite(nextMs) || nextMs <= saleMs) return false;
  if (!lastPaymentTime) return nextMs - saleMs <= 370 * 24 * 60 * 60 * 1000;
  const lastMs = Date.parse(lastPaymentTime);
  if (!Number.isFinite(lastMs)) return false;
  return Math.abs(saleMs - lastMs) <= MAX_PAYMENT_CLOCK_DRIFT_MS;
}

/**
 * Resolve the EXACT subscription a verified event refers to, per event family:
 *   • PAYMENT.SALE.* — the resource is a SALE; its subscription is `billing_agreement_id`.
 *   • BILLING.SUBSCRIPTION.* — the resource id IS the subscription, so it is left alone.
 * `custom_id` (our internal user id, echoed by PayPal) is deliberately NOT used to pick a
 * subscription: it identifies the user, not the agreement, and mapping it to whichever subscription
 * is currently linked would let one user's event act on another's. Ownership comes from the persisted
 * billing_subscriptions.user_id link inside apply_paypal_event.
 */
export function resolveSubscriptionId(eventType: string, resource: Record<string, unknown>): Record<string, unknown> {
  if (!eventType.startsWith('PAYMENT.SALE') || resource.subscription_id) return resource;
  const ba = resource.billing_agreement_id;
  return ba ? { ...resource, subscription_id: String(ba) } : resource;
}

/**
 * Verify a PayPal webhook through PayPal's documented mechanism: POST the transmission headers plus
 * the event payload to /v1/notifications/verify-webhook-signature and accept ONLY a
 * verification_status=SUCCESS answer. The cert_url MUST be a PayPal-owned https host — we refuse
 * others before any network call to prevent SSRF via an attacker-supplied certificate URL.
 *
 * VERIFIER CONTRACT, measured against the sandbox (which signs payloads with auth-version v2): the
 * request takes exactly auth_algo, cert_url, transmission_id, transmission_sig, transmission_time,
 * webhook_id and webhook_event — the payload field is `webhook_event` as a parsed JSON OBJECT, not
 * the legacy `event_body` string, and sending an unknown field such as auth_version fails the schema.
 * Tampering with webhook_id, transmission_id, transmission_time, the signature or any body value
 * (e.g. resource.status) makes PayPal answer FAILURE, so this stays fail-closed.
 */
export async function verifyWebhook(env: PayPalEnv, headers: Headers, rawBody: string): Promise<boolean> {
  if (!env.PAYPAL_WEBHOOK_ID) return false;
  const certUrl = headers.get('paypal-cert-url') || '';
  const transmissionId = headers.get('paypal-transmission-id') || '';
  const transmissionTime = headers.get('paypal-transmission-time') || '';
  const transmissionSig = headers.get('paypal-transmission-sig') || '';
  const authAlgo = headers.get('paypal-auth-algo') || '';
  if (!certUrl || !transmissionId || !transmissionSig) { console.warn('[paypal-verify] missing cert_url/transmission_id/transmission_sig'); return false; }
  try {
    const u = new URL(certUrl);
    if (u.protocol !== 'https:') { console.warn('[paypal-verify] non-https cert_url', certUrl); return false; }
    if (!(u.hostname === 'paypal.com' || u.hostname.endsWith('.paypal.com'))) { console.warn('[paypal-verify] cert_url host not paypal', u.hostname); return false; } // SSRF guard
  } catch { console.warn('[paypal-verify] unparseable cert_url', certUrl); return false; }

  let event: any; try { event = JSON.parse(rawBody); } catch { console.warn('[paypal-verify] unparseable body'); return false; }
  const { status, json } = await call(env, '/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: JSON.stringify({
      auth_algo: authAlgo, cert_url: certUrl, transmission_id: transmissionId,
      transmission_sig: transmissionSig, transmission_time: transmissionTime,
      webhook_id: env.PAYPAL_WEBHOOK_ID, webhook_event: event,
    }),
  });
  const okVerify = status === 200 && json?.verification_status === 'SUCCESS';
  if (!okVerify) {
    console.warn('[paypal-verify] FAILED', {
      httpStatus: status, verification_status: json?.verification_status ?? json?.name ?? null,
      event_id: event?.id, event_type: event?.event_type, detail: json?.details ? JSON.stringify(json.details).slice(0, 300) : null,
    });
  }
  return okVerify;
}
