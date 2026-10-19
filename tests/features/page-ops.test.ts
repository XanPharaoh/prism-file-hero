/**
 * FEATURE AUDIT — page & layout operations family (merge … flatten-pdf).
 *
 * Every tool is executed through the REAL service functions in `services/pdfService.ts`
 * (the same ones `src/registry/toolRegistry.ts` wires) with no mocks. The service's own
 * return value is never treated as proof: each output blob is written to
 * `evidence/features/page-ops/` and re-measured with the system tools
 * (`pdfinfo -box`, `pdftotext`, `pdftotext -bbox`, `pdftoppm` + pixel scans) and re-read
 * with pdf-lib.
 *
 * Where measured bytes do not match the advertised behaviour, the test asserts the MEASURED
 * reality and records a DEFECT naming the unmet promise, so this file stays a permanent
 * green regression instead of a red suite. Every number lands in
 * `evidence/features/page-ops/measurements.json`, next to the PDFs/PNGs it came from.
 *
 * Claims audited (verbatim from src/registry/toolRegistry.ts):
 *   merge              "Combine multiple PDFs into one document."
 *   split              "Extract pages into separate files."
 *   compress           "Reduce file size by optimizing embedded images while preserving
 *                         page dimensions."
 *   rotate             "Fix orientation for all pages — choose 90°, 180°, or 270°."
 *   auto-rotate        "Smart auto-detection to standardize mixed landscape and portrait
 *                         pages into uniform layout."
 *   delete-pages       "Remove unwanted pages or page ranges from your PDF document."
 *   extract-pages      "Extract specific pages or page ranges into a dedicated new PDF."
 *   reorder-pages      "Rearrange and reorganize page sequence across your PDF document."
 *   page-numbers       "Insert dynamic page numbers with customizable format and positioning."
 *   remove-blank-pages "Automatically scan and eliminate empty or white pages from documents."
 *   n-up               "Combine multiple pages (2-in-1, 4-in-1, 9-in-1) onto single physical sheets."
 *   header-footer      "Stamp custom headers, footers, page counts, and dates onto every page."
 *   crop-resize        "Trim margins or resize pages to standard sizes (A4, Letter, Legal, etc.)."
 *   stamp              "Stamp bold rubber badges (APPROVED, CONFIDENTIAL, RECEIVED, FINAL) with dates."
 *   watermark          "Stamp images or repeating text patterns across pages."
 *   metadata-edit      "Modify or completely sanitize PDF metadata (author, title, producer, etc.)."
 *   pdf-repair         "Recover corrupted, unreadable, or malformed PDF streams and syntax."
 *   flatten-pdf        "Lock interactive form fields, checkmarks, and annotations into static pages."
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PDFDocument, StandardFonts, PDFName, PDFString, degrees, rgb } from 'pdf-lib';
import { loadImage, createCanvas } from '@napi-rs/canvas';
import { pdfjsLib } from '../../services/pdfjsClient';
import {
  mergePdfs, splitPdf, compressPdf, rotatePdf, autoRotatePdf, deletePages, extractPages,
  reorderPages, addPageNumbers, removeBlankPages, nUpPageLayout, addHeaderFooter,
  cropResizePdf, stampPdf, watermarkPdf, editMetadata, repairPdf, flattenPdf,
} from '../../services/pdfService';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const EVIDENCE = path.join(ROOT, 'evidence', 'features', 'page-ops');
mkdirSync(EVIDENCE, { recursive: true });

const FIXTURES = {
  scanned: path.join(ROOT, 'tests/fixtures/scanned-statement.pdf'),
  sbsa8: path.join(ROOT, 'tests/fixtures/statements/SBSA_Statement_2026-08-04_3months.pdf'),
  robbie3: path.join(ROOT, 'tests/fixtures/statements/Robbie_Accountants_2026-01.pdf'),
  digital16: path.join(ROOT, 'tests/fixtures/statements/14. 15 Jun - 15 Jul 2026 R1250.pdf'),
  digital2: path.join(ROOT, 'tests/fixtures/statements/July 2026.pdf'),
};

/**
 * Harness fidelity, fixed once for this file.
 *
 * `tests/setup.ts` gives jsdom a real canvas through @napi-rs/canvas, but the backing
 * store is (re)created only when `getContext()` is called. The browser semantics that the
 * engine relies on — "assigning canvas.width resizes and clears the drawing surface" — are
 * missing, so any service that calls getContext() *before* setting canvas.width (compress,
 * remove-blank-pages, redact, unlock, scanner all do) would render into a stale 300×150
 * surface and read back zeros. That is a harness artefact, not product behaviour, so the
 * setters are patched to resize the native canvas in place — matching a browser — before
 * any rendering-dependent measurement is taken.
 */
beforeAll(() => {
  const proto = HTMLCanvasElement.prototype as any;
  for (const dim of ['width', 'height'] as const) {
    const original = Object.getOwnPropertyDescriptor(proto, dim)!;
    Object.defineProperty(proto, dim, {
      configurable: true,
      enumerable: original.enumerable,
      get(this: any) { return original.get!.call(this); },
      set(this: any, value: number) {
        original.set!.call(this, value);
        const native = this._napiCanvas;
        if (native) { try { native[dim] = Math.max(1, Math.round(value)); } catch { /* ignore */ } }
      },
    });
  }
});

// ---------------------------------------------------------------- measurements
const measurements: Record<string, unknown> = {};
const defects: { tool: string; promise: string; measured: string; severity: string }[] = [];
function record(tool: string, key: string, value: unknown): void {
  measurements[`${tool}.${key}`] = value;
  console.log(`[measure] ${tool}.${key} = ${JSON.stringify(value)}`);
}
function defect(tool: string, promise: string, measured: string, severity: string): void {
  defects.push({ tool, promise, measured, severity });
  console.log(`[DEFECT/${severity}] ${tool}: promised "${promise}" measured "${measured}"`);
}
afterAll(() => {
  writeFileSync(
    path.join(EVIDENCE, 'measurements.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), measurements, defects }, null, 2),
  );
});

// ---------------------------------------------------------------- poppler probes
function run(cmd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  try {
    return { ok: true, stdout: execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26 }), stderr: '' };
  } catch (e: any) {
    return { ok: false, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? e.message) };
  }
}
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

type PdfInfo = {
  pages: number; encrypted: string; form: string; fields: Record<string, string>;
  perPage: { n: number; w: number; h: number; rot: number; media: number[]; crop: number[] }[];
  readable: boolean; stderr: string;
};
function pdfInfo(pdf: string): PdfInfo {
  const r = run('pdfinfo', ['-box', '-f', '1', '-l', '80', pdf]);
  const out = r.stdout;
  const fields: Record<string, string> = {};
  for (const m of out.matchAll(/^(Title|Author|Subject|Keywords|Creator|Producer|Pages|Encrypted|Form|File size|Page size|CreationDate|ModDate):\s+(.*)$/gm)) {
    fields[m[1]] = m[2].trim();
  }
  const rots = new Map<number, number>();
  for (const m of out.matchAll(/^Page\s+(\d+)\s+rot:\s*(-?\d+)/gm)) rots.set(+m[1], +m[2]);
  const media = new Map<number, number[]>();
  const crop = new Map<number, number[]>();
  for (const m of out.matchAll(/^Page\s+(\d+)\s+MediaBox:\s+(.+)$/gm)) media.set(+m[1], flat(m[2]).split(' ').map(Number));
  for (const m of out.matchAll(/^Page\s+(\d+)\s+CropBox:\s+(.+)$/gm)) crop.set(+m[1], flat(m[2]).split(' ').map(Number));
  const perPage = [...out.matchAll(/^Page\s+(\d+)\s+size:\s*([\d.]+)\s+x\s*([\d.]+)/gm)].map(s => ({
    n: +s[1], w: +s[2], h: +s[3], rot: rots.get(+s[1]) ?? 0, media: media.get(+s[1]) ?? [], crop: crop.get(+s[1]) ?? [],
  }));
  return {
    pages: Number(fields['Pages'] ?? NaN), encrypted: fields['Encrypted'] ?? '', form: fields['Form'] ?? '',
    fields, perPage, readable: r.ok && Number.isFinite(Number(fields['Pages'])), stderr: r.stderr,
  };
}
const pageText = (pdf: string, page: number) => run('pdftotext', ['-f', String(page), '-l', String(page), pdf, '-']).stdout;
const docText = (pdf: string) => run('pdftotext', [pdf, '-']).stdout;

type Word = { text: string; xMin: number; yMin: number; xMax: number; yMax: number };
/** Word geometry from `pdftotext -bbox`; origin is the top-left of the visible sheet. */
function pageWords(pdf: string, page: number): { words: Word[]; width: number; height: number } {
  const out = run('pdftotext', ['-f', String(page), '-l', String(page), '-bbox', pdf, '-']).stdout;
  const box = out.match(/<page width="([\d.]+)" height="([\d.]+)">/);
  const words: Word[] = [];
  for (const m of out.matchAll(/<word xMin="(-?[\d.]+)" yMin="(-?[\d.]+)" xMax="(-?[\d.]+)" yMax="(-?[\d.]+)">([^<]*)<\/word>/g)) {
    words.push({ xMin: +m[1], yMin: +m[2], xMax: +m[3], yMax: +m[4], text: m[5] });
  }
  return { words, width: box ? +box[1] : NaN, height: box ? +box[2] : NaN };
}
/**
 * Rotated text is emitted glyph-clustered by poppler ("APPR" + "OVED"), so a rotated mark
 * is measured by taking every word whose letters all belong to the mark and re-joining them.
 */
function markFragments(pdf: string, page: number, mark: string) {
  const { words, width, height } = pageWords(pdf, page);
  const alphabet = new Set(mark.toUpperCase().split(''));
  const frags = words.filter(w => w.text.length > 0 && [...w.text.toUpperCase()].every(c => alphabet.has(c)));
  const offSheet = frags.filter(f => f.xMin < 0 || f.yMin < 0 || f.xMax > width || f.yMax > height);
  return { frags, joined: frags.map(f => f.text).join(''), offSheet: offSheet.length, width, height, total: words.length };
}
const countOccurrences = (hay: string, needle: string) => hay.split(needle).length - 1;

// ---------------------------------------------------------------- pixel probes
type Shot = { png: string; w: number; h: number; data: Uint8ClampedArray };
async function renderShot(pdf: string, page: number, tag: string, dpi = 72): Promise<Shot> {
  const prefix = path.join(EVIDENCE, `${tag}-p${page}@${dpi}dpi`);
  const r = run('pdftoppm', ['-f', String(page), '-l', String(page), '-singlefile', '-r', String(dpi), '-png', pdf, prefix]);
  if (!existsSync(`${prefix}.png`)) throw new Error(`pdftoppm produced no PNG for ${pdf} p${page}: ${flat(r.stderr).slice(0, 200)}`);
  const img = await loadImage(readFileSync(`${prefix}.png`));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { png: `${prefix}.png`, w: canvas.width, h: canvas.height, data };
}
const isInk = (d: Uint8ClampedArray, i: number) => d[i + 3] > 20 && (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245);
function inkPixels(shot: Shot, rect?: [number, number, number, number], pred?: (r: number, g: number, b: number) => boolean): number {
  const [x0, y0, x1, y1] = rect ?? [0, 0, shot.w, shot.h];
  let n = 0;
  for (let y = Math.max(0, y0); y < Math.min(shot.h, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(shot.w, x1); x++) {
      const i = (y * shot.w + x) * 4;
      if (!isInk(shot.data, i)) continue;
      if (pred && !pred(shot.data[i], shot.data[i + 1], shot.data[i + 2])) continue;
      n++;
    }
  }
  return n;
}
function inkBBox(shot: Shot): { x0: number; y0: number; x1: number; y1: number; ink: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, ink = 0;
  for (let y = 0; y < shot.h; y++) {
    for (let x = 0; x < shot.w; x++) {
      if (!isInk(shot.data, (y * shot.w + x) * 4)) continue;
      ink++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return ink ? { x0, y0, x1, y1, ink } : null;
}
/** Run the page through the service's own render path (pdf.js + <canvas>) and count ink. */
async function pdfJsInk(pdfPath: string, standardFontDataUrl?: string): Promise<number> {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(readFileSync(pdfPath)), ...(standardFontDataUrl ? { standardFontDataUrl } : {}) }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;   // getContext before sizing, exactly as the service does
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  await page.render({ canvasContext: ctx, viewport }).promise;
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let ink = 0;
  for (let i = 0; i < d.length; i += 4) if (isInk(d, i)) ink++;
  await doc.destroy();
  return ink;
}

function quadrantInk(shot: Shot, rect?: [number, number, number, number]): number[] {
  const [x0, y0, x1, y1] = rect ?? [0, 0, shot.w, shot.h];
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  return [
    inkPixels(shot, [x0, y0, mx, my]), inkPixels(shot, [mx, y0, x1, my]),
    inkPixels(shot, [x0, my, mx, y1]), inkPixels(shot, [mx, my, x1, y1]),
  ];
}
/** Count pixels that differ materially between two equally sized renders. */
function pixelDiff(a: Shot, b: Shot): { differing: number; sameSize: boolean } {
  if (a.w !== b.w || a.h !== b.h) return { differing: -1, sameSize: false };
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const la = (a.data[i] + a.data[i + 1] + a.data[i + 2]) / 3;
    const lb = (b.data[i] + b.data[i + 1] + b.data[i + 2]) / 3;
    if (Math.abs(la - lb) > 30) n++;
  }
  return { differing: n, sameSize: true };
}

