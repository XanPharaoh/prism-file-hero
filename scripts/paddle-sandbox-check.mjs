#!/usr/bin/env node
/**
 * Item — Paddle SANDBOX checkout→entitlement test (PREPARED, gated).
 *
 * Aligned to the R2 trust model: entitlement comes ONLY from a verified webhook whose event resolves
 * a PERSISTED customer→user link (created via ensure_billing_customer) and a SERVER-allowlisted
 * price id — never a client-supplied plan. Requires a real Paddle SANDBOX secret + a sandbox price
 * id; without them it exits 2 (PENDING) and never reports a false pass.
 *
 * Run (with creds in env): PADDLE_WEBHOOK_SECRET=<sandbox secret>
 *   SUPABASE_SERVICE_ROLE_KEY=<local stack key> PADDLE_PRICE_PRO=<sandbox price id>
 *   node scripts/paddle-sandbox-check.mjs
 * The webhook route needs `wrangler dev` up with worker/.dev.vars holding the SAME sandbox secret.
 */
import { createHmac } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

const WORKER = process.env.WORKER_URL || 'http://127.0.0.1:8787';
const REST = (process.env.SUPABASE_URL || 'http://127.0.0.1:54321') + '/rest/v1';
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY
  || (existsSync('.localdev/tokens.json') ? JSON.parse(readFileSync('.localdev/tokens.json', 'utf8')).service_role : '');
const SECRET = process.env.PADDLE_WEBHOOK_SECRET || '';
const PRICE = process.env.PADDLE_PRICE_PRO || '';

if (!SECRET || SECRET.startsWith('local-dev-')) { console.error('PENDING: set PADDLE_WEBHOOK_SECRET to a real Paddle SANDBOX signing secret to run this. Not executed — no false pass.'); process.exit(2); }
if (!PRICE) { console.error('PENDING: set PADDLE_PRICE_PRO to a real sandbox price id that is ALSO in the billing_price_plans allowlist. Not executed.'); process.exit(2); }
if (!SR) { console.error('FAIL: SUPABASE_SERVICE_ROLE_KEY required (or run npm run tokens:local).'); process.exit(1); }

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`PASS ${n}`)) : (fail++, console.log(`FAIL ${n} ${e}`)); };
const H = (t) => ({ apikey: t, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
const q = async (tb, qs) => (await fetch(`${REST}/${tb}?${qs}`, { headers: H(SR) })).json();
const del = async (tb, qs) => { await fetch(`${REST}/${tb}?${qs}`, { method: 'DELETE', headers: H(SR) }); };
const rpc = async (fn, body) => { const r = await fetch(`${REST}/rpc/${fn}`, { method: 'POST', headers: H(SR), body: JSON.stringify(body) }); const t = await r.text(); try { return { status: r.status, j: JSON.parse(t) }; } catch { return { status: r.status, j: t }; } };

const user = process.env.TEST_USER_ID || '11111111-0000-4000-8000-0000paddle';
const cust = 'cus_sandbox_1', sub = 'sub_sandbox_1';
async function send(eventId, type, occurred, opts = {}) {
  const body = JSON.stringify({ event_id: eventId, event_type: type, occurred_at: occurred, data: { id: sub, customer_id: opts.customer ?? cust, price_id: opts.price ?? PRICE } });
  const ts = Math.floor(Date.now() / 1000);
  const h1 = opts.badSig ? 'x'.repeat(64) : createHmac('sha256', SECRET).update(`${ts}:${body}`).digest('hex');
  const r = await fetch(`${WORKER}/api/paddle/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Paddle-Signature': `ts=${ts};h1=${h1}` }, body });
  return r.status;
}

await del('user_plans', `user_id=eq.${user}`);
await del('billing_customers', `customer_id=eq.${cust}`);
await del('billing_subscriptions', `subscription_id=eq.${sub}`);
await del('billing_events', `customer_id=eq.${cust}`);

// (1) active webhook for an UNLINKED customer → recorded but grants nothing (browser/checkout alone can't).
ok('sandbox: unlinked active event acked 200', (await send('sbx-1', 'subscription.activated', '2026-10-01T00:00:00Z')) === 200);
ok('sandbox: unlinked ⇒ no user_plans grant', (await q('user_plans', `user_id=eq.${user}&select=plan`)).length === 0);
ok('sandbox: unlinked event still recorded (durable)', (await q('billing_events', `event_id=eq.sbx-1&select=event_id`)).length === 1);

// (2) now link server-side (ensure_billing_customer), bad signature must not mutate.
await rpc('ensure_billing_customer', { p_user_id: user, p_customer_id: cust });
ok('sandbox: invalid signature → 401', (await send('sbx-bad', 'subscription.activated', '2026-10-01T00:00:01Z', { badSig: true })) === 401);

// (3) valid active for LINKED + allowlisted price → grants the allowlist tier (pro).
const st3 = await send('sbx-2', 'subscription.activated', '2026-10-01T00:00:02Z');
const up3 = await q('user_plans', `user_id=eq.${user}&select=plan,subscription_status`);
ok('sandbox: linked+allowlisted active grants pro/active', st3 === 200 && up3[0] && up3[0].plan === 'pro' && up3[0].subscription_status === 'active', JSON.stringify(up3));
const ent = (await rpc('get_user_entitlement', { p_user_id: user })).j;
ok('sandbox: get_user_entitlement reflects pro', ent[0] && ent[0].entitled === true && ent[0].plan === 'pro', JSON.stringify(ent));

// (4) un-allowlisted price → grants nothing (must not silently upgrade tier)
await del('user_plans', `user_id=eq.${user}`);
await send('sbx-3', 'subscription.activated', '2026-10-02T00:00:00Z', { price: 'pri_NOT_IN_ALLOWLIST' });
ok('sandbox: un-allowlisted price grants nothing', (await q('user_plans', `user_id=eq.${user}&select=plan`)).length === 0);

// (5) renewal→active, payment_failed→past_due, cancel→not entitled (timing/ordering)
await send('sbx-4', 'subscription.activated', '2026-10-03T00:00:00Z');
await send('sbx-5', 'subscription.payment_failed', '2026-10-05T00:00:00Z');
const pd = await q('user_plans', `user_id=eq.${user}&select=subscription_status`);
ok('sandbox: payment_failed → past_due status', pd[0] && pd[0].subscription_status === 'past_due', JSON.stringify(pd));
await send('sbx-6', 'subscription.canceled', '2026-10-06T00:00:00Z');
const entC = (await rpc('get_user_entitlement', { p_user_id: user })).j;
ok('sandbox: cancel removes entitlement', entC[0] && entC[0].entitled === false, JSON.stringify(entC));

// (6) replay dedupe (durable, survives restart via event_id PK)
const before = (await q('billing_events', `customer_id=eq.${cust}&select=event_id`)).length;
await send('sbx-2', 'subscription.activated', '2026-10-01T00:00:02Z');
const after = (await q('billing_events', `customer_id=eq.${cust}&select=event_id`)).length;
ok('sandbox: replayed event_id not double-stored', after === before, `before=${before} after=${after}`);

console.log(`\n=== paddle-sandbox-check: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
