#!/usr/bin/env node
/**
 * Item 6 / Check F — drive a REAL tool through the built Vite app (React SPA, not the static site)
 * with Playwright: stage two PDFs at the tool's file input, click process, capture the browser
 * DOWNLOAD, and inspect the produced document. Saves the output + a screenshot to evidence/.
 * Passes only if the app genuinely produced a merged 5-page PDF — a load smoke is not enough.
 *
 * Requires: `npm run build` then `npm run preview -- --port 4173` (started by the caller).
 */
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = join(ROOT, 'evidence');
const APP = 'http://127.0.0.1:4173';
await mkdir(EVIDENCE, { recursive: true });

async function makePdf(label, pages) {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) d.addPage([300, 400]).drawText(`${label}-${i + 1}`, { x: 40, y: 300, size: 16, font: f });
  const p = join(EVIDENCE, `app-in-${label}.pdf`); await writeFile(p, Buffer.from(await d.save())); return p;
}

const result = { loaded: false, produced: false, pages: 0, error: '' };
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${APP}/merge-pdf`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 20000 });
  result.loaded = true;
  const a = await makePdf('A', 2), b = await makePdf('B', 3);
  await page.setInputFiles('input[type=file]', [a, b]);
  // Click the primary process/run control (label varies; match common verbs).
  const btn = page.getByRole('button', { name: /process|merge|convert|run|start/i }).first();
  await btn.waitFor({ state: 'visible', timeout: 15000 });
  const dl = page.waitForEvent('download', { timeout: 60000 });
  await btn.click();
  const download = await dl;
  const stream = await download.createReadStream();
  const chunks = []; for await (const c of stream) chunks.push(c);
  const buf = Buffer.concat(chunks);
  await writeFile(join(EVIDENCE, 'app-merge-out.pdf'), buf);
  const out = await PDFDocument.load(buf);
  result.pages = out.getPageCount();
  result.produced = result.pages === 5;
  await page.screenshot({ path: join(EVIDENCE, 'app-merge.png'), fullPage: true });
  result.error = errors.slice(0, 2).join(' | ');
} catch (e) { result.error = (result.error || '') + ' :: ' + String(e.message); }
finally { await browser.close(); }

console.log(JSON.stringify(result, null, 2));
console.log(`\nAPP-EVIDENCE: loaded=${result.loaded} produced5pages=${result.produced} -> ${EVIDENCE}`);
process.exit(result.produced ? 0 : 1);
