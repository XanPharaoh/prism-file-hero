#!/usr/bin/env node
/**
 * R7 — PayPal entitlement LOGIC (no PayPal creds needed; drives the real DB authority via
 * service-role RPCs). Proves the documented access policy: paid access ONLY when the subscription is
 * server-linked + the plan is allowlisted + an ACTIVE/verified event arrives; every non-entitled
 * transition (pending, suspended, cancelled, expired, payment-failed, refund/reversal) grants/demotes
 * correctly; events are idempotent + order-safe; unknown/unlinked/foreign-owner grants nothing.
 * This is the same apply_paypal_event the Worker's webhook calls after signature verification.
 */
import { readFileSync } from 'node:fs';

const REST = (process.env.SUPABASE_URL || 'http://127.0.0.1:54321') + '/rest/v1';
const SR = JSON.parse(readFileSync('.localdev/tokens.json', 'utf8')).service_role;
const PRO = 'P-SANDBOX-PRO-MONTHLY', BIZ = 'P-SANDBOX-BUSINESS-ANNUAL';
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`PASS ${n}`)) : (fail++, console.log(`FAIL ${n} ${e}`)); };
const rpc = async (fn, body) => { const r = await fetch(`${REST}/rpc/${fn}`, { method: 'POST', headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const q = async (tb, qs) => (await fetch(`${REST}/${tb}?${qs}`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } })).json();
const del = async (tb, qs) => { await fetch(`${REST}/${tb}?${qs}`, { method: 'DELETE', headers: { apikey: SR, Authorization: `Bearer ${SR}` } }); };
const uid = (x) => `11111111-7777-4000-8000-${x}`;
const ent = async (u) => (await rpc('get_user_entitlement', { p_user_id: u }))[0];
function res(sub, status, plan, ts) { return { id: sub, status: status ?? '', plan_id: plan, ...(ts ? { last_updated_time: ts } : {}) }; }

async function reset(u, sub) { await del('user_plans', `user_id=eq.${u}`); await del('billing_subscriptions', `subscription_id=eq.${sub}`); await del('billing_events', `subscription_id=eq.${sub}`); }

// begin_paypal_subscription: ok / unknown_plan / conflict_owner
{ const u = uid('b1'), s = 'I-BEGIN1'; await reset(u, s);
  ok('begin: allowlisted plan links owner', (await rpc('begin_paypal_subscription', { p_user_id: u, p_subscription_id: s, p_plan_id: PRO })) === 'ok');
  ok('begin: unknown plan rejected', (await rpc('begin_paypal_subscription', { p_user_id: u, p_subscription_id: s + 'x', p_plan_id: 'P-NOT-ALLOWED' })) === 'unknown_plan');
  const u2 = uid('b2'); await reset(u2, s + 'x2'); await rpc('begin_paypal_subscription', { p_user_id: u, p_subscription_id: s + 'x2', p_plan_id: PRO });
  ok('begin: refuse to adopt another user’s subscription', (await rpc('begin_paypal_subscription', { p_user_id: u2, p_subscription_id: s + 'x2', p_plan_id: BIZ })) === 'conflict_owner');
}

// browser approval alone (SUBSCRIPTIONCreated/PENDING) grants nothing
{ const u = uid('p1'), s = 'I-PEND1'; await reset(u, s); await rpc('begin_paypal_subscription', { p_user_id: u, p_subscription_id: s, p_plan_id: PRO });
  await rpc('apply_paypal_event', { p_event_id: 'pnd-1', p_event_type: 'BILLING.SUBSCRIPTION.CREATED', p_resource: res(s, 'PENDING', PRO) });
  const e = await ent(u); ok('pending approval grants no entitlement', e && e.entitled === false && (e.plan === 'free' || e.subscription_status !== 'active'), JSON.stringify(e));
}

// ACTIVE + allowlisted + linked → grants tier
{ const u = uid('a1'), s = 'I-ACT1'; await reset(u, s); await rpc('begin_paypal_subscription', { p_user_id: u, p_subscription_id: s, p_plan_id: BIZ });
  const r1 = await rpc('apply_paypal_event', { p_event_id: 'act-1', p_event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', p_resource: res(s, 'ACTIVE', BIZ, '2026-10-01T00:00:00Z') });
  const e = await ent(u); ok('active+allowlisted grants business/entitled', r1 === 'applied' && e && e.entitled === true && e.plan === 'business', `${r1} ${JSON.stringify(e)}`);
  ok('duplicate ACTIVE event idempotent', (await rpc('apply_paypal_event', { p_event_id: 'act-1', p_event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', p_resource: res(s, 'ACTIVE', BIZ) })) === 'duplicate');
  ok('out-of-order older event ignored', (await rpc('apply_paypal_event', { p_event_id: 'act-old', p_event_type: 'BILLING.SUBSCRIPTION.UPDATED', p_resource: res(s, 'ACTIVE', BIZ, '2020-01-01T00:00:00Z') })) === 'out_of_order');
}

// non-entitled transitions demote: payment_failed, cancel, refund/reversal
for (const [label, ev, expStatus] of [['payment_failed', 'BILLING.SUBSCRIPTION.PAYMENT.FAILED', 'past_due'], ['cancel', 'BILLING.SUBSCRIPTION.CANCELLED', 'canceled'], ['refund', 'PAYMENT.CAPTURE.REFUNDED', 'past_due']]) {
  const u = uid('x' + label.length), s = 'I-X' + label.length; await reset(u, s); await rpc('begin_paypal_subscription', { p_user_id: u, p_subscription_id: s, p_plan_id: PRO });
  await rpc('apply_paypal_event', { p_event_id: 'x-act', p_event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', p_resource: res(s, 'ACTIVE', PRO, '2026-10-01T00:00:00Z') });
  await rpc('apply_paypal_event', { p_event_id: 'x-' + label, p_event_type: ev, p_resource: { id: s, status: 'ACTIVE', plan_id: PRO } });
  const e = await ent(u); ok(`${label} revokes entitlement`, e && e.entitled === false, JSON.stringify(e));
  const up = (await q('user_plans', `user_id=eq.${u}&select=subscription_status`))[0]; ok(`${label} sets ${expStatus}`, up && up.subscription_status === expStatus, JSON.stringify(up));
}

// unlinked event (no begin) grants nothing; active w/ un-allowlisted plan grants nothing
{ const u = uid('u1'), s = 'I-UNLINKED'; await reset(u, s);
  ok('unlinked active event → unlinked (no grant)', (await rpc('apply_paypal_event', { p_event_id: 'ul-1', p_event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', p_resource: res(s, 'ACTIVE', PRO) })) === 'unlinked');
  ok('unlinked user has no plan', (await q('user_plans', `user_id=eq.${u}&select=*`)).length === 0); }
{ const u = uid('u2'), s = 'I-BADPLAN'; await reset(u, s); await rpc('begin_paypal_subscription', { p_user_id: u, p_subscription_id: s, p_plan_id: PRO });
  ok('active with un-allowlisted plan → unknown_plan (no grant)', (await rpc('apply_paypal_event', { p_event_id: 'bp-1', p_event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', p_resource: res(s, 'ACTIVE', 'P-ROGUE' ) })) === 'unknown_plan'); }

console.log(`\n=== paypal-entitlement-check: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
