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
for (const [fn, args] of [['reserve_credit', { p_request_id: '00000000-0000-4000-8000-000000000001', p_user_id: subA, p_cost: 1, p_month: '2099-01' }], ['settle_credit', { p_request_id: '00000000-0000-4000-8000-000000000001', p_status: 'SUCCESS', p_month: '2099-01' }], ['check_usage_limit', { p_user_id: subA, p_tracking_key: subA, p_ip_address: '1.1.1.1', p_tool_id: 'ocr', p_ai_pages: 1, p_operations: 0, p_page_count: 1 }], ['reserve_usage', { p_request_id: '00000000-0000-4000-8000-000000000002', p_user_id: subA, p_tracking_key: subA, p_ip_address: '1.1.1.1', p_tool_id: 'ocr', p_ai_pages: 1, p_operations: 0, p_page_count: 1 }], ['get_user_entitlement', { p_user_id: subB }], ['resolve_plan_for_price', { p_price_id: 'pri_SANDBOX_PRO_PLACEHOLDER' }], ['ensure_billing_customer', { p_user_id: subA, p_customer_id: 'cus_A' }], ['apply_billing_event', { p_event_id: 'x', p_event_type: 'subscription.activated', p_occurred_at: '2026-01-01T00:00:00Z', p_subscription_id: 's', p_customer_id: 'c', p_payload: {} }]]) {
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

// ── R2 webhook ownership: grant only with link + allowlisted price + active ────
async function webhook(cust, sub, priceId, type, occurred, eventId) {
  return rpc(SR, 'apply_billing_event', { p_event_id: eventId, p_event_type: type, p_occurred_at: occurred, p_subscription_id: sub, p_customer_id: cust, p_payload: { data: { id: sub, customer_id: cust, ...(priceId ? { price_id: priceId } : {}) } } });
}
// (a) unlinked customer → no grant
await del(SR, 'user_plans', `user_id=eq.${subA}`); await del(SR, 'billing_customers', `user_id=eq.${subA}`);
await webhook('cus_unlinked', 'sub_unlinked', 'pri_SANDBOX_PRO_PLACEHOLDER', 'subscription.activated', '2026-10-01T00:00:00Z', 'r2-a');
const unlinked = await sel(SR, 'user_plans', `user_id=eq.${subA}&select=plan`);
ok('R2: unlinked customer grants nothing', unlinked.j.length === 0, JSON.stringify(unlinked.j));
const recorded = await sel(SR, 'billing_events', `event_id=eq.r2-a&select=event_id`);
ok('R2: unknown-link event still recorded (durable, for retry)', recorded.j.length === 1, JSON.stringify(recorded.j));
// (b) linked but price NOT allowlisted → no grant
await ins(SR, 'billing_customers', [{ customer_id: 'cusA', user_id: subA }]);
await webhook('cusA', 'subA', 'pri_UNKNOWN_NOT_IN_ALLOWLIST', 'subscription.activated', '2026-10-02T00:00:00Z', 'r2-b');
const noTier = await sel(SR, 'user_plans', `user_id=eq.${subA}&select=plan`);
ok('R2: allowlisted-price required — unknown price grants nothing', noTier.j.length === 0, JSON.stringify(noTier.j));
// (c) linked + allowlisted price → grants the allowlist tier
await webhook('cusA', 'subA', 'pri_SANDBOX_BUSINESS_PLACEHOLDER', 'subscription.activated', '2026-10-03T00:00:00Z', 'r2-c');
const granted = await sel(SR, 'user_plans', `user_id=eq.${subA}&select=plan,subscription_status`);
ok('R2: linked + allowlisted business price grants business/active', granted.j[0] && granted.j[0].plan === 'business' && granted.j[0].subscription_status === 'active', JSON.stringify(granted.j));
// (d) cancel demotes
await webhook('cusA', 'subA', 'pri_SANDBOX_BUSINESS_PLACEHOLDER', 'subscription.canceled', '2026-10-04T00:00:00Z', 'r2-d');
const canceled = await sel(SR, 'user_plans', `user_id=eq.${subA}&select=subscription_status`);
ok('R2: cancel demotes subscription_status', canceled.j[0] && canceled.j[0].subscription_status === 'canceled', JSON.stringify(canceled.j));

// ── one customer per user (R2 link integrity) ───────────────────────────────
const reLinkOther = await rpc(SR, 'ensure_billing_customer', { p_user_id: subA, p_customer_id: 'cusA2' });
ok('R2: a user cannot bind a second customer (one-per-user)', reLinkOther.j === 'conflict_user_linked', JSON.stringify(reLinkOther.j));

console.log(`\n=== privilege-escalation-check: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
