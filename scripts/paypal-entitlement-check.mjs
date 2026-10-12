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

// ── Coverage identity: replay, duplicates, ambiguity, renewal-without-dates ──────────
const saleAt = (sub, saleId, capturedIso, extra = {}) => ({
  id: saleId, subscription_id: sub, status: 'completed', update_time: capturedIso, create_time: capturedIso,
  amount: { currency: 'USD', total: '19.00' }, ...extra,
});
const payRow = async (saleId) => (await q('billing_payments', `payment_id=eq.${saleId}&select=period_start,period_end,status,captured_at`))[0];

// (1) An OLD payment arriving after a later renewal must not acquire the latest period
{ const u = uid('09'), s = 'I-REPLAY'; await reset(u, s); await begin(u, s);
  await rpc('apply_paypal_event', { p_event_id: 'rp-new', p_event_type: 'PAYMENT.SALE.COMPLETED',
    p_resource: saleAt(s, 'SALE-NEW', iso(0), { billing_period_start_date: iso(0), billing_period_end_date: iso(30) }) });
  const before = await ent(u);
  // Same OLD sale, brand-new event id, arriving after the renewal and carrying no period dates.
  await rpc('apply_paypal_event', { p_event_id: 'rp-old-2', p_event_type: 'PAYMENT.SALE.COMPLETED', p_resource: saleAt(s, 'SALE-OLD', iso(-30)) });
  const old = await payRow('SALE-OLD');
  const after = await ent(u);
  ok('old payment replayed after a renewal gains no paid-through window', old && old.period_end === null, JSON.stringify(old));
  ok('replaying an old payment does not change current coverage', before.entitled === after.entitled && after.entitled === true, JSON.stringify([before, after]));
}
// (2) A redelivery of the SAME sale under a new event id must not extend coverage
{ const u = uid('10'), s = 'I-EXTEND'; await reset(u, s); await begin(u, s);
  const end20 = iso(20);
  await rpc('apply_paypal_event', { p_event_id: 'ex-1', p_event_type: 'PAYMENT.SALE.COMPLETED',
    p_resource: saleAt(s, 'SALE-E1', iso(-10), { billing_period_start_date: iso(-10), billing_period_end_date: end20 }) });
  await rpc('apply_paypal_event', { p_event_id: 'ex-2', p_event_type: 'PAYMENT.SALE.COMPLETED',
    p_resource: saleAt(s, 'SALE-E1', iso(-10), { billing_period_start_date: iso(-10), billing_period_end_date: iso(400) }) });
  const row = await payRow('SALE-E1');
  ok('duplicate sale under a new event id cannot extend the paid-through date', row && new Date(row.period_end).getTime() === new Date(end20).getTime(), JSON.stringify(row));
}
// (3) Reconciliation binds the window to the payment it belongs to, and refuses to move a date
{ const u = uid('11'), s = 'I-REPAIR'; await reset(u, s); await begin(u, s);
  const end30 = iso(30);
  await rpc('apply_paypal_event', { p_event_id: 'rep-old', p_event_type: 'PAYMENT.SALE.COMPLETED', p_resource: saleAt(s, 'SALE-R-OLD', iso(-40)) });
  await rpc('apply_paypal_event', { p_event_id: 'rep-new', p_event_type: 'PAYMENT.SALE.COMPLETED', p_resource: saleAt(s, 'SALE-R-NEW', iso(0)) });
  const e0 = await ent(u);
  ok('two undated payments leave the user pending, not entitled', e0.entitled === false, JSON.stringify(e0));
  const wrong = await rpc('set_payment_coverage', { p_payment_id: 'SALE-R-OLD', p_period_start: iso(-40), p_period_end: end30 });
  ok('reconciliation may bind a window to an undated payment', wrong === 'applied', JSON.stringify(wrong));
  const again = await rpc('set_payment_coverage', { p_payment_id: 'SALE-R-OLD', p_period_start: iso(200), p_period_end: iso(400) });
  const oldRow = await payRow('SALE-R-OLD');
  ok('a second repair cannot move an existing paid-through date', again === 'already_covered' && new Date(oldRow.period_end).getTime() === new Date(end30).getTime(), `${again} ${JSON.stringify(oldRow)}`);
  const missing = await rpc('set_payment_coverage', { p_payment_id: 'SALE-NOPE', p_period_start: iso(-1), p_period_end: iso(29) });
  ok('coverage cannot be attached to a payment that does not exist', missing === 'unknown_payment', JSON.stringify(missing));
}
// (4) Ambiguous/absent dates stay pending rather than being guessed
{ const u = uid('12'), s = 'I-PENDING'; await reset(u, s); await begin(u, s);
  await rpc('apply_paypal_event', { p_event_id: 'pend-1', p_event_type: 'PAYMENT.SALE.COMPLETED', p_resource: saleAt(s, 'SALE-P1', iso(-3)) });
  const row = await payRow('SALE-P1'); const e = await ent(u);
  ok('payment with no period dates is recorded but stays pending coverage', row.period_end === null && row.period_start !== null && e.entitled === false, JSON.stringify([row, e]));
}
// (5) A renewal that also omits billing_period_* still becomes coverage once its window is bound
{ const u = uid('13'), s = 'I-RENEW'; await reset(u, s); await begin(u, s);
  await rpc('apply_paypal_event', { p_event_id: 'rn-1', p_event_type: 'PAYMENT.SALE.COMPLETED',
    p_resource: saleAt(s, 'SALE-RN1', iso(-30), { billing_period_end_date: iso(0) }) });
  await rpc('apply_paypal_event', { p_event_id: 'rn-2', p_event_type: 'PAYMENT.SALE.COMPLETED', p_resource: saleAt(s, 'SALE-RN2', iso(0)) });
  const mid = await ent(u);
  ok('expired first period without a renewal window leaves the user free', mid.entitled === false, JSON.stringify(mid));
  await rpc('set_payment_coverage', { p_payment_id: 'SALE-RN2', p_period_start: iso(0), p_period_end: iso(30) });
  const after = await ent(u); const r2 = await payRow('SALE-RN2');
  ok('renewal without billing_period_* fields restores coverage when bound', after.entitled === true && after.plan === 'pro' && r2.period_end !== null, JSON.stringify([after, r2]));
}

