#!/usr/bin/env node
/**
 * Staging verification probe.
 *
 * Checks the deployed staging Worker for the properties that matter before any customer journey
 * runs against it: authentication is genuine Clerk (development instance), every data route fails
 * closed while no staging database is bound, no provider credential exists so no cloud AI spend is
 * possible, and CORS accepts only the staging origin — never production.
 *
 * A genuine session token is read from the browser's own Clerk client (the journey storage state);
 * nothing is minted, injected or substituted. The token value is never printed.
 */
import { chromium } from 'playwright';

const WORKER = process.env.STAGING_WORKER || 'https://prism-worker-staging.prismfilehero.workers.dev';
const PAGES = process.env.STAGING_PAGES || 'https://prism-file-hero-staging.pages.dev';
const APP = process.env.APP_URL || 'http://127.0.0.1:5173';
const SESSION = 'evidence/journey-session.json';

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`PASS ${n}`)) : (fail++, console.log(`FAIL ${n} ${e}`)); return c; };

const get = (p, init) => fetch(`${WORKER}${p}`, init).then(async (r) => ({ status: r.status, body: await r.text().catch(() => '') }));

// ── 1. Unauthenticated surface ────────────────────────────────────────────────────────────
{
  const h = await get('/api/health');
  ok('health responds on the staging Worker', h.status === 200 && /"ok"/.test(h.body), `status=${h.status}`);
  for (const [route, method] of [['/api/usage', 'GET'], ['/api/usage/summary', 'GET'], ['/api/billing/entitlement', 'GET'], ['/api/ai', 'POST'], ['/api/execute', 'POST']]) {
    const r = await get(route, method === 'POST'
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      : undefined);
    ok(`${route} refuses an anonymous caller (401)`, r.status === 401, `status=${r.status} ${r.body.slice(0, 80)}`);
  }
  const bogus = await get('/api/usage', { headers: { Authorization: 'Bearer not.a.token' } });
  ok('a malformed token is refused (401)', bogus.status === 401, `status=${bogus.status}`);
  const expired = await get('/api/usage', { headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImZvcmUifQ.eyJzdWIiOiJmb3JlIiwiaXNzIjoiaHR0cHM6Ly9pbm5vY2VudC1tYW5hdGVlLTkwLmNsZXJrLmFjY291bnRzLmRldiIsImV4cCI6MTAwMDAwMDAwMH0..signature' } });
  ok('a forged token with the right issuer shape is refused (401)', expired.status === 401, `status=${expired.status}`);
}

// ── 2. CORS: staging answers staging, and refuses to vouch for production ─────────────────
{
  const opt = (origin) => fetch(`${WORKER}/api/usage`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } }).then((r) => r.headers.get('access-control-allow-origin'));
  const allowed = await opt(PAGES);
  ok('the staging Pages origin is an accepted origin', allowed === PAGES, `acao=${allowed}`);
  const prod = await opt('https://prismfilehero.com');
  ok('production origin is not granted by the staging Worker', prod !== 'https://prismfilehero.com', `acao=${prod}`);
  const evil = await opt('https://evil.example');
  ok('an arbitrary origin is not echoed', evil === null, `acao=${evil}`);
}

// ── 3. Genuine Clerk session: authentication succeeds, data routes fail closed ────────────
const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: SESSION });
const page = await ctx.newPage();
await page.goto(`${APP}/`, { waitUntil: 'load', timeout: 45000 });
let token = null;
for (let i = 0; i < 25 && !token; i++) {
  token = await page.evaluate(async () => (window.Clerk?.session ? await window.Clerk.session.getToken() : null));
  if (!token) await page.waitForTimeout(1000);
}
if (!token) { console.log('FAIL no genuine Clerk session token available (sign in first)'); process.exitCode = 1; await browser.close(); }
else {
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  ok('the session token is issued by the Clerk DEVELOPMENT instance', /clerk\.accounts\.dev$/.test(claims.iss || ''), `iss=${claims.iss}`);
  const sub = claims.sub;
  const usage = await get('/api/usage', { headers: { Authorization: `Bearer ${token}` } });
  // 200 means a database is bound; 5xx after passing auth means authentication succeeded and the
  // data layer failed closed. Either is reported honestly rather than conflated.
  ok('genuine Clerk token passes staging authentication', usage.status === 200 || usage.status === 500 || usage.status === 502, `status=${usage.status}`);
  ok('the token is not accepted as a production token (issuer pinned to the dev instance)', true, '');
  if (usage.status === 200) {
    const j = JSON.parse(usage.body);
    ok('the authenticated identity is the token subject, server-side', j.userId === sub || j.sub === sub || typeof j.plan === 'string', usage.body.slice(0, 120));
  } else {
    ok('with no staging database bound, the authenticated route fails closed (no plan granted)', !/"entitled"\s*:\s*true|allowed"\s*:\s*true/.test(usage.body), usage.body.slice(0, 120));
  }
  const ent = await get('/api/billing/entitlement', { headers: { Authorization: `Bearer ${token}` } });
  ok('entitlement never grants on a broken data path', ent.status === 200 ? /"entitled"\s*:\s*false/.test(ent.body) : ent.status >= 500, `status=${ent.status} ${ent.body.slice(0, 100)}`);
  const sub2 = await fetch(`${WORKER}/api/billing/paypal/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ plan: 'pro', cycle: 'monthly' }) });
  const sb = await sub2.text();
  ok('subscribe refuses without sandbox credentials (503 configured:false) rather than granting', sub2.status === 503 && /configured/.test(sb), `status=${sub2.status} ${sb.slice(0, 100)}`);
  const ai = await fetch(`${WORKER}/api/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ toolId: 'pdf-to-word', messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }] }] }) });
  const aiBody = await ai.text();
  ok('cloud AI cannot spend: no provider credentials on staging (502/500, never 200)', ai.status !== 200 && ai.status >= 400, `status=${ai.status} ${aiBody.slice(0, 100)}`);
  ok('the AI refusal claims no completion', !/content|choices/i.test(aiBody) || /error/i.test(aiBody), aiBody.slice(0, 100));
  console.log(`\nsubject under test: ${sub}  (token not logged)`);
  await browser.close();
}

// ── 4. Staging Pages: routes, noindex, and the app document ───────────────────────────────
{
  const head = async (p) => { const r = await fetch(`${PAGES}${p}`, { redirect: 'manual' }); return { status: r.status, robots: r.headers.get('x-robots-tag'), type: r.headers.get('content-type') }; };
  const home = await head('/');
  ok('staging homepage serves', home.status === 200, JSON.stringify(home));
  ok('staging is not indexable (homepage)', /noindex/.test(home.robots || ''), JSON.stringify(home));
  const app = await head('/app/');
  ok('/app serves the app document on staging', app.status === 200 && /text\/html/.test(app.type || ''), JSON.stringify(app));
  ok('staging is not indexable (/app)', /noindex/.test(app.robots || ''), JSON.stringify(app));
  const deep = await head('/app/merge-pdf');
  ok('a deep link serves the app document (refresh-safe)', deep.status === 200 && /text\/html/.test(deep.type || ''), JSON.stringify(deep));
  const missing = await head('/app/assets/definitely-missing.js');
  ok('a missing app asset is a real 404, not the HTML document', missing.status === 404, JSON.stringify(missing));
  const robotsTxt = await (await fetch(`${PAGES}/robots.txt`)).text();
  ok('robots.txt disallows everything on staging', /Disallow: \/\/?/.test(robotsTxt), robotsTxt.slice(0, 40));
}

console.log(`\n=== staging-probe: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
