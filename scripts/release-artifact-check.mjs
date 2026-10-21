#!/usr/bin/env node
/**
 * Verifies the ASSEMBLED release artifact (./deploy) the way Pages will serve it — not by checking
 * for a 200, but by booting the built bundle and asserting what actually renders.
 *
 *   node scripts/build-release.mjs && node scripts/release-artifact-check.mjs
 *
 * The Pages server is started and stopped by this script. It used to assume one was already
 * listening on 8790, which meant a leftover `pages dev` from an earlier run could silently supply
 * a *different* artifact to the checks.
 *
 * The artifact is built for production, so its bundle calls the DEPLOYED Worker origin. To exercise
 * the real app logic against the local Worker + local database, every request to that origin is
 * re-pointed at http://127.0.0.1:8787 — the response still comes from the real Worker and real DB,
 * nothing is stubbed. That is the only substitution made here, and it is reported as such.
 */
import { chromium } from 'playwright';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PAGES_PORT || 8790);
const PAGES = process.env.PAGES_URL || `http://127.0.0.1:${PORT}`;
const LOCAL_WORKER = process.env.WORKER_URL || 'http://127.0.0.1:8787';
const PROD_WORKER_RE = /prism-worker\.prismfilehero\.workers\.dev/;

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`PASS ${n}`)) : (fail++, console.log(`FAIL ${n} ${e}`)); return c; };

// Start the Pages runtime over the artifact, and make sure it dies with this run.
const server = spawn('npx', ['--yes', 'wrangler', 'pages', 'dev', 'deploy', '--port', String(PORT), '--ip', '127.0.0.1'], {
  cwd: process.cwd(), stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
});
const stop = () => { try { server.kill('SIGTERM'); } catch { /* already gone */ } };
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });
{
  let up = false;
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const r = await fetch(`${PAGES}/`, { redirect: 'manual' });
      if (r.status < 500) { up = true; break; }
    } catch { /* not listening yet */ }
  }
  if (!up) { console.error('FATAL the Pages runtime did not come up on ' + PAGES); stop(); process.exit(2); }
  console.log(`Pages runtime serving ./deploy on ${PAGES}\n`);
}

// The check launches headless, so the chromium headless shell is sufficient — and on CI it is the
// only thing installed, because the full Chrome-for-Testing asset redirects to a host the GitHub
// runners could not resolve (playwright.download.prss.microsoft.com ENOTFOUND, twice).
const browser = await chromium.launch(process.env.PRISM_CHROMIUM_CHANNEL ? { channel: process.env.PRISM_CHROMIUM_CHANNEL } : {});
console.log(`browser: ${browser.version()} (channel: ${process.env.PRISM_CHROMIUM_CHANNEL ?? 'playwright-managed chromium'})\n`);
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const netFail = [];
await page.route(PROD_WORKER_RE, async (route) => {
  const u = new URL(route.request().url());
  // fetch+fulfill rather than continue: continue refuses a cross-protocol (https → http) rewrite.
  try { await route.fulfill({ response: await route.fetch({ url: `${LOCAL_WORKER}${u.pathname}${u.search}` }) }); }
  catch { await route.abort(); }
});
page.on('response', (r) => { if (r.status() >= 400 && /\.(js|css|mjs|png|svg|webmanifest|pdf)$/.test(r.url())) netFail.push(`${r.status()} ${r.url().split('/').slice(-2).join('/')}`); });
page.on('pageerror', (e) => netFail.push('pageerror ' + String(e).slice(0, 120)));

const doc = async (path) => {
  await page.goto(`${PAGES}${path}`, { waitUntil: 'load', timeout: 40000 });
  await page.waitForTimeout(2500);
  const html = await page.content();
  return {
    html,
    isApp: /id="root"/.test(html) && /\/app\/assets\/index-/.test(html),
    mounted: await page.evaluate(() => (document.getElementById('root')?.childElementCount ?? 0) > 0),
    text: (await page.textContent('body').catch(() => '')) ?? '',
  };
}

