#!/usr/bin/env node
/**
 * Item 2 / Check E — verify OCR runs FULLY OFFLINE on the vendored Tesseract assets, on BOTH halves
 * of the product.
 *
 * SITE: generates a genuinely scanned PDF (text rendered to a JPEG image; no extractable text
 * layer), drives the REAL site "OCR to searchable PDF" page in headless Chromium with every
 * non-local request ABORTED (so any CDN fetch would fail the run), then re-reads the produced PDF
 * with the browser's own pdf.js and asserts the token is now present as searchable text. Saving
 * inputs, output, and a screenshot to evidence/ as review artifacts.
 *
 * APP: `services/ocrService.ts` resolves its bundles from `public/ocr`, generated from the installed
 * tesseract packages by `scripts/lib/app-ocr-assets.mjs` (D1). This serves that directory at `/ocr/`,
 * hands tesseract the exact `appOcrWorkerOptions()` trio, runs the app's own call shape
 * (`createWorker('eng', 1, opts)` + `recognize(canvas, {}, { blocks, text })`) and requires the
 * nested blocks→paragraphs→lines→words+bbox tree that ocrService's fallback chain walks — all with
 * the same network abort in force. The glue it loads is the site's `tesseract.min.js`, asserted to
 * be byte-identical to `node_modules/tesseract.js/dist/tesseract.min.js`, i.e. what the app bundles.
 * Not covered here: the React UI wrapping those calls (see tests/ocrAssets.test.ts for the guard
 * that every entry point passes the paths at all).
 *
 *   node scripts/offline-ocr-check.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { provisionAppOcrAssets } from './lib/app-ocr-assets.mjs';
import { appOcrWorkerOptions } from '../shared/ocr/assets.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const EVIDENCE = join(ROOT, 'evidence');
const PORT = 4321;
const TOKEN = 'OFFLINE-OCR-4242';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.gz': 'application/gzip', '.js.gz': 'application/gzip' };

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent((req.url || '/').split('?')[0]);
    // /ocr/* is the APP's bundle (public/ocr); anything else is the marketing site.
    const file = path.startsWith('/ocr/') ? join(ROOT, 'public', path) : join(SITE, path === '/' ? 'index.html' : path);
    const data = await readFile(file);
    const type = path.endsWith('.traineddata.gz') ? 'application/gzip' : (MIME[extname(path)] || 'application/octet-stream');
    res.writeHead(200, { 'Content-Type': type }); res.end(data);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(PORT, r));
await mkdir(EVIDENCE, { recursive: true });
// The app's bundle is generated from the installed packages; provision (and hash-verify) it here so
// this gate always exercises the bytes that ship, and a missing public/ocr is a failure, not a skip.
provisionAppOcrAssets({ root: ROOT });

// Render the token as a raster image and embed it into a text-free PDF → a real "scan".
async function scannedPdf() {
  const c = createCanvas(1000, 300); const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#000'; g.font = 'bold 64px sans-serif'; g.fillText(TOKEN, 40, 150);
  g.fillText('SECOND LINE MARKER', 40, 230);
  const jpg = c.toBuffer('image/jpeg', 92);
  const doc = await PDFDocument.create(); const img = await doc.embedJpg(jpg);
  const p = doc.addPage([595, 842]); p.drawImage(img, { x: 40, y: 500, width: 515, height: 154 });
  const path = join(EVIDENCE, 'ocr-offline-in.pdf'); await writeFile(path, Buffer.from(await doc.save()));
  return path;
}
const inB64 = async (page, href) => page.evaluate(async (h) => { const b = new Uint8Array(await (await fetch(h)).arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }, href);

const scanned = await scannedPdf();
const browser = await chromium.launch();
const result = { offlineRun: false, textRecovered: false, externalRequestsBlocked: 0, localRequestsAllowed: 0, notes: '' };
try {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(`http://localhost:${PORT}`) || u.startsWith('data:') || u.startsWith('blob:')) { result.localRequestsAllowed++; return route.continue(); }
    result.externalRequestsBlocked++; return route.abort();
  });
  const page = await ctx.newPage();
  const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/features/ocr-to-searchable-pdf.html`, { waitUntil: 'load' });
  await page.setInputFiles('input[type=file]', scanned);
  await page.click('.tool-run');
  await page.waitForSelector('.tool-result-dl', { timeout: 90000 });
  const href = await page.getAttribute('.tool-result-dl', 'href');
  const b64 = await inB64(page, href);
  await writeFile(join(EVIDENCE, 'ocr-offline-out.pdf'), Buffer.from(b64, 'base64'));
  await page.screenshot({ path: join(EVIDENCE, 'ocr-offline.png') });
  result.offlineRun = true;
  // Re-read the produced PDF with the browser's OWN pdf.js and check the searchable layer.
  result.textRecovered = await page.evaluate(async (bs) => {
    const pdfjs = await import('/assets/vendor/pdf/pdf.min.mjs');
    const bin = atob(bs); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const doc = await pdfjs.getDocument({ data: arr }).promise; let t = '';
    for (let p = 1; p <= doc.numPages; p++) { const tc = await (await doc.getPage(p)).getTextContent(); t += tc.items.map((x) => x.str).join(' ') + ' '; }
    return t.replace(/\s+/g, ' ').includes('4242');
  }, b64);
  result.notes = pageErrors.slice(0, 3).join(' | ');

  // ── App half ────────────────────────────────────────────────────────────────────────────────
  // services/ocrService.ts asks tesseract.js for appOcrWorkerOptions(); this drives exactly those
  // paths against public/ocr (provisioned from the installed packages) with the same call shape —
  // createWorker('eng', 1, opts) + recognize(canvas, {}, { blocks, text }) — and asserts the nested
  // blocks→paragraphs→lines→words+bbox tree that ocrService's fallback chain walks. It loads the
  // site's tesseract.min.js as the glue because that file is byte-identical to the app's bundled
  // node_modules/tesseract.js/dist/tesseract.min.js; the hash equality is asserted below so that
  // substitution cannot go stale. What it does NOT cover: the app's React UI around the call.
  const glueSite = readFileSync(join(SITE, 'assets/vendor/tesseract.min.js'));
  const glueApp = readFileSync(join(ROOT, 'node_modules/tesseract.js/dist/tesseract.min.js'));
  const sha = (b) => createHash('sha256').update(b).digest('hex');
  result.glueHashMatch = sha(glueSite) === sha(glueApp);
  if (!result.glueHashMatch) result.notes += ` | glue hash mismatch site=${sha(glueSite).slice(0, 12)} app=${sha(glueApp).slice(0, 12)}`;

  const appOpts = appOcrWorkerOptions({ isBrowser: true, baseUrl: '/' });
  const appPageErrors = [];
  const appPage = await ctx.newPage();
  appPage.on('pageerror', (e) => appPageErrors.push(String(e)));
  await appPage.goto(`http://localhost:${PORT}/features/ocr-to-searchable-pdf.html`, { waitUntil: 'load' });
  result.appRun = true;
  const appProbe = await appPage.evaluate(async (opts) => {
    const s = document.createElement('script');
    s.src = '/assets/vendor/tesseract.min.js';
    await new Promise((res, rej) => { s.onload = res; s.onerror = () => rej(new Error('glue load failed')); document.head.appendChild(s); });
    const worker = await window.Tesseract.createWorker('eng', 1, opts);
    const c = document.createElement('canvas'); c.width = 1000; c.height = 300;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000'; g.font = 'bold 64px sans-serif';
    g.fillText('OFFLINE-OCR-4242', 40, 150); g.fillText('SECOND LINE MARKER', 40, 230);
    const { data } = await worker.recognize(c, {}, { blocks: true, text: true });
    await worker.terminate();
    const line = data?.blocks?.[0]?.paragraphs?.[0]?.lines?.[0];
    return {
      text: String(data.text || '').replace(/\s+/g, ' ').trim(),
      blocks: Array.isArray(data.blocks) ? data.blocks.length : 0,
      words: line ? (line.words || []).map((w) => w.text) : [],
      bbox: line?.bbox ?? null,
    };
  }, appOpts);
  result.appTextRecovered = appProbe.text.includes('4242');
  result.appStructureOk = appProbe.blocks > 0 && appProbe.words.length > 0 && !!appProbe.bbox;
  result.appPaths = appOpts;
  result.notes += appPageErrors.slice(0, 2).join(' | ');

  await browser.close();
} finally { server.close(); }

console.log(JSON.stringify(result, null, 2));
const ok = result.offlineRun && result.textRecovered && result.externalRequestsBlocked === 0
  && result.glueHashMatch && result.appRun && result.appTextRecovered && result.appStructureOk;
console.log(`\nOFFLINE-OCR  site: ran=${result.offlineRun} text=${result.textRecovered} | app: text=${result.appTextRecovered} structure=${result.appStructureOk} glueHashMatch=${result.glueHashMatch}`);
console.log(`             externalBlocked=${result.externalRequestsBlocked} localAllowed=${result.localRequestsAllowed} appPaths=${JSON.stringify(result.appPaths)} -> ${EVIDENCE}`);
process.exit(ok ? 0 : 1);