// ── Refund identity: the REAL payload names the refund, not the sale, and no subscription ──
{ const u = uid('14'), s = 'I-RFMT'; await reset(u, s); await begin(u, s);
  await rpc('apply_paypal_event', { p_event_id: 'fm-1', p_event_type: 'PAYMENT.SALE.COMPLETED',
    p_resource: saleAt(s, 'SALE-F1', iso(-1), { billing_period_start_date: iso(-1), billing_period_end_date: iso(28) }) });
  const paid = await ent(u);
  ok('refund setup: captured payment covers the period', paid.entitled === true, JSON.stringify(paid));
  const rf = await rpc('apply_paypal_event', { p_event_id: 'fm-2', p_event_type: 'PAYMENT.SALE.REFUNDED',
    p_resource: { id: 'REFUND-ONLY-ID', sale_id: 'SALE-F1', state: 'completed', amount: { total: '19.00', currency: 'USD' }, update_time: iso(0), create_time: iso(0) } });
  const row = await payRow('SALE-F1'); const after = await ent(u);
  ok('refund resolving through sale_id (no subscription in payload)', rf === 'applied' && row && row.status === 'refunded', `${rf} ${JSON.stringify(row)}`);
  ok('full refund of the covering payment revokes access', after.entitled === false, JSON.stringify(after));
}
// Partial refunds keep the period paid for until the cumulative amount reaches gross
{ const u = uid('15'), s = 'I-RPART'; await reset(u, s); await begin(u, s);
  await rpc('apply_paypal_event', { p_event_id: 'pt-1', p_event_type: 'PAYMENT.SALE.COMPLETED',
    p_resource: saleAt(s, 'SALE-PT', iso(-1), { billing_period_start_date: iso(-1), billing_period_end_date: iso(28) }) });
  await rpc('apply_paypal_event', { p_event_id: 'pt-2', p_event_type: 'PAYMENT.SALE.REFUNDED',
    p_resource: { id: 'REF-PART-1', sale_id: 'SALE-PT', amount: { total: '5.00', currency: 'USD' }, update_time: iso(0) } });
  const mid = await ent(u); const midRow = await payRow('SALE-PT');
  ok('partial refund does not revoke the period it did not fully repay', mid.entitled === true && midRow.status === 'captured', JSON.stringify([mid, midRow]));
  await rpc('apply_paypal_event', { p_event_id: 'pt-3', p_event_type: 'PAYMENT.SALE.REFUNDED',
    p_resource: { id: 'REF-PART-2', sale_id: 'SALE-PT', amount: { total: '14.00', currency: 'USD' }, update_time: iso(0) } });
  const end = await ent(u); const endRow = await payRow('SALE-PT');
  ok('cumulative refunds reaching gross revoke the period', end.entitled === false && endRow.status === 'refunded', JSON.stringify([end, endRow]));
}
// A reversal voids regardless of the amount reported
{ const u = uid('16'), s = 'I-RREV'; await reset(u, s); await begin(u, s);
  await rpc('apply_paypal_event', { p_event_id: 'rv-1', p_event_type: 'PAYMENT.SALE.COMPLETED',
    p_resource: saleAt(s, 'SALE-RV', iso(-1), { billing_period_start_date: iso(-1), billing_period_end_date: iso(28) }) });
  await rpc('apply_paypal_event', { p_event_id: 'rv-2', p_event_type: 'PAYMENT.SALE.REVERSED',
    p_resource: { id: 'REVERSAL-1', sale_id: 'SALE-RV', amount: { total: '1.00', currency: 'USD' }, update_time: iso(0) } });
  const e = await ent(u); const row = await payRow('SALE-RV');
  ok('reversal revokes coverage even for a partial amount', e.entitled === false && row.status === 'reversed', JSON.stringify([e, row]));
}