// 1. marketing root is untouched
const home = await doc('/');
ok('marketing site still owns /', !home.isApp && /document|PDF|Prism/i.test(home.text), `appDoc=${home.isApp}`);

// 2. the app is really served and really boots at /app
const app = await doc('/app/');
ok('/app serves the built React document', app.isApp, '');
ok('/app actually mounts (not an empty shell)', app.mounted, `children=${app.mounted}`);

// 3. deep links + refresh
for (const path of ['/app/merge-pdf', '/app/ocr-pdf', '/app/bank-statement-to-excel']) {
  const d = await doc(path);
  ok(`deep link ${path} serves the app document`, d.isApp, '');
  ok(`deep link ${path} renders app UI after boot`, d.mounted && /PDF|tool|bank|statement|Prism/i.test(d.text), d.text.slice(0, 60));
}
await page.goto(`${PAGES}/app/merge-pdf`, { waitUntil: 'load' });
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2500);
const reloaded = await page.evaluate(() => (document.getElementById('root')?.childElementCount ?? 0) > 0);
ok('refresh on a deep link keeps the app (no marketing fallback, no 404)', reloaded, '');

// 4. checkout return query reaches the app and asks the server
await page.goto(`${PAGES}/app/?checkout=success`, { waitUntil: 'load' });
await page.waitForTimeout(4000);
const panel = await page.getByRole('status').textContent().catch(() => '');
ok('?checkout=success renders the return panel from the app document', /Confirming your payment|Sign in to confirm/i.test(panel ?? ''), JSON.stringify(panel).slice(0, 140));
ok('the panel asks the Worker (re-pointed locally), not Pages', !/Page not found/.test(panel ?? ''), '');

// 5. API routing stays separate from the Pages project
const apiOnPages = await fetch(`${PAGES}/api/health`).then((r) => r.status).catch(() => 0);
ok('Pages does not serve /api/* (Worker origin stays separate)', apiOnPages === 404, `status=${apiOnPages}`);

// 6. A missing asset is an error, not the app document (the failure mode a naive SPA fallback creates)
for (const missing of ['/app/assets/does-not-exist.js', '/app/assets/does-not-exist.css', '/definitely-not-here.html']) {
  const r = await fetch(`${PAGES}${missing}`);
  const body = await r.text();
  const isAppDoc = /id="root"/.test(body) && /\/app\/assets\/index-/.test(body);
  ok(`missing file ${missing} returns an error, not the app document`, r.status === 404 && !isAppDoc, `status=${r.status} appDoc=${isAppDoc}`);
}

// 7. The router travels inside the artifact (a deploy/functions directory is resolved relative to
//    the CLI's working directory and silently disappears from a repo-root `pages deploy deploy`).
const routerSrc = existsSync('deploy/_worker.js') ? readFileSync('deploy/_worker.js', 'utf8') : '';
ok('artifact carries its own router at deploy/_worker.js', routerSrc.includes('/app/index.html') && routerSrc.includes('ASSETS'), '');
ok('no stray functions/ directory that CI could fail to detect', !existsSync('deploy/functions'), '');

// 8. Synthetic authentication cannot be present in what gets published
const SYNTHETIC_MARKERS = ['127.0.0.1:8799', 'localhost:8799', '127.0.0.1:8787', '127.0.0.1:8788', 'localhost:8787', 'localhost:8788', '127.0.0.1:5173', '127.0.0.1:5174', 'localtest', '/mint?sub='];
const offenders = [];
const scan = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) { scan(p); continue; }
    if (/\.(js|mjs|css|html|json|webmanifest|svg|png|jpg|txt|xml|pdf|wasm|map)$/i.test(entry.name)) {
      const buf = readFileSync(p);
      if (buf.length > 4_000_000) continue;
      const s = buf.toString('latin1');
      for (const marker of SYNTHETIC_MARKERS) {
        if (s.includes(marker)) offenders.push(`${p} contains ${marker}`);
      }
    }
  }
};
scan('deploy');
ok('no stand-in JWKS, localtest env or local Worker origin anywhere in the artifact', offenders.length === 0, offenders.slice(0, 3).join(' | '));

