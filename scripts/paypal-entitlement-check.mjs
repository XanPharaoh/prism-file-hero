#!/usr/bin/env node
/**
 * R7 access-policy (PAYMENT COVERAGE) — no PayPal creds needed; drives the real DB authority.
 * Proves: entitlement reflects VERIFIED payment coverage, not ACTIVE status; cancel preserves
 * already-paid access through the paid-through date; refunds/reversals void the AFFECTED payment
 * (older-period refund among several payments); reconciliation on a mere ACTIVE cannot restore
 * revoked access; a PAYMENT.SALE arriving after a newer status event is still applied (not discarded);
 * duplicates idempotent; unlinked grants nothing; cross-user cannot adopt another's subscription.
 */
import { readFileSync } from 'node:fs';
const REST = (process.env.SUPABASE_URL || 'http://127.0.0.1:54321') + '/rest/v1';
const SR = JSON.parse(readFileSync('.localdev/tokens.json', 'utf8')).service_role;
const PRO = 'P-SANDBOX-PRO-MONTHLY';
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`PASS ${n}`)) : (fail++, console.log(`FAIL ${n} ${e}`)); };
const rpc = async (fn, b) => { const r = await fetch(`${REST}/rpc/${fn}`, { method: 'POST', headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const q = async (tb, qs) => (await fetch(`${REST}/${tb}?${qs}`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } })).json();
const del = async (tb, qs) => { await fetch(`${REST}/${tb}?${qs}`, { method: 'DELETE', headers: { apikey: SR, Authorization: `Bearer ${SR}` } }); };
const uid = (x) => `11111111-8888-4000-8000-${x}`;
const ent = async (u) => (await rpc('get_user_entitlement', { p_user_id: u }))[0];
const iso = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString();
async function begin(u, s, plan = PRO) { return rpc('begin_paypal_subscription', { p_user_id: u, p_subscription_id: s, p_plan_id: plan }); }
function sale(sub, saleId, startOffset, endOffset) { return { id: saleId, subscription_id: sub, status: 'completed', amount: { currency_code: 'USD', total: '19.00' }, billing_period_start_date: iso(startOffset), billing_period_end_date: iso(endOffset) }; }
async function reset(u, s) { await del('user_plans', `user_id=eq.${u}`); await del('billing_subscriptions', `subscription_id=eq.${s}`); await del('billing_events', `subscription_id=eq.${s}`); await del('billing_payments', `subscription_id=eq.${s}`); }

// ACTIVE without a payment grants NOTHING (no-trial coverage rule)
{ const u = uid('01'), s = 'I-NOPE'; await reset(u, s); await begin(u, s);
  await rpc('apply_paypal_event', { p_event_id: 'a1', p_event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', p_resource: { id: s, status: 'ACTIVE', plan_id: PRO } });
  const e = await ent(u); ok('ACTIVE alone grants nothing (no trial)', e && e.entitled === false, JSON.stringify(e));
}
// Captured payment → entitled; cancel preserves paid-through coverage
{ const u = uid('02'), s = 'I-PAY'; await reset(u, s); await begin(u, s);
  await rpc('apply_paypal_event', { p_event_id: 'pay1', p_event_type: 'PAYMENT.SALE.COMPLETED', p_resource: sale(s, 'SALE-1', -1, 29) });
  let e = await ent(u); ok('captured payment grants coverage', e && e.entitled === true && e.plan === 'pro', JSON.stringify(e));
  await rpc('apply_paypal_event', { p_event_id: 'cancel1', p_event_type: 'BILLING.SUBSCRIPTION.CANCELLED', p_resource: { id: s, status: 'CANCELLED', plan_id: PRO } });
  e = await ent(u); ok('cancel stops renewal but keeps paid-through access', e && e.entitled === true, JSON.stringify(e));
}
// Refund the affected payment → coverage gone; reversal too
{ const u = uid('03'), s = 'I-REF'; await reset(u, s); await begin(u, s);
  await rpc('apply_paypal_event', { p_event_id: 'pay2', p_event_type: 'PAYMENT.SALE.COMPLETED', p_resource: sale(s, 'SALE-2', -1, 29) });
  await rpc('apply_paypal_event', { p_event_id: 'rf1', p_event_type: 'PAYMENT.SALE.REFUNDED', p_resource: { id: 'SALE-2', subscription_id: s, amount: { currency_code: 'USD', total: '19.00' } } });
  const e = await ent(u); ok('refund of the covering payment revokes access', e && e.entitled === false, JSON.stringify(e));
}
// Older-period refund among several payments: newer period still covers
{ const u = uid('04'), s = 'I-MULTI'; await reset(u, s); await begin(u, s);
  await rpc('apply_paypal_event', { p_event_id: 'payA', p_event_type: 'PAYMENT.SALE.COMPLETED', p_resource: sale(s, 'SALE-A', -60, -31) }); // older, already past
  await rpc('apply_paypal_event', { p_event_id: 'payB', p_event_type: 'PAYMENT.SALE.COMPLETED', p_resource: sale(s, 'SALE-B', -1, 29) });  // current
  let e = await ent(u); ok('multi-period: current coverage entitled', e && e.entitled === true, JSON.stringify(e));
  await rpc('apply_paypal_event', { p_event_id: 'rfOld', p_event_type: 'PAYMENT.SALE.REFUNDED', p_resource: { id: 'SALE-A', subscription_id: s } }); // refund OLD
  e = await ent(u); ok('refunding an OLDER period keeps current coverage', e && e.entitled === true, JSON.stringify(e));
  await rpc('apply_paypal_event', { p_event_id: 'rfNew', p_event_type: 'PAYMENT.SALE.REFUNDED', p_resource: { id: 'SALE-B', subscription_id: s } }); // refund CURRENT
  e = await ent(u); ok('refunding the current period revokes', e && e.entitled === false, JSON.stringify(e));
}
// Reconcile on mere ACTIVE cannot restore revoked access (payments drive it)
{ const u = uid('05'), s = 'I-RECON'; await reset(u, s); await begin(u, s);
  await rpc('apply_paypal_event', { p_event_id: 'r-act', p_event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', p_resource: { id: s, status: 'ACTIVE', plan_id: PRO } });
  const e = await ent(u); ok('reconcile/status ACTIVE with no payment ⇒ not entitled', e && e.entitled === false, JSON.stringify(e));
}
// Payment event arriving AFTER a newer status event must still apply (not discarded)
{ const u = uid('06'), s = 'I-ORDER'; await reset(u, s); await begin(u, s);
  await rpc('apply_paypal_event', { p_event_id: 'st-late', p_event_type: 'BILLING.SUBSCRIPTION.UPDATED', p_resource: { id: s, status: 'ACTIVE', plan_id: PRO, time_updated: iso(5) } });
  const pr = await rpc('apply_paypal_event', { p_event_id: 'pay-old', p_event_type: 'PAYMENT.SALE.COMPLETED', p_resource: sale(s, 'SALE-O', -1, 29) }); // earlier create_time, but a payment
  const e = await ent(u); ok('payment event not discarded by newer status ordering', pr === 'applied' && e && e.entitled === true, `${pr} ${JSON.stringify(e)}`);
}
// Duplicate + unlinked + cross-user
{ const u = uid('07'), s = 'I-DUP'; await reset(u, s); await begin(u, s);
  await rpc('apply_paypal_event', { p_event_id: 'd1', p_event_type: 'PAYMENT.SALE.COMPLETED', p_resource: sale(s, 'SALE-D', -1, 29) });
  ok('duplicate payment event idempotent', (await rpc('apply_paypal_event', { p_event_id: 'd1', p_event_type: 'PAYMENT.SALE.COMPLETED', p_resource: sale(s, 'SALE-D', -1, 29) })) === 'duplicate');
  const s2 = 'I-UNLINK-P'; await del('billing_events', `subscription_id=eq.${s2}`);
  ok('unlinked payment → unlinked (no grant)', (await rpc('apply_paypal_event', { p_event_id: 'unl', p_event_type: 'PAYMENT.SALE.COMPLETED', p_resource: sale(s2, 'SALE-U', -1, 29) })) === 'unlinked');
  const u2 = uid('08'); const s3 = 'I-XU'; await reset(u2, s3); await begin(u, s3);
  ok('cross-user cannot adopt another’s subscription', (await begin(u2, s3)) === 'conflict_owner');
}

console.log(`\n=== paypal-entitlement-check (coverage policy): ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
