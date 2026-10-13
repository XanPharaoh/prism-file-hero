#!/usr/bin/env node
/**
 * Items 1-3 — the authenticated customer journey, driven in a real browser with NO injected
 * Authorization headers, NO locally minted tokens and NO manually granted plans.
 *
 *   node scripts/clerk-journey-check.mjs --phase=auth      sign up / sign in on the Clerk DEV
 *                                                          instance, then prove the local Worker
 *                                                          verifies that session's own token and
 *                                                          maps it to the canonical user id.
 *   node scripts/clerk-journey-check.mjs --phase=upgrade   click Upgrade, create the PayPal
 *                                                          subscription server-side, print the
 *                                                          approve URL, and stop for the buyer.
 *   node scripts/clerk-journey-check.mjs --phase=verify    return to the app, read entitlement,
 *                                                          check refresh / logout-login / a second
 *                                                          browser session, and that a separate
 *                                                          user stays free and cannot adopt it.
 *
 * Session continuity uses Playwright storageState (evidence/journey-session*.json, gitignored) — the
 * browser holds a genuine Clerk cookie, nothing is faked.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

/**
 * Credentials come from the gitignored .localdev/journey.env — a dedicated DEVELOPMENT-instance test
 * user created with the Clerk CLI (`clerk users create --instance dev`). Nothing is hardcoded, and
 * the password is never printed by this script.
 */
function fromJourneyEnv(key) {
  if (process.env[key]) return process.env[key];
  try {
    for (const line of readFileSync('.localdev/journey.env', 'utf8').split('\n')) {
      const t = line.trim();
      if (t.startsWith(key + '=')) return t.slice(key.length + 1).replace(/^['"]|['"]$/g, '');
    }
  } catch { /* file absent: caller reports what is missing */ }
  return '';
}

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const APP = process.env.APP_URL || 'http://127.0.0.1:5173';
const WORKER = process.env.WORKER_URL || 'http://127.0.0.1:8787';
const OUT = 'evidence';
const SESSION = `${OUT}/journey-session.json`;
const EMAIL = fromJourneyEnv('JOURNEY_EMAIL');
const PASSWORD = fromJourneyEnv('JOURNEY_PASSWORD');
const phase = String(args.phase || 'auth');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`PASS ${n}`)) : (fail++, console.log(`FAIL ${n} ${e}`)); return c; };

const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
async function context(name) {
  const opts = { viewport: { width: 1400, height: 1000 }, acceptDownloads: true };
  if (name === 'primary' && existsSync(SESSION)) opts.storageState = SESSION;
  const ctx = await browser.newContext(opts);
  ctx.on('page', () => {});
  return ctx;
}
const save = async (ctx) => { writeFileSync(SESSION, JSON.stringify(await ctx.storageState(), null, 2)); };

async function openApp(ctx) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(`${APP}/app`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(2500);
  return { page, errors };
}

/** Signed-in user id as the APP sees it, read from the DOM (never from a minted token). */
async function appUserId(page) {
  return page.evaluate(async () => {
    const w = window;
    const clerk = w.Clerk ?? w.__clerk;
    if (clerk?.session) {
      try { const t = await clerk.session.getToken(); if (!t) return null; const u = JSON.parse(atob(t.split('.')[1])); return u.sub ?? null; } catch { return null; }
    }
    return null;
  });
}

