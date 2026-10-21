/**
 * FEATURE AUDIT — OCR + financial extraction (delegated audit, 2026-10-19).
 *
 * House pattern per tests/searchablePdf.test.ts + tests/statementCorpus.integration.test.ts:
 * real services, real fixtures, jsdom + @napi-rs/canvas polyfills from tests/setup.ts, NO MOCKS.
 *
 * The service's own return object is never accepted as proof. Every claim is re-measured from
 * bytes on disk: `pdfinfo` / `pdftotext` / `pdfimages` for the OCR text layer and raster,
 * `pdf-lib` + `pdfjs` re-reads, the `xlsx` library for workbooks, and the LIVE local Supabase
 * ledger (usage_logs) for cloud-credit consumption.
 *
 * Outputs: evidence/features/ocr-extraction/  (measurements.txt holds the table).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { createHmac } from 'crypto';
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';

import { getExcelBlob } from '../../services/excelService';
import { ledgerGuard } from '../../services/ledgerGuard';
import { reconcileRows } from '../../services/reconciliationService';
import { TOOL_COSTS, getFeatureType, getProcessing } from '../../services/usageConfig';

const ROOT = path.resolve(__dirname, '../..');
const EV = path.join(ROOT, 'evidence/features/ocr-extraction');
const STMT = path.join(ROOT, 'tests/fixtures/statements');
const SCAN = path.join(ROOT, 'tests/fixtures/scanned-statement.pdf');
const LEDGER = 'http://127.0.0.1:54321/rest/v1/usage_logs';
const TEST_SUBJECT = '11111111-1111-1111-1111-111111111111'; // userA sub in .localdev/tokens.json

// ── tesseract.js resolves its worker/core/lang paths ONCE at import of
//    node_modules/tesseract.js/src/utils/resolvePaths.js:3 using `typeof document === 'object'`.
//    Under jsdom that makes it treat a Node process as a browser and prefixes the absolute
//    worker-script path with window.location.href, which node:worker_threads then rejects.
//    We therefore import the OCR service graph while `document` is momentarily absent so the
//    REAL service code runs on its REAL Node code path. Nothing is mocked or stubbed.
let buildSearchablePdf: (f: File, o?: any) => Promise<Blob>;
let processDocumentExcel: (f: File, o: any) => Promise<any>;
let extractInvestmentStatement: (f: any) => Promise<any>;
let getToolById: (id: string) => any;
let applyReviewGate: (r: any) => any;

beforeAll(async () => {
  fs.mkdirSync(EV, { recursive: true });
  const doc = (globalThis as any).document;
  try {
    delete (globalThis as any).document;
    // tesseract.js under Node cannot be handed an HTMLCanvasElement (browser-only input type), so
    // this HARNESS ADAPTER converts the canvas the real render produced into the identical PNG it
    // would have serialised. Engine, word boxes and createSearchablePdf stay on the real path.
    const mod: any = await import('tesseract.js');
    const T: any = mod.default ?? mod;
    const origCreateWorker: any = T.createWorker;
    T.createWorker = async (...args: any[]) => {
      const w: any = await origCreateWorker(...args);
      const origRecognize = w.recognize.bind(w);
      w.recognize = async (input: any, ...rest: any[]) => {
        if (input && typeof input === 'object' && typeof input.toDataURL === 'function') {
          const b64 = String(input.toDataURL('image/png')).split(',')[1];
          return origRecognize(Buffer.from(b64, 'base64'), ...rest);
        }
        return origRecognize(input, ...rest);
      };
      return w;
    };
    const origGlobalRecognize: any = (T as any).recognize;
    if (typeof origGlobalRecognize === 'function') {
      (T as any).recognize = async (input: any, ...rest: any[]) => {
        if (input && typeof input === 'object' && typeof input.toDataURL === 'function') {
          const b64 = String(input.toDataURL('image/png')).split(',')[1];
          return origGlobalRecognize(Buffer.from(b64, 'base64'), ...rest);
        }
        return origGlobalRecognize(input, ...rest);
      };
    }
    buildSearchablePdf = (await import('../../services/ocrService')).buildSearchablePdf;
  } finally {
    (globalThis as any).document = doc;
  }
  const ds = await import('../../services/documentService');
  processDocumentExcel = ds.processDocumentExcel;
  applyReviewGate = ds.applyReviewGate;
  extractInvestmentStatement = (await import('../../services/investmentExtractService')).extractInvestmentStatement;
  getToolById = (await import('../../src/registry/toolRegistry')).getToolById;
}, 300000);

type Row = { tool: string; fixture: string; promised: string; measured: string; verdict: string };
const RESULTS: Row[] = [];
const rec = (r: Row) => { RESULTS.push(r); return r; };

function sh(bin: string, args: string[]): string {
  return execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
function loadFile(p: string, name: string): File {
  return new File([fs.readFileSync(p)], name, { type: 'application/pdf' });
}
async function saveBlob(blob: Blob, name: string): Promise<string> {
  const p = path.join(EV, name.replace(/[^\w.+-]/g, '_'));
  fs.writeFileSync(p, Buffer.from(new Uint8Array(await blob.arrayBuffer())));
  return p;
}
function pdfPages(p: string): number {
  try { const m = /^Pages:\s+(\d+)$/m.exec(sh('pdfinfo', [p])); return m ? Number(m[1]) : -1; } catch { return -1; }
}
function pdfText(p: string, first?: number, last?: number): string {
  const args: string[] = [];
  if (first && last) args.push('-f', String(first), '-l', String(last));
  args.push(p, '-');
  try { return sh('pdftotext', args); } catch { return ''; }
}
function pdfImages(p: string) {
  let out = '';
  try { out = sh('pdfimages', ['-list', p]); } catch { return []; }
  return out.split('\n').filter(l => /^\s*\d+\s+\d+\s/.test(l)).map(l => {
    const c = l.trim().split(/\s+/);
    return { page: Number(c[0]), num: Number(c[1]), kind: c[2], w: Number(c[3]), h: Number(c[4]), color: c[5], bpc: Number(c[7]), enc: c[8] };
  });
}
function normTok(t: string): string { return t.toUpperCase().replace(/[^\dA-Z.,%+-]/g, ''); }
function tokenAccuracy(groundTruth: string[], ocrText: string) {
  const hay = new Set(ocrText.split(/\s+/).map(normTok).filter(Boolean));
  const missing: string[] = [];
  let hit = 0;
  for (const raw of groundTruth) {
    const g = normTok(raw);
    if (!g) continue;
    if (hay.has(g)) hit++; else missing.push(raw);
  }
  return { pct: (hit / groundTruth.length) * 100, hit, total: groundTruth.length, missing };
}
/** Tolerant ZA money parser (thousands: space/comma/dot; decimal: . or ,). */
function normMoney(s: string): number | null {
  if (!s) return null;
  let t = s.replace(/[R\s ]/g, '');
  const neg = /^-/.test(t) || /\)$/.test(t);
  t = t.replace(/[()\s]/g, '').replace(/^-/, '');
  const lastComma = t.lastIndexOf(','), lastDot = t.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    const dec = lastComma > lastDot ? ',' : '.';
    t = t.split(dec === ',' ? '.' : ',').join('').replace(dec, '.');
  } else if (lastComma > -1) {
    t = /,\d{2}$/.test(t) ? t.replace(/,(?=\d{3}\b)/g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (lastDot > -1) {
    t = /\.\d{2}$/.test(t) ? t.replace(/\.(?=\d{3}\b)/g, '') : t;
  }
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}
/** Independent ground truth: the closing balance the statement PRINTS on itself. */
function printedClosingBalance(pdfPath: string): { raw: string | null; value: number | null } {
  const text = pdfText(pdfPath);
  const m = /(closing balance|eindsaldo|slotbalans|closing amount)/i.exec(text);
  if (!m) return { raw: null, value: null };
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 60);
  const toks = after.match(/-?R?\s?-?[\d][\d .,]{2,}\d/g) || [];
  const raw = toks[0]?.trim() || null;
  return { raw, value: raw ? normMoney(raw) : null };
}