// ---------------------------------------------------------------- pdf-lib re-read
async function structAsync(pdfPath: string) {
  const out = { loads: false, loadError: '', acroForm: false, annotSubtypes: [] as string[], rotations: [] as number[], pages: 0 };
  try {
    const doc = await PDFDocument.load(new Uint8Array(readFileSync(pdfPath)), { ignoreEncryption: true });
    const entry = (doc.catalog as any).get(PDFName.of('AcroForm'));
    out.loads = true;
    out.acroForm = entry != null && String(entry) !== 'null';
    out.pages = doc.getPageCount();
    out.rotations = doc.getPages().map(p => p.getRotation().angle);
    out.annotSubtypes = doc.getPages().flatMap(p => {
      const arr = p.node.Annots();
      if (!arr) return [];
      return Array.from({ length: arr.size() }, (_, i) => {
        const d: any = doc.context.lookup(arr.get(i));
        if (!d) return 'DANGLING_REF';
        return String(d.get?.(PDFName.of('Subtype')) ?? 'UNKNOWN');
      });
    });
  } catch (e: any) {
    out.loadError = flat(String(e.message ?? e)).slice(0, 200);
  }
  return out;
}

// ---------------------------------------------------------------- fixture builders
async function fileFrom(p: string): Promise<File> {
  return new File([new Uint8Array(readFileSync(p))], path.basename(p), { type: 'application/pdf' });
}
const asFile = (bytes: Uint8Array, name: string) => new File([bytes], name, { type: 'application/pdf' });
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
async function emit(tool: string, name: string, blob: Blob): Promise<string> {
  const out = path.join(EVIDENCE, `${tool}-${name}.pdf`);
  writeFileSync(out, Buffer.from(await bytesOf(blob)));
  return out;
}
const emitFile = (tool: string, name: string, file: File) => emit(tool, name, file as unknown as Blob);

const TOK = (tag: string, i: number) => `PRISM${tag}${i}`;
async function labeledDoc(
  tag: string,
  count: number,
  opts: { size?: [number, number]; marginText?: boolean; blankPages?: number[]; dotPages?: number[]; rotation?: Record<number, number> } = {},
): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const [w, h] = opts.size ?? [300, 400];
  for (let i = 1; i <= count; i++) {
    const page = doc.addPage([w, h]);
    if (opts.blankPages?.includes(i)) continue;
    if (opts.dotPages?.includes(i)) { page.drawRectangle({ x: 150, y: 200, width: 1, height: 1, color: rgb(0, 0, 0) }); continue; }
    page.drawText(TOK(tag, i), { x: 40, y: h - 50, size: 20, font });
    page.drawText(`BODY${tag}${i}`, { x: 120, y: h / 2, size: 14, font });
    if (opts.marginText) {
      page.drawText(`EDGE${tag}${i}`, { x: 3, y: h - 14, size: 9, font });
      page.drawText(`FOOTEDG${tag}${i}`, { x: 3, y: 4, size: 9, font });
    }
    if (opts.rotation?.[i]) page.setRotation(degrees(opts.rotation[i]));
  }
  return asFile(await doc.save(), `labeled-${tag}.pdf`);
}

/** Hand-built AcroForm: terminal field dict + child widget annotation with an /AP appearance. */
async function formDoc(variant: 'plain' | 'sig-first' | 'no-appearance' | 'with-freetext'): Promise<File> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('STATIC-BASE-TEXT', { x: 50, y: 700, size: 14, font });
  const ctx = doc.context;
  const mkAppearance = (txt: string) => ctx.register(ctx.flateStream(`BT /F1 12 Tf 4 6 Td (${txt}) Tj ET`, {
    Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [0, 0, 240, 20], Resources: { Font: { F1: (font as any).ref } },
  }));
  const fieldRefs: any[] = [];
  const addText = (name: string, value: string, y: number) => {
    const ap = variant === 'no-appearance' ? null : mkAppearance(`APPEARANCE-${value}`);
    const widget = ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'Widget', Rect: [50, y, 290, y + 20], P: page.ref, ...(ap ? { AP: { N: ap } } : {}),
    }));
    const field = ctx.register(ctx.obj({ FT: 'Tx', T: PDFString.of(name), V: PDFString.of(value), Kids: [widget] }));
    (ctx.lookup(widget) as any).set(PDFName.of('Parent'), field);
    page.node.addAnnot(widget);
    fieldRefs.push(field);
  };
  addText('q1', 'ALPHAVALUE', 600);
  if (variant === 'sig-first') {
    const sig = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: [50, 650, 290, 690], T: PDFString.of('Sig1'), P: page.ref }));
    page.node.addAnnot(sig);
    fieldRefs.unshift(sig);
  }
  if (variant === 'with-freetext') {
    const ft = ctx.register(ctx.obj({
      Type: 'Annot', Subtype: 'FreeText', Rect: [50, 500, 290, 540], Contents: PDFString.of('FREETEXT-ANNOTATION'),
      DS: PDFString.of('Helvetica 12 Tf'), DA: PDFString.of('/F1 12 Tf 0 g'), P: page.ref,
    }));
    page.node.addAnnot(ft);
  }
  const acroForm = ctx.register(ctx.obj({ Fields: fieldRefs, DA: PDFString.of('/F1 12 Tf 0 g') }));
  doc.catalog.set(PDFName.of('AcroForm'), acroForm);
  return asFile(await doc.save(), `form-${variant}.pdf`);
}

/** White JPEG with a centred black square of `side`² device pixels (1 px == 1 pt when drawn 1:1). */
function inkJpeg(w: number, h: number, side: number, quality = 92): Uint8Array {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  if (side > 0) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(Math.floor(w / 2), Math.floor(h / 2), side, side);
  }
  return new Uint8Array(c.toBuffer('image/jpeg', quality));
}

/** Pages that hold a real photograph (noise) plus selectable text — for the compress raster path. */
async function photoTextDoc(tag: string, count: number): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= count; i++) {
    const page = doc.addPage([595, 842]);
    const noise = createCanvas(760, 1040);
    const nctx = noise.getContext('2d');
    const img = nctx.createImageData(760, 1040);
    for (let k = 0; k < img.data.length; k += 4) {
      const v = (k * 2654435761 >> 13) & 255;          // deterministic pseudo-random grain
      img.data[k] = v; img.data[k + 1] = v; img.data[k + 2] = v; img.data[k + 3] = 255;
    }
    nctx.putImageData(img, 0, 0);
    const jpg = await doc.embedJpg(new Uint8Array(noise.toBuffer('image/jpeg', 93)));
    page.drawImage(jpg, { x: 0, y: 120, width: 595, height: 722 });
    page.drawText(`${TOK(tag, i)} SELECTABLE-TEXT`, { x: 40, y: 40, size: 16, font });
  }
  return asFile(await doc.save(), `photo-text-${tag}.pdf`);
}

/** Pages of distinct size, each carrying a known amount of real image ink (blank = 0). */
async function inkAreaDoc(specs: { w: number; h: number; side: number }[]): Promise<File> {
  const doc = await PDFDocument.create();
  for (const s of specs) {
    const page = doc.addPage([s.w, s.h]);
    const jpg = await doc.embedJpg(inkJpeg(s.w, s.h, s.side));
    page.drawImage(jpg, { x: 0, y: 0, width: s.w, height: s.h });
  }
  return asFile(await doc.save(), 'ink-area.pdf');
}

/** Damage a good PDF. 'tail' cuts mid-object so both pdf-lib and poppler refuse. */
async function damage(file: File, kind: 'tail' | 'header'): Promise<File> {
  const text = Buffer.from(await bytesOf(file)).toString('latin1');
  if (kind === 'tail') return asFile(Buffer.from(text.slice(0, Math.floor(text.length * 0.8)), 'latin1'), `damaged-${kind}.pdf`);
  return asFile(Buffer.from(text.replace('%PDF-1.', '%PDDF-1.').replace(/startxref\n\d+/, 'startxref\n9999999'), 'latin1'), `damaged-${kind}.pdf`);
}

// ================================================================ THE AUDIT
describe('measurement harness', () => {
  /** Serve pdf.js's bundled standard-font data over HTTP so the option can be tested for real. */
  let fontServer: any = null;
  let fontUrl = '';
  beforeAll(async () => {
    const http = await import('node:http');
    const dir = path.join(ROOT, 'node_modules/pdfjs-dist/standard_fonts');
    fontServer = http.createServer((req: any, res: any) => {
      const name = String(req.url ?? '/').split('/').pop() ?? '';
      if (!/^[A-Za-z0-9._-]+\.ttf$/.test(name)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'font/ttf' });
      res.end(readFileSync(path.join(dir, name)));
    });
    await new Promise<void>(r => fontServer.listen(0, '127.0.0.1', r));
    fontUrl = `http://127.0.0.1:${fontServer.address().port}/standard_fonts/`;
  });
  afterAll(() => { if (fontServer) fontServer.close(); });

  it('pdf.js ink fidelity for a non-embedded (base-14) text page, with standardFontDataUrl attribution attempt', async () => {
    const p = await emitFile('harness', 'text-page', await labeledDoc('C', 1, { size: [612, 792] }));
    const poppler = inkPixels(await renderShot(p, 1, 'harness-poppler'));
    const without = await pdfJsInk(p);
    const withFonts = await pdfJsInk(p, fontUrl);
    record('harness', 'textAttribution', { popplerPng: poppler, pdfJsWithoutOption: without, pdfJsWithServedFontData: withFonts, fontUrl });
    expect(poppler).toBeGreaterThan(0);
    expect(without).toBe(0);
    if (withFonts > 0) {
      defect('remove-blank-pages + compress (shared render path)', 'Automatically scan and eliminate empty or white pages / reduce file size by optimizing embedded images.',
        `the ink sampler these tools judge pages by is pdf.js canvas output, and no call site passes standardFontDataUrl (services/pdfService.ts:287, 1087, 1333 …; services/pdfjsClient.ts:8-9 sets only workerSrc). The same page yields ${without} ink px without the option and ${withFonts} px with the bundled font data served over HTTP, so a page whose text is not embedded (Helvetica/Times from pdf-lib, reportlab, etc.) reads as blank to removeBlankPages and is painted text-less by compressPdf`, 'high');
    } else {
      record('harness', 'attributionInconclusive', `pdf.js logged "Ensure that the standardFontDataUrl API parameter is provided" and skipped every glyph (${without} ink px vs poppler's ${poppler}); supplying the served font data changed nothing in this harness (${withFonts} px), so text-only pages cannot be graded here — every blank-page measurement below therefore uses real embedded images, and the browser behaviour stays for the UI auditor`);
    }
  }, 240_000);

  it('image content renders faithfully through pdf.js in this harness (so the blank-page results below are valid)', async () => {
    const p = await emitFile('harness', 'image-page', await inkAreaDoc([{ w: 300, h: 400, side: 40 }]));
    const poppler = inkPixels(await renderShot(p, 1, 'harness-image-poppler'));
    const jsInk = await pdfJsInk(p);
    record('harness', 'imageFidelity', { popplerPng: poppler, pdfJsCanvas: jsInk });
    expect(poppler).toBeGreaterThan(500);
    expect(jsInk).toBeGreaterThan(poppler * 0.5);
  }, 240_000);
});

