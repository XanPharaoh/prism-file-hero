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
// The landing view hands the accepted files to the workspace store and navigates to '/',
// so registration is proven by the queue listing the file, not by a counter on the landing page.
await page.waitForURL(`${APP}/`, { timeout: 20000 }).catch(() => {});
const fixtureName = FIXTURE.split('/').pop();
const registered = await page
  .waitForFunction((name) => document.body.innerText.includes(name), fixtureName, { timeout: 25000 })
  .then(() => true)
  .catch(() => false);
if (!registered) {
  console.log(`FAIL the uploaded file did not register in the workspace queue ("${fixtureName}" never appeared) — the run cannot start.`);
  await page.screenshot({ path: `${OUT}/fail-no-file.png` });
  await browser.close();
  process.exit(1);
}
console.log(`registered: ${fixtureName} is listed in the workspace queue`);
const gate = [];
page.on('response', async (r) => {
  if (/\/api\/(execute|usage\/(summary|reserve|settle|report))$/.test(new URL(r.url()).pathname)) {
    gate.push(`${r.status()} ${new URL(r.url()).pathname} ${(await r.text().catch(() => '')).slice(0, 160)}`);
  }
});
const run = page.getByRole('button', { name: 'Start Operation', exact: true }).first();
await run.waitFor({ state: 'visible', timeout: 20000 });
const dl = page.waitForEvent('download', { timeout: 180000 });
await run.click();
let download;
try {
  download = await dl;
} catch {
  const modal = await page.evaluate(() => {
    const t = document.body.innerText;
    return /Limit Reached|allowance is|Upgrade to Pro/i.test(t) ? t.split('\n').filter((l) => l.trim()).slice(-14).join(' | ') : null;
  });
  console.log(`FAIL no download. server gate: ${gate.join(' || ') || 'no /api call seen'}`);
  if (modal) console.log(`visible screen text: ${modal.slice(0, 600)}`);
  await page.screenshot({ path: `${OUT}/fail-no-download.png` });
  await browser.close();
  process.exit(1);
}
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

// ── drag-and-drop entry point ──────────────────────────────────────────
// Same landing view, but the file arrives through the dropzone's onDrop handler instead of
// the hidden <input>. The File is built inside the page so the DataTransfer carries a real
// entry; nothing is injected into the app's state. A fresh page keeps this phase independent
// of whatever the first run left open.
const dropPage = await ctx.newPage();
const dropTraffic = [];
dropPage.on('response', async (r) => {
  const p = new URL(r.url()).pathname;
  if (/\/api\/usage\/(reserve|settle)$/.test(p)) dropTraffic.push(`${r.status()} ${p} ${(await r.text().catch(() => '')).slice(0, 120)}`);
});
const dropB64 = readFileSync(FIXTURE).toString('base64');
await dropPage.goto(`${APP}/ocr-pdf`, { waitUntil: 'load', timeout: 40000 });
await dropPage.waitForSelector('[aria-label^="Upload files"]', { timeout: 25000 });
const dispatched = await dropPage.evaluate(async (data) => {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const file = new File([bytes], 'dragged-statement.pdf', { type: 'application/pdf' });
  const dt = new DataTransfer();
  dt.items.add(file);
  const zone = document.querySelector('[aria-label^="Upload files"]');
  if (!zone) return 'no-dropzone';
  zone.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
  zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  return dt.files.length === 1 ? 'dispatched' : 'empty-transfer';
}, dropB64);
ok('the dropzone accepts a native drop event', dispatched === 'dispatched', dispatched);
await dropPage.waitForURL(`${APP}/`, { timeout: 20000 }).catch(() => {});
const droppedRegistered = await dropPage
  .waitForFunction(() => document.body.innerText.includes('dragged-statement.pdf'), { timeout: 25000 })
  .then(() => true)
  .catch(() => false);
ok('a dragged file registers in the workspace queue', droppedRegistered);
await dropPage.screenshot({ path: `${OUT}/drag-and-drop.png` });

if (droppedRegistered) {
  const dl2 = dropPage.waitForEvent('download', { timeout: 240000 }).catch(() => null);
  await dropPage.getByRole('button', { name: 'Start Operation', exact: true }).first().click();
  const d2 = await dl2;
  ok('the dragged file produces its own searchable PDF', Boolean(d2), d2 ? '' : dropTraffic.join(' || ') || 'no download');
  if (d2) {
    const b2 = Buffer.concat(await (() => { const c = []; return d2.createReadStream().then(async (s) => { for await (const x of s) c.push(x); return c; }); })());
    const p2 = `${OUT}/dragged-statement_Searchable.pdf`;
    writeFileSync(p2, b2);
    const doc2 = await PDFDocument.load(b2);
    const text2 = execFileSync('pdftotext', [p2, '-'], { encoding: 'utf8' }).toLowerCase();
    ok('the drag-and-drop artifact is a 2-page searchable PDF', doc2.getPageCount() === 2 && text2.includes('acme payroll'), `pages=${doc2.getPageCount()}`);
  }
}
console.log(`drop-phase server traffic: ${dropTraffic.join(' || ') || 'none'}`);

const t2 = await sessionToken();
const final = await (await fetch(`${WORKER}/api/usage/summary`, { headers: { Authorization: `Bearer ${t2}` } })).json().catch(() => null);
console.log(`final ledger: ${JSON.stringify({ plan: final?.plan, aiPagesUsed: final?.aiPagesUsed, aiPagesLimit: final?.aiPagesLimit, ocr: final?.byTool?.ocr })}`);

await browser.close();
console.log(`\n=== paid-tool-output-check: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