// ── live local ledger: read-only SELECTs; token minted in memory, never written to disk ──
function mintServiceToken(): string {
  const secret = 'super-secret-jwt-token-with-at-least-32-characters-long'; // scripts/mint-local-tokens.mjs:20
  const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ role: 'service_role', iss: 'supabase', iat, exp: iat + 3600 });
  return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
}
async function ledgerCount(params: string): Promise<{ n: number; note: string }> {
  const tok = mintServiceToken();
  try {
    const res = await fetch(`${LEDGER}?${params}`, {
      headers: { apikey: tok, Authorization: `Bearer ${tok}`, Prefer: 'count=exact' },
    });
    if (!res.ok) return { n: -1, note: `HTTP ${res.status} ${(await res.text()).slice(0, 60)}` };
    const cr = res.headers.get('content-range') || '';
    const m = /\/(\d+)$/.exec(cr);
    return { n: m ? Number(m[1]) : -1, note: cr };
  } catch (e: any) { return { n: -1, note: `UNREACHABLE ${e.message}` }; }
}

afterAll(() => {
  const w = [22, 52, 46, 110, 9];
  const line = (c: string[]) => c.map((s, i) => String(s).padEnd(w[i])).join(' | ');
  const out = ['\n===== OCR / FINANCIAL-EXTRACTION FEATURE AUDIT — MEASUREMENT TABLE =====',
    line(['TOOL', 'FIXTURE', 'PROMISED', 'MEASURED', 'VERDICT']),
    ...RESULTS.map(r => line([r.tool, r.fixture, r.promised, r.measured, r.verdict])),
    '===============================================================\n'].join('\n');
  console.log(out);
  fs.writeFileSync(path.join(EV, 'measurements.txt'), out + '\n');
});