describe('merge — "Combine multiple PDFs into one document."', () => {
  it('concatenates both sources in the chosen order (poppler per-page text)', async () => {
    const out = await emit('merge', 'order', await mergePdfs([await labeledDoc('A', 3), await labeledDoc('B', 2)]));
    const info = pdfInfo(out);
    const heads = [1, 2, 3, 4, 5].map(n => flat(pageText(out, n)).split(' ')[0]);
    record('merge', 'pageOrder', heads);
    expect(info.pages).toBe(5);
    expect(heads).toEqual([TOK('A', 1), TOK('A', 2), TOK('A', 3), TOK('B', 1), TOK('B', 2)]);
    expect([1, 2, 3, 4, 5].map(n => pageText(out, n).includes('BODY')).every(Boolean)).toBe(true);
  }, 180_000);

  it('mergePages option selects inside each file', async () => {
    const out = await emit('merge', 'selection', await mergePdfs([await labeledDoc('C', 4), await labeledDoc('D', 4)], '2-3'));
    const heads = [1, 2, 3, 4].map(n => flat(pageText(out, n)).split(' ')[0]);
    record('merge', 'selection', heads);
    expect(heads).toEqual([TOK('C', 2), TOK('C', 3), TOK('D', 2), TOK('D', 3)]);
  }, 180_000);

  it('merges the unencrypted digital statement and keeps both documents readable', async () => {
    const out = await emit('merge', 'digital', await mergePdfs([await fileFrom(FIXTURES.digital2), await labeledDoc('E', 1)]));
    const info = pdfInfo(out);
    record('merge', 'digital', { pages: info.pages, page1: flat(pageText(out, 1)).slice(0, 50), page3: flat(pageText(out, 3)).slice(0, 30) });
    expect(info.pages).toBe(3);
    expect(flat(pageText(out, 1)).length).toBeGreaterThan(40);
    expect(pageText(out, 3)).toContain(TOK('E', 1));
  }, 240_000);
});

describe('split — "Extract pages into separate files."', () => {
  it('default split produces exactly N single-page files in order', async () => {
    const parts = await splitPdf(await labeledDoc('S', 4));
    const paths: string[] = [];
    for (const p of parts) paths.push(await emit('split', p.label.replace(/\.pdf$/, ''), p.blob));
    const per = paths.map(p => ({ pages: pdfInfo(p).pages, head: flat(pageText(p, 1)).split(' ')[0] }));
    record('split', 'default', { labels: parts.map(p => p.label), per });
    expect(per.length).toBe(4);
    per.forEach((x, i) => { expect(x.pages).toBe(1); expect(x.head).toBe(TOK('S', i + 1)); });
    expect(new Set(parts.map(p => p.label)).size).toBe(4);
  }, 240_000);

  it('range string produces one file per range with the right pages', async () => {
    const parts = await splitPdf(await labeledDoc('R', 6), '1-2,4-6');
    const paths: string[] = [];
    for (const p of parts) paths.push(await emit('split', `range-${p.label.replace(/\.pdf$/, '')}`, p.blob));
    const per = paths.map(p => ({ pages: pdfInfo(p).pages, text: docText(p) }));
    record('split', 'ranges', per.map(x => ({ pages: x.pages, head: flat(x.text).split(' ')[0] })));
    expect(per.map(p => p.pages)).toEqual([2, 3]);
    expect(per[0].text).toContain(TOK('R', 2));
    expect(per[0].text).not.toContain(TOK('R', 3));
    expect(per[1].text).toContain(TOK('R', 6));
  }, 240_000);

  it('splits the unencrypted digital statement into readable single pages', async () => {
    const parts = await splitPdf(await fileFrom(FIXTURES.digital16));
    const paths: string[] = [];
    for (const p of parts) paths.push(await emit('split', `digital-${p.label.replace(/\.pdf$/, '')}`, p.blob));
    const chars = paths.map(p => flat(pageText(p, 1)).length);
    record('split', 'digital16', { files: paths.length, charsPerPage: chars });
    expect(paths.length).toBe(16);
    expect(chars.every(c => c > 40)).toBe(true);
  }, 300_000);

  it('a junk token in the range string is refused, not widened to the whole document', async () => {
    // A3: split used the lenient set parser, so "2,oops" returned a second entry containing ALL
    // pages. Strict parsing turns that into an error the user can act on.
    await expect(splitPdf(await labeledDoc('J', 4), '2,oops')).rejects.toThrow(/"oops" is not a valid page or range/i);
    record('split', 'junkToken', 'refused (A3 fixed): parsePageSelectionExact is strict — no fallback to "all"');

    const parts = await splitPdf(await labeledDoc('J', 4), '2, 4');
    const per = [];
    for (const p of parts) per.push({ label: p.label, pages: pdfInfo(await emit('split', `valid-${p.label.replace(/\.pdf$/, '')}`, p.blob)).pages });
    record('split', 'validGroups', per);
    expect(per.map(x => x.pages)).toEqual([1, 1]);
  }, 240_000);
});

describe('compress — "Reduce file size by optimizing embedded images while preserving page dimensions."', () => {
  it('opt-in rasterize: image-only scan gets smaller with pages, dimensions and ink intact', async () => {
    const before = pdfInfo(FIXTURES.scanned);
    const beforeSize = readFileSync(FIXTURES.scanned).byteLength;
    // The scan stores raw Flate samples, not JPEGs, so the default path has nothing to re-encode.
    // Rebuilding the page as one picture is the only lever here — and it costs nothing, because the
    // page has no text layer to lose. That is why it is offered, and why it is not the default.
    const out = await emit('compress', 'scanned', await compressPdf(await fileFrom(FIXTURES.scanned), 0.60, () => {}, undefined, 'rasterize'));
    const after = pdfInfo(out);
    const afterSize = readFileSync(out).byteLength;
    const shot = await renderShot(out, 1, 'compress-scanned-out');
    record('compress', 'scanned', {
      beforeSize, afterSize, reductionPct: Math.round((1 - afterSize / beforeSize) * 1000) / 10,
      mode: 'rasterize', pagesBefore: before.pages, pagesAfter: after.pages,
      dimsBefore: before.perPage.map(p => `${p.w}x${p.h}`), dimsAfter: after.perPage.map(p => `${p.w}x${p.h}`),
      inkPixelsPage1: inkPixels(shot),
    });
    expect(after.pages).toBe(before.pages);
    expect(after.perPage.map(p => `${p.w}x${p.h}`)).toEqual(before.perPage.map(p => `${p.w}x${p.h}`));
    expect(afterSize).toBeLessThan(beforeSize);
    expect(inkPixels(shot)).toBeGreaterThan(1000);
  }, 600_000);

  it('the default path never enlarges a file and never touches a scan that has no JPEG in it', async () => {
    const beforeSize = readFileSync(FIXTURES.scanned).byteLength;
    const out = await emit('compress', 'scanned-default', await compressPdf(await fileFrom(FIXTURES.scanned), 0.60, () => {}));
    const afterSize = readFileSync(out).byteLength;
    const info = pdfInfo(out);
    record('compress', 'scannedDefault', { beforeSize, afterSize, pages: info.pages, mode: 'images' });
    expect(afterSize).toBeLessThanOrEqual(beforeSize);
    expect(info.pages).toBe(2);
  }, 600_000);

  it('extreme preset also preserves page count and dimensions', async () => {
    const before = pdfInfo(FIXTURES.scanned);
    const out = await emit('compress', 'extreme', await compressPdf(await fileFrom(FIXTURES.scanned), 0.40, () => {}, undefined, 'rasterize'));
    const after = pdfInfo(out);
    record('compress', 'extreme', { afterSize: readFileSync(out).byteLength, beforeSize: readFileSync(FIXTURES.scanned).byteLength, pages: after.pages, dims: after.perPage.map(p => `${p.w}x${p.h}`) });
    expect(after.pages).toBe(before.pages);
    expect(after.perPage.every(p => p.w === before.perPage[0].w && p.h === before.perPage[0].h)).toBe(true);
  }, 600_000);

  it('digital text statement: every page keeps its text, its count and its dimensions', async () => {
    const before = pdfInfo(FIXTURES.digital16);
    const beforeSize = readFileSync(FIXTURES.digital16).byteLength;
    const out = await emit('compress', 'digital16', await compressPdf(await fileFrom(FIXTURES.digital16), 0.60, () => {}));
    const after = pdfInfo(out);
    const afterSize = readFileSync(out).byteLength;
    const textPages = (pdf: string, n: number) => Array.from({ length: n }, (_, i) => flat(pageText(pdf, i + 1)).length).filter(l => l > 0).length;
    const beforeText = textPages(FIXTURES.digital16, before.pages);
    const afterText = textPages(out, after.pages);
    record('compress', 'digital16', {
      beforeSize, afterSize, reductionPct: Math.round((1 - afterSize / beforeSize) * 1000) / 10,
      mode: 'images', pagesBefore: before.pages, pagesAfter: after.pages,
      dimsPreserved: JSON.stringify(after.perPage.map(p => `${p.w}x${p.h}`)) === JSON.stringify(before.perPage.map(p => `${p.w}x${p.h}`)),
      pagesWithTextBefore: beforeText, pagesWithTextAfter: afterText,
    });
    expect(after.pages).toBe(before.pages);
    expect(after.perPage.map(p => `${p.w}x${p.h}`)).toEqual(before.perPage.map(p => `${p.w}x${p.h}`));
    expect(afterText).toBe(beforeText);
    expect(afterSize).toBeLessThanOrEqual(beforeSize);
  }, 900_000);

  it('a page mixing a photograph with selectable text keeps its text layer at the default', async () => {
    const mixed = await photoTextDoc('P', 4);
    const srcPath = await emitFile('compress', 'src-photo', mixed);
    const before = pdfInfo(srcPath);
    const beforeSize = readFileSync(srcPath).byteLength;
    const out = await emit('compress', 'photo-text', await compressPdf(mixed, 0.60, () => {}));
    const after = pdfInfo(out);
    const afterSize = readFileSync(out).byteLength;
    const beforeText = flat(docText(srcPath));
    const afterText = flat(docText(out));
    record('compress', 'photoText', {
      beforeSize, afterSize, reductionPct: Math.round((1 - afterSize / beforeSize) * 1000) / 10,
      mode: 'images', pagesBefore: before.pages, pagesAfter: after.pages,
      dimsAfter: after.perPage.map(p => `${p.w}x${p.h}`),
      textCharsBefore: beforeText.length, textCharsAfter: afterText.length,
      outInkPage1: inkPixels(await renderShot(out, 1, 'compress-photo-out')),
    });
    expect(after.pages).toBe(before.pages);
    expect(after.perPage.map(p => `${p.w}x${p.h}`)).toEqual(before.perPage.map(p => `${p.w}x${p.h}`));
    // The defect this replaces: the page came back 78% smaller with its text characters reduced to
    // none, because the whole page was re-drawn as a JPEG rather than only its embedded images.
    expect(afterText.length).toBeGreaterThan(0);
    expect(afterText).toBe(beforeText);
    expect(afterSize).toBeLessThanOrEqual(beforeSize);
  }, 900_000);

  it('rasterize mode is the one that trades the text layer for size, and says so in its own output', async () => {
    const mixed = await photoTextDoc('R', 4);
    const srcPath = await emitFile('compress', 'src-photo-raster', mixed);
    const beforeText = flat(docText(srcPath)).length;
    const out = await emit('compress', 'photo-text-raster', await compressPdf(mixed, 0.60, () => {}, undefined, 'rasterize'));
    const afterText = flat(docText(out)).length;
    record('compress', 'photoTextRaster', { beforeText, afterText, pages: pdfInfo(out).pages });
    expect(beforeText).toBeGreaterThan(0);
    // Correct behaviour for the named opt-in — text is gone, which is exactly why it is not the default.
    expect(afterText).toBe(0);
  }, 900_000);
});