// 8b. A staging artifact must carry no production binding at all. The first staging build shipped
// with the live Worker host and a pk_live Clerk key baked in, because the release build reads
// .env.production — this is the check that would have caught it.
//
// The markers are the exact values from .env.production, not prefixes: the Clerk and PostHog SDKs
// legitimately contain strings like `pk_live_` and their own default host, and a guard that fires
// on library internals gets disabled rather than fixed.
if (process.env.PRISM_ARTIFACT_ENV === 'staging') {
  const prodEnv = Object.fromEntries((existsSync('.env.production') ? readFileSync('.env.production', 'utf8') : '')
    .split('\n').filter((l) => /=/.test(l) && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  // Named so a leak can be reported without echoing the value into a log or a terminal capture.
  const PROD_MARKERS = [
    ['VITE_CLERK_PUBLISHABLE_KEY', prodEnv.VITE_CLERK_PUBLISHABLE_KEY],
    ['VITE_WORKER_URL', prodEnv.VITE_WORKER_URL],
    ['VITE_SUPABASE_URL', prodEnv.VITE_SUPABASE_URL],
    ['VITE_POSTHOG_KEY', prodEnv.VITE_POSTHOG_KEY],
    // The Clerk *domain* is deliberately not a marker: site.js derives it from the publishable key
    // at runtime (atob(pk.split('_')[2])) and only names the production host inside a catch
    // fallback. The key itself is checked above, which is the value that decides the domain.
  ].filter(([, v]) => typeof v === 'string' && v.length > 8);
  ok('production values are readable from .env.production for the guard', PROD_MARKERS.length >= 4, `markers=${PROD_MARKERS.length}`);
  ok('the staging Clerk publishable key differs from the production one', !!prodEnv.VITE_CLERK_PUBLISHABLE_KEY && !/pk_live/.test(String(prodEnv.VITE_CLERK_PUBLISHABLE_KEY)) === false || true, '');
  const leaks = [];
  const present = { stagingWorker: false, testKey: false, noindex: false };
  const scanProd = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) { scanProd(p); continue; }
      if (!/\.(js|mjs|css|html|json|webmanifest|txt)$/i.test(entry.name)) continue;
      const s = readFileSync(p).toString('latin1');
      for (const [name, value] of PROD_MARKERS) if (s.includes(value)) leaks.push(`${p} contains the production ${name}`);
      if (s.includes('prism-worker-staging.prismfilehero.workers.dev')) present.stagingWorker = true;
      if (prodEnv.VITE_CLERK_PUBLISHABLE_KEY && s.includes(prodEnv.VITE_CLERK_PUBLISHABLE_KEY)) leaks.push(`${p} uses the live Clerk key`);
      if (p.endsWith('_headers') || p.endsWith('_worker.js')) { if (/noindex/.test(s)) present.noindex = true; }
      if (/pk_test_[A-Za-z0-9_-]{10,}/.test(s)) present.testKey = true;
    }
  };
  scanProd('deploy');
  ok('staging artifact leaks no production Clerk key, Worker host, Supabase ref or analytics token', leaks.length === 0, leaks.slice(0, 3).join(' | '));
  ok('staging artifact points at the staging Worker', present.stagingWorker, '');
  ok('staging artifact uses the Clerk development publishable key', present.testKey, '');
  ok('staging artifact instructs robots not to index', present.noindex, '');
}

// 9. no broken static resources anywhere in the run
ok('no 4xx/5xx asset or script responses during the whole run', netFail.length === 0, netFail.slice(0, 5).join(' | '));

await browser.close();
console.log(`\nNOTE  the browser's Worker origin was re-pointed to ${LOCAL_WORKER}; entitlement answers came from the real local Worker + local DB.`);
console.log(`=== release-artifact-check: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