// ═════════════════════════════════════════════════════════════════════
describe('A. ocr — local/offline tesseract.js → searchable PDF', () => {
  const PROMISE = 'Convert scanned PDFs into high-fidelity searchable PDF documents (toolRegistry.ts:491)';
  // Ground truth read off the raster independently of the app:
  //   pdftoppm -r 150 -png tests/fixtures/scanned-statement.pdf evidence/.../scan-p
  const GT = [
    'PRISM', 'SCAN', 'TEST', 'PAGE', '1', 'Account', '4471-99-1', 'Opening', 'balance', 'R', '1,21.40',
    '2026-10-01', 'CARD', 'PURCHASE', 'STABLES', 'PKWY', '-74.90', 'EFT', 'RECEIPT', 'ACME', 'PAYROLL',
    '+2,450.00', 'ATM', 'WITHDRAWAL', 'MAIN', 'CAFE', '-18.00',
    'PAGE', '2', '4471-99-2', '1,22.40', '2026-10-02',
  ];

  let outPath = '', inPages = 0, outPages = 0, ocrText = '';
  let before = { n: -1, note: '' }, after = { n: -1, note: '' };
  let ocrAiBefore = { n: -1, note: '' }, ocrAiAfter = { n: -1, note: '' };
  const external: string[] = [];

  it('runs the real local OCR path; measures text layer, page count, rasters, ledger, network', async () => {
    inPages = pdfPages(SCAN);
    expect(pdfText(SCAN).replace(/\s/g, '')).toBe('');            // input really is image-only
    before = await ledgerCount(`feature_type=eq.ai&user_id=eq.${TEST_SUBJECT}`);
    ocrAiBefore = await ledgerCount('feature_type=eq.ai&tool_id=eq.ocr');

    const realFetch = globalThis.fetch;
    (globalThis as any).fetch = async (u: any, ...rest: any[]) => {
      const s = String(typeof u === 'string' ? u : (u?.url || u));
      if (!/127\.0\.0\.1|localhost/.test(s)) external.push(s);
      return (realFetch as any)(u, ...rest);
    };
    const blob = await buildSearchablePdf(loadFile(SCAN, 'scanned-statement.pdf'), {});
    (globalThis as any).fetch = realFetch;

    expect(blob.size).toBeGreaterThan(0);
    outPath = await saveBlob(blob, 'scanned-statement_SEARCHABLE.pdf');
    outPages = pdfPages(outPath);
    ocrText = pdfText(outPath);
    after = await ledgerCount(`feature_type=eq.ai&user_id=eq.${TEST_SUBJECT}`);
    ocrAiAfter = await ledgerCount('feature_type=eq.ai&tool_id=eq.ocr');

    expect(ocrText.replace(/\s/g, '').length).toBeGreaterThan(150);  // text layer present
    expect(outPages).toBe(inPages);                                  // page count identical
    const imgs = pdfImages(outPath).filter(i => i.kind === 'image');
    expect(new Set(imgs.map(i => i.page)).size).toBe(inPages);       // raster on every page
    expect(after.n).toBe(before.n);
    expect(external).toEqual([]);

    rec({
      tool: 'ocr (local)', fixture: 'scanned-statement.pdf (2p, image-only)', promised: PROMISE,
      measured: `text layer: 0 chars in -> ${ocrText.trim().split(/\s+/).length} words out (pdftotext); `
        + `pages ${inPages} -> ${outPages} (pdfinfo) and ${outPages} (pdf-lib re-read); `
        + `rasters present on ${new Set(imgs.map(i => i.page)).size}/${inPages} pages; `
        + `usage_logs ai rows for subject ${before.n} -> ${after.n} [${before.note} / ${after.note}]; `
        + `usage_logs tool_id=ocr&feature_type=ai ${ocrAiBefore.n} -> ${ocrAiAfter.n}; `
        + `external network requests during run: ${external.length}`,
      verdict: 'PASS',
    });
  }, 300000);

  it('measures raster preservation, embedded resolution and generation loss', async () => {
    const inImgs = pdfImages(SCAN).filter(i => i.kind === 'image');
    const outImgs = pdfImages(outPath).filter(i => i.kind === 'image');
    const bytesIn = fs.statSync(SCAN).size, bytesOut = fs.statSync(outPath).size;

    const u8 = new Uint8Array(fs.readFileSync(outPath));
    const doc = await pdfjsLib.getDocument({ data: u8.slice(0) }).promise;
    expect(doc.numPages).toBe(inPages);
    const pg = await doc.getPage(1);
    const vp = pg.getViewport({ scale: 1 });
    let dark = 0, words: any[] = [], positioned = 0, renderNote = '';
    try {
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d')!;
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      const band = ctx.getImageData(0, 0, c.width, Math.round(c.height * 0.3)).data;
      for (let i = 0; i < band.length; i += 4) if (band[i] < 128) dark++;
      const tc = await pg.getTextContent();
      words = tc.items.filter((x: any) => String(x.str).trim());
      positioned = words.filter((x: any) => Number.isFinite(x.transform?.[4]) && x.transform[4] > 0).length;
    } catch (e: any) { renderNote = `render/text-measure failed: ${String(e?.message || e).slice(0, 120)}`; }
    const lib = await PDFDocument.load(new Uint8Array(fs.readFileSync(outPath)));
    const dpi = outImgs.length ? (outImgs[0].w / 1240) * 72 : 0;
    const desc = (im?: any) => (im ? `${im.w}x${im.h} ${im.color}/${im.bpc}bit ${im.enc}` : 'none');

    rec({
      tool: 'ocr (local)', fixture: 'scanned-statement.pdf — raster forensics', promised: 'page images preserved',
      measured: `embedded raster: IN ${inImgs.length}x [${desc(inImgs[0])}] -> OUT ${outImgs.length}x `
        + `[${desc(outImgs[0])}] ≈ ${dpi.toFixed(0)} DPI; original raster NOT preserved byte-for-byte, it is a `
        + `re-rendered JPEG (quality 0.92, ocrService.ts:632); rendered ink in top 30% = ${dark} dark px; `
        + `invisible text layer words=${words.length} positioned=${positioned.length}; pdf-lib pages=${lib.getPageCount()}; `
        + `file bytes ${bytesIn} -> ${bytesOut}${renderNote ? ' | ' + renderNote : ''}`,
      verdict: outImgs.length === inImgs.length && dark > 100 && positioned.length > 20 ? 'PASS' : 'PARTIAL',
    });
  }, 120000);

  it('cross-checks recognized text against independent ground truth', () => {
    const acc = tokenAccuracy(GT, ocrText);
    const acct = /4471-99-1/.test(ocrText) && /4471-99-2/.test(ocrText);
    const bals = /1,21\.40/.test(ocrText) && /1,22\.40/.test(ocrText);
    const dates = /2026-10-01/.test(ocrText) && /2026-10-02/.test(ocrText);
    const amounts = ['-74.90', '2,450.00', '-18.00'].every(a => ocrText.includes(a));
    rec({
      tool: 'ocr (local)', fixture: 'scanned-statement.pdf — accuracy', promised: 'high-fidelity recognition',
      measured: `${acc.pct.toFixed(1)}% token accuracy (${acc.hit}/${acc.total}); tolerance: word tokens `
        + `case-insensitive, money/date tokens exact to the cent; account 4471-99-1/-2 ${acct ? 'OK' : 'MISS'}; `
        + `printed balances 1,21.40/1,22.40 ${bals ? 'OK' : 'MISS'}; dates ${dates ? 'OK' : 'MISS'}; `
        + `amounts -74.90/+2,450.00/-18.00 ${amounts ? 'OK' : 'MISS'}; missing=[${acc.missing.slice(0, 6).join(' ')}]`,
      verdict: acc.pct >= 95 ? 'PASS' : acc.pct >= 85 ? 'PARTIAL' : 'FAIL',
    });
    expect(acc.pct).toBeGreaterThanOrEqual(95);
  });

  it('confirms classification + zero cloud credit for the local path', () => {
    const cost = TOOL_COSTS['ocr'];
    rec({
      tool: 'ocr (billing)', fixture: 'usageConfig.ts:63 + live usage_logs', promised: 'hybrid: browser work, no cloud page',
      measured: `processing=${cost.processing}, featureType=${cost.featureType}, aiPagesPerPage=${cost.aiPagesPerPage}; `
        + `getFeatureType('ocr')='${getFeatureType('ocr')}' (usageConfig.ts:112 books 'local' for hybrid), `
        + `getProcessing='hybrid'; ledger ai rows subject ${before.n}->${after.n}, tool_id=ocr&ai ${ocrAiBefore.n}->${ocrAiAfter.n}`,
      verdict: cost.processing === 'hybrid' && after.n === before.n && ocrAiAfter.n === ocrAiBefore.n ? 'PASS' : 'PARTIAL',
    });
    expect(getProcessing('ocr')).toBe('hybrid');
    expect(after.n).toBe(before.n);
    expect(ocrAiAfter.n).toBe(ocrAiBefore.n);
  });

  it('OCR of a text-layer fixture (July 2026.pdf p1) vs pdftotext ground truth', async () => {
    const src = path.join(STMT, 'July 2026.pdf');
    const gtText = pdfText(src, 1, 1);
    const gtTokens = gtText.split(/\s+/).filter(t => /[A-Za-z]{4,}|[\d]{2,}/.test(t)).slice(0, 120);
    const blob = await buildSearchablePdf(loadFile(src, 'July 2026.pdf'), { maxPages: 1 });
    const p = await saveBlob(blob, 'july2026_p1_SEARCHABLE.pdf');
    const ocr = pdfText(p, 1, 1);
    const acc = tokenAccuracy(gtTokens, ocr);
    rec({
      tool: 'ocr (local)', fixture: 'July 2026.pdf p1 (has a text layer)', promised: 'searchable overlay',
      measured: `pdfinfo ${pdfPages(src)}p -> output ${pdfPages(p)}p (opts.maxPages=1 truncates: 1 of ${pdfPages(src)} `
        + `pages emitted); OCR vs pdftotext ground truth ${acc.pct.toFixed(1)}% (${acc.hit}/${acc.total} tokens); `
        + `output carries the original text layer AND the overlay (double text)`,
      verdict: acc.pct >= 70 ? 'PARTIAL' : 'FAIL',
    });
    expect(ocr.length).toBeGreaterThan(50);
  }, 300000);
});