describe('rotate — "Fix orientation for all pages — choose 90°, 180°, or 270°."', () => {
  it('90° sets /Rotate on every page and swaps the rendered sheet geometry', async () => {
    const f = await labeledDoc('O', 2);
    const srcPath = await emitFile('rotate', 'src', f);
    const out = await emit('rotate', 'deg90', await rotatePdf(f, 90));
    const info = pdfInfo(out);
    const shot = await renderShot(out, 1, 'rotate-deg90');
    const shotBefore = await renderShot(srcPath, 1, 'rotate-src');
    const s = await structAsync(out);
    record('rotate', 'deg90', {
      rotPdfjs: s.rotations, rotPoppler: info.perPage.map(p => p.rot),
      sheetBefore: `${shotBefore.w}x${shotBefore.h}`, sheetAfter: `${shot.w}x${shot.h}`,
      textKept: pageText(out, 1).includes(TOK('O', 1)),
    });
    expect(info.perPage.map(p => p.rot)).toEqual([90, 90]);
    expect(s.rotations).toEqual([90, 90]);
    expect([shotBefore.w, shotBefore.h]).toEqual([300, 400]);
    expect([shot.w, shot.h]).toEqual([400, 300]);
    expect(pageText(out, 1)).toContain(TOK('O', 1));
  }, 240_000);

  it('180° flips the page upside-down (measured by ink position)', async () => {
    const f = await labeledDoc('U', 1);
    const srcPath = await emitFile('rotate', 'src180', f);
    const out = await emit('rotate', 'deg180', await rotatePdf(f, 180));
    const before = inkBBox(await renderShot(srcPath, 1, 'rotate-180-src'))!;
    const after = inkBBox(await renderShot(out, 1, 'rotate-180-out'))!;
    record('rotate', 'deg180', { rot: pdfInfo(out).perPage[0].rot, inkTopBefore: before.y0, inkTopAfter: after.y0, sheetH: 400 });
    expect(pdfInfo(out).perPage[0].rot).toBe(180);
    expect(after.y0 - before.y0).toBeGreaterThan(120);   // content moved towards the bottom
  }, 240_000);

  it('a 270° page + 90° turn is written as /Rotate 360, which the PDF spec forbids', async () => {
    const f = await labeledDoc('W', 1, { rotation: { 1: 270 } });
    const srcPath = await emitFile('rotate', 'src270', f);
    const out = await emit('rotate', 'accumulated', await rotatePdf(f, 90));
    const s = await structAsync(out);
    record('rotate', 'accumulated', { srcRot: pdfInfo(srcPath).perPage[0].rot, outRotPdfLib: s.rotations, outRotPoppler: pdfInfo(out).perPage[0].rot });
    expect(s.rotations).toEqual([360]);
    defect('rotate', 'Fix orientation for all pages — choose 90°, 180°, or 270°.',
      `rotatePdf adds the angle to the existing /Rotate without reducing modulo 360 (services/pdfService.ts:168-169), so a page already at 270° is written as /Rotate 360 — an out-of-range value; poppler reports it back as ${pdfInfo(out).perPage[0].rot}`, 'low');
  }, 180_000);
});

describe('auto-rotate — "Smart auto-detection to standardize mixed landscape and portrait pages into uniform layout."', () => {
  async function mixed(): Promise<File> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([300, 400]).drawText(TOK('M', 1), { x: 40, y: 350, size: 20, font });
    doc.addPage([400, 300]).drawText(TOK('M', 2), { x: 40, y: 250, size: 20, font });
    doc.addPage([300, 400]).drawText(TOK('M', 3), { x: 40, y: 350, size: 20, font });
    return asFile(await doc.save(), 'mixed.pdf');
  }

  it('landscape page is rotated to portrait, the document renders uniformly and stays readable', async () => {
    const out = await emit('auto-rotate', 'once', await autoRotatePdf(await mixed()));
    const info = pdfInfo(out);
    const shots = await Promise.all([1, 2, 3].map(n => renderShot(out, n, 'auto-rotate-once')));
    record('auto-rotate', 'once', {
      outRot: info.perPage.map(p => p.rot), sheets: shots.map(s => `${s.w}x${s.h}`),
      textKept: [1, 2, 3].map(n => pageText(out, n).includes(TOK('M', n))), readable: info.readable,
    });
    expect(info.pages).toBe(3);
    expect(info.perPage.map(p => p.rot)).toEqual([0, 90, 0]);
    expect(shots[0].w).toBe(shots[1].w);
    expect(shots[0].h).toBe(shots[1].h);
    expect(info.readable).toBe(true);
  }, 300_000);

  it('running auto-rotate a second time un-rotates the page it just fixed', async () => {
    const once = await autoRotatePdf(await mixed());
    const twice = await autoRotatePdf(await pdfjsAsFile(once, 'auto-once.pdf'));
    const out = await emit('auto-rotate', 'twice', twice);
    const s1 = await renderShot(await emit('auto-rotate', 'once2', once), 2, 'auto-twice-first');
    const s2 = await renderShot(out, 2, 'auto-twice-second');
    record('auto-rotate', 'idempotency', { firstPass: `${s1.w}x${s1.h}`, secondPass: `${s2.w}x${s2.h}`, rot: pdfInfo(out).perPage[1].rot });
    expect([s1.w, s1.h]).toEqual([300, 400]);
    expect([s2.w, s2.h]).toEqual([400, 300]);
    defect('auto-rotate', 'Smart auto-detection to standardize mixed landscape and portrait pages into uniform layout.',
      `the decision uses page.getSize() (the MediaBox) and ignores the existing /Rotate (services/pdfService.ts:2045-2048), so the tool is not idempotent: two passes put the landscape page back to landscape (${s1.w}x${s1.h} → ${s2.w}x${s2.h})`, 'medium');
  }, 300_000);
});
async function pdfjsAsFile(blob: Blob, name: string): Promise<File> {
  return new File([await bytesOf(blob)], name, { type: 'application/pdf' });
}

describe('delete-pages — "Remove unwanted pages or page ranges from your PDF document."', () => {
  it('"2,2" removes exactly page 2; every survivor appears once, in order', async () => {
    const out = await emit('delete-pages', 'dup', await deletePages(await labeledDoc('K', 4), '2,2'));
    const heads = [1, 2, 3].map(n => flat(pageText(out, n)).split(' ')[0]);
    record('delete-pages', 'dup', { pages: pdfInfo(out).pages, heads });
    expect(pdfInfo(out).pages).toBe(3);
    expect(heads).toEqual([TOK('K', 1), TOK('K', 3), TOK('K', 4)]);
  }, 180_000);

  it('deleting every page refuses instead of emitting an empty document', async () => {
    await expect(deletePages(await labeledDoc('L', 3), '1-3')).rejects.toThrow(/delete all pages/i);
  }, 60_000);

  it('removing a range from the real digital statement keeps the remaining pages text-perfect', async () => {
    const src = await fileFrom(FIXTURES.digital16);
    const srcPath = await emitFile('delete-pages', 'src-digital', src);
    const out = await emit('delete-pages', 'digital', await deletePages(src, '1,16'));
    const info = pdfInfo(out);
    const kept = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((orig, i) => ({
      out: flat(pageText(out, i + 1)), srcPage: flat(pageText(srcPath, orig + 1)),
    }));
    const mismatches = kept.filter(k => k.out !== k.srcPage).length;
    record('delete-pages', 'digital', { pages: info.pages, mismatchedPages: mismatches, firstPageChars: kept[0].out.length });
    expect(info.pages).toBe(14);
    expect(mismatches).toBe(0);
  }, 300_000);

  it('an out-of-range page list silently returns the whole document', async () => {
    const out = await emit('delete-pages', 'out-of-range', await deletePages(await labeledDoc('G', 4), '99'));
    record('delete-pages', 'outOfRange', pdfInfo(out).pages);
    expect(pdfInfo(out).pages).toBe(4);
    defect('delete-pages', 'Remove unwanted pages or page ranges from your PDF document.',
      'deletePages("99") on a 4-page document returns all 4 pages with no error (non-strict parsePageRange at services/pdfService.ts:830-835 drops out-of-range tokens; shared/pdf/pageSelection.ts:100-105)', 'low');
  }, 120_000);
});

describe('extract-pages — "Extract specific pages or page ranges into a dedicated new PDF."', () => {
  it('"2-3" of a 4-page document yields exactly those two pages', async () => {
    const out = await emit('extract-pages', 'range', await extractPages(await labeledDoc('X', 4), '2-3'));
    const heads = [1, 2].map(n => flat(pageText(out, n)).split(' ')[0]);
    record('extract-pages', 'range', heads);
    expect(pdfInfo(out).pages).toBe(2);
    expect(heads).toEqual([TOK('X', 2), TOK('X', 3)]);
  }, 120_000);

  it('garbage selection throws instead of returning the whole document', async () => {
    await expect(extractPages(await labeledDoc('Y', 3), 'oops')).rejects.toThrow(/No valid pages/);
  }, 60_000);

  it('extracts page 7 of the real digital statement byte-perfect', async () => {
    const srcPath = await emitFile('extract-pages', 'src-digital', await fileFrom(FIXTURES.digital16));
    const out = await emit('extract-pages', 'digital', await extractPages(await fileFrom(FIXTURES.digital16), '7'));
    const info = pdfInfo(out);
    const baseline = flat(pageText(srcPath, 7));
    const got = flat(pageText(out, 1));
    record('extract-pages', 'digital', { pages: info.pages, chars: got.length, matchesSource: got === baseline, dims: `${info.perPage[0].w}x${info.perPage[0].h}` });
    expect(info.pages).toBe(1);
    expect(got).toBe(baseline);
  }, 300_000);
});

describe('reorder-pages — "Rearrange and reorganize page sequence across your PDF document."', () => {
  it('"3,1,2" reorders verbatim and keeps every page exactly once', async () => {
    const out = await emit('reorder-pages', 'full', await reorderPages(await labeledDoc('P', 3), '3,1,2'));
    const heads = [1, 2, 3].map(n => flat(pageText(out, n)).split(' ')[0]);
    record('reorder-pages', 'full', heads);
    expect(heads).toEqual([TOK('P', 3), TOK('P', 1), TOK('P', 2)]);
  }, 180_000);

  it('"1,1,1" is rejected rather than duplicating page 1', async () => {
    await expect(reorderPages(await labeledDoc('Q', 3), '1,1,1')).rejects.toThrow(/more than once|Invalid page order/i);
  }, 60_000);

  it('a partial order is refused and names the missing pages', async () => {
    // A2: reorder used a set parser, so "3,1" quietly deleted pages 2 and 4. Reorder is a
    // permutation now; subsets are what Extract pages exists for.
    await expect(reorderPages(await labeledDoc('T', 4), '3,1')).rejects.toThrow(/pages 2, 4 are missing/i);
    record('reorder-pages', 'subset-refused', 'refused (A2 fixed): reorder requires every page exactly once');

    const out = await emit('reorder-pages', 'reverse-range', await reorderPages(await labeledDoc('T', 4), '4-1'));
    const heads = [1, 2, 3, 4].map(n => flat(pageText(out, n)).split(' ')[0]);
    record('reorder-pages', 'reverseRange', { pages: pdfInfo(out).pages, heads });
    expect(pdfInfo(out).pages).toBe(4);
    expect(heads).toEqual([TOK('T', 4), TOK('T', 3), TOK('T', 2), TOK('T', 1)]);
  }, 180_000);
});

