#!/usr/bin/env node
/**
 * Item 6 — Headless browser evidence for the REAL website flows (Chromium via Playwright).
 * Drives the actual site tool UI (file input -> Run -> blob download), captures the generated
 * PDF bytes + a screenshot into evidence/, and asserts the redaction truly removes the secret
 * by re-reading the output with pdf.js IN THE BROWSER (the same engine users get).
 *
 * Run: `node scripts/browser-evidence.mjs` (needs playwright chromium; see package scripts).
 * Requires a local static server for site/ so relative vendor scripts + blob URLs work.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const EVIDENCE = join(ROOT, 'evidence');
const PORT = 4319;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = join(SITE, path === '/' ? 'index.html' : path);
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(PORT, r));

await mkdir(EVIDENCE, { recursive: true });
async function fixture(name, pages, secretOnFirst) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = d.addPage([612, 792]);
    p.drawText(i === 0 && secretOnFirst ? `ACCOUNT ${name} ${secretOnFirst}` : `PAGE ${i + 1} ${name} keep`, { x: 60, y: 700, size: 18, font: f });
  }
  const out = join(EVIDENCE, `${name}.pdf`);
  await (await import('node:fs/promises')).writeFile(out, Buffer.from(await d.save()));
  return out;
}
const b64InPage = async (page, href) => page.evaluate(async (h) => {
  const buf = await (await fetch(h)).arrayBuffer();
  let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}, href);

const results = [];
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();

  // --- REDACT flow ---
  const secret = 'TOPSECRET-9Q4Z-77';
  const redIn = await fixture('redact-in', 2, secret);
  await page.goto(`http://localhost:${PORT}/features/redact-pdf.html`, { waitUntil: 'load' });
  await page.setInputFiles('input[type=file]', redIn);
  await page.fill('#opt-terms', secret);
  await page.click('.tool-run');
  await page.waitForSelector('.tool-result-dl', { timeout: 30000 });
  const href = await page.getAttribute('.tool-result-dl', 'href');
  const b64 = await b64InPage(page, href);
  await (await import('node:fs/promises')).writeFile(join(EVIDENCE, 'redact-out.pdf'), Buffer.from(b64, 'base64'));
  // Verify IN-BROWSER that the produced PDF has no extractable secret.
  const extracted = await page.evaluate(async (b64str) => {
    const pdfjs = await import('/assets/vendor/pdf/pdf.min.mjs');
    const bin = atob(b64str); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const doc = await pdfjs.GlobalWorkerOptions && await pdfjs.getDocument({ data: arr }).promise;
    let t = '';
    for (let p = 1; p <= doc.numPages; p++) { const tc = await (await doc.getPage(p)).getTextContent(); t += tc.items.map(x => x.str).join(' ') + '\n'; }
    return t;
  }, b64);
  results.push({ flow: 'redact', removed: !extracted.includes(secret), screenshot: await (async () => { await page.screenshot({ path: join(EVIDENCE, 'redact.png') }); return 'redact.png'; })() });

  // --- MERGE flow ---
  const a = await fixture('merge-a', 2); const b = await fixture('merge-b', 3);
  await page.goto(`http://localhost:${PORT}/features/merge-pdf.html`, { waitUntil: 'load' });
  await page.setInputFiles('input[type=file]', [a, b]);
  await page.click('.tool-run');
  await page.waitForSelector('.tool-result-dl', { timeout: 30000 });
  const mhref = await page.getAttribute('.tool-result-dl', 'href');
  const mb64 = await b64InPage(page, mhref);
  await (await import('node:fs/promises')).writeFile(join(EVIDENCE, 'merge-out.pdf'), Buffer.from(mb64, 'base64'));
  const { PDFDocument: L } = await import('pdf-lib');
  const mdoc = await L.load(new Uint8Array(Buffer.from(mb64, 'base64')));
  results.push({ flow: 'merge', pages: mdoc.getPageCount(), expectPages: 5 });
  await page.screenshot({ path: join(EVIDENCE, 'merge.png') });

  await browser.close();
} finally { server.close(); }

console.log(JSON.stringify(results, null, 2));
const okRedact = results.find(r => r.flow === 'redact')?.removed === true;
const okMerge = (results.find(r => r.flow === 'merge')?.pages) === 5;
console.log(`\nEVIDENCE: redact-removed=${okRedact} merge-5pages=${okMerge} -> ${EVIDENCE}`);
process.exit(okRedact && okMerge ? 0 : 1);
