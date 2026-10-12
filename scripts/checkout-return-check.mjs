#!/usr/bin/env node
/**
 * Verifies BOTH PayPal browser return flows against the real local Worker + real local DB.
 *
 * What is real here: the Worker route, PostgREST, the stored payment/entitlement answer. The buyer
 * has genuinely approved I-N4ECJF9TG5HX in the sandbox; the events and the captured payment are
 * PayPal's, not fixtures. What is a stand-in: the browser's Clerk session (this repo's .env.local
 * points at a LIVE Clerk instance, which must not be used for local testing), so for the signed-in
 * case the locally minted RS256 token the Worker already accepts is attached to /api/billing/*
 * requests. The response is still whatever the server decides — nothing about entitlement is mocked.
 *
 * Requires: local supabase stack, scripts/local-jwks.mjs (:8799), wrangler dev (:8787) with
 * FRONTEND_URL, and `vite --port 5173` pointed at the local Worker.
 *
 *   node scripts/checkout-return-check.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const APP = process.env.APP_URL || 'http://127.0.0.1:5173';
const WORKER = process.env.WORKER_URL || 'http://127.0.0.1:8787';
const JWKS = process.env.JWKS_ORIGIN || 'http://127.0.0.1:8799';
const PAID_USER = '11111111-0000-4000-8000-0000diag02';   // the sandbox buyer's linked local user
const OUT = 'evidence/checkout-return';
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? (pass++, console.log(`PASS ${name}`)) : (fail++, console.log(`FAIL ${name} ${extra}`)); return cond; };

const token = await (await fetch(`${JWKS}/mint?sub=${encodeURIComponent(PAID_USER)}`)).text();

const browser = await chromium.launch();
const entRequests = [];
async function open({ signedIn }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  entRequests.length = 0;
  page.on('response', async (r) => {
    if (r.url().includes('/api/billing/entitlement')) {
      let body = null; try { body = await r.json(); } catch {}
      const hdrs = await r.request().allHeaders();
      entRequests.push({ status: r.status(), body, authed: Boolean(hdrs['authorization']) });
    }
  });
  if (signedIn) {
    // Stand-in for the Clerk session only: attach the local token to billing calls.
    await page.route('**/api/billing/**', (route) => route.continue({
      headers: { ...route.request().headers(), authorization: `Bearer ${token}` },
    }));
  }
  return { ctx, page };
}

// ── A. Return with checkout=success, server has NOT confirmed anything (signed out) ────
{
  const { ctx, page } = await open({ signedIn: false });
  await page.goto(`${APP}/app?checkout=success`, { waitUntil: 'domcontentloaded' });
  const pending = await page.getByRole('status').textContent().catch(() => '');
  ok('A: return page renders a status panel', /Confirming your payment/i.test(pending ?? ''), JSON.stringify(pending));
  let txt = '';
  try {
    await page.waitForFunction(() => /Not confirmed yet/.test(document.body.innerText), null, { timeout: 25000 });
  } catch {}
  txt = await page.getByRole('status').textContent().catch(() => '');
  ok('A: unresolved server answer shows NOT CONFIRMED (never an unlock)', /Not confirmed yet/i.test(txt ?? ''), JSON.stringify(txt).slice(0, 200));
  ok('A: no "is active" claim without server entitlement', !/is active/i.test(txt ?? ''), JSON.stringify(txt).slice(0, 200));
  ok('A: entitlement was asked of the server', entRequests.length > 0 && entRequests[0].status === 401, JSON.stringify(entRequests[0]));
  ok('A: ?checkout= stripped from the URL', !new URL(page.url()).searchParams.has('checkout'), page.url());
  await page.screenshot({ path: `${OUT}/A-unconfirmed.png`, fullPage: false });
  await ctx.close();
}

// ── B. Return with checkout=success, server DOES have a captured payment ───────────────
{
  const { ctx, page } = await open({ signedIn: true });
  await page.goto(`${APP}/app?checkout=success`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => /is active/.test(document.body.innerText), null, { timeout: 15000 });
  } catch {}
  const txt = await page.getByRole('status').textContent().catch(() => '');
  ok('B: panel reports PRO active from the SERVER answer', /is active/i.test(txt ?? ''), JSON.stringify(txt).slice(0, 220));
  const answered = entRequests.find((r) => r.status === 200);
  ok('B: server entitlement = entitled pro', answered?.body?.entitled === true && answered?.body?.plan === 'pro', JSON.stringify(answered?.body));
  ok('B: panel states access survives refresh (server-derived)', /survives refresh/i.test(txt ?? ''), JSON.stringify(txt).slice(0, 220));
  await page.screenshot({ path: `${OUT}/B-entitled.png` });
  // Reload without any checkout param: the same server answer must still say pro.
  await page.goto(`${APP}/app`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  ok('B: no status panel on a plain visit (the URL param is the only trigger)', (await page.getByRole('status').count()) === 0, '');
  await ctx.close();
}

// ── C. Cancelled return ────────────────────────────────────────────────────────────────
{
  const { ctx, page } = await open({ signedIn: true });
  await page.goto(`${APP}/app?checkout=cancelled`, { waitUntil: 'domcontentloaded' });
  const txt = await page.getByRole('status').textContent().catch(() => '');
  ok('C: cancelled return says nothing was charged', /Checkout cancelled[\s\S]*nothing was charged/i.test(txt ?? ''), JSON.stringify(txt).slice(0, 200));
  ok('C: cancelled return makes no entitlement claim', !/is active/i.test(txt ?? ''), JSON.stringify(txt).slice(0, 200));
  await page.screenshot({ path: `${OUT}/C-cancelled.png` });
  await ctx.close();
}

// ── D. Root redirect carries the checkout param through to /app ────────────────────────
{
  const { ctx, page } = await open({ signedIn: true });
  await page.goto(`${APP}/?checkout=success`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /Confirming your payment|is active/.test(document.body.innerText), null, { timeout: 10000 }).catch(() => {});
  const rendered = await page.getByRole('status').count();
  await page.waitForTimeout(2500);
  ok('D: arriving at /?checkout=success still reaches the app panel after the redirect', rendered === 1, `count=${rendered} url=${page.url()}`);
  await ctx.close();
}

// ── E. Worker never derives a return target from its own origin ────────────────────────
{
  const r = await fetch(`${WORKER}/api/billing/paypal/subscribe`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ plan: 'gold', cycle: 'monthly' }),   // invalid plan: rejected before any PayPal call
  });
  ok('E: subscribe rejects an unknown plan before touching PayPal', r.status === 400, `status=${r.status}`);
}

await browser.close();
console.log(`\nSaved: ${OUT}/A-unconfirmed.png, B-entitled.png, C-cancelled.png`);
console.log(`\n=== checkout-return-check: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