describe('page-numbers — "Insert dynamic page numbers with customizable format and positioning."', () => {
  it('default format paints "Page n of N" on-sheet in the bottom band', async () => {
    const out = await emit('page-numbers', 'default', await addPageNumbers(await labeledDoc('Z', 3)));
    const per = [1, 2, 3].map(n => ({ n, text: flat(pageText(out, n)), geo: pageWords(out, n) }));
    record('page-numbers', 'default', per.map(p => ({ text: p.text, box: `${p.geo.width}x${p.geo.height}` })));
    expect(pdfInfo(out).pages).toBe(3);
    expect(per[0].text).toContain('Page 1 of 3');
    expect(per[2].text).toContain('Page 3 of 3');
    const geo = per[1].geo;
    const numWords = geo.words.filter(w => ['Page', '2', 'of', '3'].includes(w.text));
    expect(numWords.length).toBe(4);
    expect(numWords.every(w => w.yMin > geo.height - 60)).toBe(true);
    expect(numWords.every(w => w.xMin >= 0 && w.xMax <= geo.width)).toBe(true);
  }, 300_000);

  it('pixels prove the number is painted, not only present in the text stream', async () => {
    const srcPath = await emitFile('page-numbers', 'plain-src', await labeledDoc('Z', 3));
    const out = await emit('page-numbers', 'pixels', await addPageNumbers(await labeledDoc('Z', 3)));
    const s0 = await renderShot(srcPath, 1, 'page-numbers-before');
    const s1 = await renderShot(out, 1, 'page-numbers-after');
    const bandBefore = inkPixels(s0, [0, 340, 300, 400]);
    const bandAfter = inkPixels(s1, [0, 340, 300, 400]);
    record('page-numbers', 'pixels', { totalBefore: inkPixels(s0), totalAfter: inkPixels(s1), bandBefore, bandAfter });
    expect(bandAfter).toBeGreaterThan(bandBefore);
    expect(inkPixels(s1)).toBeGreaterThan(inkPixels(s0));
  }, 300_000);

  it('positions top-left / bottom-right place the ink in the claimed corner', async () => {
    const tl = await emit('page-numbers', 'top-left', await addPageNumbers(await labeledDoc('V', 1), { position: 'top-left', format: '{page} of {total}' }));
    const br = await emit('page-numbers', 'bottom-right', await addPageNumbers(await labeledDoc('V', 1), { position: 'bottom-right', format: '{page} of {total}' }));
    const tlW = pageWords(tl, 1).words.filter(w => ['1', 'of', '2'].includes(w.text));
    const brW = pageWords(br, 1).words.filter(w => ['1', 'of', '2'].includes(w.text));
    record('page-numbers', 'positions', {
      topLeft: tlW.map(w => [Math.round(w.xMin), Math.round(w.yMin)]),
      bottomRight: brW.map(w => [Math.round(w.xMin), Math.round(w.yMin)]),
    });
    expect(tlW.length).toBe(3);
    expect(tlW.every(w => w.yMax < 70 && w.xMin < 60)).toBe(true);
    expect(brW.every(w => w.yMin > 330 && w.xMax > 240)).toBe(true);
  }, 300_000);

  it('every format the app UI offers stamps a real number, never the token', async () => {
    // A1: all four of these used to fall through to the literal-token branch and paint the
    // placeholder word itself on every page. Kept as a contract proof, not a defect record.
    const painted: Record<string, string> = {};
    for (const fmt of ['page_n_of_m', 'page_n', 'n_of_m', 'n'] as const) {
      const out = await emit('page-numbers', `fmt-${fmt}`, await addPageNumbers(await labeledDoc('F', 2), { format: fmt }));
      painted[fmt] = flat(pageText(out, 1));
    }
    record('page-numbers', 'uiFormats', painted);
    expect(painted['page_n_of_m']).toContain('Page 1 of 2');
    expect(painted['page_n']).toContain('Page 1');
    expect(painted['n_of_m']).toContain('1 of 2');
    expect(painted['n']).toContain('1');
    for (const text of Object.values(painted)) {
      expect(text).not.toMatch(/page_n|n_of_m|\bn\b_/);
    }
  }, 300_000);

  it('an unknown format is refused rather than painted on the page', async () => {
    await expect(addPageNumbers(await labeledDoc('F', 2), { format: 'whatever' })).rejects.toThrow(/Unknown page-number format/);
    record('page-numbers', 'unknownFormat', 'refused with the accepted list (services/pdfService.ts renderPageNumber)');
  }, 60_000);

  it('startNum shifts the counter while {total} keeps the document length', async () => {
    const out = await emit('page-numbers', 'start5', await addPageNumbers(await labeledDoc('H', 2), { startNum: 5 }));
    const texts = [1, 2].map(n => flat(pageText(out, n)));
    record('page-numbers', 'start5', texts);
    expect(texts[0]).toContain('Page 5 of 2');
    expect(texts[1]).toContain('Page 6 of 2');
  }, 180_000);

  it('numbers on a /Rotate 90 page stay on the sheet but not at the displayed bottom', async () => {
    const out = await emit('page-numbers', 'rotated', await addPageNumbers(await labeledDoc('J', 1, { rotation: { 1: 90 } }), { position: 'bottom-center', format: '{page}' }));
    const geo = pageWords(out, 1);
    const shot = await renderShot(out, 1, 'page-numbers-rotated');
    const num = geo.words.find(w => w.text === '1')!;
    record('page-numbers', 'rotated', { sheet: `${shot.w}x${shot.h}`, numberWord: [Math.round(num.xMin), Math.round(num.yMin)], box: [geo.width, geo.height] });
    expect(num.xMin).toBeGreaterThanOrEqual(0);
    expect(num.yMin).toBeGreaterThanOrEqual(0);
    expect(num.xMax).toBeLessThanOrEqual(shot.w);
  }, 300_000);
});

describe('remove-blank-pages — "Automatically scan and eliminate empty or white pages from documents."', () => {
  /**
   * Ground truth for these measurements comes from real embedded photographs, not glyph
   * runs: `measurement harness` above shows pdf.js paints no text ink inside jsdom (no
   * standard-font data is configured for `pdfjsLib.getDocument`), so a text-only fixture
   * would read as "blank" for harness reasons rather than product ones. Image content is
   * rendered faithfully, so each page below is measured twice: once with poppler (truth)
   * and once through the service's own pixel scan (verdict).
   */
  it('deletes the truly blank page, keeps a page with real content', async () => {
    const f = await inkAreaDoc([{ w: 300, h: 400, side: 40 }, { w: 310, h: 400, side: 0 }, { w: 330, h: 400, side: 16 }]);
    const srcPath = await emitFile('remove-blank-pages', 'src', f);
    const out = await emit('remove-blank-pages', 'kept', await removeBlankPages(await inkAreaDoc([{ w: 300, h: 400, side: 40 }, { w: 310, h: 400, side: 0 }, { w: 330, h: 400, side: 16 }])));
    const truth = await Promise.all([1, 2, 3].map(async n => ({ n, size: `${(await renderShot(srcPath, n, 'remove-blank-src')).w}x${(await renderShot(srcPath, n, 'remove-blank-src2')).h}`, ink: inkPixels(await renderShot(srcPath, n, 'remove-blank-src3')) })));
    const survivors = pdfInfo(out).perPage.map(p => `${p.w}x${p.h}`);
    record('remove-blank-pages', 'blank', { truth, survivors, pagesBefore: pdfInfo(srcPath).pages, pagesAfter: pdfInfo(out).pages });
    expect(pdfInfo(srcPath).pages).toBe(3);
    expect(survivors).toEqual(['300x400', '330x400']);
    expect(truth[1].ink).toBe(0);
  }, 400_000);

  it('a real scanned statement (no blank pages) is left untouched', async () => {
    const srcPath = await emitFile('remove-blank-pages', 'src-scan', await fileFrom(FIXTURES.scanned));
    const out = await emit('remove-blank-pages', 'scan', await removeBlankPages(await fileFrom(FIXTURES.scanned)));
    const info = pdfInfo(out);
    record('remove-blank-pages', 'scan', { before: pdfInfo(srcPath).pages, after: info.pages, inkPage1: inkPixels(await renderShot(out, 1, 'remove-blank-scan')) });
    expect(info.pages).toBe(2);
  }, 400_000);

  it('keeps a page holding a 2×2 mark, and drops it only when density is explicitly asked for', async () => {
    const specs = [{ w: 320, h: 400, side: 2 }, { w: 300, h: 400, side: 40 }];
    const srcPath = await emitFile('remove-blank-pages', 'src-dot', await inkAreaDoc(specs));
    const truth2 = inkPixels(await renderShot(srcPath, 1, 'remove-blank-dot-truth'));
    expect(pdfInfo(srcPath).perPage[0]).toMatchObject({ w: 320, h: 400 });
    expect(truth2).toBeGreaterThan(0);                       // poppler sees real content on that page

    const out = await emit('remove-blank-pages', 'dot', await removeBlankPages(await inkAreaDoc(specs)));
    const survivors = pdfInfo(out).perPage.map(p => `${p.w}x${p.h}`);
    record('remove-blank-pages', 'sparseContent', { truthPage1Ink: truth2, pagesBefore: 2, pagesAfter: pdfInfo(out).pages, survivors });
    expect(survivors).toEqual(['320x400', '300x400']);       // neither page is empty, so neither is dropped

    // The aggressive behaviour is still available — it is just a choice the caller makes, not a
    // default that deletes content the user never agreed to lose.
    const dense = await emit('remove-blank-pages', 'dot-density', await removeBlankPages(await inkAreaDoc(specs), 0.001));
    record('remove-blank-pages', 'sparseContentDense', { survivors: pdfInfo(dense).perPage.map(p => `${p.w}x${p.h}`) });
    expect(pdfInfo(dense).perPage.map(p => `${p.w}x${p.h}`)).toEqual(['300x400']);
  }, 400_000);

  it('an all-blank document still yields one page', async () => {
    const out = await emit('remove-blank-pages', 'all-blank', await removeBlankPages(await inkAreaDoc([{ w: 300, h: 400, side: 0 }, { w: 310, h: 400, side: 0 }])));
    record('remove-blank-pages', 'allBlank', { pages: pdfInfo(out).pages, size: pdfInfo(out).perPage.map(p => `${p.w}x${p.h}`) });
    expect(pdfInfo(out).pages).toBe(1);
    expect(pdfInfo(out).perPage[0].w).toBe(300);
  }, 300_000);
});

describe('n-up — "Combine multiple pages (2-in-1, 4-in-1, 9-in-1) onto single physical sheets."', () => {
  it('2-up places two source pages on one A4 sheet in separate cells', async () => {
    const out = await emit('n-up', 'two', await nUpPageLayout(await labeledDoc('2', 3), 2));
    const info = pdfInfo(out);
    const geo = pageWords(out, 1);
    record('n-up', 'two', { sheets: info.pages, sheetSize: `${info.perPage[0].w}x${info.perPage[0].h}`, sheet1: flat(pageText(out, 1)), sheet2: flat(pageText(out, 2)) });
    expect(info.pages).toBe(2);
    expect(info.perPage[0].w).toBeCloseTo(595.28, 1);
    expect(info.perPage[0].h).toBeCloseTo(841.89, 1);
    expect(pageText(out, 1)).toContain(TOK('2', 1));
    expect(pageText(out, 1)).toContain(TOK('2', 2));
    expect(pageText(out, 2)).toContain(TOK('2', 3));
    const y1 = geo.words.find(w => w.text.includes(TOK('2', 1)))!;
    const y2 = geo.words.find(w => w.text.includes(TOK('2', 2)))!;
    expect(y2.yMin - y1.yMin).toBeGreaterThan(300);
    expect([y1.xMin, y2.xMin].every(x => x >= 0 && x <= geo.width)).toBe(true);
  }, 300_000);

  it('4-up really puts four pages in four quadrants of one sheet (geometry + pixels)', async () => {
    const out = await emit('n-up', 'four', await nUpPageLayout(await labeledDoc('4', 4), 4));
    const info = pdfInfo(out);
    const geo = pageWords(out, 1);
    const shot = await renderShot(out, 1, 'n-up-four');
    const cells = [1, 2, 3, 4].map(i => {
      const w = geo.words.find(x => x.text.includes(TOK('4', i)))!;
      return { i, x: Math.round(w.xMin), y: Math.round(w.yMin), quadrant: `${w.yMin < geo.height / 2 ? 't' : 'b'}${w.xMin < geo.width / 2 ? 'l' : 'r'}` };
    });
    record('n-up', 'four', { sheets: info.pages, cells, quadrantInk: quadrantInk(shot) });
    expect(info.pages).toBe(1);
    expect(new Set(cells.map(c => c.quadrant)).size).toBe(4);
    expect(quadrantInk(shot).every(v => v > 50)).toBe(true);
  }, 300_000);

  it('9-up packs nine source pages onto one sheet', async () => {
    const out = await emit('n-up', 'nine', await nUpPageLayout(await labeledDoc('9', 9), 9));
    const info = pdfInfo(out);
    const all = pageText(out, 1);
    record('n-up', 'nine', { sheets: info.pages, present: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => all.includes(TOK('9', i))) });
    expect(info.pages).toBe(1);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].every(i => all.includes(TOK('9', i)))).toBe(true);
  }, 300_000);

  it('2-up of the real 16-page digital statement yields 8 A4 sheets that still carry the text', async () => {
    const srcPath = await emitFile('n-up', 'src-digital', await fileFrom(FIXTURES.digital16));
    const srcWord = flat(pageText(srcPath, 3)).split(' ').slice(0, 3).join(' ');
    const out = await emit('n-up', 'digital2up', await nUpPageLayout(await fileFrom(FIXTURES.digital16), 2));
    const info = pdfInfo(out);
    const chars = [1, 2, 3, 4, 5, 6, 7, 8].map(n => flat(pageText(out, n)).length);
    record('n-up', 'digital', { sheets: info.pages, sheetSize: `${info.perPage[0].w}x${info.perPage[0].h}`, charsPerSheet: chars, carriesSourceWords: flat(pageText(out, 2)).includes(srcWord) });
    expect(info.pages).toBe(8);
    expect(chars.every(c => c > 100)).toBe(true);
  }, 480_000);
});