// A redelivered capture must not resurrect a refunded payment
{ const u = uid('17'), s = 'I-RUNCAP'; await reset(u, s); await begin(u, s);
  await rpc('apply_paypal_event', { p_event_id: 'uc-1', p_event_type: 'PAYMENT.SALE.COMPLETED',
    p_resource: saleAt(s, 'SALE-UC', iso(-1), { billing_period_start_date: iso(-1), billing_period_end_date: iso(28) }) });
  await rpc('apply_paypal_event', { p_event_id: 'uc-2', p_event_type: 'PAYMENT.SALE.REFUNDED',
    p_resource: { id: 'REF-UC', sale_id: 'SALE-UC', amount: { total: '19.00', currency: 'USD' }, update_time: iso(0) } });
  const refunded = await ent(u);
  await rpc('apply_paypal_event', { p_event_id: 'uc-3', p_event_type: 'PAYMENT.SALE.COMPLETED',
    p_resource: saleAt(s, 'SALE-UC', iso(-1), { billing_period_start_date: iso(-1), billing_period_end_date: iso(28) }) });
  const row = await payRow('SALE-UC'); const after = await ent(u);
  ok('refunded payment stays refunded through a redelivered capture', refunded.entitled === false && row.status === 'refunded' && after.entitled === false, JSON.stringify([refunded, row, after]));
}
// p_coverage is stored OUT of the inbox: the event payload stays exactly as delivered
{ const u = uid('18'), s = 'I-RAWPAY'; await reset(u, s); await begin(u, s);
  const raw = saleAt(s, 'SALE-RAW', iso(0));
  await rpc('apply_paypal_event', { p_event_id: 'raw-1', p_event_type: 'PAYMENT.SALE.COMPLETED', p_resource: raw, p_coverage: { start: iso(0), end: iso(30) } });
  const stored = (await q('billing_events', `event_id=eq.raw-1&select=payload`))[0].payload;
  const row = await payRow('SALE-RAW'); const e = await ent(u);
  ok('inbox keeps the raw payload (no derived dates written into it)', !('billing_period_end_date' in stored) && stored.id === 'SALE-RAW', JSON.stringify(stored).slice(0, 160));
  ok('the Worker-supplied window still bounds coverage', row.period_end !== null && e.entitled === true && e.plan === 'pro', JSON.stringify([row, e]));
  const bad = await rpc('apply_paypal_event', { p_event_id: 'raw-2', p_event_type: 'PAYMENT.SALE.COMPLETED', p_resource: saleAt(s, 'SALE-RAW2', iso(0)), p_coverage: null });
  const unbounded = await payRow('SALE-RAW2');
  ok('a capture with no window anywhere stays pending rather than guessing', bad === 'applied' && unbounded.period_end === null, `${bad} ${JSON.stringify(unbounded)}`);
}

console.log(`\n=== paypal-entitlement-check (coverage policy): ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
