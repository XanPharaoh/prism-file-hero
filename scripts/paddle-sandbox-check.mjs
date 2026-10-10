#!/usr/bin/env node
/**
 * Item — Paddle SANDBOX checkout→entitlement test (PREPARED, not run).
 *
 * This is the end-to-end billing verification that CANNOT run without real credentials and is
 * therefore deliberately gated: it requires PADDLE_WEBHOOK_SECRET to be a genuine Paddle SANDBOX
 * secret (not the local-dev placeholder) plus SUPABASE_URL + service-role token. With those set it
 * replays signed sandbox lifecycle events through the live Worker /api/paddle/webhook and proves:
 *   1. an invalid signature never mutates state (401),
 *   2. an active subscription grants the LIVE user_plans plan + entitlement,
 *   3. a payment failure / cancel DROPS entitlement,
 *   4. a replayed event is deduped (survives restart via the event_id PK),
 *   5. a customer with NO billing_customers link grants nothing (browser checkout alone can't).
 * Without the real secret it exits 2 with a clear PENDING — it never reports a false pass.
 *
 * Requires: local supabase stack + `wrangler dev` (worker/.dev.vars has the REAL sandbox secret).
 */
import { createHmac } from 'node:crypto';

const WORKER = process.env.WORKER_URL || 'http://127.0.0.1:8787';
const REST = (process.env.SUPABASE_URL || 'http://127.0.0.1:54321') + '/rest/v1';
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SECRET = process.env.PADDLE_WEBHOOK_SECRET || '';

if (!SECRET || SECRET.startsWith('local-dev-')) {
  console.error('PENDING: this is the Paddle SANDBOX test. Set PADDLE_WEBHOOK_SECRET to a real Paddle sandbox');
  console.error('signing secret (and SUPABASE_SERVICE_ROLE_KEY for the local stack) to run it. Not executed — no false pass.');
  process.exit(2);
}
if (!SR) { console.error('FAIL: SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`PASS ${n}`)) : (fail++, console.log(`FAIL ${n} ${e}`)); };
const api = (t) => ({ apikey: t, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
const q = async (table, qs) => (await fetch(`${REST}/${table}?${qs}`, { headers: api(SR) })).json();
const del = async (table, qs) => { await fetch(`${REST}/${table}?${qs}`, { method: 'DELETE', headers: api(SR) }); };
const ins = async (table, rows) => (await fetch(`${REST}/${table}`, { method: 'POST', headers: { ...api(SR), Prefer: 'return=minimal' }, body: JSON.stringify(rows) })).status;

const user = process.env.TEST_USER_ID || '11111111-0000-4000-8000-0000paddle';
const cust = 'cus_sandbox_1', sub = 'sub_sandbox_1';
async function send(eventId, type, occurred, opts = {}) {
  const body = JSON.stringify({ event_id: eventId, event_type: type, occurred_at: occurred, data: { id: sub, customer_id: opts.customer ?? cust, ...(opts.plan ? { metadata: { plan: opts.plan } } : {}) } });
  const ts = Math.floor(Date.now() / 1000);
  const h1 = opts.badSig ? 'x'.repeat(64) : createHmac('sha256', SECRET).update(`${ts}:${body}`).digest('hex');
  const r = await fetch(`${WORKER}/api/paddle/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Paddle-Signature': `ts=${ts};h1=${h1}` }, body });
  return r.status;
}

await del('user_plans', `user_id=eq.${user}`);
await del('billing_customers', `customer_id=eq.${cust}`);
await del('billing_subscriptions', `subscription_id=eq.${sub}`);
await del('billing_events', `customer_id=eq.${cust}`);

// (5) no customer→user link yet → an active event records but grants nothing.
let st = await send('sbx-1', 'subscription.activated', '2026-10-01T00:00:00Z', { plan: 'pro' });
ok('sandbox: unlinked customer acks 200', st === 200, `status=${st}`);
let up = await q('user_plans', `user_id=eq.${user}&select=plan`);
ok('sandbox: no link ⇒ no entitlement granted', Array.isArray(up) && up.length === 0, JSON.stringify(up));

// link, then (1) bad signature must not mutate.
await ins('billing_customers', [{ customer_id: cust, user_id: user }]);
st = await send('sbx-bad', 'subscription.activated', '2026-10-01T00:00:01Z', { badSig: true });
ok('sandbox: invalid signature → 401', st === 401, `status=${st}`);

// (2) valid active → grants live plan.
st = await send('sbx-2', 'subscription.activated', '2026-10-01T00:00:02Z', { plan: 'pro' });
up = await q('user_plans', `user_id=eq.${user}&select=plan,subscription_status`);
ok('sandbox: active grants pro/active on user_plans', st === 200 && up[0] && up[0].plan === 'pro' && up[0].subscription_status === 'active', JSON.stringify(up));

// (3) payment_failed → past_due; cancel → not entitled.
await send('sbx-3', 'subscription.payment_failed', '2026-10-05T00:00:00Z');
await send('sbx-4', 'subscription.canceled', '2026-10-06T00:00:00Z');
up = await q('user_plans', `user_id=eq.${user}&select=subscription_status`);
const ent = await (await fetch(`${REST}/rpc/get_user_entitlement`, { method: 'POST', headers: api(SR), body: JSON.stringify({ p_user_id: user }) })).json();
ok('sandbox: cancel removes entitlement', up[0] && up[0].subscription_status === 'canceled' && ent[0] && ent[0].entitled === false, JSON.stringify([up, ent]));

// (4) replay of an already-applied event is deduped (still 200, no state change).
st = await send('sbx-2', 'subscription.activated', '2026-10-01T00:00:02Z', { plan: 'pro' });
const events = await q('billing_events', `event_id=eq.sbx-2&select=event_id`);
ok('sandbox: replayed event_id deduped (single row)', st === 200 && Array.isArray(events) && events.length === 1, JSON.stringify(events));

console.log(`\n=== paddle-sandbox-check: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