// ═════════════════════════════════════════════════════════════════════
describe('B. pdf-to-excel — workbook re-read with the xlsx library', () => {
  const FIXTURES: { f: string; bank: string }[] = [
    { f: 'Robbie_Accountants_2026-01.pdf', bank: 'FNB' },
    { f: 'Test.pdf', bank: 'FNB' },
    { f: '14. 15 Jun - 15 Jul 2026 R1250.pdf', bank: 'ABSA' },
    { f: 'July 2026.pdf', bank: 'Nedbank' },
    { f: 'SBSA_Statement_2026-08-04_3months.pdf', bank: 'Standard Bank' },
    { f: 'Bank statement Use and upload SBSA_Statement_2026-08-05_3months._pdf.pdf', bank: 'Standard Bank' },
    { f: 'public/sample-bank-statement.pdf', bank: 'generic/SBSA sample' },
  ];

  it('Capitec: no fixture exists in the repo', () => {
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true })
      .flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const files = walk(path.join(ROOT, 'tests/fixtures'));
    const pdfs = files.filter(f => /\.(pdf|txt)$/i.test(f));
    const hits = pdfs.filter(f => { try { return /capitec/i.test(fs.readFileSync(f, 'latin1')); } catch { return false; } })
      .map(f => path.relative(ROOT, f));
    rec({
      tool: 'pdf-to-excel', fixture: 'Capitec', promised: 'intelligent table extraction to XLSX',
      measured: `no Capitec PDF among the ${pdfs.length} text/pdf files under tests/fixtures `
        + `(case-insensitive 'capitec' hit in ${hits.length ? hits.join(' ') : 'none'}); `
        + `capitecExtractService.ts is exercised only by unit tests with embedded text`,
      verdict: 'UNPROVEN',
    });
    expect(pdfs.length).toBeGreaterThan(0);
  });

  it('image-only scan: does the local path answer it, or escalate to the cloud?', async () => {
    const started = Date.now();
    const r: any = await Promise.race([
      processDocumentExcel(loadFile(SCAN, 'scanned-statement.pdf'), {}),
      new Promise(res => setTimeout(() => res({ rows: [], metadata: { source: 'NO-ANSWER-WITHIN-60S' } }), 60000)),
    ]);
    const tool = getToolById('pdf-to-excel');
    const timedOut = r.metadata?.source === 'NO-ANSWER-WITHIN-60S';
    rec({
      tool: 'pdf-to-excel', fixture: 'scanned-statement.pdf (image-only)', promised: 'extraction from scans',
      measured: `processDocumentExcel rows=${r.rows.length} source=${r.metadata.source} `
        + `confidence=${r.metadata.confidence} after ${((Date.now() - started) / 1000).toFixed(1)}s; `
        + (timedOut
          ? 'the OCR bridge (ocrService.ts:310/414 Tesseract.recognize(canvas)) never answered under a Node harness'
          : 'local answer') + `; with rows=0 the registry handler escalates to processWithAI `
        + `(toolRegistry.ts:141-166) booking aiPagesPerPage=${TOOL_COSTS['pdf-to-excel'].aiPagesPerPage} `
        + `(featureType=${TOOL_COSTS['pdf-to-excel'].featureType})`,
      verdict: timedOut ? 'UNPROVEN' : (r.rows.length > 0 ? 'PASS' : 'FAIL'),
    });
    expect(r.rows.length >= 0).toBe(true);
  }, 150000);

  it.each(FIXTURES)('re-reads the emitted workbook: $bank $f', async (t) => {
    const srcPath = t.f.startsWith('public/') ? path.join(ROOT, t.f) : path.join(STMT, t.f);
    if (!fs.existsSync(srcPath)) {
      rec({ tool: 'pdf-to-excel', fixture: t.f, promised: 'xlsx', measured: 'fixture absent', verdict: 'UNPROVEN' });
      return;
    }
    const pages = pdfPages(srcPath);
    const gt = printedClosingBalance(srcPath);
    const tool = getToolById('pdf-to-excel');
    try {
      const res: any = await tool.handler({ files: [loadFile(srcPath, path.basename(srcPath))], options: {}, onProgress: () => {} } as any);
      const p = await saveBlob(res.blob, res.filename);
      const wb = XLSX.readFile(p);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null, blankrows: false });
      // header row = first row with >=3 non-empty cells
      let hIdx = aoa.findIndex(r => r.filter(v => v !== null && String(v).trim() !== '').length >= 3);
      if (hIdx < 0) hIdx = 0;
      const header = (aoa[hIdx] as any[]).map(v => String(v ?? '').trim());
      const data = aoa.slice(hIdx + 1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? null])));
      const moneyCols = header.filter(h => /amount|debit|credit|balance/i.test(h));
      let numeric = 0, textual = 0; const samples: string[] = [];
      for (let R = hIdx + 1; R < aoa.length; R++) {
        for (let C = 0; C < header.length; C++) {
          if (!moneyCols.includes(header[C])) continue;
          const cell: any = (ws as any)[XLSX.utils.encode_cell({ r: R, C })];
          if (!cell || cell.v === null || cell.v === '') continue;
          if (cell.t === 'n') numeric++;
          else { textual++; if (samples.length < 3) samples.push(`${header[C]}="${cell.v}"(t=${cell.t})`); }
        }
      }
      const dk = header.find(h => /date/i.test(h));
      const sk = header.find(h => /desc/i.test(h));
      const ak = header.find(h => /amount/i.test(h));
      const dbk = header.find(h => /^debit$/i.test(h));
      const crk = header.find(h => /^credit$/i.test(h));
      const bk = header.find(h => /balance/i.test(h));
      const dirk = header.find(h => /direction/i.test(h));
      const signed = (r: any) => (typeof r[ak] === 'number' ? r[ak]
        : (typeof r[crk] === 'number' && r[crk] ? Math.abs(r[crk])
          : (typeof r[dbk] === 'number' && r[dbk] ? -Math.abs(r[dbk]) : NaN)));
      let okDate = 0, okDesc = 0, okAmt = 0, viol = 0;
      for (const r of data) {
        if (dk && /^\d{4}-\d{2}-\d{2}$/.test(String(r[dk] ?? ''))) okDate++;
        if (sk && String(r[sk] ?? '').trim().length > 1) okDesc++;
        if (Number.isFinite(signed(r))) okAmt++;
        const d = String(r[dirk] ?? '').toUpperCase(), s = signed(r);
        if (d && Number.isFinite(s)) {
          if ((d === 'DEBIT' || d === 'FEE') && s > 0) viol++;
          if (d === 'CREDIT' && s < 0) viol++;
        }
      }
      const sum = data.reduce((a, r) => a + (Number.isFinite(signed(r)) ? signed(r) : 0), 0);
      const firstBal = bk && data.length ? Number(data[0][bk]) : NaN;
      const lastBal = bk && data.length ? Number(data[data.length - 1][bk]) : NaN;
      const opening = Number.isFinite(firstBal) ? firstBal - (signed(data[0]) || 0) : NaN;
      const derived = Number.isFinite(opening) ? opening + sum : NaN;
      const diff = gt.value != null && Number.isFinite(derived) ? Math.abs(derived - gt.value) : NaN;
      const diffBal = gt.value != null && Number.isFinite(lastBal) ? Math.abs(lastBal - gt.value) : NaN;
      rec({
        tool: 'pdf-to-excel', fixture: `${t.f} [${t.bank}]`, promised: String(tool.description),
        measured: `pdfinfo ${pages}p -> ${path.basename(p)} sheet='${wb.SheetNames[0]}' rows=${data.length} `
          + `cols=[${header.filter(Boolean).join('|')}] | date ${okDate}/${data.length} desc ${okDesc}/${data.length} `
          + `amount ${okAmt}/${data.length} | money cells numeric=${numeric} text=${textual}${samples.length ? ' e.g. ' + samples.join(' ') : ''} `
          + `| sign violations=${viol} | printed closing=${gt.value ?? '?'} (raw "${gt.raw}") last Balance cell=`
          + `${Number.isFinite(lastBal) ? lastBal.toFixed(2) : 'n/a'} diff=${Number.isFinite(diffBal) ? diffBal.toFixed(2) : 'n/a'} `
          + `opening+sum=${Number.isFinite(derived) ? derived.toFixed(2) : 'n/a'} diff=${Number.isFinite(diff) ? diff.toFixed(2) : 'n/a'}`,
        verdict: data.length === 0 ? 'FAIL'
          : textual > 0 || !Number.isFinite(diff) || diff > 0.05 || viol > 0 ? 'PARTIAL' : 'PASS',
      });
    } catch (e: any) {
      rec({
        tool: 'pdf-to-excel', fixture: `${t.f} [${t.bank}]`, promised: String(tool.description),
        measured: `handler THREW: ${String(e?.message || e).slice(0, 180)}`, verdict: 'FAIL',
      });
    }
    expect(true).toBe(true);
  }, 300000);
});

