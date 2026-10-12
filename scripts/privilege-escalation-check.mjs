#!/usr/bin/env node
/**
 * R2 + R4 — PROVE the trust boundaries, not just cross-user isolation:
 *   R4 privilege escalation — an authenticated user must NOT be able to:
 *     · self-upgrade by writing user_plans directly;
 *     · create credits / alter usage accounting (insert credit/plan/usage rows, call reserve/settle);
 *     · invoke privileged billing/grant/refund/entitlement functions;
 *     · attach another user's Paddle customer to their own account.
 *   R2 webhook ownership — a grant happens ONLY for a LINKED customer + an ALLOWLISTED price +
 *     active state; unlinked / un-allowlisted / unknown price / conflicting link grant NOTHING
 *     (the event is still recorded for investigation). Cancel demotes.
 * Runs against the real local PostgREST with service-role + two authenticated + anon tokens.
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const REST = BASE + '/rest/v1';
const TOK = JSON.parse(readFileSync('.localdev/tokens.json', 'utf8'));
const SR = TOK.service_role, UA = TOK.userA, UB = TOK.userB, ANON = TOK.anon;
const subA = JSON.parse(Buffer.from(UA.split('.')[1], 'base64url').toString()).sub;
const subB = JSON.parse(Buffer.from(UB.split('.')[1], 'base64url').toString()).sub;

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`PASS ${n}`)) : (fail++, console.log(`FAIL ${n} ${e}`)); };
const H = (t) => ({ apikey: t, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
async function rpc(t, fn, body) { const r = await fetch(`${REST}/rpc/${fn}`, { method: 'POST', headers: H(t), body: JSON.stringify(body) }); const tx = await r.text(); let j; try { j = JSON.parse(tx); } catch { j = tx; } return { status: r.status, j }; }
async function sel(t, tb, qs) { const r = await fetch(`${REST}/${tb}?${qs}`, { headers: H(t) }); const x = await r.text(); let j; try { j = JSON.parse(x); } catch { j = x; } return { status: r.status, j }; }
async function ins(t, tb, rows) { const r = await fetch(`${REST}/${tb}`, { method: 'POST', headers: { ...H(t), Prefer: 'return=minimal' }, body: JSON.stringify(rows) }); return r.status; }
async function patch(t, tb, qs, body) { const r = await fetch(`${REST}/${tb}?${qs}`, { method: 'PATCH', headers: { ...H(t), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.status; }
async function del(t, tb, qs) { await fetch(`${REST}/${tb}?${qs}`, { method: 'DELETE', headers: H(t) }); }
const denied = (s) => s === 401 || s === 403 || s === 404 || s === 406; // no policy/permission ⇒ these

// ── R4.1 self-upgrade via direct user_plans writes ────────────────────────────
await del(SR, 'user_plans', `user_id=in.(${subA},${subB})`);
ok('R4: user cannot INSERT their own plan (self-upgrade blocked)', denied(await ins(UA, 'user_plans', [{ user_id: subA, plan: 'business', subscription_status: 'active' }])), '');
await ins(SR, 'user_plans', [{ user_id: subA, plan: 'free', subscription_status: 'inactive' }]);
const patchRes = await (async () => { const r = await fetch(`${REST}/user_plans?user_id=eq.${subA}`, { method: 'PATCH', headers: { ...H(UA), 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ plan: 'business', subscription_status: 'active' }) }); return { status: r.status, body: await r.json().catch(() => []) }; })();
const patchAfter = await sel(SR, 'user_plans', `user_id=eq.${subA}&select=plan,subscription_status`);
const patchBlocked = denied(patchRes.status) || (Array.isArray(patchRes.body) && patchRes.body.length === 0) || (patchAfter.j[0] && patchAfter.j[0].plan === 'free');
ok('R4: user cannot PATCH their own plan up (write blocked by RLS)', patchBlocked, `status=${patchRes.status} after=${JSON.stringify(patchAfter.j)}`);
ok('R4: self-upgrade PATCH left the plan unchanged (still free)', patchAfter.j[0] && patchAfter.j[0].plan === 'free', JSON.stringify(patchAfter.j));

// ── R4.2 create credits / alter usage accounting ──────────────────────────────
ok('R4: cannot INSERT credit_reservations (mint credits)', denied(await ins(UA, 'credit_reservations', [{ request_id: 'f0f0f0f0-0000-4000-8000-0000000000aa', user_id: subA, cost: 999, status: 'SUCCESS' }])), '');
ok('R4: cannot INSERT plan_grants (raise own limit)', denied(await ins(UA, 'plan_grants', [{ month_key: '2099-01', user_id: subA, ai_credit_limit: 1000000, ai_credit_used: 0 }])), '');
ok('R4: cannot INSERT usage_logs (fake accounting)', denied(await ins(UA, 'usage_logs', [{ request_id: 'f0f0f0f0-0000-4000-8000-0000000000bb', tracking_key: subA, ip_address: '1.1.1.1', month: '2099-01', tool_id: 'ocr', ai_pages: 1, operations: 1, page_count: 1, feature_type: 'ai', status: 'SUCCESS' }])), '');

// ── R4.3 invoke privileged functions (revoked from authenticated) ──────────────
for (const [fn, args] of [['reserve_credit', { p_request_id: '00000000-0000-4000-8000-000000000001', p_user_id: subA, p_cost: 1, p_month: '2099-01' }], ['settle_credit', { p_request_id: '00000000-0000-4000-8000-000000000001', p_status: 'SUCCESS', p_month: '2099-01' }], ['check_usage_limit', { p_user_id: subA, p_tracking_key: subA, p_ip_address: '1.1.1.1', p_tool_id: 'ocr', p_ai_pages: 1, p_operations: 0, p_page_count: 1 }], ['reserve_usage', { p_request_id: '00000000-0000-4000-8000-000000000002', p_user_id: subA, p_tracking_key: subA, p_ip_address: '1.1.1.1', p_tool_id: 'ocr', p_ai_pages: 1, p_operations: 0, p_page_count: 1 }], ['get_user_entitlement', { p_user_id: subB }], ['resolve_plan_for_price', { p_price_id: 'pri_SANDBOX_PRO_PLACEHOLDER' }], ['ensure_billing_customer', { p_user_id: subA, p_customer_id: 'cus_A' }], ['apply_paypal_event', { p_event_id: 'x', p_event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', p_resource: { id: 's' } }], ['begin_paypal_subscription', { p_user_id: subA, p_subscription_id: 's', p_plan_id: 'P-SANDBOX-PRO-MONTHLY' }], ['refresh_user_coverage', { p_user_id: subA }]]) {
  const r = await rpc(UA, fn, args);
  ok(`R4: authenticated cannot call privileged fn ${fn}`, denied(r.status), `status=${r.status}`);
}

// ── R4.4 attach another user's Paddle customer ───────────────────────────────
await del(SR, 'billing_customers', `user_id=in.(${subA},${subB})`);
ok('R4: cannot INSERT a row linking self to another user\'s customer', denied(await ins(UA, 'billing_customers', [{ customer_id: 'cusB', user_id: subA }])), '');
await ins(SR, 'billing_customers', [{ customer_id: 'cusB', user_id: subB }]);
const steal = await rpc(SR, 'ensure_billing_customer', { p_user_id: subA, p_customer_id: 'cusB' });
ok('R4: server refuses to steal B\'s customer (conflict_customer_owned)', steal.j === 'conflict_customer_owned', JSON.stringify(steal.j));
const stillB = await sel(SR, 'billing_customers', `customer_id=eq.cusB&select=user_id`);
ok('R4: B still owns cusB after A\'s attempt', stillB.j[0] && stillB.j[0].user_id === subB, JSON.stringify(stillB.j));

// ── R2 webhook ownership: grant only via a persisted link + allowlisted plan + payment coverage ──
const FUTURE = new Date(Date.now() + 30 * 864e5).toISOString();
const PAST = new Date(Date.now() - 864e5).toISOString();
async function webhook(eventId, type, resource) {
  return rpc(SR, 'apply_paypal_event', { p_event_id: eventId, p_event_type: type, p_resource: resource });
}
async function planRow(u) { return (await sel(SR, 'user_plans', `user_id=eq.${u}&select=plan,subscription_status`)).j; }
async function payment(sub, sale) {
  return webhook(`r2-pay-${sale}`, 'PAYMENT.SALE.COMPLETED', {
    id: sale, subscription_id: sub, billing_agreement_id: sub, transaction_state: 'completed',
    amount: { currency: 'USD', total: '19.00' }, billing_period_start_date: PAST, billing_period_end_date: FUTURE, time_updated: new Date().toISOString(),
  });
}
// (a) event for a subscription with NO server-side owner → recorded, nothing granted
await del(SR, 'user_plans', `user_id=eq.${subA}`);
await del(SR, 'billing_subscriptions', `subscription_id=eq.sub_unlinked`);
await del(SR, 'billing_events', `subscription_id=eq.sub_unlinked`);
await webhook('r2-a', 'BILLING.SUBSCRIPTION.ACTIVATED', { id: 'sub_unlinked', status: 'ACTIVE', time_updated: PAST });
ok('R2: unlinked subscription grants nothing (no user_plans row)', (await planRow(subA)).length === 0, JSON.stringify(await planRow(subA)));
ok('R2: unlinked event still recorded durably (kept for retry)', (await sel(SR, 'billing_events', `event_id=eq.r2-a&select=event_id`)).j.length === 1, '');
// (b) linked to a plan id that is NOT allowlisted → payment coverage cannot name a tier
await del(SR, 'billing_subscriptions', `subscription_id=eq.subA`);
await ins(SR, 'billing_subscriptions', [{ subscription_id: 'subA', user_id: subA, plan_id: 'P-NOT-IN-ALLOWLIST', provider: 'paypal', status: 'ACTIVE' }]);
await payment('subA', 'sale-b');
const entB = await rpc(SR, 'get_user_entitlement', { p_user_id: subA });
ok('R2: coverage of an unknown plan → free, not entitled', entB.j[0] && entB.j[0].entitled === false && entB.j[0].plan === 'free', JSON.stringify(entB.j));
// (c) linked + allowlisted business plan + captured USD payment → business
await del(SR, 'billing_payments', `subscription_id=eq.subA`);
await del(SR, 'billing_events', `subscription_id=eq.subA`);
const link = await rpc(SR, 'begin_paypal_subscription', { p_user_id: subA, p_subscription_id: 'subA', p_plan_id: 'P-SANDBOX-BUSINESS-MONTHLY' });
ok('R2: server links own subscription (allowlisted plan)', link.j === 'ok', JSON.stringify(link.j));
await payment('subA', 'sale-c');
const granted = await planRow(subA);
ok('R2: link + allowlisted plan + captured payment → business/active', granted[0] && granted[0].plan === 'business' && granted[0].subscription_status === 'active', JSON.stringify(granted));
// (d) cancel stops renewal but keeps paid-through access; refund of that payment revokes it
await webhook('r2-d', 'BILLING.SUBSCRIPTION.CANCELLED', { id: 'subA', status: 'CANCELLED', time_updated: new Date().toISOString() });
const afterCancel = await rpc(SR, 'get_user_entitlement', { p_user_id: subA });
ok('R2: cancel preserves already-paid coverage', afterCancel.j[0] && afterCancel.j[0].entitled === true, JSON.stringify(afterCancel.j));
await webhook('r2-e', 'PAYMENT.SALE.REFUNDED', { id: 'sale-c', subscription_id: 'subA', billing_agreement_id: 'subA', time_updated: new Date().toISOString() });
const afterRefund = await rpc(SR, 'get_user_entitlement', { p_user_id: subA });
ok('R2: refund of the covering payment revokes access', afterRefund.j[0] && afterRefund.j[0].entitled === false, JSON.stringify(afterRefund.j));
// (f) adoption attempt: A cannot attach B's subscription
await del(SR, 'billing_subscriptions', `subscription_id=eq.subB`);
await ins(SR, 'billing_subscriptions', [{ subscription_id: 'subB', user_id: subB, plan_id: 'P-SANDBOX-PRO-MONTHLY', provider: 'paypal', status: 'ACTIVE' }]);
const adopt = await rpc(SR, 'begin_paypal_subscription', { p_user_id: subA, p_subscription_id: 'subB', p_plan_id: 'P-SANDBOX-BUSINESS-MONTHLY' });
ok('R2: server refuses to adopt another user\'s subscription (conflict_owner)', adopt.j === 'conflict_owner', JSON.stringify(adopt.j));
const bStill = await sel(SR, 'billing_subscriptions', `subscription_id=eq.subB&select=user_id`);
ok('R2: B still owns subB after A\'s attempt', bStill.j[0] && bStill.j[0].user_id === subB, JSON.stringify(bStill.j));

await del(SR, 'billing_customers', `user_id=in.(${subA},${subB})`);
await ins(SR, 'billing_customers', [{ customer_id: 'cusA', user_id: subA }]);
// ── one customer per user (R2 link integrity) ───────────────────────────────
const reLinkOther = await rpc(SR, 'ensure_billing_customer', { p_user_id: subA, p_customer_id: 'cusA2' });
ok('R2: a user cannot bind a second customer (one-per-user)', reLinkOther.j === 'conflict_user_linked', JSON.stringify(reLinkOther.j));

console.log(`\n=== privilege-escalation-check: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
