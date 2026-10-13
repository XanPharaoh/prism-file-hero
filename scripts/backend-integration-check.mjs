#!/usr/bin/env node
/**
 * Item 4 — PROVE THE BACKEND IS CONNECTED against the real local stack (PostgREST + Postgres +
 * Kong), NOT an in-memory reducer. Exercises the actual DB functions the Worker calls and the
 * RLS roles a real browser/app request would carry. Prints one PASS/FAIL line per assertion and
 * exits non-zero on any failure. Requires: `supabase start` running and minted tokens.
 *
 *   node scripts/backend-integration-check.mjs
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const REST = `${BASE}/rest/v1`;
const TOK = JSON.parse(readFileSync('.localdev/tokens.json', 'utf8'));
const MONTH = new Date().toISOString().slice(0, 7); // matches check_usage_limit / plan_grants month key
const N = Date.now().toString(36); // unique per run: the durable inbox dedupes by event_id

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? (pass++, console.log(`PASS ${name}`)) : (fail++, console.log(`FAIL ${name} ${extra}`)); return cond; };

async function rpc(token, fn, body) {
  const r = await fetch(`${REST}/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: token, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}
async function select(token, table, qs) {
  const r = await fetch(`${REST}/${table}?${qs}`, { headers: { apikey: token, Authorization: `Bearer ${token}` } });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, json: j };
}
async function del(token, table, qs) {
  const r = await fetch(`${REST}/${table}?${qs}`, { method: 'DELETE', headers: { apikey: token, Authorization: `Bearer ${token}` } });
  return { status: r.status };
}
async function ins(token, table, rows) {
  const r = await fetch(`${REST}/${table}`, { method: 'POST', headers: { apikey: token, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
  return { status: r.status };
}

const SR = TOK.service_role;
const uid = (n) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ── 1. Credit ledger: reserve/settle/refund/idempotency ─────────────────────
{
  const u = uid(9001);
  await del(SR, 'credit_reservations', `user_id=eq.${u}`);
  await del(SR, 'plan_grants', `user_id=eq.${u}`);
  await ins(SR, 'plan_grants', [{ month_key: MONTH, user_id: u, ai_credit_limit: 5, ai_credit_used: 0 }]);
  const r1 = await rpc(SR, 'reserve_credit', { p_request_id: 'aaaaaaaa-0000-4000-8000-000000000001', p_user_id: u, p_cost: 3, p_month: MONTH });
  const g1 = r1.json[0];
  ok('credit: reserve grants within limit', g1 && g1.granted === true && g1.remaining === 2, JSON.stringify(r1.json));
  const rep = await rpc(SR, 'reserve_credit', { p_request_id: 'aaaaaaaa-0000-4000-8000-000000000001', p_user_id: u, p_cost: 3, p_month: MONTH });
  ok('credit: same request_id replays (idempotent, no double-hold)', rep.json[0] && rep.json[0].reason === 'replay-granted', JSON.stringify(rep.json));
  const r2 = await rpc(SR, 'reserve_credit', { p_request_id: 'aaaaaaaa-0000-4000-8000-000000000002', p_user_id: u, p_cost: 3, p_month: MONTH });
  ok('credit: rejects over-limit (3+3>5)', r2.json[0] && r2.json[0].granted === false && r2.json[0].reason === 'insufficient credits', JSON.stringify(r2.json));
  await rpc(SR, 'settle_credit', { p_request_id: 'aaaaaaaa-0000-4000-8000-000000000001', p_status: 'ERROR', p_month: MONTH }); // refund
  const r3 = await rpc(SR, 'reserve_credit', { p_request_id: 'aaaaaaaa-0000-4000-8000-000000000003', p_user_id: u, p_cost: 3, p_month: MONTH });
  ok('credit: ERROR settle refunds the hold (now affordable)', r3.json[0] && r3.json[0].granted === true, JSON.stringify(r3.json));
  await rpc(SR, 'settle_credit', { p_request_id: 'aaaaaaaa-0000-4000-8000-000000000003', p_status: 'SUCCESS', p_month: MONTH });
  const pg = await select(SR, 'plan_grants', `user_id=eq.${u}&select=ai_credit_used`);
  ok('credit: SUCCESS settle converts hold into used (3)', pg.json[0] && Number(pg.json[0].ai_credit_used) === 3, JSON.stringify(pg.json));
  // duplicate settle must not double-count
  await rpc(SR, 'settle_credit', { p_request_id: 'aaaaaaaa-0000-4000-8000-000000000003', p_status: 'SUCCESS', p_month: MONTH });
  const pg2 = await select(SR, 'plan_grants', `user_id=eq.${u}&select=ai_credit_used`);
  ok('credit: duplicate settle does not double-count', Number(pg2.json[0].ai_credit_used) === 3, JSON.stringify(pg2.json));
}

// ── 2. Credit concurrency: 20 parallel single-credit reserves vs limit 5 ─────
{
  const u = uid(9002);
  await del(SR, 'credit_reservations', `user_id=eq.${u}`);
  await del(SR, 'plan_grants', `user_id=eq.${u}`);
  await ins(SR, 'plan_grants', [{ month_key: MONTH, user_id: u, ai_credit_limit: 5, ai_credit_used: 0 }]);
  const reqs = Array.from({ length: 20 }, (_, i) => rpc(SR, 'reserve_credit', {
    p_request_id: `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`, p_user_id: u, p_cost: 1, p_month: MONTH,
  }));
  const res = await Promise.all(reqs);
  const granted = res.filter((r) => r.json && r.json[0] && r.json[0].granted === true).length;
  const held = await select(SR, 'credit_reservations', `user_id=eq.${u}&status=eq.PENDING&select=request_id`);
  ok('credit: concurrent 20→ exactly 5 granted, never oversold', granted === 5, `granted=${granted}`);
  ok('credit: exactly 5 PENDING holds persisted', Array.isArray(held.json) && held.json.length === 5, `held=${Array.isArray(held.json) ? held.json.length : 'n/a'}`);
}

// ── 3. Live usage ledger (the path /api/ai actually calls): reserve→settle ───
{
  // Cloud pages are only bookable by an entitled account (free cloud AI is zero on every layer),
  // so the ledger mechanics are exercised against a seeded pro subject.
  const tk = uid(9040);
  const u = tk;
  await del(SR, 'usage_logs', `request_id=in.(cccccccc-0000-4000-8000-000000000001)`); // re-runnable
  await del(SR, 'user_plans', `user_id=eq.${u}`);
  await del(SR, 'usage_logs', `user_id=eq.${u}`);
  await ins(SR, 'user_plans', [{ user_id: u, plan: 'pro', subscription_status: 'active' }]);
  const r1 = await rpc(SR, 'reserve_usage', { p_request_id: 'cccccccc-0000-4000-8000-000000000001', p_user_id: u, p_tracking_key: tk, p_ip_address: '10.0.0.1', p_tool_id: 'ocr', p_ai_pages: 1, p_operations: 0, p_page_count: 1 });
  ok('usage: reserve_usage allowed (entitled plan, within caps)', r1.json[0] && r1.json[0].allowed === true, JSON.stringify(r1.json));
  await rpc(SR, 'settle_usage', { p_request_id: 'cccccccc-0000-4000-8000-000000000001', p_status: 'SUCCESS' });
  const sum = await select(SR, 'usage_logs', `tracking_key=eq.${tk}&status=eq.SUCCESS&select=ai_pages`);
  ok('usage: settled SUCCESS recorded', Array.isArray(sum.json) && sum.json.length === 1, JSON.stringify(sum.json));
  // idempotent replay of the SAME request_id must not add a second row
  const replay = await rpc(SR, 'reserve_usage', { p_request_id: 'cccccccc-0000-4000-8000-000000000001', p_user_id: u, p_tracking_key: tk, p_ip_address: '10.0.0.1', p_tool_id: 'ocr', p_ai_pages: 1, p_operations: 0, p_page_count: 1 });
  const dup = await select(SR, 'usage_logs', `request_id=eq.cccccccc-0000-4000-8000-000000000001&select=request_id`);
  ok('usage: unique request_id prevents a second reservation row', Array.isArray(dup.json) && dup.json.length === 1, JSON.stringify(replay.json));
  // settle of an unknown id errors (authoritative, not silent)
  const bad = await rpc(SR, 'settle_usage', { p_request_id: 'dddddddd-0000-4000-8000-000000000000', p_status: 'SUCCESS' });
  ok('usage: settle of unknown reservation is rejected (not swallowed)', bad.status >= 400, `status=${bad.status}`);
}

// ── 3b. Authenticated reserve path (p_user_id NOT NULL) — regression for the "plan ambiguous" bug ─
{
  const u = uid(9050);
  await del(SR, 'user_plans', `user_id=eq.${u}`);
  await del(SR, 'usage_logs', `user_id=eq.${u}`);
  await ins(SR, 'user_plans', [{ user_id: u, plan: 'pro', subscription_status: 'active' }]);
  const r = await rpc(SR, 'reserve_usage', { p_request_id: 'eeeeeeee-0000-4000-8000-000000000001', p_user_id: u, p_tracking_key: u, p_ip_address: '10.0.0.9', p_tool_id: 'ocr', p_ai_pages: 1, p_operations: 0, p_page_count: 1 });
  ok('usage: authenticated reserve (non-null user_id) resolves plan without SQL ambiguity', r.json[0] && r.json[0].allowed === true && r.json[0].plan === 'pro', JSON.stringify(r.json).slice(0, 200));
}

// ── 4. Billing: verified PayPal events + payment coverage drive the LIVE plan ─
{
  const user = uid(7001); const sub = 'sub_paypal_grant_1'; const sale = 'sale_paypal_grant_1';
  const plan = 'P-SANDBOX-PRO-MONTHLY';                      // allowlisted in billing_price_plans
  const now = new Date().toISOString();
  const past = new Date(Date.now() - 864e5).toISOString();
  const future = new Date(Date.now() + 30 * 864e5).toISOString();
  await del(SR, 'user_plans', `user_id=eq.${user}`);
  await del(SR, 'billing_subscriptions', `subscription_id=eq.${sub}`);
  await del(SR, 'billing_events', `subscription_id=eq.${sub}`);
  await del(SR, 'billing_payments', `subscription_id=eq.${sub}`);
  const link = await rpc(SR, 'begin_paypal_subscription', { p_user_id: user, p_subscription_id: sub, p_plan_id: plan });
  ok('billing: server-side user↔subscription link persisted', link.status === 200, JSON.stringify(link.json).slice(0, 120));
  const ev = (id, type, resource) => rpc(SR, 'apply_paypal_event', { p_event_id: id, p_event_type: type, p_resource: resource });
  const ent = async () => (await rpc(SR, 'get_user_entitlement', { p_user_id: user })).json[0];

  const created = await ev(`pp-evt-1-${N}`, 'BILLING.SUBSCRIPTION.CREATED', { id: sub, status: 'APPROVAL_PENDING', plan_id: plan, create_time: past });
  ok('billing: CREATED event applied through the durable inbox', created.json === 'applied', JSON.stringify(created.json));
  ok('billing: CREATED is recorded but grants nothing (browser approval ≠ access)', (await ent()).entitled === false && (await ent()).plan === 'free', JSON.stringify(await ent()));
  const activated = await ev(`pp-evt-2-${N}`, 'BILLING.SUBSCRIPTION.ACTIVATED', { id: sub, status: 'ACTIVE', time_updated: now });
  ok('billing: ACTIVATED applied', activated.json === 'applied', JSON.stringify(activated.json));
  ok('billing: ACTIVE alone still grants nothing — entitlement needs payment coverage', (await ent()).entitled === false, JSON.stringify(await ent()));

  const paid = await ev(`pp-evt-3-${N}`, 'PAYMENT.SALE.COMPLETED', {
    id: sale, billing_agreement_id: sub, transaction_state: 'completed',
    amount: { currency: 'USD', total: '19.00' }, billing_period_start_date: past, billing_period_end_date: future, time_updated: now,
  });
  ok('billing: PAYMENT.SALE.COMPLETED applied (ownership via billing_agreement_id)', paid.json === 'applied', JSON.stringify(paid.json));
  const afterPay = await ent();
  ok('billing: captured USD payment → entitled pro', afterPay.entitled === true && afterPay.plan === 'pro', JSON.stringify(afterPay));
  const up = await select(SR, 'user_plans', `user_id=eq.${user}&select=plan,subscription_status`);
  ok('billing: coverage refresh writes the LIVE user_plans projection (pro/active)', up.json[0] && up.json[0].plan === 'pro' && up.json[0].subscription_status === 'active', JSON.stringify(up.json));
  const replay = await ev(`pp-evt-3-${N}`, 'PAYMENT.SALE.COMPLETED', { id: sale, billing_agreement_id: sub, amount: { currency: 'USD', total: '19.00' }, billing_period_end_date: future });
  ok('billing: replayed event_id is duplicate (survives restart — PK)', replay.json === 'duplicate', JSON.stringify(replay.json));
  const ooo = await ev(`pp-evt-0-${N}`, 'BILLING.SUBSCRIPTION.SUSPENDED', { id: sub, status: 'SUSPENDED', time_updated: '2020-01-01T00:00:00Z' });
  ok('billing: status event older than last_occurred is out_of_order', ooo.json === 'out_of_order', JSON.stringify(ooo.json));
  const refunded = await ev(`pp-evt-4-${N}`, 'PAYMENT.SALE.REFUNDED', { id: sale, billing_agreement_id: sub, time_updated: new Date().toISOString() });
  ok('billing: refund of the covering payment applied', refunded.json === 'applied', JSON.stringify(refunded.json));
  const afterRefund = await ent();
  ok('billing: refund revokes coverage → not entitled, even though status is still ACTIVE', afterRefund.entitled === false, JSON.stringify(afterRefund));
}

// ── 5. RLS cross-user isolation with REAL authenticated tokens (no service role) ─
{
  const userA = TOK.userA, userB = TOK.userB;
  const aSub = JSON.parse(Buffer.from(userA.split('.')[1], 'base64url').toString()).sub;
  const bSub = JSON.parse(Buffer.from(userB.split('.')[1], 'base64url').toString()).sub;
  await del(SR, 'user_plans', `user_id=in.(${aSub},${bSub})`);
  await ins(SR, 'user_plans', [{ user_id: aSub, plan: 'pro', subscription_status: 'active' }, { user_id: bSub, plan: 'business', subscription_status: 'active' }]);
  const own = await select(userA, 'user_plans', `select=user_id,plan`);
  ok('rls: user A reads only their own user_plans row', Array.isArray(own.json) && own.json.every((r) => r.user_id === aSub) && own.json.length === 1, JSON.stringify(own.json));
  const cross = await select(userB, 'user_plans', `user_id=eq.${aSub}&select=*`);
  ok('rls: user B cannot read user A row (empty, not 403-leak)', Array.isArray(cross.json) && cross.json.length === 0, JSON.stringify(cross.json));
  const anonRead = await select(TOK.anon, 'user_plans', `select=*`);
  ok('rls: anon cannot read user_plans', Array.isArray(anonRead.json) && anonRead.json.length === 0, JSON.stringify(anonRead.json));
  const insAttempt = await fetch(`${REST}/user_plans`, { method: 'POST', headers: { apikey: userA, Authorization: `Bearer ${userA}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: bSub, plan: 'business', subscription_status: 'active' }) });
  ok('rls: authenticated cannot INSERT another user plan', insAttempt.status === 401 || insAttempt.status === 403, `status=${insAttempt.status}`);
  const credRead = await select(userA, 'credit_reservations', `select=*`);
  ok('rls: authenticated has no credit_reservations policy (blocked)', credRead.status === 401 || credRead.status === 403 || (Array.isArray(credRead.json) && credRead.json.length === 0), `status=${credRead.status}`);
  const billRead = await select(userA, 'billing_events', `select=*`);
  ok('rls: authenticated cannot read the billing inbox', billRead.status === 401 || billRead.status === 403 || (Array.isArray(billRead.json) && billRead.json.length === 0), `status=${billRead.status}`);
}

// ── 6. Restart survival: PostgREST container restart keeps durable state ─────
{
  const cust = 'cus_grant_1';
  try {
    execFileSync('docker', ['restart', 'supabase_rest_prism-file-hero'], { stdio: 'ignore', timeout: 60000 });
    // wait for PostgREST to be reachable again
    for (let i = 0; i < 30; i++) { try { const r = await fetch(`${REST}/`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } }); if (r.ok) break; } catch {} await new Promise((res) => setTimeout(res, 500)); }
    const dup = await rpc(SR, 'apply_paypal_event', { p_event_id: `pp-evt-3-${N}`, p_event_type: 'PAYMENT.SALE.COMPLETED', p_resource: { id: 'sale_paypal_grant_1', billing_agreement_id: 'sub_paypal_grant_1' } });
    ok('restart: dedupe still returns duplicate after PostgREST restart (durable in Postgres)', dup.json === 'duplicate', JSON.stringify(dup.json));
  } catch (e) { ok('restart: PostgREST restart performed', false, String(e.message)); }
}

console.log(`\n=== backend-integration-check: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
