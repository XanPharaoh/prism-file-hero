#!/usr/bin/env node
/**
 * Proves the dashboard upload path actually loads files, through the real browser.
 *
 * The defect (measured by the UI audit, evidence/features/ui/): ToolDashboard passes the chosen tool
 * id to App.tsx, which set state and then called a callback reading `s.selectedTool` from the
 * previous render. Setters are async, so the guard `if (!s.selectedTool) return;` saw undefined and
 * every file was discarded -- no error, no toast, no queue. Drag-drop and the file picker on `/app/`
 * both produced an empty queue, while `/app/<tool>` deep links worked because the tool was already
 * selected. A stale closure of this shape is invisible to unit tests, so the proof is pixel-level:
 * assert the queue, the page count, and a real downloaded merge.
 *
 *   npm run release:build && node scripts/feature-audit/uploader-check.mjs
 */
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const PORT = Number(process.env.PAGES_PORT || 8794);
const PAGES = `http://127.0.0.1:${PORT}`;
const LOCAL_WORKER = process.env.WORKER_URL || 'http://127.0.0.1:8787';
const PROD_WORKER_RE = /prism-worker\.prismfilehero\.workers\.dev/;
const EV = 'evidence/features/uploader';
mkdirSync(EV, { recursive: true });

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`PASS ${n}`)) : (fail++, console.log(`FAIL ${n} ${e}`)); };

async function makePdf(name, pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([420, 300]);
    p.drawText(`${name}-PAGE-${i}`, { x: 40, y: 200, size: 20, font });
  }
  const path = join(EV, `${name}.pdf`);
  writeFileSync(path, Buffer.from(await doc.save()));
  return path;
}

const A = await makePdf('up-A', 3);
const B = await makePdf('up-B', 3);

const server = spawn('npx', ['--yes', 'wrangler', 'pages', 'dev', 'deploy', '--port', String(PORT), '--ip', '127.0.0.1'], {
  cwd: process.cwd(), stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
});
const stop = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

let up = false;
for (let i = 0; i < 90 && !up; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try { up = (await fetch(`${PAGES}/app/`, { redirect: 'manual' })).status < 500; } catch { /* not yet */ }
}
if (!up) { console.error('FATAL Pages runtime did not come up on ' + PAGES); stop(); process.exit(2); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1040 }, acceptDownloads: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)));
await page.route(PROD_WORKER_RE, async (route) => {
  const u = new URL(route.request().url());
  try { await route.fulfill({ response: await route.fetch({ url: `${LOCAL_WORKER}${u.pathname}${u.search}` }) }); }
  catch { await route.abort(); }
});

const startBtn = () => page.getByRole('button', { name: /Start Operation/i }).first();
const queueText = () => page.getByText(/Queue \(\d+\)/).first().textContent().catch(() => null);

async function openDashboard() {
  await page.goto(`${PAGES}/app/`, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(2600);
  await page.getByRole('button', { name: /Merge PDF/i }).first().click();
  await page.waitForTimeout(600);
}

async function measure(label) {
  const q = (await queueText()) || '';
  const pages = await page.evaluate(() => document.body.innerText.match(/(\d+)\s*pages?/i)?.[1] ?? '');
  const started = await startBtn().isVisible().catch(() => false);
  ok(`${label}: files register in the queue`, /Queue \(2\)/.test(q), `queue="${q}"`);
  ok(`${label}: Start Operation is offered`, started, `startVisible=${started}`);
  return { q, pages };
}

async function runAndCount(saveName) {
  const dlP = page.waitForEvent('download', { timeout: 40000 });
  await startBtn().click();
  const dl = await dlP;
  const out = join(EV, saveName);
  await dl.saveAs(out);
  return execFileSync('pdfinfo', [out]).toString().match(/^Pages:\s+(\d+)$/m)?.[1] ?? '0';
}

// ── 1. the file picker on the dashboard dropzone, driven the way a user does it ─────────────
await openDashboard();
const chooser = page.waitForEvent('filechooser', { timeout: 15000 });
await page.locator('[aria-label="Upload PDF document"]').click();
await (await chooser).setFiles([A, B]);
await page.waitForTimeout(2500);
await measure('picker');
// 3 + 3 pages merged is the numeric proof the intake counted what the user picked.
const pickedPages = await runAndCount('picker-merge.pdf');
ok('the picker path really runs: 3 + 3 pages become a 6-page merge', pickedPages === '6', `Pages=${pickedPages}`);

// ── 2. drag-and-drop on the same dropzone (fresh load, no carried state) ────────────────────
await openDashboard();
const files = [A, B].map((p) => ({ name: p.split('/').pop(), b64: readFileSync(p).toString('base64') }));
await page.evaluate(async ({ files }) => {
  const mk = (f) => {
    const bin = atob(f.b64); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new File([u], f.name, { type: 'application/pdf' });
  };
  const dt = new DataTransfer();
  files.map(mk).forEach((f) => dt.items.add(f));
  const el = document.querySelector('[aria-label="Upload PDF document"]');
  if (!el) { window.__dropErr = 'no-dropzone'; return; }
  el.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
  el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
}, { files });
await page.waitForTimeout(2500);
await measure('drag-drop');
const droppedPages = await runAndCount('drop-merge.pdf');
ok('the drag-drop path really runs: 3 + 3 pages become a 6-page merge', droppedPages === '6', `Pages=${droppedPages}`);

// ── 3. nothing threw on the way ─────────────────────────────────────────────────────────────
ok('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));
await page.screenshot({ path: join(EV, 'dashboard-after-drop.png'), fullPage: false });

console.log(`\n=== uploader-check: ${pass} passed, ${fail} failed ===`);
await browser.close();
stop();
process.exit(fail === 0 ? 0 : 1);
