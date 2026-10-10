#!/usr/bin/env node
/**
 * Item 2 / Check E — verify OCR runs FULLY OFFLINE on the vendored Tesseract assets.
 *
 * Generates a genuinely scanned PDF (text rendered to a JPEG image; no extractable text layer),
 * drives the REAL site "OCR to searchable PDF" page in headless Chromium with every non-local
 * request ABORTED (so any CDN fetch would fail the run), then re-reads the produced PDF with the
 * browser's own pdf.js and asserts the token is now present as searchable text. Saving inputs,
 * output, and a screenshot to evidence/ as review artifacts.
 *
 *   node scripts/offline-ocr-check.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const EVIDENCE = join(ROOT, 'evidence');
const PORT = 4321;
const TOKEN = 'OFFLINE-OCR-4242';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.gz': 'application/gzip', '.js.gz': 'application/gzip' };

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent((req.url || '/').split('?')[0]);
    const data = await readFile(join(SITE, path === '/' ? 'index.html' : path));
    const type = path.endsWith('.traineddata.gz') ? 'application/gzip' : (MIME[extname(path)] || 'application/octet-stream');
    res.writeHead(200, { 'Content-Type': type }); res.end(data);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(PORT, r));
await mkdir(EVIDENCE, { recursive: true });

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
const result = { offlineRun: false, textRecovered: false, externalRequestsBlocked: 0, externalRequestsAllowed: 0, notes: '' };
try {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith(`http://localhost:${PORT}`) || u.startsWith('data:') || u.startsWith('blob:')) { result.externalRequestsAllowed++; return route.continue(); }
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
  await browser.close();
} finally { server.close(); }

console.log(JSON.stringify(result, null, 2));
const ok = result.offlineRun && result.textRecovered && result.externalRequestsBlocked === 0;
console.log(`\nOFFLINE-OCR: ran=${result.offlineRun} textRecovered=${result.textRecovered} externalBlocked=${result.externalRequestsBlocked} -> ${EVIDENCE}`);
process.exit(ok ? 0 : 1);
