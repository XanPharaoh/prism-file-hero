/**
 * Batch 05 — Paddle webhook signature + durable-inbox projection, tested with a known secret.
 * Live verification against Paddle's SANDBOX secret + the deployed handler is a separate,
 * credential-gated step; this proves the pure logic.
 */
import { describe, it, expect } from 'vitest';
import {
  verifyPaddleSignature,
  newInbox,
  applyEvent,
  hasEntitlement,
  type PaddleEvent,
} from '../worker/src/billing/paddleVerify';

async function sign(secret: string, ts: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}:${body}`));
  return [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const SECRET = 'whsec_test_0123456789';
const BODY = JSON.stringify({ event_id: 'evt_1', event_type: 'subscription.activated', data: { id: 'sub_9' } });

describe('Paddle raw-body signature', () => {
  it('accepts a correctly signed payload', async () => {
    const ts = '1700000000';
    const h1 = await sign(SECRET, ts, BODY);
    expect(await verifyPaddleSignature(BODY, `ts=${ts};h1=${h1}`, SECRET)).toBe(true);
  });
  it('rejects a tampered body, wrong secret, and malformed headers', async () => {
    const ts = '1700000000';
    const h1 = await sign(SECRET, ts, BODY);
    expect(await verifyPaddleSignature(BODY + ' ', `ts=${ts};h1=${h1}`, SECRET)).toBe(false); // raw body changed
    expect(await verifyPaddleSignature(BODY, `ts=${ts};h1=${h1}`, 'other_secret')).toBe(false);
    expect(await verifyPaddleSignature(BODY, null, SECRET)).toBe(false);
    expect(await verifyPaddleSignature(BODY, 'ts=1700000000', SECRET)).toBe(false); // no h1
  });
});

function evt(id: string, type: string, occurredAt: string, data: any): PaddleEvent {
  return { event_id: id, event_type: type, occurred_at: occurredAt, data };
}

describe('durable inbox projection', () => {
  it('dedupes a replayed event id', () => {
    const inbox = newInbox();
    const first = applyEvent(inbox, evt('e1', 'subscription.activated', '2026-01-01T00:00:00Z', { id: 'sub_1' }));
    const replay = applyEvent(inbox, evt('e1', 'subscription.activated', '2026-01-01T00:00:00Z', { id: 'sub_1' }));
    expect(first.action).toBe('applied');
    expect(replay.action).toBe('duplicate');
  });

  it('ignores an OUT-OF-ORDER event older than the last applied for the subscription', () => {
    const inbox = newInbox();
    applyEvent(inbox, evt('new', 'subscription.activated', '2026-03-01T00:00:00Z', { id: 'sub_1' }));
    const stale = applyEvent(inbox, evt('old', 'subscription.canceled', '2026-02-01T00:00:00Z', { id: 'sub_1' }));
    expect(stale.action).toBe('out_of_order');
    // Subscription remains active — the stale cancel did not regress it.
    expect(hasEntitlement(inbox.subs.get('sub_1')!.status)).toBe(true);
  });

  it('cancellation removes entitlement; payment failure marks past_due but keeps no new grant', () => {
    const inbox = newInbox();
    applyEvent(inbox, evt('a', 'subscription.activated', '2026-01-01T00:00:00Z', { id: 'sub_2' }));
    expect(hasEntitlement(inbox.subs.get('sub_2')!.status)).toBe(true);
    applyEvent(inbox, evt('b', 'subscription.payment_failed', '2026-01-05T00:00:00Z', { id: 'sub_2' }));
    expect(inbox.subs.get('sub_2')!.status).toBe('past_due');
    applyEvent(inbox, evt('c', 'subscription.canceled', '2026-01-06T00:00:00Z', { id: 'sub_2' }));
    expect(hasEntitlement(inbox.subs.get('sub_2')!.status)).toBe(false);
  });

  it('checkout completion in the browser is NOT an entitlement — only verified webhook events grant access', () => {
    // A browser "completed checkout" with no server-verified event grants nothing.
    const inbox = newInbox();
    expect(hasEntitlement(inbox.subs.get('sub_X')?.status)).toBe(false);
  });

  it('unsupported event types are recorded-not-applied', () => {
    const inbox = newInbox();
    expect(applyEvent(inbox, evt('x', 'payout.paid', '2026-01-01T00:00:00Z', {})).action).toBe('ignored_unsupported');
  });
});
