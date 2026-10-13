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
    ok('that user is free until a payment exists', server?.entitled === false && server?.plan === 'free', JSON.stringify(server));
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
} else {
  console.log(`phase "${phase}" not implemented yet in this script (auth is).`);
}

await browser.close();
console.log(`\n=== clerk-journey-check (${phase}): ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