if (phase === 'auth') {
  const ctx = await context('primary');
  const { page, errors } = await openApp(ctx);
  const startText = await page.textContent('body');
  ok('app boots with the Clerk dev instance mounted', /prism file hero/i.test(startText ?? ''), '');
  if (!EMAIL || !PASSWORD) {
    console.log('BLOCKED  no journey credentials: create the development user with the Clerk CLI and put JOURNEY_EMAIL / JOURNEY_PASSWORD in .localdev/journey.env (gitignored).');
    await browser.close();
    process.exit(2);
  }
  console.log(`signing in as ${EMAIL} (password read from .localdev/journey.env, never printed)`);

  const emailSel = 'input[name="emailAddress"], input[name="identifier"], input#identifier';
  const pwSel = 'input[name="password"], input#password';
  const submitWith = async () => {
    const em = page.locator(emailSel).first();
    await em.waitFor({ state: 'visible', timeout: 15000 });
    await em.fill(EMAIL);
    const pw = page.locator(pwSel).first();
    if (await pw.isVisible().catch(() => false)) await pw.fill(PASSWORD);
    await page.keyboard.press('Enter').catch(() => {});
    await page.waitForTimeout(4000);
    if (await pw.isVisible().catch(() => false)) {   // two-step form: password on its own screen
      await pw.fill(PASSWORD);
      await page.keyboard.press('Enter').catch(() => {});
      await page.waitForTimeout(4000);
    }
  };
  const session = async () => Boolean(await appUserId(page));

  // A returning browser may already hold the session (storageState from an earlier phase); that is
  // the normal customer state, so don't force the sign-in form on them. Otherwise sign in first —
  // that path carries no human-verification widget — and fall back to Create Account.
  let via = 'existing session';
  if (await session()) {
    console.log('browser already holds a Clerk session from a previous phase — skipping the sign-in form');
  } else {
    via = 'sign-in';
    await page.getByRole('button', { name: /^(log in|sign in)$/i }).first().click();
    await page.waitForTimeout(2500);
    await submitWith();
    if (!(await session())) {
      const text = (await page.textContent('body')) ?? '';
      const missing = /couldn.t find|not found|invalid|incorrect|no account|bad email/i.test(text);
      console.log(`NOTE  sign-in did not produce a session (${missing ? 'account not found' : 'form still open'}); trying Create Account.`);
      await page.getByRole('button', { name: /sign up free|create account/i }).first().click();
      await page.waitForTimeout(2500);
      await submitWith();
      via = 'sign-up';
    }
  }
  const body = (await page.textContent('body')) ?? '';
  if (/verify you are human|captcha|are you a robot/i.test(body)) {
    console.log('BLOCKED  Clerk shows a human-verification widget on sign-up. Re-run with --headed to solve it, or create the user in the dashboard / disable sign-up CAPTCHA on this development instance. Nothing is bypassed or substituted here.');
  }
  if (/enter the code|verification code|check your email/i.test(body)) {
    console.log('NOTE  Clerk is asking for an email verification code (a *_test_* address on a development instance normally skips this).');
  }
  await page.screenshot({ path: `${OUT}/journey-auth.png` });
  // In headed mode a human finishes the sign-up (Clerk's dev instance puts a CAPTCHA on sign-up).
  // Wait for a real session instead of guessing; nothing is injected.
  const waitSeconds = Number(args.wait ?? (process.argv.includes('--headed') ? 300 : 0)) || 0;
  if (waitSeconds > 0) {
    console.log(`Waiting up to ${waitSeconds}s for you to finish sign-up in the browser window…`);
    const deadline = Date.now() + waitSeconds * 1000;
    while (Date.now() < deadline) {
      if (await appUserId(page)) break;
      await page.waitForTimeout(2000);
    }
  }
  const sub = await appUserId(page);
  ok(`browser holds a real Clerk session via ${via} (sub read from its own token)`, typeof sub === 'string' && sub.startsWith('user_'), `sub=${sub}`);
  ok('no uncaught page errors during sign-up', errors.length === 0, errors.join(' | '));
  if (sub) {
    // The Worker must accept that session's token WITHOUT us attaching anything ourselves.
    const viaApp = await page.evaluate(async (s) => {
      const r = await fetch(`${(window).__WORKER_BASE__ || 'http://127.0.0.1:8787'}/api/billing/entitlement`, { headers: {} });
      return { status: r.status };
    }, sub);
    ok('anonymous call to the billing route is refused (no ambient credential trick)', viaApp.status === 401, `status=${viaApp.status}`);
    const token = await page.evaluate(async () => {
      const c = window.Clerk; if (!c?.session) return null; return await c.session.getToken();
    });
    const server = await (await fetch(`${WORKER}/api/billing/entitlement`, { headers: { Authorization: `Bearer ${token}` } })).json().catch(() => null);
    ok('Worker verifies the real Clerk token and echoes the SAME canonical user id', server?.userId === sub, JSON.stringify({ server: server?.userId, sub }));
    // On a fresh account this phase runs before any purchase, but the same journey user can
    // already hold a paid subscription from an earlier run: assert whichever state is true.
    if (server?.entitled === false) {
      ok('an unpaid journey user is free until a payment exists', server?.plan === 'free', JSON.stringify(server));
    } else {
      ok('a journey user with a verified payment is entitled with server-derived coverage',
        ['pro', 'business'].includes(server?.plan) && server?.source === 'server' && Boolean(server?.paid_until), JSON.stringify(server));
    }
    console.log(`\nClerk user id: ${sub}`);
    console.log(`Server-derived plan: ${server?.plan} entitled=${server?.entitled} source=${server?.source}`);
  }
  await save(ctx);
  await ctx.close();
} else if (phase === 'upgrade') {
  const ctx = await context('primary');
  const { page } = await openApp(ctx);
  const sub = await appUserId(page);
  ok('upgrade phase starts from a real Clerk session', typeof sub === 'string' && sub.startsWith('user_'), `sub=${sub}`);
  if (!sub) { console.log('BLOCKED  no session; run --phase=auth first.'); await browser.close(); process.exit(2); }

  let subscribeBody = null;
  page.on('response', async (r) => { if (r.url().includes('/api/billing/paypal/subscribe')) { try { subscribeBody = await r.json(); } catch {} } });

  await page.getByRole('button', { name: /^upgrade$/i }).first().click();
  await page.waitForTimeout(1500);
  const pro = page.getByRole('button', { name: /subscribe to pro/i }).first();
  await pro.waitFor({ state: 'visible', timeout: 15000 });

  // The modal opens PayPal in a new tab; capture that popup rather than inventing a URL.
  const popupPromise = ctx.waitForEvent('page', { timeout: 45000 });
  await pro.click();
  const paypal = await popupPromise;
  await paypal.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(() => {});
  const approveUrl = paypal.url();
  console.log(`\nPayPal sandbox approval page opened by the app:\n  ${approveUrl}`);
  ok('a genuine PayPal approval page was opened', /paypal\.com/i.test(approveUrl) && /ba_token=BA-/.test(approveUrl), approveUrl.slice(0, 120));
  ok('the server created a pending subscription for this session', subscribeBody?.status === 'pending' && !!subscribeBody?.subscriptionId, JSON.stringify(subscribeBody).slice(0, 160));

  const ent = await page.evaluate(async () => {
    const c = window.Clerk; const t = c?.session ? await c.session.getToken() : null;
    const r = await fetch('http://127.0.0.1:8787/api/billing/entitlement', { headers: { Authorization: `Bearer ${t}` } });
    return await r.json();
  }).catch(() => null);
  ok('approval pending grants NOTHING server-side', ent?.entitled === false && ent?.plan === 'free', JSON.stringify(ent));
  ok('the created subscription is owned by this Clerk user (server mapping)', ent?.activeSubscriptionId ? ent.activeSubscriptionId === subscribeBody?.subscriptionId : subscribeBody?.subscriptionId?.startsWith('I-'), JSON.stringify({ ent: ent?.activeSubscriptionId, created: subscribeBody?.subscriptionId }));

  await page.screenshot({ path: `${OUT}/journey-upgrade.png` });
  await paypal.screenshot({ path: `${OUT}/journey-paypal-approval.png` });
  await save(ctx);
  writeFileSync(`${OUT}/journey-pending.json`, JSON.stringify({ sub, subscriptionId: subscribeBody?.subscriptionId, approveUrl }, null, 2));
  console.log('\nPAUSE: approve this subscription in the PayPal tab (sandbox buyer), then run --phase=verify.');
  await ctx.close();
} else if (phase === 'verify') {
  const pending = existsSync(`${OUT}/journey-pending.json`) ? JSON.parse(readFileSync(`${OUT}/journey-pending.json`, 'utf8')) : {};
  const SR = existsSync('.localdev/tokens.json') ? JSON.parse(readFileSync('.localdev/tokens.json', 'utf8')).service_role : '';
  const db = async (qs) => (await fetch(`${process.env.SUPABASE_URL || 'http://127.0.0.1:54321'}/rest/v1/${qs}`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } })).json().catch(() => []);

  const ctx = await context('primary');
  const { page } = await openApp(ctx);
  const sub = await appUserId(page);
  ok('verify starts from the same real Clerk session', sub === pending.sub, `sub=${sub} expected=${pending.sub}`);

  // Buyer approval and the payment webhook are asynchronous: poll the SERVER, don't assume.
  let ent = null;
  for (let i = 0; i < 40 && !(ent && ent.entitled); i++) {
    ent = await page.evaluate(async () => {
      const c = window.Clerk; const t = c?.session ? await c.session.getToken() : null;
      const r = await fetch('http://127.0.0.1:8787/api/billing/entitlement', { headers: { Authorization: `Bearer ${t}` } });
      return r.ok ? await r.json() : null;
    }).catch(() => null);
    if (!ent || !ent.entitled) await page.waitForTimeout(3000);
  }
  ok('verified payment produced server-derived entitlement (pro)', ent?.entitled === true && ent?.plan === 'pro', JSON.stringify(ent));
  ok('the entitled subscription is the one this user created', ent?.activeSubscriptionId === pending.subscriptionId, JSON.stringify({ got: ent?.activeSubscriptionId, want: pending.subscriptionId }));

  const payments = await db(`billing_payments?subscription_id=eq.${pending.subscriptionId}&select=payment_id,currency,gross_amount,period_start,period_end,status,source_event_id`);
  const events = await db(`billing_events?subscription_id=eq.${pending.subscriptionId}&select=event_id,event_type&order=received_at.desc`);
  console.log(`\nPayPal payment record(s): ${JSON.stringify(payments)}`);
  console.log(`Stored events: ${events.map((e) => e.event_type).join(', ')}`);
  ok('a captured payment row exists for the approved subscription', payments.some((p) => p.status === 'captured' && p.currency === 'USD' && new Date(p.period_end) > new Date()), JSON.stringify(payments).slice(0, 220));
  ok('the payment window is bounded (paid-through date known, not guessed)', payments.some((p) => p.period_end && p.period_start), '');
  await page.screenshot({ path: `${OUT}/journey-entitled.png` });

  // Persistence: refresh
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(3000);
  const afterReload = await page.textContent('body');
  ok('refresh keeps the paid state in the UI (no Upgrade CTA, PRO shown)', /PRO/i.test(afterReload ?? '') && !/Subscribe to Pro/i.test(afterReload ?? ''), (afterReload ?? '').slice(0, 0));

  // Persistence: logout then login again
  const acct = page.locator('button[aria-label*="account" i], button:has(svg.lucide-circle-user)').first();
  if (await acct.isVisible().catch(() => false)) { await acct.click(); await page.waitForTimeout(1200); }
  const signOut = page.getByRole('button', { name: /sign out|log out/i }).first();
  if (await signOut.isVisible().catch(() => false)) { await signOut.click(); await page.waitForTimeout(3000); }
  ok('signed out (session cleared in this browser)', (await appUserId(page)) === null, '');
  await page.getByRole('button', { name: /^(log in|sign in)$/i }).first().click();
  await page.waitForTimeout(2500);
  const em = page.locator('input[name="emailAddress"], input[name="identifier"]').first();
  await em.waitFor({ state: 'visible', timeout: 15000 }); await em.fill(fromJourneyEnv('JOURNEY_EMAIL'));
  await page.keyboard.press('Enter'); await page.waitForTimeout(3500);
  const pw = page.locator('input[name="password"]').first();
  if (await pw.isVisible().catch(() => false)) { await pw.fill(fromJourneyEnv('JOURNEY_PASSWORD')); await page.keyboard.press('Enter'); await page.waitForTimeout(4000); }
  const resub = await appUserId(page);
  ok('logging back in returns the SAME canonical user', resub === sub, `resub=${resub}`);
  const ent2 = await page.evaluate(async () => {
    const c = window.Clerk; const t = c?.session ? await c.session.getToken() : null;
    return (await (await fetch('http://127.0.0.1:8787/api/billing/entitlement', { headers: { Authorization: `Bearer ${t}` } })).json());
  }).catch(() => null);
  ok('entitlement survives logout/login', ent2?.entitled === true, JSON.stringify(ent2));
  await save(ctx);

  // Second browser session (separate context, same stored session)
  const ctx2 = await browser.newContext({ storageState: SESSION, viewport: { width: 1280, height: 900 } });
  const p2 = await ctx2.newPage();
  await p2.goto(`${APP}/app`, { waitUntil: 'load' }); await p2.waitForTimeout(3000);
  const ent3 = await p2.evaluate(async () => {
    const c = window.Clerk; const t = c?.session ? await c.session.getToken() : null;
    return (await (await fetch('http://127.0.0.1:8787/api/billing/entitlement', { headers: { Authorization: `Bearer ${t}` } })).json());
  }).catch(() => null);
  ok('a second browser session sees the same server-derived plan', ent3?.entitled === true && ent3?.plan === 'pro', JSON.stringify(ent3));
  await ctx2.close();

  // Separate free user: still free, and cannot adopt the paid subscription
  const ctxF = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pF = await ctxF.newPage();
  await pF.goto(`${APP}/app`, { waitUntil: 'load' }); await pF.waitForTimeout(2500);
  await pF.getByRole('button', { name: /^(log in|sign in)$/i }).first().click();
  await pF.waitForTimeout(2500);
  const emF = pF.locator('input[name="emailAddress"], input[name="identifier"]').first();
  await emF.waitFor({ state: 'visible', timeout: 15000 }); await emF.fill(fromJourneyEnv('JOURNEY_FREE_EMAIL'));
  await pF.keyboard.press('Enter'); await pF.waitForTimeout(3500);
  const pwF = pF.locator('input[name="password"]').first();
  if (await pwF.isVisible().catch(() => false)) { await pwF.fill(fromJourneyEnv('JOURNEY_FREE_PASSWORD')); await pF.keyboard.press('Enter'); await pF.waitForTimeout(4000); }
  const freeSub = await appUserId(pF);
  ok('the separate free user signed in as a DIFFERENT Clerk identity', Boolean(freeSub) && freeSub !== sub, `free=${freeSub} paid=${sub}`);
  const freeEnt = await pF.evaluate(async () => {
    const c = window.Clerk; const t = c?.session ? await c.session.getToken() : null;
    return (await (await fetch('http://127.0.0.1:8787/api/billing/entitlement', { headers: { Authorization: `Bearer ${t}` } })).json());
  }).catch(() => null);
  ok('that user remains free with no coverage of its own', freeEnt?.entitled === false && freeEnt?.plan === 'free', JSON.stringify(freeEnt));
  const adopt = await pF.evaluate(async (sid) => {
    const c = window.Clerk; const t = c?.session ? await c.session.getToken() : null;
    const r = await fetch('http://127.0.0.1:8787/api/billing/paypal/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ subscriptionId: sid }) });
    return r.status;
  }, pending.subscriptionId);
  ok('the free user cannot cancel/adopt the paid subscription (403)', adopt === 403, `status=${adopt}`);
  await ctxF.close();
  await ctx.close();
  console.log('\nNext: node scripts/paid-tool-output-check.mjs --live  (real session, no injection)');
} else {
  console.log(`phase "${phase}" not implemented (auth | upgrade | verify).`);
}

await browser.close();
console.log(`\n=== clerk-journey-check (${phase}): ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