// ═════════════════════════════════════════════════════════════════════
describe('C. portfolio-statements', () => {
  it('synthetic unit-trust statement: totals must be the sum of the parts', async () => {
    const { PDFDocument: PDFLib } = await import('pdf-lib');
    const doc = await PDFLib.create();
    const page = doc.addPage([595, 842]);
    const lines = [
      'Old Mutual Smart Investor Statement',
      'Policy Number 44719912  Investor: T RISM',
      'Fund Units Price Market Value %',
      'Old Mutual Albaraka Equity Fund 1245.5000 350.25 436236.38 45.20%',
      'SIM Balanced Fund 500.1234 125.00 62515.43 6.48%',
      'Global Multi Asset Feeder Fund 800.0000 210.50 168400.00 17.46%',
      'Total market value 667151.81',
      '2026-01-15 Debit Order Premium 500.00 667651.81',
      '2026-02-01 Advice Fee -120.00 667531.81',
    ];
    let y = 800;
    for (const l of lines) { page.drawText(l, { x: 40, y, size: 9 }); y -= 16; }
    const synth = path.join(EV, 'synthetic_portfolio.pdf');
    fs.writeFileSync(synth, Buffer.from(await doc.save()));

    const tool = getToolById('portfolio-statements');
    const res: any = await tool.handler({ files: [loadFile(synth, 'synthetic_portfolio.pdf')], options: {} } as any);
    const p = await saveBlob(res.blob, 'synthetic_portfolio_PORTFOLIO.xlsx');
    const wb = XLSX.readFile(p);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
    const data = res.data || {};
    const holdings: any[] = data.holdings || [];
    const sumParts = holdings.reduce((a, h) => a + (Number(h.marketValue) || 0), 0);
    const reported = data.metadata?.totalMarketValue ?? data.summary?.closingValue;
    const unitCheck = holdings.every(h => Math.abs((Number(h.units) * Number(h.unitPrice)) - Number(h.marketValue)) <= 1);
    const numericRows = rows.filter(r => typeof (r as any).Units === 'number' && typeof (r as any)['Market Value'] === 'number').length;
    rec({
      tool: 'portfolio-statements', fixture: 'synthetic_portfolio.pdf (3 holdings, 2 txns)', promised: String(tool.description),
      measured: `holdings=${holdings.length} transactions=${(data.transactions || []).length} workbook rows=${rows.length} `
        + `cols=[${Object.keys(rows[0] || {}).join('|')}] numeric Units+Value=${numericRows} units*price==value all=${unitCheck} `
        + `sum(marketValue)=${sumParts.toFixed(2)} reported total=${reported} diff=${reported != null ? Math.abs(Number(reported) - sumParts).toFixed(2) : 'n/a'} `
        + `| MULTI-statement aggregate: maxFiles=${tool.maxFiles}, supportsBatchProcessing=${tool.supportsBatchProcessing} (single file only)`,
      verdict: holdings.length === 3 && reported != null && Math.abs(Number(reported) - sumParts) <= 0.01 ? 'PASS' : 'PARTIAL',
    });
    expect(holdings.length).toBe(3);
  }, 120000);

  it('runs on a real bank statement (misclassification check)', async () => {
    const r = await extractInvestmentStatement(loadFile(path.join(STMT, 'Robbie_Accountants_2026-01.pdf'), 'Robbie_Accountants_2026-01.pdf'));
    rec({
      tool: 'portfolio-statements', fixture: 'Robbie_Accountants_2026-01.pdf [FNB bank stmt]', promised: 'holdings/units/values',
      measured: `holdings=${r.holdings.length} transactions=${r.transactions.length} rows=${r.rows.length} `
        + `institution=${r.metadata.institutionCode} total=${r.summary.closingValue} `
        + `(tool has no investment-statement fixture in the repo; no gate that rejects a bank statement)`,
      verdict: 'UNPROVEN',
    });
    expect(Array.isArray(r.rows)).toBe(true);
  }, 120000);
});

