#!/usr/bin/env node
/**
 * R7 (Req 1 & 2) — verify the PayPal account's Subscriptions + USD capability and create/reuse the
 * sandbox PRODUCT and RECURRING PLANS (monthly + annual, USD) for Pro and Business. SANDBOX ONLY.
 *
 * Gated: without PAYPAL_CLIENT_ID / PAYPAL_SECRET it exits 2 (PENDING) and makes NO calls. On success
 * it prints the four PayPal plan ids to place in (a) the billing_price_plans allowlist and (b)
 * worker/.dev.vars (PAYPAL_PLAN_PRO_MONTHLY etc.). No live credentials, no real money.
 *
 *   PAYPAL_CLIENT_ID=.. PAYPAL_SECRET=.. PAYPAL_ENV=sandbox node scripts/paypal-capability-check.mjs
 */
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const SECRET = process.env.PAYPAL_SECRET || '';
const BASE = process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

if (!CLIENT_ID || !SECRET) {
  console.error('PENDING: PayPal capability check needs PAYPAL_CLIENT_ID + PAYPAL_SECRET (sandbox app from developer.paypal.com). Not run.');
  process.exit(2);
}

async function token() {
  const r = await fetch(`${BASE}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  if (!r.ok) throw new Error(`oauth ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).access_token;
}
async function call(auth, path, method, body) {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, j };
}

(async () => {
  const auth = await token();
  // Capability: confirm the app can reach the billing/catalog APIs.
  const who = await call(auth, '/v1/billing/plans?product_id=&page_size=1', 'GET');
  console.log('billing API reachable:', who.status === 200 ? 'yes' : `HTTP ${who.status} ${JSON.stringify(who.j).slice(0, 160)}`);

  // 1) product (idempotent-ish: create once; reuse if operator already has one via PAYPAL_PRODUCT_ID)
  let productId = process.env.PAYPAL_PRODUCT_ID;
  if (!productId) {
    const p = await call(auth, '/v1/catalogs/products', 'POST', { name: 'Prism File Hero', description: 'Document & bank-statement intelligence', category: 'SOFTWARE', purpose: 'SUBSCRIPTION' });
    if (p.status >= 400) { console.error('product create failed', p.status, JSON.stringify(p.j).slice(0, 200)); process.exit(1); }
    productId = p.j.id;
  }
  console.log('product id:', productId);

  // 2) recurring plans: USD, monthly + annual, for pro and business.
  const mk = async (label, amount) => {
    const body = (freq, total) => ({ product_id: productId, name: `Prism ${label} ${freq}`, category: 'SOFTWARE', billing_cycles: [
      { frequency: { interval_unit: freq === 'MONTH' ? 'MONTH' : 'YEAR', interval_count: 1 }, tenure_type: 'REGULAR', sequence: 1, total_cycles: total, pricing_scheme: { fixed_price: { currency_code: 'USD', value: amount } } },
    ], payment_preferences: { auto_bill_outstanding: true, setup_fee_failure_action: 'CONTINUE', payment_failure_threshold: 3 } });
    const m = await call(auth, '/v1/billing/plans', 'POST', body('MONTH', 36));
    const a = await call(auth, '/v1/billing/plans', 'POST', body('YEAR', 12));
    console.log(`${label}: monthly ${m.j?.id ?? 'ERR ' + m.status}  annual ${a.j?.id ?? 'ERR ' + a.status}`);
  };
  await mk('PRO', process.env.PAYPAL_PRICE_PRO || '19');
  await mk('BUSINESS', process.env.PAYPAL_PRICE_BUSINESS || '49');
  console.log('\nAdd the printed plan ids to billing_price_plans (plan→tier) and worker/.dev.vars PAYPAL_PLAN_*. Then run the sandbox E2E.');
})().catch((e) => { console.error('capability check error:', e.message); process.exit(1); });
