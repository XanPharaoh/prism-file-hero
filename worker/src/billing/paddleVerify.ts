/**
 * Batch 05 — Paddle webhook verification + durable-inbox event projection (pure core).
 *
 * Signature (Paddle "paddle-signature: ts=<unix>;h1=<hex>"): HMAC-SHA256 over the string
 * `${ts}:${rawBody}` using the shared webhook secret, compared in constant time against h1.
 * The RAW request body must be verified before any JSON parsing (a re-serialized body would
 * not hash equal).
 *
 * The reducer models the durable inbox + transactional projection:
 *   - dedupe by event id (a replay is ignored),
 *   - ignore OUT-OF-ORDER events older than the last applied for the same subscription,
 *   - apply subscription state changes (active / past_due / canceled / trialed),
 *   - a payment failure does NOT grant access; only an active/trialed subscription does.
 * Real verification against Paddle's SANDBOX secret and the live Worker handler is a
 * deploy/credential-gated step (see docs/audit/baseline.md).
 */

export interface PaddleEvent {
  event_id: string;
  event_type: string;
  occurred_at: string; // ISO
  data: { id?: string; status?: string; customer_id?: string; [k: string]: unknown };
}

export interface SubscriptionState {
  subscriptionId: string;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'paused' | 'unknown';
  lastOccurredAt: string;
  lastEventId: string;
}

export function hasEntitlement(status: SubscriptionState['status'] | undefined): boolean {
  return status === 'active' || status === 'trialing';
}

/**
 * Verify a Paddle signature header against the RAW body. Returns false (never throws) on
 * any malformed input so the handler can 401 without leaking details.
 */
export async function verifyPaddleSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const parts = new Map<string, string>();
  for (const seg of signatureHeader.split(';')) {
    const [k, v] = seg.trim().split('=');
    if (k && v) parts.set(k, v);
  }
  const ts = parts.get('ts');
  const h1 = parts.get('h1');
  if (!ts || !h1) return false;

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}:${rawBody}`));
    const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
    return timingSafeEqualHex(hex, h1);
  } catch {
    return false;
  }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface Inbox {
  seenEventIds: Set<string>;
  subs: Map<string, SubscriptionState>;
}
export function newInbox(): Inbox {
  return { seenEventIds: new Set(), subs: new Map() };
}

export interface AppliedResult {
  action: 'applied' | 'duplicate' | 'out_of_order' | 'ignored_unsupported';
  state?: SubscriptionState;
}

/** Subscription lifecycle types we project; anything else is recorded but not applied. */
const SUPPORTED = new Set(['subscription.created', 'subscription.updated', 'subscription.activated', 'subscription.canceled', 'subscription.paused', 'subscription.resumed', 'transaction.paid', 'subscription.payment_failed']);

/**
 * Apply one (already signature-verified) event to the inbox. Idempotent + order-safe.
 */
export function applyEvent(inbox: Inbox, evt: PaddleEvent): AppliedResult {
  if (!SUPPORTED.has(evt.event_type)) return { action: 'ignored_unsupported' };
  if (inbox.seenEventIds.has(evt.event_id)) return { action: 'duplicate' };

  const subId = String(evt.data?.id ?? evt.data?.subscription_id ?? '');
  const prev = subId ? inbox.subs.get(subId) : undefined;
  if (prev && new Date(evt.occurred_at) < new Date(prev.lastOccurredAt)) {
    inbox.seenEventIds.add(evt.event_id); // still mark seen so a replay is a clean duplicate
    return { action: 'out_of_order' };
  }

  let status: SubscriptionState['status'] = prev?.status ?? 'unknown';
  const t = evt.event_type;
  if (t === 'subscription.canceled') status = 'canceled';
  else if (t === 'subscription.paused') status = 'paused';
  else if (t === 'subscription.payment_failed') status = 'past_due';
  else if (t === 'subscription.activated' || t === 'transaction.paid') status = 'active';
  else if (evt.data?.status) status = String(evt.data.status) as SubscriptionState['status'];

  const state: SubscriptionState = {
    subscriptionId: subId || prev?.subscriptionId || 'unknown',
    status,
    lastOccurredAt: evt.occurred_at,
    lastEventId: evt.event_id,
  };
  if (state.subscriptionId !== 'unknown') inbox.subs.set(state.subscriptionId, state);
  inbox.seenEventIds.add(evt.event_id);
  return { action: 'applied', state };
}