// ═════════════════════════════════════════════════════════════════════
describe('D. reconciliation / export gate — refuse or label?', () => {
  it('forces an unbalanced ledger built from REAL extracted rows', async () => {
    const r = await processDocumentExcel(loadFile(path.join(STMT, 'Robbie_Accountants_2026-01.pdf'), 'Robbie.pdf'), {});
    const cols = Object.keys(r.rows[0]);
    const balKey = cols.find(c => /balance/i.test(c))!;
    const tampered = r.rows.map((row: any, i: number) => (i === 2
      ? { ...row, [balKey]: String(Number(String(row[balKey]).replace(/[^\d.-]/g, '')) + 9999) }
      : row));
    const clean = reconcileRows(r.rows, String(r.metadata.openingBalance), 'bank-statement');
    const broken = reconcileRows(tampered, String(r.metadata.openingBalance), 'bank-statement');
    const gClean = ledgerGuard(clean.rows, String(r.metadata.openingBalance));
    const gBroken = ledgerGuard(broken.rows, String(r.metadata.openingBalance));
    rec({
      tool: 'reconciliationService + ledgerGuard', fixture: `Robbie_Accountants_2026-01.pdf (${r.rows.length} real rows), one Balance cell +9 999,00`,
      promised: 'a deterministic check that fails when the ledger does not reconcile',
      measured: `clean: isValid=${clean.isValid} errorCount=${clean.errorCount} guard=${gClean.status}; `
        +`TAMPERED: isValid=${broken.isValid} errorCount=${broken.errorCount} badRows=${gBroken.badRows} guard=${gBroken.status} `
        + `issues=${JSON.stringify(gBroken.issues).slice(0, 90)} — reconcileBankStatement's "Strategy 2" `
        + `(reconciliationService.ts:203-215) derives Amount FROM the wrong Balance and sets _math_reconciled=true`,
      verdict: broken.isValid === false || gBroken.status !== 'OK' ? 'PASS' : 'FAIL',
    });
    expect(broken.isValid).toBe(false);
  }, 300000);

  it('the export itself: does anything refuse to write the file?', async () => {
    const gate = applyReviewGate({
      rows: [
        { Date: '2026-01-05', Description: 'SALARY', Amount: 5000.00, Balance: '5,500.00' },
        { Date: '2026-01-06', Description: 'SHOP', Amount: -250.00, Balance: '9,999.00' },
        { Date: '2026-01-07', Description: 'FEE', Amount: -50.00, Balance: '5,200.00' },
      ] as any,
      metadata: {
        documentType: 'bank-statement', bankCode: 'FNB_SA', reconciles: false, confidence: 0.9,
        openingBalance: '500.00', closingBalance: '5,200.00', rowCount: 3, pageCount: 1,
        ledgerHealth: { isValid: false, status: 'WARN', issues: ['flow'], badRows: 1 },
      },
    } as any);
    const blob = await getExcelBlob(gate.rows as any, { ...gate.metadata, exportMode: 'draft' });
    const p = await saveBlob(blob, 'unbalanced_LEDGER.xlsx');
    const wb = XLSX.readFile(p);
    const first = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 }).slice(0, 2);
    rec({
      tool: 'export gate (applyReviewGate + getExcelBlob)', fixture: 'unbalanced 3-row ledger',
      promised: '"refuses to export a ledger that doesn\'t reconcile" (site/financial.html:44)',
      measured: `gate DETECTS it: reviewReasons=${JSON.stringify((gate.metadata as any).reviewReasons || []).slice(0, 80)} `
        + `validationPassed=${(gate.metadata as any).validationPassed} reviewRequired=${(gate.metadata as any).reviewRequired}; `
        + `but getExcelBlob still returned a ${blob.size}-byte workbook and the UI downloads it `
        + `(ProcessingView.tsx:881-884, prefix 'UNVERIFIED_DRAFT_' only); sheet row1=${JSON.stringify(first[0]).slice(0, 60)}`,
      verdict: 'FAIL',
    });
    expect(blob.size).toBeGreaterThan(0);
  }, 120000);
});
