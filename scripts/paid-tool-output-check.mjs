#!/usr/bin/env node
/**
 * Item 7 — ACTUAL paid-tool output, not a quota preflight.
 *
 * Drives the real OCR tool in a browser against a genuinely image-only 2-page PDF
 * (tests/fixtures/scanned-statement.pdf: pdftotext extracts nothing from it), lets the app run its
 * own handler, captures the downloaded artifact and verifies it with poppler: page count plus the
 * words the OCR layer must have produced. Also records what the SERVER said about the plan and the
 * quota consumed, so "paid" is evidenced by the ledger as well as by the file.
 *
 * Usage:
 *   node scripts/paid-tool-output-check.mjs --sub=<user id> [--token=<bearer>] [--live]
 *     --sub    the account to run as. Without --token, a token is minted from the LOCAL Clerk
 *              stand-in (:8799) — clearly a stand-in, never a real Clerk session.
 *     --token  use this bearer instead (e.g. a token from a real Clerk dev session).
 *     --live   do NOT inject any Authorization header: the browser must already hold a real session.
 *
 * MEASURED PREREQUISITE: App.tsx's pre-flight refuses to run any non-free tool unless the app itself
 * holds a signed-in user (`!isFreeTool(tool) && !s.user` → "Please sign in…"). Injecting a bearer on
 * /api/** therefore cannot drive this tool: it needs a real session in the browser, i.e. a Clerk
 * development instance. Run it with --live once the app is signed in.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const APP = process.env.APP_URL || 'http://127.0.0.1:5173';
const WORKER = process.env.WORKER_URL || 'http://127.0.0.1:8788';
const JWKS = process.env.JWKS_ORIGIN || 'http://127.0.0.1:8799';
const SUB = args.sub || '11111111-0000-4000-8000-0000free01';
const INJECT = !args.live;
const FIXTURE = 'tests/fixtures/scanned-statement.pdf';
const OUT = 'evidence/paid-tool-output';
const SESSION = 'evidence/journey-session.json';

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`PASS ${n}`)) : (fail++, console.log(`FAIL ${n} ${e}`)); return c; };

const token = args.token || (INJECT ? await (await fetch(`${JWKS}/mint?sub=${encodeURIComponent(SUB)}`)).text() : '');
if (INJECT && !token) { console.error('no token available for injected mode'); process.exit(2); }


const browser = await chromium.launch();
// In live mode the browser must already hold the Clerk session, so it is restored at context
// creation (addStorageState after creation is not applied to the first navigation).
const ctx = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1400, height: 1000 },
  ...(!INJECT && existsSync(SESSION) ? { storageState: SESSION } : {}),
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
if (INJECT) {
  await page.route('**/api/**', (route) => route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${token}` } }));
}

/** In live mode the token comes from the browser's own Clerk session; nothing is substituted. */
const sessionToken = async () => {
  if (!INJECT) {
    return page.evaluate(async () => {
      const c = window.Clerk;
      return c?.session ? await c.session.getToken() : null;
    });
  }
  return token;
};

await page.goto(`${APP}/ocr-pdf`, { waitUntil: 'load', timeout: 40000 });
await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 25000 });
// Clerk hydrates after load, so the session snapshot is taken from the live page.
let t0 = null;
for (let i = 0; i < 20 && !t0; i++) { t0 = await sessionToken(); if (!t0) await page.waitForTimeout(1000); }
if (!t0) { console.error('FAIL no session token in the browser — sign in first (clerk-journey-check --phase=auth)'); await browser.close(); process.exit(1); }
const before = await (await fetch(`${WORKER}/api/usage/summary`, { headers: { Authorization: `Bearer ${t0}` } })).json().catch(() => null);
const entBefore = await (await fetch(`${WORKER}/api/billing/entitlement`, { headers: { Authorization: `Bearer ${t0}` } })).json().catch(() => null);
console.log(`account ${entBefore?.userId ?? SUB}  server plan=${entBefore?.plan ?? '?'} entitled=${entBefore?.entitled ?? '?'} sub=${entBefore?.subscription_status ?? '?'}`);
console.log(`before: ${JSON.stringify(before).slice(0, 220)}`);
await page.setInputFiles('input[type=file]', FIXTURE);
await page.waitForTimeout(3000);
// Fail fast with the reason instead of a bare download timeout: the landing view keeps its own file
// list, and an upload that never registers shows up as the "0/0" counter in the header.
const registered = await page.evaluate(() => (document.body.innerText.match(/\d+\/\d+\|\d+\/(\d+)/) || [])[1] ?? null);
if (registered === '0' || registered === null) {
  console.log('FAIL the uploaded file did not register in the tool view (header still shows 0 pages) — the run cannot start. Wiring gap: this view needs its own file-selection path, not a direct input[type=file] set.');
  await page.screenshot({ path: `${OUT}/fail-no-file.png` });
  await browser.close();
  process.exit(1);
}
const run = page.getByRole('button', { name: /process|run|start|ocr|convert/i }).first();
await run.waitFor({ state: 'visible', timeout: 20000 });
const dl = page.waitForEvent('download', { timeout: 180000 });
await run.click();
const download = await dl;
const buf = Buffer.concat(await (() => { const c = []; return download.createReadStream().then(async (s) => { for await (const x of s) c.push(x); return c; }); })());
const outPath = `${OUT}/${(download.suggestedFilename() || 'ocr-out.pdf').replace(/[^\w.-]/g, '_')}`;
writeFileSync(outPath, buf);
await page.screenshot({ path: `${OUT}/run.png` });

const doc = await PDFDocument.load(buf);
const pages = doc.getPageCount();
const text = execFileSync('pdftotext', [outPath, '-'], { encoding: 'utf8' }).toLowerCase();
const expected = ['prism', 'scan', 'stables', 'acme', 'cafe', '74.90', '2,450.00'];
const hits = expected.filter((w) => text.includes(w));

ok('the tool produced a real PDF artifact', buf.length > 1000 && pages > 0, `bytes=${buf.length} pages=${pages}`);
ok('output page count matches the scanned input', pages === 2, `pages=${pages}`);
ok('the output carries extracted text (OCR layer present)', text.trim().length > 40, `chars=${text.trim().length}`);
ok('the recognized words are the ones on the scan', hits.length >= 4, `hits=${hits.join(',')}`);
ok('no uncaught page errors during execution', errors.length === 0, errors.join(' | '));

const t1 = await sessionToken();
const after = await (await fetch(`${WORKER}/api/usage/summary`, { headers: { Authorization: `Bearer ${t1}` } })).json().catch(() => null);
console.log(`after:  ${JSON.stringify(after).slice(0, 220)}`);
console.log(`artifact: ${outPath} (${buf.length} bytes, ${pages} pages, ${text.trim().length} extracted chars)`);
console.log(`recognized sample: ${text.replace(/\s+/g, ' ').trim().slice(0, 180)}`);

await browser.close();
console.log(`\n=== paid-tool-output-check: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