describe('header-footer — "Stamp custom headers, footers, page counts, and dates onto every page."', () => {
  it('header and footer appear in the top/bottom bands with token replacement', async () => {
    const out = await emit('header-footer', 'basic', await addHeaderFooter(await labeledDoc('H', 3), {
      header: 'HDRPRISM {page}/{total}', footer: 'FTRPRISM {date}',
    }));
    const per = [1, 2, 3].map(n => {
      const geo = pageWords(out, n);
      const hdr = geo.words.find(w => w.text === 'HDRPRISM');
      const ftr = geo.words.find(w => w.text === 'FTRPRISM');
      return { n, text: flat(pageText(out, n)), hdrY: hdr && Math.round(hdr.yMin), ftrY: ftr && Math.round(ftr.yMin), height: geo.height };
    });
    record('header-footer', 'bands', per);
    expect(per.map(p => p.text)).toEqual([
      expect.stringContaining('HDRPRISM 1/3'), expect.stringContaining('HDRPRISM 2/3'), expect.stringContaining('HDRPRISM 3/3'),
    ]);
    expect(per.every(p => /FTRPRISM \d{4}-\d{2}-\d{2}/.test(p.text))).toBe(true);
    expect(per.every(p => p.hdrY! < 60)).toBe(true);
    expect(per.every(p => p.ftrY! > p.height - 60)).toBe(true);
  }, 300_000);

  it('rendered pixels confirm the stamp is painted on the sheet', async () => {
    const srcPath = await emitFile('header-footer', 'src', await labeledDoc('H', 2));
    const out = await emit('header-footer', 'pixels', await addHeaderFooter(await labeledDoc('H', 2), { header: 'HDRPIXELS', footer: 'FTRPIXELS' }));
    const s0 = await renderShot(srcPath, 1, 'header-footer-src');
    const s1 = await renderShot(out, 1, 'header-footer-pixels');
    record('header-footer', 'pixels', {
      topBefore: inkPixels(s0, [0, 0, s0.w, 60]), topAfter: inkPixels(s1, [0, 0, s1.w, 60]),
      bottomBefore: inkPixels(s0, [0, s0.h - 60, s0.w, s0.h]), bottomAfter: inkPixels(s1, [0, s1.h - 60, s1.w, s1.h]),
    });
    expect(inkPixels(s1, [0, 0, s1.w, 60])).toBeGreaterThan(inkPixels(s0, [0, 0, s0.w, 60]));
    expect(inkPixels(s1, [0, s1.h - 60, s1.w, s1.h])).toBeGreaterThan(inkPixels(s0, [0, s0.h - 60, s0.w, s0.h]));
  }, 300_000);

  it('stamps the real digital statement without losing its own text', async () => {
    const srcPath = await emitFile('header-footer', 'src-digital', await fileFrom(FIXTURES.digital16));
    const out = await emit('header-footer', 'digital', await addHeaderFooter(await fileFrom(FIXTURES.digital16), { footer: 'CONFIDENTIAL — page {page} of {total}' }));
    const info = pdfInfo(out);
    const srcChars = flat(pageText(srcPath, 1)).length;
    const outChars = flat(pageText(out, 1)).length;
    record('header-footer', 'digital', { pages: info.pages, srcChars, outChars, footerAdded: pageText(out, 1).includes('CONFIDENTIAL') });
    expect(info.pages).toBe(16);
    expect(pageText(out, 1)).toContain('CONFIDENTIAL');
    expect(outChars).toBeGreaterThan(srcChars);
  }, 300_000);
});

describe('crop-resize — "Trim margins or resize pages to standard sizes (A4, Letter, Legal, etc.)."', () => {
  it('margin trim changes MediaBox and CropBox by exactly the requested millimetres', async () => {
    const f = await labeledDoc('C', 1, { marginText: true });
    const srcPath = await emitFile('crop-resize', 'src', f);
    const out = await emit('crop-resize', 'trim10mm', await cropResizePdf(f, { cropMarginMm: 10 }));
    const before = pdfInfo(srcPath).perPage[0];
    const after = pdfInfo(out).perPage[0];
    const inset = 10 * 2.83465;
    record('crop-resize', 'trim', { beforeMedia: before.media, afterMedia: after.media, afterCrop: after.crop, widthBefore: before.w, widthAfter: after.w, expectedInset: inset });
    expect(after.w).toBeCloseTo(before.w - 2 * inset, 1);
    expect(after.h).toBeCloseTo(before.h - 2 * inset, 1);
    expect(after.crop[0]).toBeCloseTo(inset, 1);
    expect(after.crop[2]).toBeCloseTo(before.w - inset, 1);
  }, 240_000);

  it('trimmed content really disappears from the sheet', async () => {
    const f = await labeledDoc('C', 1, { marginText: true });
    const srcPath = await emitFile('crop-resize', 'src-edge', f);
    const out = await emit('crop-resize', 'trim30mm', await cropResizePdf(f, { cropMarginMm: 30 }));
    const before = docText(srcPath);
    const after = docText(out);
    record('crop-resize', 'edgeContent', { beforeHasEdge: before.includes('EDGE'), afterHasEdge: after.includes('EDGE'), afterHasBody: after.includes('BODY'), dims: `${pdfInfo(out).perPage[0].w}x${pdfInfo(out).perPage[0].h}` });
    expect(before).toContain('EDGE');
    expect(after).not.toContain('EDGE');
    expect(after).toContain('BODY');
  }, 240_000);

  it('target size scales the artwork, and nothing that was visible is deleted', async () => {
    const f = await labeledDoc('Z', 1, { size: [600, 800], marginText: true });
    const srcPath = await emitFile('crop-resize', 'src600', f);
    const outA4 = await emit('crop-resize', 'toA4', await cropResizePdf(f, { targetSize: 'A4' }));
    const outA5 = await emit('crop-resize', 'toA5', await cropResizePdf(await labeledDoc('Z', 1, { size: [600, 800], marginText: true }), { targetSize: 'A5' }));
    const before = inkBBox(await renderShot(srcPath, 1, 'crop-resize-src'))!;
    const afterA4 = inkBBox(await renderShot(outA4, 1, 'crop-resize-a4'))!;
    const afterA5 = inkBBox(await renderShot(outA5, 1, 'crop-resize-a5'))!;
    const srcText = flat(docText(srcPath));
    const a5Text = flat(docText(outA5));
    record('crop-resize', 'resize', {
      a4dims: `${pdfInfo(outA4).perPage[0].w}x${pdfInfo(outA4).perPage[0].h}`,
      a5dims: `${pdfInfo(outA5).perPage[0].w}x${pdfInfo(outA5).perPage[0].h}`,
      inkBefore: before, inkAfterA4: afterA4, inkAfterA5: afterA5, srcText, a5Text,
    });

    expect(pdfInfo(outA4).perPage[0].w).toBeCloseTo(595.28, 1);
    expect(pdfInfo(outA5).perPage[0].w).toBeCloseTo(419.53, 1);

    // 600x800 -> A5 is 419.53/600 = 0.6992 by width, the binding axis. The ink must follow the box.
    const wOf = (b: { x0: number; x1: number }) => b.x1 - b.x0;
    const expectW = wOf(before) * (419.53 / 600);
    expect(Math.abs(wOf(afterA5) - expectW)).toBeLessThan(expectW * 0.06);
    expect(wOf(afterA5)).toBeLessThan(wOf(before));
    expect(wOf(afterA4)).toBeCloseTo(wOf(before) * (595.28 / 600), 0);

    // The defect this replaces: shrinking to A5 silently deleted the top-of-page text.
    expect(a5Text).toContain('PRISMZ1');
    expect(a5Text).toContain('BODY');
    const srcTokens = new Set(srcText.split(/\s+/).filter(Boolean));
    const lostTokens = [...srcTokens].filter((t) => !a5Text.includes(t));
    expect(lostTokens, `tokens lost by shrinking to A5: ${lostTokens.join(', ')}`).toEqual([]);
  }, 400_000);

  it('fit, fill and clip are three different choices, and the user makes it', async () => {
    const f = () => labeledDoc('Q', 1, { size: [600, 800], marginText: true });
    const fit = await emit('crop-resize', 'mode-fit', await cropResizePdf(await f(), { targetSize: 'A5', resizeMode: 'fit' }));
    const clip = await emit('crop-resize', 'mode-clip', await cropResizePdf(await f(), { targetSize: 'A5', resizeMode: 'clip' }));
    const fitText = flat(docText(fit));
    const clipText = flat(docText(clip));
    record('crop-resize', 'modes', {
      fitDims: `${pdfInfo(fit).perPage[0].w}x${pdfInfo(fit).perPage[0].h}`,
      clipDims: `${pdfInfo(clip).perPage[0].w}x${pdfInfo(clip).perPage[0].h}`,
      fitChars: fitText.length, clipChars: clipText.length,
      fitKeepsTop: fitText.includes('PRISMQ1'), clipKeepsTop: clipText.includes('PRISMQ1'),
    });
    expect(fitText.includes('PRISMQ1')).toBe(true);    // everything is drawn, scaled into the sheet
    expect(clipText.includes('PRISMQ1')).toBe(false);  // 'clip' is the old behaviour, now chosen by name
  }, 400_000);

  it('Letter target on the A4 statement produces exactly 612×792 for all 16 pages', async () => {
    const out = await emit('crop-resize', 'letter-from-a4', await cropResizePdf(await fileFrom(FIXTURES.digital16), { targetSize: 'LETTER' }));
    const info = pdfInfo(out);
    record('crop-resize', 'letter', { pages: info.pages, dims: [...new Set(info.perPage.map(p => `${p.w}x${p.h}`))] });
    expect(info.pages).toBe(16);
    expect([...new Set(info.perPage.map(p => `${p.w}x${p.h}`))]).toEqual(['612x792']);
  }, 300_000);
});

describe('stamp — "Stamp bold rubber badges (APPROVED, CONFIDENTIAL, RECEIVED, FINAL) with dates."', () => {
  it('badge text + date are painted in the upper-right corner in the chosen colour', async () => {
    const out = await emit('stamp', 'approved', await stampPdf(await labeledDoc('S', 2), 'APPROVED', { color: 'red', dateStamp: true }));
    const today = new Date().toISOString().split('T')[0];
    const shot = await renderShot(out, 1, 'stamp-approved');
    const red = inkPixels(shot, undefined, (r, g, b) => r - g > 40 && r - b > 40);
    const badge = markFragments(out, 1, 'APPROVED');
    const dateWords = pageWords(out, 1).words.filter(w => /\d{4}-/.test(w.text) || /-\d{2}/.test(w.text)).map(w => w.text).join('');
    const badge2 = markFragments(out, 2, 'APPROVED');
    record('stamp', 'approved', { joinedPage1: badge.joined, joinedPage2: badge2.joined, dateJoined: dateWords, redPixels: red, badgeBox: badge.frags.map(f => [Math.round(f.xMin), Math.round(f.yMin)]) });
    expect(badge.joined).toBe('APPROVED');
    expect(badge2.joined).toBe('APPROVED');
    expect(dateWords).toContain(today);
    expect(red).toBeGreaterThan(100);
    expect(Math.min(...badge.frags.map(f => f.xMin))).toBeGreaterThan(100);   // right-hand side
    expect(Math.max(...badge.frags.map(f => f.yMax))).toBeLessThan(140);      // upper band
  }, 300_000);

  it('green / blue badge colours really change the painted ink', async () => {
    const green = await emit('stamp', 'green', await stampPdf(await labeledDoc('S', 1), 'RECEIVED', { color: 'green' }));
    const blue = await emit('stamp', 'blue', await stampPdf(await labeledDoc('S', 1), 'FINAL', { color: 'blue' }));
    const g = inkPixels(await renderShot(green, 1, 'stamp-green'), undefined, (r, gr, b) => gr - r > 20 && gr - b > 20);
    const b = inkPixels(await renderShot(blue, 1, 'stamp-blue'), undefined, (r, gr, bl) => bl - r > 20 && bl - gr > 20);
    record('stamp', 'colors', { greenPixels: g, bluePixels: b, greenMark: markFragments(green, 1, 'RECEIVED').joined, blueMark: markFragments(blue, 1, 'FINAL').joined });
    expect(g).toBeGreaterThan(50);
    expect(b).toBeGreaterThan(50);
    expect(markFragments(green, 1, 'RECEIVED').joined).toBe('RECEIVED');
    expect(markFragments(blue, 1, 'FINAL').joined).toBe('FINAL');
  }, 300_000);

  it('the badge never renders off-sheet on a Letter page', async () => {
    const out = await emit('stamp', 'letter', await stampPdf(await labeledDoc('S', 1, { size: [612, 792] }), 'CONFIDENTIAL', { color: 'red', dateStamp: true }));
    const shot = await renderShot(out, 1, 'stamp-letter');
    const box = inkBBox(shot)!;
    const badge = markFragments(out, 1, 'CONFIDENTIAL');
    record('stamp', 'letterInk', { sheet: `${shot.w}x${shot.h}`, inkBox: box, joined: badge.joined, offSheet: badge.offSheet, rightEdge: Math.max(...badge.frags.map(f => f.xMax)) });
    expect(badge.joined).toBe('CONFIDENTIAL');
    expect(badge.offSheet).toBe(0);
    expect(box.x1).toBeLessThan(shot.w);
    expect(box.y1).toBeLessThan(shot.h);
  }, 300_000);

  it('dateStamp:false omits the date', async () => {
    const out = await emit('stamp', 'no-date', await stampPdf(await labeledDoc('S', 1), 'FINAL', { color: 'blue', dateStamp: false }));
    const today = new Date().toISOString().split('T')[0];
    const text = flat(pageText(out, 1));
    record('stamp', 'noDate', { text, containsDate: text.includes(today), mark: markFragments(out, 1, 'FINAL').joined });
    expect(markFragments(out, 1, 'FINAL').joined).toBe('FINAL');
    expect(text.includes(today)).toBe(false);
  }, 240_000);
});

