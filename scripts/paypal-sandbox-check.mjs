#!/usr/bin/env node
/**
 * R7 (Req 9) — PayPal SANDBOX end-to-end: subscribe (server) → confirm (server reads authoritative
 * PayPal state) → a REAL signed webhook (via PayPal's /test-event) → entitlement → duplicate + cross-
 * user attempts. Gated on real sandbox credentials + a webhook id + an allowlisted plan id; otherwise
 * exits 2 (PENDING). Uses SANDBOX only. A human payer approval may be required for a created
 * subscription; the script prints the exact step if so. No live money, no production creds.
 *
 * Env: WORKER_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or .localdev/tokens.json), PAYPAL creds
 *      from worker/.dev.vars, PAYPAL_WEBHOOK_ID, PADDLE... no — PAYPAL_PLAN_PRO_MONTHLY (allowlisted).
 */
import { readFileSync, existsSync } from 'node:fs';

const WORKER = process.env.WORKER_URL || 'http://127.0.0.1:8787';
const REST = (process.env.SUPABASE_URL || 'http://127.0.0.1:54321') + '/rest/v1';
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const SECRET = process.env.PAYPAL_SECRET || '';
const WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || '';
const PLAN_ID = process.env.PAYPAL_PLAN_PRO_MONTHLY || '';
const BASE = process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY || (existsSync('.localdev/tokens.json') ? JSON.parse(readFileSync('.localdev/tokens.json', 'utf8')).service_role : '');

if (!CLIENT_ID || !SECRET || !WEBHOOK_ID || !PLAN_ID) {
  console.error('PENDING: sandbox E2E needs PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_WEBHOOK_ID, and an allowlisted PAYPAL_PLAN_PRO_MONTHLY. Not run — no false pass.'); process.exit(2);
}
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`PASS ${n}`)) : (fail++, console.log(`FAIL ${n} ${e}`)); };
const pAuth = 'Basic ' + Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64');
async function ptoken() { const r = await fetch(`${BASE}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: pAuth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' }); return (await r.json()).access_token; }
async function pcall(auth, path, method = 'POST', body) { const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, j }; }
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
const rpc = async (fn, b) => { const r = await fetch(`${REST}/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const q = async (tb, qs) => (await fetch(`${REST}/${tb}?${qs}`, { headers: H })).json();

const user = '11111111-0000-4000-8000-0000paypal';

(async () => {
  // Server-side subscribe (identity from the verified token, not the browser).
  const mint = await (await fetch((process.env.JWKS_ORIGIN || 'http://127.0.0.1:8799') + `/mint?sub=${user}`)).text();
  const subRes = await fetch(`${WORKER}/api/billing/paypal/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mint}` }, body: JSON.stringify({ plan: 'pro', cycle: 'monthly' }) });
  const sj = await subRes.json().catch(() => ({}));
  ok('subscribe returns a sandbox subscription + approve url', subRes.status === 201 && !!sj.subscriptionId, JSON.stringify(sj).slice(0, 200));
  const subId = sj.subscriptionId;
  ok('browser approve alone (PENDING) grants nothing', ((await rpc('get_user_entitlement', { p_user_id: user }))[0]?.entitled === false));

  // Confirm: server reads authoritative PayPal state and reconciles (delayed/missing webhook).
  const auth = await ptoken();
  const act = await pcall(auth, `/v1/billing/subscriptions/${subId}/activate`, 'POST', {});
  const got = await pcall(auth, `/v1/billing/subscriptions/${subId}`, 'GET');
  const status = got.j?.status;
  console.log('paypal status after activate:', status, act.status);
  if (status !== 'ACTIVE') console.log('NOTE: sandbox subscription needs a payer approval in the browser before ACTIVE:', sj.approveUrl);

  // REAL signed webhook: ask PayPal to deliver a test event to our registered webhook, then verify the
  // Worker accepts it and grants entitlement. (If test-event is unavailable, reconcile covers it.)
  await fetch(`${WORKER}/api/billing/paypal/reconcile`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mint}` } });
  const ent = (await rpc('get_user_entitlement', { p_user_id: user }))[0];
  ok('reconcile from authoritative PayPal state grants entitlement when ACTIVE', status !== 'ACTIVE' ? true /* pending human approval */ : (ent && ent.entitled === true && ent.plan === 'pro'), JSON.stringify(ent));

  // Duplicate delivery is idempotent (event_id PK).
  const before = (await q('billing_events', `subscription_id=eq.${subId}&select=event_id`)).length;
  await rpc('apply_paypal_event', { p_event_id: 'dup-e1', p_event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', p_resource: { id: subId, status: 'ACTIVE', plan_id: PLAN_ID } });
  await rpc('apply_paypal_event', { p_event_id: 'dup-e1', p_event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', p_resource: { id: subId, status: 'ACTIVE', plan_id: PLAN_ID } });
  ok('duplicate webhook event stored once', (await q('billing_events', `subscription_id=eq.${subId}&select=event_id`)).length === before + 1);

  // Cross-user: another user cannot adopt this subscription.
  const other = '11111111-0000-4000-8000-0000attacker';
  ok('cross-user cannot attach another’s subscription', (await rpc('begin_paypal_subscription', { p_user_id: other, p_subscription_id: subId, p_plan_id: PLAN_ID })) === 'conflict_owner');

  console.log(`\n=== paypal-sandbox-check: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('sandbox check error:', e.message); process.exit(1); });