describe('watermark — "Stamp images or repeating text patterns across pages."', () => {
  it('tiled mode repeats the mark across the sheet and leaves the page content readable', async () => {
    const out = await emit('watermark', 'tiled', await watermarkPdf(await labeledDoc('W', 2), 'CONFIDENTIAL', { mode: 'tiled' }));
    const tiles = markFragments(out, 1, 'CONFIDENTIAL');
    const singleRef = markFragments(await emit('watermark', 'tiled-single-ref', await watermarkPdf(await labeledDoc('W', 1), 'CONFIDENTIAL', { mode: 'single' })), 1, 'CONFIDENTIAL');
    const shot = await renderShot(out, 1, 'watermark-tiled');
    const texts = [1, 2].map(n => pageText(out, n));
    record('watermark', 'tiled', { fragmentWords: tiles.frags.length, singleFragmentWords: singleRef.frags.length, alphabetCovered: [...new Set(tiles.joined)].sort().join(''), bodyReadable: [texts[0].includes(TOK('W', 1)), texts[1].includes(TOK('W', 2))], ink: inkPixels(shot), quadrants: quadrantInk(shot) });
    expect(tiles.frags.length).toBeGreaterThanOrEqual(8);   // the mark is painted many times
    expect(tiles.frags.length).toBeGreaterThan(singleRef.frags.length * 2);
    expect([...new Set(tiles.joined)].sort().join('')).toBe([...new Set('CONFIDENTIAL')].sort().join(''));
    expect(texts[0]).toContain(TOK('W', 1));
    expect(texts[1]).toContain(TOK('W', 2));
    expect(quadrantInk(shot).every(v => v > 100)).toBe(true);
  }, 300_000);

  it('single mode paints one instance, far less ink than the tile field', async () => {
    const single = await emit('watermark', 'single', await watermarkPdf(await labeledDoc('W', 1), 'SOLOMARK', { mode: 'single' }));
    const tiled = await emit('watermark', 'single-tiled-compare', await watermarkPdf(await labeledDoc('W', 1), 'SOLOMARK', { mode: 'tiled' }));
    const sShot = await renderShot(single, 1, 'watermark-single');
    const tShot = await renderShot(tiled, 1, 'watermark-single-tiled');
    const geo = pageWords(single, 1);
    const sMark = markFragments(single, 1, 'SOLOMARK');
    const tMark = markFragments(tiled, 1, 'SOLOMARK');
    record('watermark', 'single', {
      singleInk: inkPixels(sShot), tiledInk: inkPixels(tShot), singleFragments: sMark.frags.length,
      tiledFragments: tMark.frags.length, singleQuadrants: quadrantInk(sShot), sheet: `${geo.width}x${geo.height}`,
    });
    expect(sMark.frags.length * 2).toBeLessThan(tMark.frags.length);   // one instance vs a repeated field
    expect([...new Set(sMark.joined)].sort().join('')).toBe([...new Set('SOLOMARK')].sort().join(''));
  }, 300_000);

  it('on a blank sheet the tile field covers all four quadrants but also paints off-sheet', async () => {
    const out = await emit('watermark', 'blank-sheet', await watermarkPdf(await labeledDoc('Q', 1, { blankPages: [1] }), 'SPAM', { mode: 'tiled' }));
    const marks = markFragments(out, 1, 'SPAM');
    const shot = await renderShot(out, 1, 'watermark-blank');
    const quads = quadrantInk(shot);
    record('watermark', 'coverage', { drawn: marks.frags.length, offSheet: marks.offSheet, quadrantInk: quads, joined: marks.joined });
    expect(quads.every(v => v > 0)).toBe(true);
    expect(marks.frags.length).toBeGreaterThan(8);
    expect(marks.offSheet).toBeGreaterThan(0);
    defect('watermark', 'Stamp images or repeating text patterns across pages.',
      `the tiled loop paints from -width/2 to +1.5·width (services/pdfService.ts:221-235), so ${marks.offSheet} of ${marks.frags.length} extracted mark fragments sit outside the sheet on a 300×400 page: the four quadrants do get covered (ink ${quads.join('/')}), but part of every tile runs off the edge`, 'low');
  }, 300_000);

  it('the service has no image-watermark path at all', async () => {
    const out = await emit('watermark', 'image-opt-ignored', await watermarkPdf(await labeledDoc('W', 1), 'TEXTONLY', { mode: 'tiled' } as any));
    const raw = readFileSync(out).toString('latin1');
    record('watermark', 'arity', { arity: watermarkPdf.length, imageObjectsInOutput: countOccurrences(raw, '/Image') });
    expect(countOccurrences(raw, '/Image')).toBe(0);
    defect('watermark', 'Stamp images or repeating text patterns across pages.',
      `watermarkPdf(file, text, { mode, opacity }) (services/pdfService.ts:204-270) takes no image argument and the registry handler passes only text + mode (src/registry/toolRegistry.ts:477-481); the produced file contains ${countOccurrences(raw, '/Image')} image XObjects, so the "stamp images" half of the promise is not implemented`, 'medium');
  }, 240_000);
});

describe('metadata-edit — "Modify or completely sanitize PDF metadata (author, title, producer, etc.)."', () => {
  it('sets Title/Author/Subject/Creator/Producer to exactly what the caller asked for', async () => {
    const out = await emit('metadata-edit', 'set', await editMetadata(await labeledDoc('M', 1), {
      title: 'AUDIT TITLE', author: 'AUDIT AUTHOR', subject: 'AUDIT SUBJECT', creator: 'AUDIT CREATOR', producer: 'AUDIT PRODUCER',
    }));
    const info = pdfInfo(out);
    record('metadata-edit', 'set', { title: info.fields['Title'], author: info.fields['Author'], subject: info.fields['Subject'], creator: info.fields['Creator'], producer: info.fields['Producer'] });
    expect(info.fields['Title']).toBe('AUDIT TITLE');
    expect(info.fields['Author']).toBe('AUDIT AUTHOR');
    expect(info.fields['Subject']).toBe('AUDIT SUBJECT');
    expect(info.fields['Creator']).toBe('AUDIT CREATOR');
    expect(info.fields['Producer']).toBe('AUDIT PRODUCER');
  }, 240_000);

  it('stripAll really removes the old producer/author strings from the file', async () => {
    const before = pdfInfo(FIXTURES.scanned);
    const out = await emit('metadata-edit', 'strip', await editMetadata(await fileFrom(FIXTURES.scanned), { stripAll: true }));
    const info = pdfInfo(out);
    const raw = readFileSync(out).toString('latin1');
    record('metadata-edit', 'strip', {
      before: { title: before.fields['Title'], author: before.fields['Author'], producer: before.fields['Producer'] },
      after: { title: info.fields['Title'], author: info.fields['Author'], producer: info.fields['Producer'] },
      rawStillContainsImagemagick: raw.toLowerCase().includes('imagemagick'),
      pagesPreserved: info.pages, creationDateSurvives: info.fields['CreationDate'],
    });
    expect(raw.toLowerCase().includes('imagemagick')).toBe(false);
    expect(info.pages).toBe(before.pages);
    if (info.fields['CreationDate'] && info.fields['CreationDate'] !== 'no value') {
      defect('metadata-edit', 'Modify or completely sanitize PDF metadata (author, title, producer, etc.).',
        `stripAll clears Title/Author/Subject/Keywords/Producer/Creator only (services/pdfService.ts:1304-1311) — the document still reports CreationDate "${info.fields['CreationDate']}", because setCreationDate/setModDate are never called, so the timestamps of a "sanitized" file survive`, 'low');
    }
  }, 240_000);

  it('editing the real digital statement keeps all 16 pages and their text', async () => {
    const srcChars = flat(pageText(FIXTURES.digital16, 1)).length;
    const out = await emit('metadata-edit', 'digital', await editMetadata(await fileFrom(FIXTURES.digital16), { title: 'REDACTED', author: '' }));
    const info = pdfInfo(out);
    record('metadata-edit', 'digital', { pages: info.pages, title: info.fields['Title'], charsPage1: flat(pageText(out, 1)).length, srcChars });
    expect(info.pages).toBe(16);
    expect(info.fields['Title']).toBe('REDACTED');
    expect(flat(pageText(out, 1)).length).toBe(srcChars);
  }, 300_000);
});

describe('pdf-repair — "Recover corrupted, unreadable, or malformed PDF streams and syntax."', () => {
  it('a file truncated inside an object is refused with a clear error (not silently passed through)', async () => {
    const bad = await damage(await labeledDoc('F', 2), 'tail');
    const inputPath = await emit('pdf-repair', 'input-tail', bad);
    const brokenInfo = pdfInfo(inputPath);
    let pdfLibFailed = false;
    try { await PDFDocument.load(await bytesOf(bad), { ignoreEncryption: true }); } catch { pdfLibFailed = true; }
    let message = '';
    let recovered = false;
    try {
      const out = await emit('pdf-repair', 'tail', await repairPdf(bad));
      recovered = pdfInfo(out).readable;
    } catch (e: any) { message = flat(String(e.message)); }
    record('pdf-repair', 'tail', {
      inputReadableByPoppler: brokenInfo.readable, inputPopplerError: flat(brokenInfo.stderr).slice(0, 90),
      inputPdfLibLoadThrew: pdfLibFailed, repaired: recovered, refusalMessage: message.slice(0, 90),
    });
    expect(brokenInfo.readable).toBe(false);
    expect(pdfLibFailed).toBe(true);
    expect(recovered).toBe(false);
    expect(message).toMatch(/repair failed/i);
    defect('pdf-repair', 'Recover corrupted, unreadable, or malformed PDF streams and syntax.',
      `a statement truncated inside an object (the common "download interrupted" case) cannot be recovered even though every object before the cut is intact: both parsers fail (poppler: "${flat(brokenInfo.stderr).slice(0, 60)}") and repairPdf throws "${message.slice(0, 40)}". Honest refusal, but the promise to recover malformed syntax does not cover it`, 'medium');
  }, 300_000);

  it('a broken header/startxref that pdf-lib refuses is recovered with the pages back', async () => {
    const bad = await damage(await labeledDoc('R', 2), 'header');
    const inputPath = await emit('pdf-repair', 'input-header', bad);
    let pdfLibFailed = false;
    try { await PDFDocument.load(await bytesOf(bad), { ignoreEncryption: true }); } catch { pdfLibFailed = true; }
    const out = await emit('pdf-repair', 'header', await repairPdf(bad));
    const info = pdfInfo(out);
    record('pdf-repair', 'header', { inputReadable: pdfInfo(inputPath).readable, pdfLibLoadThrew: pdfLibFailed, outputReadable: info.readable, pages: info.pages, text: flat(docText(out)).slice(0, 60) });
    expect(pdfLibFailed).toBe(true);
    expect(info.readable).toBe(true);
    expect(info.pages).toBe(2);
  }, 300_000);

  it('recovery of a digital text PDF goes through raster rebuild, so the words are pixels now', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 2; i++) doc.addPage([612, 792]).drawText(`TEXTLAYER-${i}`, { x: 50, y: 700, size: 18, font });
    const bad = await damage(asFile(await doc.save(), 'digital.pdf'), 'tail');
    const out = await emit('pdf-repair', 'digital-tail', await repairPdf(bad));
    const info = pdfInfo(out);
    const text = flat(docText(out));
    const ink = inkPixels(await renderShot(out, 1, 'pdf-repair-digital'));
    record('pdf-repair', 'digitalTextLoss', { pages: info.pages, recoveredText: text.slice(0, 60), renderedInkPixels: ink });
    expect(info.readable).toBe(true);
    expect(ink).toBeGreaterThan(50);
    if (!text.includes('TEXTLAYER-1')) {
      defect('pdf-repair', 'Recover corrupted, unreadable, or malformed PDF streams and syntax.',
        `the raster fallback (services/pdfService.ts:1085-1128) rebuilds pages as JPEGs: the repaired file shows the words (${ink} ink px) but pdftotext returns "${text || '(empty)'}" — searchable/selectable text is not recovered, and the tool reports success`, 'medium');
    }
  }, 300_000);

  it('a non-PDF payload is refused rather than passed through', async () => {
    const junk = new File([new Uint8Array(Buffer.from('this is not a pdf at all'.repeat(20)))], 'junk.pdf', { type: 'application/pdf' });
    await expect(repairPdf(junk)).rejects.toThrow(/repair failed/i);
  }, 120_000);
});

describe('flatten-pdf — "Lock interactive form fields, checkmarks, and annotations into static pages."', () => {
  const FIELD_REGION: [number, number, number, number] = [50, 792 - 620, 290, 792 - 600];

  it('a well-formed filled text field loses its interactivity and keeps its appearance', async () => {
    const f = await formDoc('plain');
    const srcPath = await emitFile('flatten-pdf', 'src-plain', f);
    const out = await emit('flatten-pdf', 'plain', await flattenPdf(f));
    const before = pdfInfo(srcPath);
    const info = pdfInfo(out);
    const raw = readFileSync(out).toString('latin1');
    const beforeInk = inkPixels(await renderShot(srcPath, 1, 'flatten-src-plain'), FIELD_REGION);
    const afterInk = inkPixels(await renderShot(out, 1, 'flatten-out-plain'), FIELD_REGION);
    record('flatten-pdf', 'plain', {
      formBefore: before.form, formAfter: info.form, widgetRefsAfter: countOccurrences(raw, '/Widget'),
      fieldInkBefore: beforeInk, fieldInkAfter: afterInk,
      valueTextBefore: docText(srcPath).includes('APPEARANCE-ALPHAVALUE'),
      valueTextAfter: docText(out).includes('APPEARANCE-ALPHAVALUE'),
      baseTextKept: docText(out).includes('STATIC-BASE-TEXT'), popplerStderr: flat(info.stderr).slice(0, 160),
    });
    expect(before.form).toBe('AcroForm');
    expect(info.form).toBe('none');
    expect(countOccurrences(raw, '/Widget')).toBe(0);
    expect(afterInk).toBeGreaterThan(0);            // the value is still painted
    expect(afterInk).toBe(beforeInk);
    expect(docText(out)).toContain('STATIC-BASE-TEXT');
  }, 400_000);

  it('a form containing an unsigned signature field keeps every filled value', async () => {
    const f = await formDoc('sig-first');
    const srcPath = await emitFile('flatten-pdf', 'src-sig', f);
    const out = await emit('flatten-pdf', 'sig-first', await flattenPdf(f));
    const info = pdfInfo(out);
    const beforeInk = inkPixels(await renderShot(srcPath, 1, 'flatten-src-sig'), FIELD_REGION);
    const afterInk = inkPixels(await renderShot(out, 1, 'flatten-out-sig'), FIELD_REGION);
    record('flatten-pdf', 'sigFirst', {
      formAfter: info.form, fieldInkBefore: beforeInk, fieldInkAfter: afterInk,
      valueVisibleAfter: docText(out).includes('APPEARANCE-ALPHAVALUE'), readable: info.readable,
    });
    expect(info.form).toBe('none');
    expect(beforeInk).toBeGreaterThan(0);
    // The old behaviour: pdf-lib threw on the /Sig widget, the catch swallowed it, the value-baking
    // never ran, and the deletion still did — 782 ink pixels became 0.
    expect(afterInk).toBe(beforeInk);
    expect(docText(out)).toContain('APPEARANCE-ALPHAVALUE');
    expect(docText(out)).toContain('STATIC-BASE-TEXT');
  }, 400_000);

  it('refuses to delete a FreeText note it has no appearance for, rather than losing it silently', async () => {
    const f = await formDoc('with-freetext');
    let error: any = null;
    try { await emit('flatten-pdf', 'with-freetext', await flattenPdf(f)); } catch (e) { error = e; }
    record('flatten-pdf', 'freetextRefusal', {
      thrown: error?.name ?? null, unbaked: error?.unbaked ?? null, message: String(error?.message ?? '').slice(0, 200),
    });
    expect(error).not.toBeNull();
    expect(error.name).toBe('FlattenRefusal');
    expect(error.message).toMatch(/Flatten stopped/);
    expect(String(error.unbaked)).toContain('FreeText');
    // The alternative was the old behaviour: keep it as a live, still-editable annotation object while
    // claiming the page had been locked.
  }, 400_000);

  it('refuses a filled field whose value only exists in /V, because a viewer would render it', async () => {
    const f = await formDoc('no-appearance');
    let error: any = null;
    try { await emit('flatten-pdf', 'no-appearance', await flattenPdf(f)); } catch (e) { error = e; }
    record('flatten-pdf', 'noAppearance', { thrown: error?.name ?? null, unbaked: error?.unbaked ?? null });
    expect(error?.name).toBe('FlattenRefusal');
    // poppler paints nothing for this field, but Acrobat and Chrome generate the appearance at
    // display time — so "no ink in my renderer" is not evidence that deleting it is safe.
    expect(String(error?.unbaked)).toContain('q1');
  }, 400_000);

  it('structural validity: the flattened output must not carry dangling annotation refs', async () => {
    const f = await formDoc('plain');
    const out = await emit('flatten-pdf', 'validity', await flattenPdf(f));
    const info = pdfInfo(out);
    const s = await structAsync(out);
    record('flatten-pdf', 'validity', { stderr: flat(info.stderr).slice(0, 200), annots: s.annotSubtypes, pdfLibLoadError: s.loadError, pages: s.pages });
    record('flatten-pdf', 'damageSignals', { dangling: s.annotSubtypes.includes('DANGLING_REF'), popplerSays: flat(info.stderr).slice(0, 60) || '(no error)', annots: s.annotSubtypes });
    // The old output kept an /Annots entry pointing at a deleted widget object — legal-looking to
    // poppler, rejected by stricter readers.
    expect(s.loads).toBe(true);
    expect(s.loadError).toBe('');
    expect(s.annotSubtypes.includes('DANGLING_REF')).toBe(false);
    expect(s.annotSubtypes).toEqual([]);
    expect(flat(info.stderr)).toBe('');
  }, 400_000);

  it('flattening a document that has no form leaves it intact', async () => {
    const out = await emit('flatten-pdf', 'no-form', await flattenPdf(await labeledDoc('N', 2)));
    const info = pdfInfo(out);
    record('flatten-pdf', 'noForm', { pages: info.pages, heads: [1, 2].map(n => flat(pageText(out, n)).split(' ')[0]) });
    expect(info.pages).toBe(2);
    expect(info.form).toBe('none');
    expect(pageText(out, 1)).toContain(TOK('N', 1));
  }, 300_000);
});

/**
 * Every document in this product's own corpus of bank statements is password-encrypted with
 * an empty user password (SBSA, FNB/Robbie, Test.pdf). `loadPdfResilient` opens them with
 * `ignoreEncryption: true` and re-saves, so page operations must be measured on them too.
 */
describe('encrypted input (the real corpus) — affects merge, split, delete, extract, header/footer, metadata', () => {
  const ENCRYPTED = [FIXTURES.sbsa8, FIXTURES.robbie3];

  it('measured: pdf-lib reports the fixture as encrypted and poppler reads its text', () => {
    for (const f of ENCRYPTED) {
      const info = pdfInfo(f);
      record('encrypted-baseline', path.basename(f), { encrypted: info.encrypted, pages: info.pages, charsPage1: flat(pageText(f, 1)).length });
      expect(info.encrypted.startsWith('yes')).toBe(true);
      expect(flat(pageText(f, 1)).length).toBeGreaterThan(40);
    }
  });

  it('extract-pages refuses an encrypted statement instead of returning a blank page', async () => {
    const src = FIXTURES.sbsa8;
    const charsBefore = flat(pageText(src, 5)).length;
    await expect(extractPages(await fileFrom(src), '5')).rejects.toThrow(/password-protected/);
    // Reading still works (pdf.js and poppler both decrypt a file that opens without a password) --
    // it is rebuilding that must be refused. Pinned so nobody reinstates the silent empty output.
    expect(charsBefore).toBeGreaterThan(40);
    record('encrypted', 'extract-refused', {
      pages: pdfInfo(src).pages, textCharsPage5Readable: charsBefore, rebuild: 'refused',
    });
  }, 400_000);

  it('every content-rebuilding operation refuses encrypted fixtures loudly', async () => {
    const attempts: { name: string; run: () => Promise<unknown> }[] = [
      { name: 'deletePages', run: async () => deletePages(await fileFrom(FIXTURES.robbie3), '1') },
      { name: 'addHeaderFooter', run: async () => addHeaderFooter(await fileFrom(FIXTURES.robbie3), { footer: 'HF {page}' }) },
      { name: 'editMetadata', run: async () => editMetadata(await fileFrom(FIXTURES.robbie3), { title: 'X' }) },
      { name: 'splitPdf', run: async () => splitPdf(await fileFrom(FIXTURES.robbie3)) },
      { name: 'mergePdfs', run: async () => mergePdfs([await fileFrom(FIXTURES.robbie3), await labeledDoc('M', 1)]) },
      { name: 'rotatePdf', run: async () => rotatePdf(await fileFrom(FIXTURES.robbie3), 90) },
      { name: 'repairPdf', run: async () => repairPdf(await fileFrom(FIXTURES.robbie3)) },
    ];
    const refused: Record<string, string> = {};
    for (const a of attempts) {
      await expect(a.run()).rejects.toThrow(/password-protected/);
      try { await a.run(); } catch (e: any) { refused[a.name] = `${e?.name}: ${String(e.message).slice(0, 48)}`; }
    }
    record('encrypted', 'refusals', refused);
    // The plaintext positive control for these same operations is the test below.
  }, 600_000);

  it('positive control: the identical operations on the unencrypted statement keep the text', async () => {
    const src = FIXTURES.digital16;
    const before = flat(pageText(src, 1)).length;
    const del = await emit('encrypted', 'control-delete', await deletePages(await fileFrom(src), '2'));
    const md = await emit('encrypted', 'control-metadata', await editMetadata(await fileFrom(src), { title: 'X' }));
    record('encrypted', 'control', {
      charsBefore: before, afterDelete: flat(pageText(del, 1)).length, afterMetadata: flat(pageText(md, 1)).length,
      pagesAfterDelete: pdfInfo(del).pages,
    });
    expect(pdfInfo(del).pages).toBe(15);
    expect(flat(pageText(del, 1)).length).toBe(before);
    expect(flat(pageText(md, 1)).length).toBe(before);
  }, 400_000);
});

describe('evidence artefacts', () => {
  it('wrote the verified outputs into evidence/features/page-ops/', () => {
    const files = readdirSync(EVIDENCE);
    expect(files.filter(f => f.endsWith('.pdf')).length).toBeGreaterThan(30);
    expect(files.filter(f => f.endsWith('.png')).length).toBeGreaterThan(10);
  });
});
