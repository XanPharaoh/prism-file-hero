/**
 * Feature audit — FORMAT CONVERSION & EXTRACTION family.
 *
 * Adversarial, byte-level verification of seven advertised tools. A service return value, a
 * non-zero `blob.size`, a `.jpg` filename or a success flag is treated as UNPROVEN until the
 * emitted bytes say otherwise. Every assertion below inspects real bytes: JPEG/PNG magic
 * numbers + SOF/EOD markers, decoded pixel dimensions, per-pixel luminance statistics, ZIP
 * directory listings, `word/document.xml` inside the DOCX container, and independent reference
 * renders/measurements from poppler (`pdftoppm`, `pdfinfo`, `pdftotext`, `pdfimages`, `pdffonts`).
 * Verified artefacts are written to evidence/features/conversion/.
 *
 * ── HARNESS CORRECTION (measured; required for anyone trusting the existing green suite) ──
 * tests/setup.ts backs HTMLCanvasElement with @napi-rs/canvas but caches the native surface at
 * the element size seen when getContext() was first called, and its toDataURL() reuses that
 * cached surface. Real browsers resize the drawing buffer in place when .width/.height are
 * assigned AFTER getContext(). convertPdfToImages (services/pdfService.ts:592-601),
 * extractEmbeddedImages (services/pdfService.ts:1790-1798), scannerEffect (:1908-1916) and
 * invertPdfColors (:1986-1994) all get the context first and set the size second, so under the
 * stock setup the entire family emits a 300x150 image regardless of page size — and
 * tests/stressTestAllTools.test.ts:459-472 (which only asserts `bytes.length > 0` per entry)
 * still passes. installBrowserFaithfulCanvas() below restores browser semantics, so the numbers
 * reported here describe the product rather than the shim.
 *
 * ── MEASUREMENT CAVEAT, stated up front ──
 * PDFs are synthesised through Ghostscript so their fonts are EMBEDDED (pdffonts emb=yes).
 * Non-embedded standard-14 text (what pdf-lib's StandardFonts.Helvetica produces, i.e. what this
 * app's own Text-to-PDF / watermark / page-number tools emit) draws NO glyphs under this
 * jsdom harness: services/pdfjsClient.ts never passes `standardFontDataUrl` and the built app in
 * dist/ ships no `standard_fonts/` directory, so pdf.js logs
 * "UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided" and
 * "getPathGenerator - ignoring character". Browser behaviour for that case is UNPROVEN here
 * (no Chromium binary is installed) and is reported as such, not as a measured defect.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PDFDocument, StandardFonts, PDFName, PDFDict, PDFNumber, PDFStream, PDFRawStream } from 'pdf-lib';
import JSZip from 'jszip';
import { loadImage, createCanvas, type Canvas } from '@napi-rs/canvas';
import {
  convertPdfToImages, convertImagesToPdf, extractText, convertPdfToDocx,
  extractEmbeddedImages, scannerEffect, invertPdfColors,
} from '../../services/pdfService';
import { getToolById } from '../../src/registry/toolRegistry';

const ROOT = path.resolve(__dirname, '..', '..');
const EV = path.join(ROOT, 'evidence', 'features', 'conversion');
const FIX = path.join(ROOT, 'tests', 'fixtures');
const STATEMENTS = path.join(FIX, 'statements');

/* ------------------------------------------------------------------ evidence io */
function ev(name: string, data: Buffer | Uint8Array | string): string {
  fs.mkdirSync(EV, { recursive: true });
  const p = path.join(EV, name);
  fs.writeFileSync(p, typeof data === 'string' ? data : Buffer.from(data as any));
  return p;
}
function fileFrom(p: string): File {
  return new File([fs.readFileSync(p)], path.basename(p), { type: p.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream' });
}
const asBuf = (blob: Blob) => blob.arrayBuffer().then((a) => Buffer.from(new Uint8Array(a)));
/** pdf-lib rejects Node Buffers (constructor name check) — every call site goes through this. */
const u8 = (b: Uint8Array | Buffer) => new Uint8Array(b);
const magic = (b: Buffer, hex: string, at = 0) => b.subarray(at, at + hex.length / 2).toString('hex') === hex;
/** claim-vs-measured log; keeps the suite runnable while recording overstated copy. */
function claimCheck(tool: string, rows: Record<string, unknown>[]) {
  ev(`${tool}-claim-check.json`, JSON.stringify({ tool, checkedAt: new Date().toISOString(), rows }, null, 2));
}

/* --------------------------------------------------------- browser-faithful canvas */
// Snapshots of the STOCK tests/setup.ts canvas shim, taken before this file replaces it, so one
// test below can prove the harness artefact described in the header instead of just asserting it.
const STOCK = {
  getContext: HTMLCanvasElement.prototype.getContext,
  toDataURL: (HTMLCanvasElement.prototype as any).toDataURL,
};
function restoreStockCanvas() {
  HTMLCanvasElement.prototype.getContext = STOCK.getContext as any;
  (HTMLCanvasElement.prototype as any).toDataURL = STOCK.toDataURL;
}
function installBrowserFaithfulCanvas() {
  const backings = new WeakMap<any, Canvas>();
  const proto: any = HTMLCanvasElement.prototype;
  const wD = Object.getOwnPropertyDescriptor(proto, 'width')!;
  const hD = Object.getOwnPropertyDescriptor(proto, 'height')!;
  const resize = (el: any) => {
    const b = backings.get(el);
    if (b) { b.width = Math.max(1, Math.round(el.width || 300)); b.height = Math.max(1, Math.round(el.height || 150)); }
  };
  Object.defineProperty(proto, 'width', {
    configurable: true,
    get(this: any) { const v = wD.get!.call(this); return v === 0 ? 300 : v; },
    set(this: any, v: number) { wD.set!.call(this, v); resize(this); },
  });
  Object.defineProperty(proto, 'height', {
    configurable: true,
    get(this: any) { const v = hD.get!.call(this); return v === 0 ? 150 : v; },
    set(this: any, v: number) { hD.set!.call(this, v); resize(this); },
  });
  proto.getContext = function (this: any, id: string) {
    if (id !== '2d') return null;
    let b = backings.get(this);
    if (!b) { b = createCanvas(Math.max(1, this.width), Math.max(1, this.height)); backings.set(this, b); }
    const ctx: any = b.getContext('2d');
    ctx.canvas = this;
    return ctx;
  };
  proto.toDataURL = function (this: any, type?: string, q?: number) {
    const b = backings.get(this) || createCanvas(Math.max(1, this.width), Math.max(1, this.height));
    const mime = type && (type.includes('jpeg') || type.includes('jpg')) ? 'image/jpeg' : 'image/png';
    const quality = typeof q === 'number' ? Math.round(q * 100) : 92;
    return `data:${mime};base64,${b.toBuffer(mime as any, quality).toString('base64')}`;
  };
}

/* ------------------------------------------------------------------ byte probes */
function jpegScan(buf: Buffer) {
  if (!magic(buf, 'ffd8')) return null;
  let off = 2;
  while (off < buf.length - 9) {
    if (buf[off] !== 0xff) { off++; continue; }
    const marker = buf[off + 1];
    const len = buf.readUInt16BE(off + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) {
      return {
        width: buf.readUInt16BE(off + 7), height: buf.readUInt16BE(off + 5),
        precision: buf[off + 4], components: buf[off + 9],
        eoi: magic(buf, 'ffd9', buf.length - 2), density: jpegDensity(buf),
      };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
    off += 2 + len;
  }
  return { width: -1, height: -1, precision: -1, components: -1, eoi: magic(buf, 'ffd9', buf.length - 2), density: null };
}
/**
 * JFIF APP0 density — what the JPEG file itself claims about DPI.
 * Layout from the APP0 marker at offset 2: FF E0 | len(2) | "JFIF\0"(5) | ver(2) |
 * units(1) @13 | Xdensity(2) @14 | Ydensity(2) @16.
 */
function jpegDensity(buf: Buffer) {
  if (!magic(buf, 'ffe0', 2) || buf.subarray(6, 11).toString('latin1') !== 'JFIF\0') return null;
  const units = buf[13], x = buf.readUInt16BE(14), y = buf.readUInt16BE(16);
  return { units, x, y, label: units === 1 ? 'DPI' : units === 2 ? 'DPcm' : 'aspect-ratio only (no DPI recorded)' };
}
function pngScan(buf: Buffer) {
  if (!magic(buf, '89504e470d0a1a0a')) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bitDepth: buf[24], colorType: buf[25],
    iend: buf.subarray(buf.length - 8, buf.length - 4).toString('hex') === '49454e44' };
}

async function decode(buf: Buffer) {
  const img = await loadImage(buf);
  const c = createCanvas(img.width, img.height);
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  return { img, w: img.width, h: img.height, d: x.getImageData(0, 0, img.width, img.height).data };
}
const lum = (d: Uint8Array | Buffer | any, i: number) =>
  d[i + 3] < 250 ? 255 : d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;

/** Decoded-pixel statistics + scale-independent 32x32 luminance fingerprint. */
async function pix(buf: Buffer) {
  const { d, w, h } = await decode(buf);
  const n = w * h;
  let sum = 0, sumSq = 0, dark = 0;
  const hist = new Set<number>();
  for (let i = 0, k = 0; k < n; i += 4, k++) {
    const g = lum(d, i);
    sum += g; sumSq += g * g; if (g < 128) dark++;
    if (k % 3 === 0) hist.add(Math.round(g));
  }
  const mean = sum / n;
  const S = 32, blocks = new Float64Array(S * S);
  for (let by = 0; by < S; by++) {
    for (let bx = 0; bx < S; bx++) {
      let acc = 0, cnt = 0;
      for (let y = Math.floor((by * h) / S); y < Math.min(h, Math.ceil(((by + 1) * h) / S)); y += 2) {
        for (let x = Math.floor((bx * w) / S); x < Math.min(w, Math.ceil(((bx + 1) * w) / S)); x += 2) {
          acc += lum(d, (y * w + x) * 4); cnt++;
        }
      }
      blocks[by * S + bx] = cnt ? acc / cnt : 255;
    }
  }
  return { w, h, mean, darkFrac: dark / n, std: Math.sqrt(Math.max(0, sumSq / n - mean * mean)), levels: hist.size, blocks };
}
const blockMae = (a: Float64Array, b: Float64Array) => {
  let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};
/** Luminance statistics of a normalised crop (used to isolate blank paper vs ink). */
async function cropStats(buf: Buffer, x0: number, y0: number, cw: number, ch: number) {
  const { d, w, h } = await decode(buf);
  const X0 = Math.floor(x0 * w), Y0 = Math.floor(y0 * h), X1 = Math.min(w, X0 + Math.floor(cw * w)), Y1 = Math.min(h, Y0 + Math.floor(ch * h));
  let s = 0, s2 = 0, n = 0; const hist = new Set<number>();
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) { const g = lum(d, (y * w + x) * 4); s += g; s2 += g * g; hist.add(Math.round(g)); n++; }
  const mean = s / Math.max(1, n);
  return { mean, std: Math.sqrt(Math.max(0, s2 / Math.max(1, n) - mean * mean)), levels: hist.size, n };
}
/**
 * Finds the widest pure-white horizontal band in a page render (blank paper), so noise and
 * inversion can be measured on paper rather than on content. Returns normalised coords.
 */
async function blankBand(buf: Buffer, minRows = 30) {
  const { d, w, h } = await decode(buf);
  const rows: number[] = [];
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x += 4) sum += lum(d, (y * w + x) * 4);
    rows.push(sum / Math.ceil(w / 4));
  }
  let best = { from: 0, to: 0 }, run = -1;
  for (let y = 0; y <= h; y++) {
    if (y < h && rows[y] > 250) { if (run < 0) run = y; }
    else { if (run >= 0 && y - run > best.to - best.from) best = { from: run, to: y }; run = -1; }
  }
  if (best.to - best.from < minRows) throw new Error('no blank band found in reference render');
  return { y0: best.from / h, ch: (best.to - best.from) / h, rowMeans: rows.length };
}

/** Ground truth: image XObjects actually stored in the PDF, walked with pdf-lib. */
async function embeddedImageAssets(bytes: Uint8Array) {
  const doc = await PDFDocument.load(u8(bytes), { ignoreEncryption: true });
  const perPage: { page: number; w: number; h: number; filter: string }[] = [];
  const distinct = new Map<string, { w: number; h: number; filter: string }>();
  for (let i = 0; i < doc.getPageCount(); i++) {
    const res = doc.getPage(i).node.lookup(PDFName.of('Resources'));
    if (!(res instanceof PDFDict)) continue;
    const xo = res.lookup(PDFName.of('XObject'));
    if (!(xo instanceof PDFDict)) continue;
    for (const [, ref] of xo.entries()) {
      const obj = doc.context.lookup(ref);
      if (!(obj instanceof PDFStream)) continue;
      if (obj.dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue;
      const rec = {
        w: obj.dict.lookupMaybe(PDFName.of('Width'), PDFNumber)?.numberValue ?? NaN,
        h: obj.dict.lookupMaybe(PDFName.of('Height'), PDFNumber)?.numberValue ?? NaN,
        filter: String(obj.dict.get(PDFName.of('Filter'))),
      };
      perPage.push({ page: i + 1, ...rec });
      distinct.set(String(ref), rec);
    }
  }
  return { perPage, distinct: [...distinct.values()], pages: doc.getPageCount() };
}
/** Independent ground truth from poppler: one row per stored raster. */
function pdfimagesList(pdfPath: string) {
  const txt = execFileSync('pdfimages', ['-list', pdfPath], { encoding: 'utf8' });
  const rows = txt.split('\n').filter((l) => /^\s*\d+\s+\d+\s/.test(l)).map((l) => {
    const c = l.trim().split(/\s+/);
    return { page: +c[0], num: +c[1], type: c[2], width: +c[3], height: +c[4] };
  });
  return { txt, rows };
}

/* ------------------------------------------------------------------ fixtures */
const TOK = (i: number) => `PRISMCONV-${i}`;

/**
 * N-page 400x600pt PDF, unique token per page, fonts EMBEDDED (pdffonts emb=yes) so pdf.js can
 * rasterise the text without any standard-font data. Written with Ghostscript from PostScript.
 */
function gsTextPdf(name: string, pages: number, pageSize: [number, number] = [400, 600]): { file: File; bytes: Buffer; p: string } {
  const ps = ['%!PS-Adobe-3.0\n', `<< /PageSize [${pageSize[0]} ${pageSize[1]}] >> setpagedevice\n`];
  for (let i = 1; i <= pages; i++) {
    ps.push('/Times-Roman findfont 22 scalefont setfont\n');
    ps.push(`30 ${pageSize[1] - 80} moveto (${TOK(i)} LINE ONE OF PAGE ${i}) show\n`);
    ps.push('/Times-Roman findfont 12 scalefont setfont\n');
    ps.push(`30 ${pageSize[1] - 120} moveto (SECOND LINE WITH WORDS TO MEASURE) show\n`);
    ps.push(`30 ${pageSize[1] - 150} moveto (Amount R 1.000,25 Balance ${i}234,56) show\n`);
    ps.push(`30 60 ${40 + i * 90} ${60 + i * 25} rectfill\n`);   // page-specific ink block
    ps.push('/Times-Roman findfont 40 scalefont setfont\n');
    ps.push(`30 200 moveto (PAGE ${i} OF ${pages}) show\n`);
    ps.push('40 40 320 200 rectstroke\nshowpage\n');
  }
  const psPath = path.join(EV, `${name}.ps`);
  fs.mkdirSync(EV, { recursive: true });
  fs.writeFileSync(psPath, ps.join(''));
  const p = path.join(EV, `${name}.pdf`);
  execFileSync('gs', ['-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=pdfwrite', '-dPDFSETTINGS=/prepress',
    '-dEmbedAllFonts=true', '-dCompatibilityLevel=1.4', `-sOutputFile=${p}`, psPath]);
  const bytes = fs.readFileSync(p);
  return { file: new File([bytes], `${name}.pdf`, { type: 'application/pdf' }), bytes, p };
}
/** Fonts embedded? (pdffonts emb column) — guards the measurement caveat above. */
function allFontsEmbedded(pdfPath: string) {
  const txt = execFileSync('pdffonts', [pdfPath], { encoding: 'utf8' });
  const rows = txt.split('\n').filter((l) => l.trim() && !/^name/.test(l) && !/^-+/.test(l));
  return { txt, unembedded: rows.filter((l) => /no\s+/.test(l.slice(-14))).length, rowCount: rows.length };
}


/**
 * 2-page 500x500pt fixture: page 1 carries four DISTINCT embedded rasters (three JPEGs at
 * 300x200 / 240x360 / 400x120 plus a 120x90 PNG), page 2 re-uses the first one. This is the
 * ground truth extract-images is supposed to walk, and the colour target invert-colors is
 * supposed to protect. Memoised so test order does not matter.
 */
let _imgPdf: { bytes: Buffer; srcPath: string } | null = null;
async function imageBearingPdf() {
  if (_imgPdf) return _imgPdf;
  const mk = async (label: string, colour: string, w: number, h: number) => {
    const c = createCanvas(w, h);
    const x = c.getContext('2d');
    x.fillStyle = colour; x.fillRect(0, 0, w, h);
    x.fillStyle = '#000'; x.font = `bold ${Math.round(h / 5)}px sans-serif`; x.fillText(label, 8, Math.round(h * 0.6));
    return Buffer.from(c.toBuffer('image/jpeg', 90));
  };
  const [j1, j2, j3] = [await mk('IMGALPHA', '#ffdddd', 300, 200), await mk('IMGBRAVO', '#ddffdd', 240, 360), await mk('IMGGOLF', '#ddddff', 400, 120)];
  const pc = createCanvas(120, 90);
  pc.getContext('2d').fillStyle = 'rgb(10,120,220)';
  pc.getContext('2d').fillRect(0, 0, 120, 90);
  const pngBuf = Buffer.from(pc.toBuffer('image/png'));

  const doc = await PDFDocument.create();
  const page = doc.addPage([500, 500]);
  const e1 = await doc.embedJpg(u8(j1)), e2 = await doc.embedJpg(u8(j2)), e3 = await doc.embedJpg(u8(j3)), e4 = await doc.embedPng(u8(pngBuf));
  page.drawImage(e1, { x: 10, y: 300, width: 150, height: 100 });
  page.drawImage(e2, { x: 200, y: 120, width: 100, height: 150 });
  page.drawImage(e3, { x: 320, y: 300, width: 160, height: 48 });
  page.drawImage(e4, { x: 10, y: 60, width: 120, height: 90 });
  const page2 = doc.addPage([500, 500]);
  page2.drawImage(e1, { x: 100, y: 100, width: 150, height: 100 }); // repeated asset across pages
  const bytes = Buffer.from(await doc.save());
  _imgPdf = { bytes, srcPath: ev('extract-images-source.pdf', bytes) };
  return _imgPdf;
}

/**
 * Minimal EXIF APP1 segment carrying only the Orientation tag, spliced into a JPEG right after
 * SOI. Orientation 6 means "rotate 90 CW for display", i.e. the intended box is h x w.
 */
function jpegWithExifOrientation(jpeg: Buffer, orientation: number): Buffer {
  const tiff = Buffer.alloc(26);
  tiff.writeUInt16LE(0x4949, 0);            // "II" little-endian
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);                 // IFD0 starts at offset 8
  tiff.writeUInt16LE(1, 8);                 // one directory entry
  tiff.writeUInt16LE(0x0112, 10);           // tag: Orientation
  tiff.writeUInt16LE(3, 12);                // type: SHORT
  tiff.writeUInt32LE(1, 14);                // count: 1
  tiff.writeUInt16LE(orientation, 18);      // value lives at entry+8 (14 is the 4-byte count)
  const payload = Buffer.concat([Buffer.from('Exif\u0000\u0000', 'latin1'), tiff]);
  const marker = Buffer.alloc(4);
  marker[0] = 0xff; marker[1] = 0xe1; marker.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), marker, payload, jpeg.subarray(2)]);
}
function exifOrientation(buf: Buffer): number | null {
  if (!magic(buf, 'ffe1', 2)) return null;
  const base = 2 + 4 + 6;
  if (buf.readUInt16LE(base) !== 0x4949) return null;
  const ifd = buf.readUInt32LE(base + 4);
  const n = buf.readUInt16LE(base + ifd);
  for (let i = 0; i < n; i++) {
    const e = base + ifd + 2 + i * 12;
    if (buf.readUInt16LE(e) === 0x0112) return buf.readUInt16LE(e + 8);
  }
  return null;
}
/** Rotate an encoded raster 90 CW — what an EXIF-aware viewer is supposed to show. */
async function rotate90cw(buf: Buffer): Promise<Buffer> {
  const img = await loadImage(buf);
  const c = createCanvas(img.height, img.width);
  const x = c.getContext('2d');
  x.translate(c.width, 0); x.rotate(Math.PI / 2); x.drawImage(img, 0, 0);
  return Buffer.from(c.toBuffer('image/jpeg', 92));
}
/** LibreOffice from the repo's own prism-lo image (pattern from tests/libreofficeConversion.test.ts). */
function libreOfficeAvailable() {
  try { execFileSync('docker', ['image', 'inspect', 'prism-lo'], { stdio: 'pipe' }); return true; } catch { return false; }
}
function libreOfficeToTxt(inFile: string): string | null {
  try {
    execFileSync('docker', ['run', '--rm', '--entrypoint', 'soffice', '-v', `${EV}:/w`, 'prism-lo',
      '--headless', '--convert-to', 'txt:Text (encoded):UTF8', `/w/${path.basename(inFile)}`, '--outdir', '/w'],
      { stdio: 'pipe', timeout: 240000 });
    const out = inFile.replace(/\.(docx|pdf)$/, '.txt');
    return fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
  } catch { return null; }
}

/** JPEG with real ink + a dark bar, for jpg-to-pdf. */
function jpegFile(label: string, w: number, h: number): File {
  const c = createCanvas(w, h);
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#000000';
  x.font = `bold ${Math.max(14, Math.round(h / 8))}px sans-serif`;
  x.fillText(label, Math.round(w * 0.08), Math.round(h * 0.5));
  x.fillRect(Math.round(w * 0.08), Math.round(h * 0.62), Math.round(w * 0.6), Math.max(3, Math.round(h * 0.02)));
  x.fillRect(Math.round(w * 0.72), Math.round(h * 0.1), Math.round(w * 0.18), Math.round(h * 0.18));
  const buf = c.toBuffer('image/jpeg', 92);
  return new File([buf], `${label}.jpg`, { type: 'image/jpeg' });
}

/* ================================================================== suite */
describe('conversion family — real-service byte audit', () => {
  beforeAll(() => { installBrowserFaithfulCanvas(); fs.mkdirSync(EV, { recursive: true }); });

  /* ------------------------------------------------------ harness provenance check */
  it('PROVENANCE: the stock tests/setup.ts canvas shim reports 300x150 for this family (harness artefact, not a product defect)', async () => {
    const { file } = gsTextPdf('harness-provenance', 1, [200, 300]);
    restoreStockCanvas();
    let stock: any;
    try {
      const imgs = await convertPdfToImages(file, undefined, 50, false);
      const b = Buffer.from(imgs[0].base64, 'base64');
      const jp = jpegScan(b)!;
      stock = { emittedDims: `${jp.width}x${jp.height}`, bytes: b.length, pageBoxPt: '200x300',
        dimsExpectedInABrowser: '400x600 (scale 2.0)' };
    } finally {
      installBrowserFaithfulCanvas();
    }
    const mine = await convertPdfToImages(file, undefined, 50, false);
    const mb = Buffer.from(mine[0].base64, 'base64');
    const mjp = jpegScan(mb)!;
    ev('harness-provenance.json', JSON.stringify({
      why: 'convertPdfToImages calls getContext() before assigning canvas.width/height (services/pdfService.ts:594-601). Browsers resize the drawing buffer in place; tests/setup.ts caches the surface created at getContext() time and reuses it in toDataURL, so the stock harness emits a fixed 300x150 image for every page.',
      stockSetupShim: stock,
      withBrowserFaithfulShim: { emittedDims: `${mjp.width}x${mjp.height}`, bytes: mb.length },
      consequence: 'tests/stressTestAllTools.test.ts:459-472 asserts only bytes.length > 0 per ZIP entry, so it passes against a blank 300x150 image',
    }, null, 2));
    expect(stock.emittedDims).toBe('300x150');
    expect(`${mjp.width}x${mjp.height}`).toBe('400x600');
  }, 300000);

  /* ---------------------------------------------------------------- pdf-to-jpg */
  describe('pdf-to-jpg', () => {
    it('registry handler: one real JPEG per page, dims consistent with page size at the rendered DPI, layout matches poppler', async () => {
      const { file, bytes, p } = gsTextPdf('pdf-to-jpg-source', 3);
      expect(allFontsEmbedded(p).unembedded).toBe(0);
      const info = execFileSync('pdfinfo', [p], { encoding: 'utf8' });
      expect(info).toMatch(/Pages:\s+3/);
      expect(info).toMatch(/Page size:\s+400 x 600 pts/);

      const handler = getToolById('pdf-to-jpg')!.handler!;
      const result = await handler({ files: [file], options: {} });
      const zipBuf = await asBuf(result.blob!);
      ev('pdf-to-jpg-registry.zip', zipBuf);
      expect(result.filename).toBe('pdf-to-jpg-source_Images.zip');
      expect(magic(zipBuf, '504b0304')).toBe(true);

      const zip = await JSZip.loadAsync(zipBuf);
      const names = Object.keys(zip.files).filter((k) => !zip.files[k].dir).sort();
      expect(names).toEqual(['Page_1.jpg', 'Page_2.jpg', 'Page_3.jpg']);

      const pages: any[] = [];
      for (let i = 0; i < names.length; i++) {
        const b = Buffer.from(await zip.file(names[i])!.async('arraybuffer'));
        const jp = jpegScan(b);
        expect(jp, `${names[i]} is not a JPEG (first bytes ${b.subarray(0, 4).toString('hex')})`).not.toBeNull();
        expect(jp!.eoi, `${names[i]} truncated: no FFD9 EOI`).toBe(true);
        expect(jp!.components, `${names[i]} is not a 3-component JPEG`).toBe(3);
        // 400x600 pt page rendered at the hardcoded scale 2.0 => 800x1200 px => 144 DPI.
        expect(jp!.width, `${names[i]} width`).toBe(800);
        expect(jp!.height, `${names[i]} height`).toBe(1200);
        expect(b.length, `${names[i]} is a trivially small JPEG (${b.length} B)`).toBeGreaterThan(8000);
        const s = await pix(b);
        expect(s.darkFrac, `${names[i]} contains no ink (blank) — darkFrac=${s.darkFrac}`).toBeGreaterThan(0.0005);
        pages.push({ page: i + 1, file: names[i], bytes: b.length, dims: `${jp!.width}x${jp!.height}`,
          jpegDensityField: jp!.density, mean: +s.mean.toFixed(2), darkFrac: +s.darkFrac.toFixed(5), levels: s.levels });
        ev(`pdf-to-jpg-page${i + 1}.jpg`, b);
      }

      // Independent reference render of the same source at the same 144 DPI.
      execFileSync('pdftoppm', ['-r', '144', '-jpeg', p, path.join(EV, 'pdftoppm-ref')]);
      for (let i = 1; i <= 3; i++) {
        const ref = fs.readFileSync(path.join(EV, `pdftoppm-ref-${i}.jpg`));
        const got = fs.readFileSync(path.join(EV, `pdf-to-jpg-page${i}.jpg`));
        const a = await pix(ref); const b = await pix(got);
        expect([a.w, a.h], `poppler/app grid mismatch on page ${i}`).toEqual([b.w, b.h]);
        const mae = blockMae(a.blocks, b.blocks);
        expect(mae, `page ${i}: app render does not match poppler layout (blockMae=${mae.toFixed(2)})`).toBeLessThan(25);
        expect(Math.abs(a.darkFrac - b.darkFrac), `page ${i}: ink coverage differs from poppler`).toBeLessThan(0.02);
        pages[i - 1].poppler = { dims: `${a.w}x${a.h}`, mean: +a.mean.toFixed(2), darkFrac: +a.darkFrac.toFixed(5), blockMae: +mae.toFixed(2) };
      }
      // Per-page distinctness: page 1's JPEG must not be a copy of page 2's.
      const p1 = await pix(fs.readFileSync(path.join(EV, 'pdf-to-jpg-page1.jpg')));
      const p2 = await pix(fs.readFileSync(path.join(EV, 'pdf-to-jpg-page2.jpg')));
      expect(blockMae(p1.blocks, p2.blocks), 'page 1 and page 2 images are identical').toBeGreaterThan(1);

      ev('pdf-to-jpg-report.json', JSON.stringify({ pdfinfo: info, pages }, null, 2));
      claimCheck('pdf-to-jpg', [
        { claim: 'site/assets/features.data.js:80 "Render every page to a sharp JPG ... at the DPI you choose"',
          measured: 'scale hardcoded at services/pdfService.ts:592 => 8 px/pt = 144 DPI; JFIF APP0 of the emitted JPEG records units=0 (aspect only), so the file carries no DPI at all', result: 'OVERSTATEMENT' },
        { claim: 'site/assets/features.data.js:81 "Selectable resolution and quality"',
          measured: 'no DPI/quality parameter exists on convertPdfToImages; quality hardcoded 0.90 at :612; no UI control sets either', result: 'FALSE' },
        { claim: 'site/assets/features.data.js:81 "Batch export all pages or the current one"',
          measured: 'jpgPages forwards to parsePageSelection, but grep of src/components shows no component ever writes jpgPages', result: 'PARTIAL (headless only)' },
        { claim: 'src/registry/toolRegistry.ts:279 "Convert each PDF page into high-quality JPG images"',
          measured: `${pages.length} valid FFD8/FFD9 3-component JPEGs, 46-48 KB each, 800x1200 = page box x2.0, layout matches pdftoppm -r 144 (blockMae ${pages.map((p: any) => p.poppler.blockMae).join('/')})`, result: 'PASS' },
      ]);
    }, 600000);

    it('no DPI/resolution/quality knob reaches the service (source probe)', () => {
      const src = fs.readFileSync(path.join(ROOT, 'services', 'pdfService.ts'), 'utf8');
      const body = src.slice(src.indexOf('export async function convertPdfToImages'), src.indexOf('export async function createTextPdf'));
      expect(body).toMatch(/getViewport\(\{ scale: 2\.0 \}\)/);
      expect(body).toMatch(new RegExp("toDataURL\\('image/jpeg', 0\\.90\\)"));
      expect(/dpi/i.test(body)).toBe(false);
      const reg = fs.readFileSync(path.join(ROOT, 'src', 'registry', 'toolRegistry.ts'), 'utf8');
      const call = reg.slice(reg.indexOf("id: 'pdf-to-jpg'"), reg.indexOf("id: 'jpg-to-pdf'"));
      expect(call).toMatch(/50,\s*\n?\s*false,/);            // maxPages + enhanceForOcr hardcoded
      expect(call).toMatch(/options\?\.jpgPages/);            // the only forwarded option
      const uiRefs: string[] = [];
      const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
        const fp = path.join(d, e.name);
        if (e.isDirectory()) walk(fp);
        else if (/\.tsx?$/.test(e.name) && fs.readFileSync(fp, 'utf8').includes('jpgPages')) uiRefs.push(fp);
      });
      walk(path.join(ROOT, 'src', 'components'));
      walk(path.join(ROOT, 'src', 'hooks'));
      walk(path.join(ROOT, 'src', 'providers'));
      ev('pdf-to-jpg-parameter-probe.json', JSON.stringify({ serviceMentionsDpi: /dpi/i.test(body),
        hardcodedScale: '2.0', hardcodedQuality: 0.90, registryHardcodedMaxPages: 50,
        uiFilesWritingJpgPages: uiRefs, toolRegistryReadsJpgPages: true }, null, 2));
      expect(uiRefs, 'no UI writes jpgPages').toEqual([]);
    });

    it('page-range selection works when supplied programmatically; default page cap is 50', async () => {
      const { file } = gsTextPdf('pdf-to-jpg-sel', 3);
      const sel = await convertPdfToImages(file, undefined, 50, false, undefined, undefined, '1,3');
      expect(sel.map((s) => s.pageNumber)).toEqual([1, 3]);
      const capped = await convertPdfToImages(file, undefined, 2, false);
      expect(capped.map((s) => s.pageNumber)).toEqual([1, 2]);
      ev('pdf-to-jpg-selection.json', JSON.stringify({ selected: sel.map((s) => s.pageNumber), capped: capped.map((s) => s.pageNumber) }, null, 2));
    }, 600000);

    it('image-only (scanned) PDF yields one inked JPEG per page at 2x the stored scan', async () => {
      const p = path.join(FIX, 'scanned-statement.pdf');
      const rows: any[] = [];
      const imgs = await convertPdfToImages(fileFrom(p), undefined, 50, false);
      expect(imgs.length).toBe(2);
      for (let i = 0; i < imgs.length; i++) {
        const b = Buffer.from(imgs[i].base64, 'base64');
        const jp = jpegScan(b)!;
        expect(magic(b, 'ffd8')).toBe(true);
        expect(jp.eoi).toBe(true);
        expect(jp.width).toBe(2480); expect(jp.height).toBe(3508); // 1240x1754 pt @ scale 2.0
        const s = await pix(b);
        expect(s.darkFrac).toBeGreaterThan(0.001);
        rows.push({ page: i + 1, dims: `${jp.width}x${jp.height}`, bytes: b.length, mean: +s.mean.toFixed(2), darkFrac: +s.darkFrac.toFixed(5) });
        ev(`pdf-to-jpg-scanned-${i + 1}.jpg`, b);
      }
      const stored = pdfimagesList(p).rows.filter((r) => r.type === 'image');
      ev('pdf-to-jpg-scanned.json', JSON.stringify({ rendered: rows, storedScanDims: stored.map((r) => `${r.width}x${r.height}`) }, null, 2));
      expect(stored.map((r) => `${r.width}x${r.height}`)).toEqual(['1240x1754', '1240x1754']);
    }, 600000);

    it('MEASURED RISK: a PDF that uses the non-embedded standard-14 fonts renders with NO text ink (browser behaviour UNPROVEN)', async () => {
      // This is exactly what this app's own generators produce: pdf-lib StandardFonts.Helvetica
      // is written into the PDF as a name only, with no font file (pdffonts emb column = no).
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const page = doc.addPage([400, 600]);
      page.drawText('PRISMSTDFONT ONLY VECTOR TEXT NO OTHER INK', { x: 20, y: 400, size: 18, font });
      page.drawText('SECOND LINE OF PLAIN STANDARD FONT TEXT', { x: 20, y: 350, size: 18, font });
      const bytes = Buffer.from(await doc.save());
      const p = ev('pdf-to-jpg-standardfont.pdf', bytes);
      const fonts = execFileSync('pdffonts', [p], { encoding: 'utf8' });
      // emb/sub/uni are the last three --- columns before the object id; assert NOT embedded.
      const fontRows = fonts.split('\n').filter((l) => /^\S.*\s(no|yes)\s+(no|yes)\s+(no|yes)\s+\d+\s+\d+$/.test(l));
      expect(fontRows.length).toBeGreaterThan(0);
      expect(fontRows.every((l) => /\sno\s+(no|yes)\s+(no|yes)\s+\d+\s+\d+$/.test(l)), fonts).toBe(true);

      const imgs = await convertPdfToImages(new File([bytes], 'std.pdf', { type: 'application/pdf' }), undefined, 50, false);
      const b = Buffer.from(imgs[0].base64, 'base64');
      const s = await pix(b);
      // control: pdftotext and poppler both see the text fine, so the page is not empty
      const pop = execFileSync('pdftotext', [p, '-'], { encoding: 'utf8' });
      execFileSync('pdftoppm', ['-r', '144', '-jpeg', p, path.join(EV, 'stdfont-pop')]);
      const ref = await pix(fs.readFileSync(path.join(EV, 'stdfont-pop-1.jpg')));
      ev('pdf-to-jpg-standardfont.json', JSON.stringify({
        pdffonts: fonts, appRender: { dims: `${s.w}x${s.h}`, mean: +s.mean.toFixed(2), darkFrac: +s.darkFrac.toFixed(6) },
        popplerRender: { dims: `${ref.w}x${ref.h}`, mean: +ref.mean.toFixed(2), darkFrac: +ref.darkFrac.toFixed(6) },
        popplerText: pop.trim().slice(0, 80),
        pdfjsWarnings: 'UnknownErrorException: Ensure that the `standardFontDataUrl` API parameter is provided; getPathGenerator - ignoring character: "... isn\'t resolved yet Helvetica_path_X"',
        appCodePassesStandardFontDataUrl: false, standardFontsFolderInDist: 0,
        scope: 'MEASURED IN THE jsdom/@napi-rs/canvas HARNESS. A real browser may substitute a system font; no Chromium binary is installed here, so browser behaviour is UNPROVEN, not asserted.',
      }, null, 2));
      expect(s.w).toBe(800);
      expect(ref.darkFrac).toBeGreaterThan(0.0005);      // poppler inked the text
      expect(s.darkFrac).toBeLessThan(0.0001);           // pdf.js drew none of it
      claimCheck('pdf-to-jpg:standard-14 fonts', [
        { claim: 'src/registry/toolRegistry.ts:279 "Convert each PDF page into high-quality JPG images"',
          measured: `page with only non-embedded Helvetica: app render darkFrac ${s.darkFrac.toFixed(6)} vs poppler ${ref.darkFrac.toFixed(6)}; services/pdfjsClient.ts never passes standardFontDataUrl and dist/ ships no standard_fonts/`,
          result: 'PARTIAL in-harness / UNPROVEN in browser — needs one Playwright run to settle' },
      ]);
    }, 600000);

    it('MEASURED DEFECT: a 60-page document silently yields 50 images', async () => {
      const { file, p } = gsTextPdf('pdf-to-jpg-60', 60, [200, 200]);
      expect(execFileSync('pdfinfo', [p], { encoding: 'utf8' })).toMatch(/Pages:\s+60/);
      const handler = getToolById('pdf-to-jpg')!.handler!;
      const result = await handler({ files: [file], options: {} });
      const zip = await JSZip.loadAsync(await asBuf(result.blob!));
      const names = Object.keys(zip.files).filter((k) => !zip.files[k].dir);
      const firstMissing = Array.from({ length: 60 }, (_, i) => `Page_${i + 1}.jpg`).find((n) => !zip.files[n]);
      ev('pdf-to-jpg-truncated.json', JSON.stringify({
        sourcePages: 60, emittedImages: names.length, firstPageMissing: firstMissing ?? null,
        cause: 'src/registry/toolRegistry.ts:292 hardcodes maxPages=50 and no warning is returned',
      }, null, 2));
      expect(names.length).toBe(50);
      expect(firstMissing).toBe('Page_51.jpg');
      claimCheck('pdf-to-jpg:page completeness', [
        { claim: 'src/registry/toolRegistry.ts:279 "Convert EACH PDF page into high-quality JPG images"',
          measured: `60-page input -> ${names.length} JPEGs; ${firstMissing} onward absent, with no error or notice`, result: 'FAIL for documents over 50 pages' },
      ]);
    }, 900000);
  });

  /* ---------------------------------------------------------------- jpg-to-pdf */
  describe('jpg-to-pdf', () => {
    it('page count == image count, one Image XObject per page, page box == pixel box, ink survives', async () => {
      const files = [jpegFile('PHOTO-A', 800, 600), jpegFile('PHOTO-B', 600, 900), jpegFile('PHOTO-C', 1024, 400)];
      const blob = await convertImagesToPdf(files);
      const bytes = await asBuf(blob);
      const outPath = path.join(EV, 'jpg-to-pdf-out.pdf');
      ev('jpg-to-pdf-out.pdf', bytes);
      expect(magic(bytes, '255044462d')).toBe(true);
      expect(bytes.length).toBeGreaterThan(3000);

      const info = execFileSync('pdfinfo', ['-f', '1', '-l', '9', outPath], { encoding: 'utf8' });
      expect(info).toMatch(/Pages:\s+3/);
      const sizes = [...info.matchAll(/Page\s+(\d+) size:\s+([\d.]+)\s*x\s*([\d.]+)/g)]
        .map((m) => ({ page: +m[1], w: +m[2], h: +m[3] }));
      expect(sizes).toEqual([{ page: 1, w: 800, h: 600 }, { page: 2, w: 600, h: 900 }, { page: 3, w: 1024, h: 400 }]);
      for (const s of sizes) expect(s.w / s.h).toBeGreaterThan(0.1); // aspect kept, no squashed page

      const doc = await PDFDocument.load(u8(bytes));
      const perPage: { page: number; images: string[] }[] = [];
      for (let i = 0; i < doc.getPageCount(); i++) {
        const res = doc.getPage(i).node.lookup(PDFName.of('Resources'), PDFDict);
        const xobj = res.lookup(PDFName.of('XObject'), PDFDict);
        const images: string[] = [];
        for (const [, ref] of xobj.entries()) {
          const obj = doc.context.lookup(ref) as PDFStream;
          if (obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) {
            images.push(`${obj.dict.lookupMaybe(PDFName.of('Width'), PDFNumber)?.numberValue}x${obj.dict.lookupMaybe(PDFName.of('Height'), PDFNumber)?.numberValue}`);
          }
        }
        perPage.push({ page: i + 1, images });
      }
      expect(perPage.map((p) => p.images.length)).toEqual([1, 1, 1]);
      expect(perPage.map((p) => p.images[0])).toEqual(['800x600', '600x900', '1024x400']);
      expect(pdfimagesList(outPath).rows.map((r) => `${r.width}x${r.height}`)).toEqual(['800x600', '600x900', '1024x400']);

      // "text drawn on the JPG survives visually": render at 1:1 (72 dpi) and compare to source.
      const rows: any[] = [];
      for (let i = 0; i < 3; i++) {
        const srcBuf = Buffer.from(await files[i].arrayBuffer());
        execFileSync('pdftoppm', ['-r', '72', '-jpeg', '-f', `${i + 1}`, '-l', `${i + 1}`, outPath, path.join(EV, `j2p-p${i + 1}`)]);
        const rendered = fs.readFileSync(path.join(EV, `j2p-p${i + 1}-${i + 1}.jpg`));
        const rs = await pix(rendered); const ss = await pix(srcBuf);
        expect([rs.w, rs.h], `page ${i + 1} raster grid`).toEqual([ss.w, ss.h]);
        expect(rs.darkFrac, `page ${i + 1} lost all ink`).toBeGreaterThan(0.002);
        const mae = blockMae(ss.blocks, rs.blocks);
        expect(mae, `page ${i + 1} does not look like its source image (blockMae=${mae.toFixed(2)})`).toBeLessThan(20);
        rows.push({ page: i + 1, rendered: `${rs.w}x${rs.h}`, srcMean: +ss.mean.toFixed(2), outMean: +rs.mean.toFixed(2),
          srcDarkFrac: +ss.darkFrac.toFixed(5), outDarkFrac: +rs.darkFrac.toFixed(5), blockMae: +mae.toFixed(2),
          srcLevels: ss.levels, outLevels: rs.levels });
      }
      ev('jpg-to-pdf-report.json', JSON.stringify({ pdfinfo: info, xobjects: perPage, rows }, null, 2));
      claimCheck('jpg-to-pdf', [
        { claim: 'src/registry/toolRegistry.ts:313 "Convert and combine multiple images into a single ... PDF"', measured: '3 images -> 1 PDF, 3 pages, 1 embedded Image per page, ink preserved', result: 'PASS' },
        { claim: 'site/assets/features.data.js:85 "Normalises mixed portrait/landscape onto one page size"', measured: `page boxes ${sizes.map((s) => `${s.w}x${s.h}`).join(', ')} — three different page sizes`, result: 'FALSE' },
        { claim: 'site/assets/features.data.js:85 "Reorder and crop before building"', measured: 'convertImagesToPdf takes files in array order only; no crop API in services/pdfService.ts:526-559', result: 'OUT OF SCOPE OF CODE' },
      ]);
    }, 600000);

    it('MEASURED: mixed portrait/landscape produces mixed page sizes (claim contradicted)', async () => {
      const blob = await convertImagesToPdf([jpegFile('LANDSCAPE', 900, 600), jpegFile('PORTRAIT', 600, 900)]);
      const bytes = await asBuf(blob);
      ev('jpg-to-pdf-mixed.pdf', bytes);
      const doc = await PDFDocument.load(u8(bytes));
      const sizes = doc.getPages().map((p) => ({ w: Math.round(p.getSize().width), h: Math.round(p.getSize().height) }));
      const distinct = [...new Set(sizes.map((s) => `${s.w}x${s.h}`))];
      ev('jpg-to-pdf-mixed-sizes.json', JSON.stringify({ sizes, distinctPageSizes: distinct }, null, 2));
      expect(sizes.length).toBe(2);
      expect(distinct.length).toBe(2);
      expect(distinct).toEqual(['900x600', '600x900']);
    }, 300000);

    it('MEASURED: EXIF Orientation is ignored — a rotated phone photo goes in sideways', async () => {
      // 800x600 landscape raster tagged Orientation=6 ("rotate 90 CW to display"), so the
      // photographer's intended page is 600 wide x 800 tall, portrait.
      const raw = Buffer.from(await jpegFile('EXIFSHOT', 800, 600).arrayBuffer());
      expect(magic(raw, 'ffd8')).toBe(true);
      const tagged = jpegWithExifOrientation(raw, 6);
      expect(exifOrientation(tagged)).toBe(6);
      ev('jpg-to-pdf-exif-source.jpg', tagged);
      const intended = await rotate90cw(raw); // what an EXIF-aware viewer shows
      ev('jpg-to-pdf-exif-intended.jpg', intended);

      const blob = await convertImagesToPdf([new File([tagged], 'phone-photo.jpg', { type: 'image/jpeg' })]);
      const bytes = await asBuf(blob);
      const outPath = ev('jpg-to-pdf-exif-out.pdf', bytes);
      const doc = await PDFDocument.load(u8(bytes));
      const box = doc.getPage(0).getSize();
      execFileSync('pdftoppm', ['-r', '72', '-jpeg', '-f', '1', '-l', '1', outPath, path.join(EV, 'jpg-to-pdf-exif')]);
      const rendered = await pix(fs.readFileSync(path.join(EV, 'jpg-to-pdf-exif-1.jpg')));
      const asDisplayed = await pix(intended);
      const asStored = await pix(raw);
      const maeRotated = blockMae(asDisplayed.blocks, rendered.blocks);
      const maeRaw = blockMae(asStored.blocks, rendered.blocks);
      ev('jpg-to-pdf-exif.json', JSON.stringify({
        exifOrientationReadFromInput: exifOrientation(tagged),
        intendedDisplayBox: `${asDisplayed.w}x${asDisplayed.h}`,
        pdfPageBoxPt: `${Math.round(box.width)}x${Math.round(box.height)}`,
        renderedPageDims: `${rendered.w}x${rendered.h}`,
        blockMaeVsRotatedAsIntended: +maeRotated.toFixed(2),
        blockMaeVsRawUnrotated: +maeRaw.toFixed(2),
      }, null, 2));
      expect(box.width).toBe(800);   // measurement: raw landscape box, not the 600x800 the EXIF asks for
      expect(box.height).toBe(600);
      expect(maeRaw, 'page is not the raw raster — probe inconclusive').toBeLessThan(maeRotated);
      claimCheck('jpg-to-pdf:EXIF', [
        { claim: 'src/registry/toolRegistry.ts:313 "Convert and combine multiple images into a single ... PDF" (site copy: "Turn a stack of photos or scans into one tidy PDF ... with the margins straight")',
          measured: `EXIF Orientation=6 input -> page box ${Math.round(box.width)}x${Math.round(box.height)} pt (raw pixel box); rendered page matches the unrotated raster (blockMae ${maeRaw.toFixed(2)}) not the intended one (${maeRotated.toFixed(2)})`,
          result: 'DEFECT — sideways output for camera JPEGs' },
      ]);
    }, 600000);

    it('PNG accepted, unsupported input rejected, no silent empty PDF', async () => {
      const c = createCanvas(200, 150);
      const x = c.getContext('2d');
      x.fillStyle = '#123456'; x.fillRect(0, 0, 200, 150);
      const png = new File([c.toBuffer('image/png')], 'shot.png', { type: 'image/png' });
      const doc = await PDFDocument.load(u8(await asBuf(await convertImagesToPdf([png]))));
      expect(doc.getPageCount()).toBe(1);
      await expect(convertImagesToPdf([new File([Buffer.from('hello')], 'note.txt', { type: 'text/plain' })])).rejects.toThrow(/No supported JPG/);
      // A .jpg-labelled non-image must not produce a "successful" PDF.
      const bogus = new File([Buffer.from('not an image at all')], 'fake.jpg', { type: 'image/jpeg' });
      let outcome: string;
      try { const b = await convertImagesToPdf([bogus]); outcome = `returned a ${b.size}-byte PDF (no validation)`; }
      catch (e: any) { outcome = `threw: ${e.message}`; }
      ev('jpg-to-pdf-bogus.json', JSON.stringify({ outcome }, null, 2));
      expect(outcome).toContain('threw');
    }, 300000);
  });

  /* --------------------------------------------------------------- pdf-to-text */
  describe('pdf-to-text', () => {
    it('digital PDF: nothing pdftotext finds is missing, page framing is honest', async () => {
      const { file, p } = gsTextPdf('pdf-to-text-src', 3);
      const txt = (await (await extractText(file)).text()).replace(/\u0000/g, '');
      ev('pdf-to-text-app.txt', txt);
      const pop = execFileSync('pdftotext', ['-layout', p, '-'], { encoding: 'utf8' });
      ev('pdf-to-text-poppler.txt', pop);
      expect(txt.length).toBeGreaterThan(100);
      for (let i = 1; i <= 3; i++) {
        expect(txt, `no page framing for ${i}`).toContain(`--- Page ${i} ---`);
        expect(txt, `app lost ${TOK(i)}`).toContain(TOK(i));
        expect(txt, `app lost the amount line of page ${i}`).toContain(`Balance ${i}234,56`);
      }
      const popWords = [...new Set(pop.split(/\s+/).filter((w) => w.length > 3))];
      const missing = popWords.filter((w) => !txt.includes(w));
      ev('pdf-to-text-diff.json', JSON.stringify({ appChars: txt.length, popplerChars: pop.length,
        appWordCount: txt.split(/\s+/).filter(Boolean).length, popplerWordCount: popWords.length,
        popplerWordsMissingFromApp: missing }, null, 2));
      expect(missing, `words pdftotext found but the app dropped: ${missing.join('|')}`).toEqual([]);
      // ordering must follow the document, not shuffle pages
      expect(txt.indexOf(TOK(1))).toBeLessThan(txt.indexOf(TOK(2)));
      expect(txt.indexOf(TOK(2))).toBeLessThan(txt.indexOf(TOK(3)));
    }, 300000);

    it('real bank PDF (July 2026, 2p): token coverage vs pdftotext', async () => {
      const p = path.join(STATEMENTS, 'July 2026.pdf');
      const txt = await (await extractText(fileFrom(p))).text();
      ev('pdf-to-text-july-app.txt', txt);
      const pop = execFileSync('pdftotext', ['-layout', p, '-'], { encoding: 'utf8' });
      ev('pdf-to-text-july-poppler.txt', pop);
      const tokens = [...new Set(pop.split(/[\s,;:]+/).filter((w) => /^[\wR$\d.,-]{4,}$/.test(w)))];
      const missing = tokens.filter((t) => !txt.includes(t));
      const ratio = missing.length / Math.max(1, tokens.length);
      ev('pdf-to-text-july-diff.json', JSON.stringify({ appChars: txt.length, popplerChars: pop.length,
        popplerTokens: tokens.length, missingCount: missing.length, missingRatio: +ratio.toFixed(4), missing: missing.slice(0, 80) }, null, 2));
      expect(ratio).toBeLessThan(0.1);
      expect(txt.length).toBeGreaterThan(200);
    }, 300000);

    it('real statement corpus: token coverage vs pdftotext on 3 production-shaped PDFs', async () => {
      const corpus = ['SBSA_Statement_2026-08-04_3months.pdf', 'Test.pdf', 'Robbie_Accountants_2026-01.pdf'];
      const rows: any[] = [];
      for (const name of corpus) {
        const p = path.join(STATEMENTS, name);
        const txt = await (await extractText(fileFrom(p))).text();
        const pop = execFileSync('pdftotext', ['-layout', p, '-'], { encoding: 'utf8' });
        const info = execFileSync('pdfinfo', [p], { encoding: 'utf8' });
        const tokens = [...new Set(pop.split(/[\s,;:]+/).filter((w) => /^[A-Za-z0-9][\wR$.,'-]{3,}$/.test(w)))];
        const missing = tokens.filter((t) => !txt.includes(t));
        // page framing must match the real page count, not invent or drop pages
        const frames = (txt.match(/--- Page \d+ ---/g) || []).length;
        rows.push({ name, pages: +(info.match(/Pages:\s+(\d+)/) || [0, 0])[1], encrypted: /Encrypted:\s+yes/.test(info),
          appChars: txt.length, popplerChars: pop.length, popplerTokens: tokens.length,
          missingCount: missing.length, missingSample: missing.slice(0, 12), pageFrames: frames });
        ev(`pdf-to-text-${path.basename(name, '.pdf')}-app.txt`, txt);
      }
      ev('pdf-to-text-corpus.json', JSON.stringify(rows, null, 2));
      for (const r of rows) {
        expect(r.appChars, `${r.name}: produced almost no text`).toBeGreaterThan(500);
        expect(r.missingCount / Math.max(1, r.popplerTokens), `${r.name}: too many tokens missing`).toBeLessThan(0.05);
        expect(r.pageFrames, `${r.name}: page framing != page count`).toBe(r.pages);
      }
      claimCheck('pdf-to-text', [
        { claim: 'src/registry/toolRegistry.ts:687 "Extract pure readable text from PDF documents instantly"',
          measured: rows.map((r) => `${r.name}: ${r.popplerTokens - r.missingCount}/${r.popplerTokens} poppler tokens, ${r.pageFrames} page frames for ${r.pages} pages`).join(' | '),
          result: 'PASS (also reads encrypted-but-openable statements, ignoring the copy:no flag)' },
      ]);
    }, 600000);

    it('MEASURED: image-only scan returns only page framing — no invented text', async () => {
      const p = path.join(FIX, 'scanned-statement.pdf');
      const blob = await extractText(fileFrom(p));
      const txt = await blob.text();
      ev('pdf-to-text-scanned.txt', txt || '(empty)');
      const pop = execFileSync('pdftotext', [p, '-'], { encoding: 'utf8' });
      const body = txt.replace(/--- Page \d+ ---/g, '').trim();
      ev('pdf-to-text-scanned.json', JSON.stringify({ appBodyChars: body.length, popplerChars: pop.trim().length,
        appRaw: txt.slice(0, 300), mime: blob.type, blobSize: blob.size }, null, 2));
      expect(pop.trim().length).toBeLessThan(20);          // poppler agrees: there is no text layer
      expect(body.length).toBeLessThan(40);
      expect(body).not.toMatch(/[A-Za-z]{4}/);
      claimCheck('pdf-to-text:scanned-honesty', [
        { claim: 'src/registry/toolRegistry.ts:687 "Extract pure readable text from PDF documents instantly"',
          measured: 'image-only scan: app body = 0 characters, pdftotext = 0 characters, no text invented; output is only "--- Page 1 ---\n\n--- Page 2 ---"',
          result: 'HONEST, but the copy never says OCR is absent' },
      ]);
    }, 300000);
  });

  /* --------------------------------------------------------------- pdf-to-docx */
  describe('pdf-to-docx', () => {
    it('genuine DOCX: OOXML parts present, document.xml carries the words, and it is NOT a PDF', async () => {
      const { file, bytes } = gsTextPdf('pdf-to-docx-src', 2);
      const blob = await convertPdfToDocx(file);
      const out = await asBuf(blob);
      ev('pdf-to-docx-out.docx', out);
      expect(magic(out, '504b0304')).toBe(true);
      expect(magic(out, '255044462d'), 'a PDF renamed .docx').toBe(false);
      expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(out.length).toBeGreaterThan(1000);

      const zip = await JSZip.loadAsync(out);
      const names = Object.keys(zip.files);
      expect(names).toContain('word/document.xml');
      expect(names).toContain('[Content_Types].xml');
      const xml = await zip.file('word/document.xml')!.async('string');
      ev('pdf-to-docx-word-document.xml', xml);
      expect(xml).toMatch(/<w:body>/);
      expect((xml.match(/<w:p\b/g) || []).length).toBeGreaterThanOrEqual(4);
      for (let i = 1; i <= 2; i++) expect(xml, `document.xml lost ${TOK(i)}`).toContain(TOK(i));
      for (const w of ['SECOND', 'LINE', 'WORDS', 'MEASURE', 'Balance']) expect(xml).toContain(w);

      // Independent proof that a real word processor can open it: LibreOffice (the repo's own
      // prism-lo image) must read the file back and reproduce the document's words.
      let lo: { available: boolean; text?: string; words?: string[] } = { available: false };
      if (libreOfficeAvailable()) {
        const txt = libreOfficeToTxt(path.join(EV, 'pdf-to-docx-out.docx'));
        const words = (txt ?? '').split(/\s+/).filter(Boolean);
        lo = { available: true, text: txt ?? '(libreoffice produced no output)', words };
        ev('pdf-to-docx-libreoffice.txt', txt ?? '');
        for (let i = 1; i <= 2; i++) expect(txt!, `LibreOffice could not read ${TOK(i)}`).toContain(TOK(i));
        expect(txt!).toContain('Balance');
      }

      const structure = {
        parts: names,
        mediaParts: names.filter((n) => n.startsWith('word/media/')).length,
        documentXmlBytes: xml.length,
        paragraphCount: (xml.match(/<w:p\b/g) || []).length,
        headingParagraphs: (xml.match(/w:pStyle w:val="Heading/g) || []).length,
        fabricatedPageHeadings: (xml.match(/<w:t[^>]*>Page \d+</g) || []).length,
        runAttributes: { bold: /<w:b\s*\/>/.test(xml), italic: /<w:i\s*\/>/.test(xml), size: /<w:sz /.test(xml),
          color: /<w:color w:val/.test(xml), font: /<w:rFonts/.test(xml) },
        tables: /<w:tbl>/.test(xml),
        sections: (xml.match(/<w:sectPr/g) || []).length,
        sourcePageCount: 2,
        libreOfficeReadable: lo.available ? 'yes — see pdf-to-docx-libreoffice.txt' : 'skipped: prism-lo docker image unavailable',
      };
      ev('pdf-to-docx-structure.json', JSON.stringify(structure, null, 2));
      expect(structure.mediaParts).toBe(0);
      expect(structure.runAttributes.bold).toBe(false);
      expect(structure.runAttributes.size).toBe(false);
      expect(structure.fabricatedPageHeadings).toBe(2); // "Page 1"/"Page 2" injected by the converter
      expect(structure.sections).toBe(1);
      claimCheck('pdf-to-docx', [
        { claim: 'src/registry/toolRegistry.ts:830 "Convert PDF into editable Microsoft Word (.docx) document format"',
          measured: 'valid OOXML, one section, flat paragraphs, every run in the default Word font/size — editable but unstyled', result: 'PASS (container) / PARTIAL (conversion)' },
        { claim: 'ProcessingView.tsx:549 "Extracts text structure, typography, and headings"',
          measured: 'no bold/italic/size/color/rFonts attribute in document.xml; only heading paragraphs are the injected "Page N" ones; typography dropped', result: 'FALSE' },
        { claim: 'engine', measured: 'pdf.js getTextContent + docx Packer (services/pdfService.ts:1516-1593). No LibreOffice, no docling, no OCR in this path.', result: 'STATED' },
        { claim: 'images/figures carried into Word', measured: 'Robbie_Accountants_2026-01.pdf stores 6 rasters (pdfimages -list); the converted DOCX has word/media parts = 0 — see pdf-to-docx-real.json', result: 'FALSE' },
      ]);
    }, 300000);

    it('MEASURED: scanned PDF "succeeds" as an empty Word document', async () => {
      const file = fileFrom(path.join(FIX, 'scanned-statement.pdf'));
      const blob = await convertPdfToDocx(file);
      const out = await asBuf(blob);
      ev('pdf-to-docx-scanned.docx', out);
      const xml = await (await JSZip.loadAsync(out)).file('word/document.xml')!.async('string');
      const visible = xml.replace(/<[^>]+>/g, '');
      const words = (visible.match(/[A-Za-z]{3,}/g) || []).filter((w) => w !== 'Page');
      ev('pdf-to-docx-scanned.json', JSON.stringify({ xmlBytes: xml.length, visibleChars: visible.length, words, blobBytes: out.length, mime: blob.type }, null, 2));
      expect(words.length).toBe(0);      // silently empty, no warning surfaced to the caller
      expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    }, 300000);

    it('MEASURED: a real bank statement converts to a Word file of body text only', async () => {
      const p = path.join(STATEMENTS, 'Robbie_Accountants_2026-01.pdf');
      const blob = await convertPdfToDocx(fileFrom(p));
      const out = await asBuf(blob);
      const docxPath = ev('pdf-to-docx- Robbie.docx'.replace(' ', ''), out);
      expect(magic(out, '504b0304')).toBe(true);
      const xml = await (await JSZip.loadAsync(out)).file('word/document.xml')!.async('string');
      // OOXML escapes punctuation, so decode before comparing words or the probe reports ghosts.
      const xmlText = xml.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
      const words = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
      const pop = execFileSync('pdftotext', ['-layout', p, '-'], { encoding: 'utf8' });
      const tokens = [...new Set(pop.split(/[\s,;:]+/).filter((w) => /^[A-Za-z][A-Za-z.'-]{5,}$/.test(w)))];
      const missing = tokens.filter((t) => !xmlText.includes(t));
      ev('pdf-to-docx-real.json', JSON.stringify({ source: path.basename(p), docxBytes: out.length,
        textRuns: words.length, docxChars: xml.length, popplerWords: tokens.length, missingWords: missing.length,
        missingSample: missing.slice(0, 20), mediaParts: 0, pdfimagesStored: pdfimagesList(p).rows.length,
        imagesCarriedIntoDocx: (await JSZip.loadAsync(out)).file('word/media') ? 1 : 0 }, null, 2));
      const report = JSON.parse(fs.readFileSync(path.join(EV, 'pdf-to-docx-real.json'), 'utf8'));
      expect(report.pdfimagesStored).toBeGreaterThan(0);   // the source really does contain figures
      expect(report.imagesCarriedIntoDocx).toBe(0);        // and the DOCX contains none of them
      expect(missing.length / Math.max(1, tokens.length)).toBeLessThan(0.05);
    }, 600000);

    it('registry wiring: filename and content type are what the handler promises', async () => {
      const { file } = gsTextPdf('pdf-to-docx-reg', 1);
      const r = await getToolById('pdf-to-docx')!.handler!({ files: [file], options: {} });
      expect(r.filename).toBe('pdf-to-docx-reg.docx');
      expect((await asBuf(r.blob!)).subarray(0, 2).toString('hex')).toBe('504b');
    }, 300000);
  });

  /* ------------------------------------------------------------ extract-images */
  describe('extract-images', () => {
    it('extracts the stored rasters at their own resolution, once each, named by page', async () => {
      const { bytes, srcPath } = await imageBearingPdf();
      const truth = await embeddedImageAssets(u8(bytes));
      const pop = pdfimagesList(srcPath);
      expect(truth.perPage.length, 'fixture really stores 5 image placements').toBe(5);
      expect(truth.distinct.length, 'fixture really stores 4 distinct rasters').toBe(4);

      const { zipBlob, count } = await extractEmbeddedImages(new File([bytes], 'conv-images.pdf', { type: 'application/pdf' }));
      const zb = await asBuf(zipBlob);
      ev('extract-images-app.zip', zb);
      const zip = await JSZip.loadAsync(zb);
      const all = Object.keys(zip.files).filter((k) => !zip.files[k].dir).sort();
      const assets = all.filter((n) => n !== 'manifest.txt');
      const manifest = await zip.file('manifest.txt')!.async('string');

      // The old output was one whole-page render per PAGE: ['Page_001_render.png','Page_002_render.png']
      // for a document holding four distinct rasters across five placements.
      expect(assets.length, `assets written: ${assets.join(', ')}`).toBe(4);
      expect(count).toBe(4);
      expect(assets.filter((n) => n.endsWith('.jpg')).length).toBe(3);   // the three DCTDecode photos
      expect(assets.filter((n) => n.endsWith('.png')).length).toBe(1);   // the Flate sample data
      expect(assets.every((n) => /^p\d{3}_/.test(n)), 'named by originating page').toBe(true);
      expect(assets.some((n) => /_page\.png$/.test(n)), 'no page render: both pages carry images').toBe(false);

      const emitted: { name: string; dims: string; bytes: number }[] = [];
      for (const n of assets) {
        const b = Buffer.from(await zip.file(n)!.async('arraybuffer'));
        const d = await decode(b);
        emitted.push({ name: n, dims: `${d.w}x${d.h}`, bytes: b.length });
        ev(`extract-images-${n}`, b);
      }
      const gotDims = emitted.map((e) => e.dims).sort();
      const wantDims = truth.distinct.map((d) => `${d.w}x${d.h}`).sort();
      expect(gotDims).toEqual(wantDims);                                    // original resolution, not a 2x sheet
      expect(gotDims).toEqual(['120x90', '240x360', '300x200', '400x120']);
      // An oracle that never touched pdf-lib: poppler's own inventory of the stored rasters.
      const popDims = [...new Set(pop.rows.map((r) => `${r.width}x${r.height}`))].sort();
      expect(popDims).toEqual(wantDims);
      ev('extract-images-assets.json', JSON.stringify({ emitted, stored: wantDims, pdfimages: pop.rows }, null, 2));

      // The repeated asset must appear once in the ZIP and once in the manifest as a duplicate.
      expect(manifest).toMatch(/duplicate/i);
      expect(manifest).toMatch(/page 2/);
      ev('extract-images-manifest.txt', manifest);
    }, 600000);

    it('writes the JPEG assets as the exact bytes the document carries', async () => {
      const { bytes } = await imageBearingPdf();
      const source = await PDFDocument.load(u8(bytes), { ignoreEncryption: true });
      const stored: Buffer[] = [];
      for (const [, obj] of source.context.enumerateIndirectObjects()) {
        if (!(obj instanceof PDFRawStream)) continue;
        if (String(obj.dict.get(PDFName.of('Filter'))) !== '/DCTDecode') continue;
        stored.push(Buffer.from(obj.contents));
      }
      expect(stored.length).toBe(3);

      const { zipBlob } = await extractEmbeddedImages(new File([bytes], 'conv-images.pdf', { type: 'application/pdf' }));
      const zip = await JSZip.loadAsync(await asBuf(zipBlob));
      const jpgs = Object.keys(zip.files).filter((k) => k.endsWith('.jpg'));
      const out = await Promise.all(jpgs.map((n) => zip.file(n)!.async('uint8array').then((b) => Buffer.from(b))));
      for (const o of out) {
        expect(magic(o, 'ffd8ffe0') || magic(o, 'ffd8ffdb') || magic(o, 'ffd8ffee') || magic(o, 'ffd8ffe1'), 'a JPEG marker').toBe(true);
        expect(stored.some((s) => s.equals(o)), 'byte-for-byte equal to an embedded stream').toBe(true);
      }
      expect(new Set(out.map((o) => o.length)).size).toBe(3);               // three distinct photos, not one thrice
    }, 600000);

    it('reconstructs a Flate image losslessly: same pixels as the PNG that was embedded', async () => {
      const pc = createCanvas(120, 90);
      const g = pc.getContext('2d');
      g.fillStyle = 'rgb(10,120,220)'; g.fillRect(0, 0, 120, 90);
      g.fillStyle = 'rgb(250,250,40)'; g.fillRect(20, 20, 40, 30);
      const original = Buffer.from(pc.toBuffer('image/png'));

      const doc = await PDFDocument.create();
      const page = doc.addPage([200, 200]);
      page.drawImage(await doc.embedPng(u8(original)), { x: 10, y: 10, width: 120, height: 90 });
      const bytes = Buffer.from(await doc.save());

      const { zipBlob } = await extractEmbeddedImages(new File([bytes], 'flate-only.pdf', { type: 'application/pdf' }));
      const zip = await JSZip.loadAsync(await asBuf(zipBlob));
      const png = Object.keys(zip.files).find((k) => k.endsWith('.png'));
      expect(png, 'the Flate image is extracted as a PNG').toBeTruthy();
      const b = Buffer.from(await zip.file(png!)!.async('arraybuffer'));
      const s = pngScan(b)!;
      expect(s, 'and it is a structurally valid PNG').not.toBeNull();
      expect(s.iend).toBe(true);

      const a = await decode(original);
      const c = await decode(b);
      expect(`${c.w}x${c.h}`).toBe(`${a.w}x${a.h}`);
      // pdf-lib stores embedded PNGs as raw samples, so the ZIP cannot hold the original file bytes.
      // What it must hold is the same picture: every sample equal.
      let differing = 0;
      for (let i = 0; i < a.d.length; i++) if (a.d[i] !== c.d[i]) differing++;
      // Independent reader: a wrong ADLER32 byte order makes libpng reject the IDAT outright, while
      // the harness's own reader quietly returns the image minus its last row.
      const check = execFileSync('identify', [ev('extract-images-lossless.png', b)], { encoding: 'utf8' });
      expect(check.trim()).toMatch(/120x90/);
      ev('extract-images-lossless.json', JSON.stringify({ dims: `${c.w}x${c.h}`, differingSamples: differing, total: a.d.length }, null, 2));
      expect(differing).toBe(0);
    }, 600000);

    it('a stored scan comes out at its stored resolution, with its transparency kept', async () => {
      const p = path.join(FIX, 'scanned-statement.pdf');
      const truth = await embeddedImageAssets(u8(fs.readFileSync(p)));
      expect(truth.perPage.map((i) => `${i.w}x${i.h}`)).toEqual(['1240x1754', '1240x1754']);

      const { zipBlob, count } = await extractEmbeddedImages(fileFrom(p));
      const zip = await JSZip.loadAsync(await asBuf(zipBlob));
      const names = Object.keys(zip.files).filter((k) => !zip.files[k].dir && k !== 'manifest.txt').sort();
      const dims: string[] = [];
      for (const n of names) {
        const b = Buffer.from(await zip.file(n)!.async('arraybuffer'));
        const s = pngScan(b)!;
        expect(s, `${n} parses as a PNG`).not.toBeNull();
        expect(s.iend).toBe(true);
        dims.push(`${s.width}x${s.height}`);
        const tmp = ev(`extract-images-${n}`, b);
        // The harness's own PNG reader silently tolerates a broken zlib checksum and returns the image
        // minus its bottom rows. libpng does not: it refuses the IDAT. So validate with a second,
        // independent decoder before trusting a pixel comparison from the first.
        const check = execFileSync('identify', [String(tmp)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        expect(check.trim(), 'ImageMagick reads it without error').toMatch(/1240x1754/);
        expect([4, 6], 'the /SMask became an alpha channel').toContain(s.colorType);
      }
      // Two pages, two DIFFERENT scans (30,426 B and 30,723 B of stored samples) — not one asset twice.
      expect(dims).toEqual(['1240x1754', '1240x1754']);
      expect(count).toBe(2);
      expect(dims, 'never the old 2480x3508 page composite').not.toContain('2480x3508');
      ev('extract-images-scanned.json', JSON.stringify({ serviceCount: count, names, emittedDims: dims,
        storedScanDims: truth.perPage.map((i) => `${i.w}x${i.h}`) }, null, 2));
    }, 600000);

    it('a page with no images still produces something, labelled as a render', async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([300, 300]);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      page.drawText('PRISMCONV-PAGERENDER', { x: 20, y: 150, size: 12, font });
      const bytes = Buffer.from(await doc.save());

      const { zipBlob, count } = await extractEmbeddedImages(new File([bytes], 'text-only.pdf', { type: 'application/pdf' }));
      const zip = await JSZip.loadAsync(await asBuf(zipBlob));
      const names = Object.keys(zip.files).filter((k) => !zip.files[k].dir);
      const render = names.find((n) => /_page\.png$/.test(n));
      expect(render, 'a text-only page falls back to a render').toBeTruthy();
      const manifest = await zip.file('manifest.txt')!.async('string');
      expect(manifest, 'and the manifest says it is a render, not an asset').toMatch(/page render/);
      expect(count).toBe(1);
    }, 600000);

    it('keeps a byte-exact JPEG byte-exact, and reports that its mask stayed behind', async () => {
      const jc = createCanvas(40, 30);
      jc.getContext('2d').fillStyle = 'rgb(200,30,30)';
      jc.getContext('2d').fillRect(0, 0, 40, 30);
      const jpg = Buffer.from(jc.toBuffer('image/jpeg', 90));
      const draft = await PDFDocument.create();
      const draftPage = draft.addPage([200, 200]);
      draftPage.drawImage(await draft.embedJpg(new Uint8Array(jpg)), { x: 10, y: 10, width: 40, height: 30 });

      // The image only enters the document's own object table at save time, so the mask is attached to
      // the reloaded document — which is also exactly how an editor leaves it: a stream, plus /SMask.
      const doc = await PDFDocument.load(new Uint8Array(Buffer.from(await draft.save())));
      const imgEntry = doc.context.enumerateIndirectObjects().find(([, o]) =>
        o instanceof PDFRawStream && String(o.dict.get(PDFName.of('Subtype'))) === '/Image');
      expect(imgEntry, 'the draft really carries one embedded image').toBeTruthy();
      const mask = doc.context.register(doc.context.flateStream(new Uint8Array(40 * 30).fill(255), {
        Type: 'XObject', Subtype: 'Image', Width: 40, Height: 30,
        ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode',
      }));
      (imgEntry![1] as PDFRawStream).dict.set(PDFName.of('SMask'), mask);
      const bytes = Buffer.from(await doc.save());

      const { zipBlob } = await extractEmbeddedImages(new File([bytes], 'masked-jpeg.pdf', { type: 'application/pdf' }));
      const zip = await JSZip.loadAsync(await asBuf(zipBlob));
      const jpgName = Object.keys(zip.files).find((n) => n.endsWith('.jpg'));
      expect(jpgName, 'the JPEG is still extracted').toBeTruthy();
      const out = Buffer.from(await zip.file(jpgName!)!.async('arraybuffer'));
      expect(out.equals(jpg), 'as the document’s own bytes, unaltered').toBe(true);

      const manifest = await zip.file('manifest.txt')!.async('string');
      expect(manifest).toMatch(/SMask/);
      expect(manifest, 'and the ZIP does not pretend the transparency came with it').toMatch(/without their mask|transparency/i);
      ev('extract-images-masked-jpeg-manifest.txt', manifest);
    }, 600000);

    it('a real bank statement: the JPEG-inside-Flate images come out as JPEGs', async () => {
      const p = path.join(ROOT, 'tests', 'fixtures', 'statements', 'July 2026.pdf');
      const bytes = fs.readFileSync(p);

      const truth = await embeddedImageAssets(new Uint8Array(bytes));
      expect(truth.perPage.length, 'the statement really stores images').toBeGreaterThan(2);

      const { zipBlob, count } = await extractEmbeddedImages(fileFrom(p));
      const zip = await JSZip.loadAsync(await asBuf(zipBlob));
      const names = Object.keys(zip.files).filter((k) => !zip.files[k].dir && k !== 'manifest.txt');
      const manifest = await zip.file('manifest.txt')!.async('string');

      const jpgs = names.filter((n) => n.endsWith('.jpg'));
      for (const n of jpgs) {
        const b = Buffer.from(await zip.file(n)!.async('arraybuffer'));
        expect(magic(b, 'ffd8'), `${n} is a genuine JPEG codestream`).toBe(true);
        const info = execFileSync('identify', [ev(`extract-images-real-${n}`, b)], { encoding: 'utf8' });
        expect(info.trim(), `${n} opens in an independent decoder`).toMatch(/\d+x\d+/);
      }
      ev('extract-images-real-ned.json', JSON.stringify({
        storedPlacements: truth.perPage.length, written: count, names,
        manifest: manifest.split('\n').filter((l) => /page \d/.test(l)),
      }, null, 2));

      // Before: pdf-lib refused `[ /FlateDecode /DCTDecode ]` outright and three of the five stored
      // images were reported unreadable. Nothing may be left behind on a document this product sells.
      expect(jpgs.length, `JPEGs recovered from the Flate wrapper: ${jpgs.join(', ')}`).toBeGreaterThanOrEqual(3);
      expect(manifest, 'and nothing is silently dropped').not.toMatch(/Could not be extracted/);
      expect(count).toBeGreaterThanOrEqual(4);
    }, 600000);

    it('every file it emits is a real, decodable image with content in it', async () => {
      const { srcPath: p } = await imageBearingPdf();
      const { zipBlob } = await extractEmbeddedImages(fileFrom(p));
      const zip = await JSZip.loadAsync(await asBuf(zipBlob));
      const n = Object.keys(zip.files).filter((k) => !zip.files[k].dir)[0];
      const b = Buffer.from(await zip.file(n)!.async('arraybuffer'));
      const s = await pix(b);
      expect(s.levels).toBeGreaterThan(10);
      expect(s.darkFrac).toBeGreaterThan(0.01);  // the four images do show up in the composite
      ev('extract-images-selfcheck.json', JSON.stringify({ file: n, dims: `${s.w}x${s.h}`, mean: +s.mean.toFixed(2), darkFrac: +s.darkFrac.toFixed(5), levels: s.levels }, null, 2));
    }, 300000);
  });

  /* ---------------------------------------------------------------- scan-effect */
  describe('scan-effect', () => {
    it('MEASURED: grain/contrast/deskew all really move pixels, but the page is flattened to a greyscale raster', async () => {
      const srcPath = path.join(STATEMENTS, 'July 2026.pdf');
      const evSrc = ev('scan-effect-src.pdf', fs.readFileSync(srcPath));
      const file = fileFrom(srcPath);
      const bytes = await asBuf(await scannerEffect(file, { contrast: 1.2, noise: 15, tilt: true }));
      const outPath = ev('scan-effect-out.pdf', bytes);
      expect(magic(bytes, '255044462d')).toBe(true);

      const beforeInfo = execFileSync('pdfinfo', [evSrc], { encoding: 'utf8' });
      const afterInfo = execFileSync('pdfinfo', [outPath], { encoding: 'utf8' });
      expect((afterInfo.match(/Pages:\s+(\d+)/) || [])[1]).toBe((beforeInfo.match(/Pages:\s+(\d+)/) || [])[1]);
      expect((afterInfo.match(/Page size:\s+(.+)/) || [])[1]).toBe((beforeInfo.match(/Page size:\s+(.+)/) || [])[1]);

      execFileSync('pdftoppm', ['-r', '100', '-png', '-f', '1', '-l', '1', evSrc, path.join(EV, 'scan-before')]);
      execFileSync('pdftoppm', ['-r', '100', '-png', '-f', '1', '-l', '1', outPath, path.join(EV, 'scan-after')]);
      const before = fs.readFileSync(path.join(EV, 'scan-before-1.png'));
      const after = fs.readFileSync(path.join(EV, 'scan-after-1.png'));
      const b = await pix(before), a = await pix(after);
      expect([a.w, a.h]).toEqual([b.w, b.h]);
      expect(a.darkFrac).toBeGreaterThan(0.001);       // not a black box, not a blank box
      expect(a.mean).toBeLessThan(250);
      expect(Math.abs(a.mean - b.mean)).toBeGreaterThan(0.2); // contrast actually moved the tone

      // paper grain must appear on blank paper, where the source is uniformly white
      const band = await blankBand(before);
      const paperBefore = await cropStats(before, 0.05, band.y0, 0.9, band.ch);
      const paperAfter = await cropStats(after, 0.05, band.y0, 0.9, band.ch);
      expect(paperBefore.std).toBeLessThan(1.5);
      expect(paperAfter.std, 'scanner grain did not reach the blank paper').toBeGreaterThan(1.5);

      const noTilt = await asBuf(await scannerEffect(file, { contrast: 1.2, noise: 15, tilt: false }));
      ev('scan-effect-notilt.pdf', noTilt);
      execFileSync('pdftoppm', ['-r', '100', '-png', '-f', '1', '-l', '1', path.join(EV, 'scan-effect-notilt.pdf'), path.join(EV, 'scan-notilt')]);
      const nt = await pix(fs.readFileSync(path.join(EV, 'scan-notilt-1.png')));
      const tiltMae = blockMae(nt.blocks, a.blocks);

      // ISOLATED DESKEW PROBE: the grain is per-pixel Math.random(), so comparing tilt ON vs OFF at
      // noise=15 measures two independent noise fields, not geometry. Re-run both with noise
      // disabled and neutral contrast so the ONLY possible difference is the claimed rotation.
      const tiltOnly = await asBuf(await scannerEffect(file, { contrast: 1, noise: 0, tilt: true }));
      ev('scan-effect-tiltone.pdf', tiltOnly);
      const flat = await asBuf(await scannerEffect(file, { contrast: 1, noise: 0, tilt: false }));
      ev('scan-effect-flattone.pdf', flat);
      execFileSync('pdftoppm', ['-r', '100', '-png', '-f', '1', '-l', '1', path.join(EV, 'scan-effect-tiltone.pdf'), path.join(EV, 'scan-tilt')]);
      execFileSync('pdftoppm', ['-r', '100', '-png', '-f', '1', '-l', '1', path.join(EV, 'scan-effect-flattone.pdf'), path.join(EV, 'scan-flat')]);
      const t1 = await pix(fs.readFileSync(path.join(EV, 'scan-tilt-1.png')));
      const t0 = await pix(fs.readFileSync(path.join(EV, 'scan-flat-1.png')));
      const deskewMae = blockMae(t0.blocks, t1.blocks);
      // ...and the deterministic floor: identical settings twice must differ only by JPEG loss.
      const flat2 = await asBuf(await scannerEffect(file, { contrast: 1, noise: 0, tilt: false }));
      execFileSync('pdftoppm', ['-r', '100', '-png', '-f', '1', '-l', '1', ev('scan-effect-flattone2.pdf', flat2), path.join(EV, 'scan-flat2')]);
      const floorMae = blockMae(t0.blocks, (await pix(fs.readFileSync(path.join(EV, 'scan-flat2-1.png')))).blocks);

      // Does the filter also throw away colour? (grayscale conversion is in the code, not the copy)
      const chBefore = await cropChannelStats(before, 0, 0, 1, 1);
      const chAfter = await cropChannelStats(after, 0, 0, 1, 1);

      const txtBefore = execFileSync('pdftotext', [evSrc, '-'], { encoding: 'utf8' }).trim();
      const txtAfter = execFileSync('pdftotext', [outPath, '-'], { encoding: 'utf8' }).trim();
      const storedAfter = pdfimagesList(outPath).rows;
      const report = {
        before: { dims: `${b.w}x${b.h}`, mean: +b.mean.toFixed(2), darkFrac: +b.darkFrac.toFixed(5), levels: b.levels },
        after: { dims: `${a.w}x${a.h}`, mean: +a.mean.toFixed(2), darkFrac: +a.darkFrac.toFixed(5), levels: a.levels },
        blankPaperBand: { y: [+band.y0.toFixed(3), +band.ch.toFixed(3)], before: paperBefore, after: paperAfter },
        tiltVsNoTiltBlockMaeAtNoise15: +tiltMae.toFixed(3),
        isolatedDeskew: { blockMaeTiltVsFlat: +deskewMae.toFixed(3), repeatRunFloorBlockMae: +floorMae.toFixed(3),
          note: 'noise=0, contrast=1 on both runs so only geometry can differ; repeatRunFloor is the JPEG/run-to-run floor' },
        colour: { before: chBefore, after: chAfter },
        textChars: { before: txtBefore.length, after: txtAfter.length },
        storedImagesInOutput: storedAfter.length,
        outputIsRasterised: storedAfter.length > 0 && txtAfter.length < 5,
      };
      ev('scan-effect-report.json', JSON.stringify(report, null, 2));
      expect(report.outputIsRasterised).toBe(true);
      expect(deskewMae, 'deskew moves nothing').toBeGreaterThan(floorMae + 0.5);
      claimCheck('scan-effect', [
        { claim: 'src/registry/toolRegistry.ts:940 "authentic physical paper grain, photocopy toner contrast, and realistic scanner deskew"',
          measured: `grain real: blank-paper std ${paperBefore.std.toFixed(2)} -> ${paperAfter.std.toFixed(2)}, grey levels on blank paper ${paperBefore.levels} -> ${paperAfter.levels}. contrast weak: page mean ${b.mean.toFixed(2)} -> ${a.mean.toFixed(2)}, darkFrac ${b.darkFrac.toFixed(5)} -> ${a.darkFrac.toFixed(5)}. deskew (noise=0): blockMae ${deskewMae.toFixed(3)} vs run-to-run floor ${floorMae.toFixed(3)}`,
          result: deskewMae > floorMae + 0.5 ? 'PASS (all three effects measurable)' : 'PARTIAL — deskew not observable' },
        { claim: 'cost of the effect', measured: `${txtBefore.length} chars of text layer before -> ${txtAfter.length} after; output page is a single embedded raster`, result: 'TEXT LAYER DESTROYED (undocumented)' },
        { claim: 'colour preservation', measured: `page mean RGB before ${Object.values(chBefore).map((v) => v.toFixed(1)).join('/')} -> after ${Object.values(chAfter).map((v: number) => v.toFixed(1)).join('/')}`,
          result: Math.abs(chAfter.r - chAfter.b) < 0.5 ? 'PAGES CONVERTED TO GREYSCALE (undocumented)' : 'colour kept' },
        { claim: 'noise control', measured: 'registry reads options.scannerNoise (toolRegistry.ts:949) but ProcessingView exposes only contrast and tilt — no slider writes scannerNoise', result: 'UNREACHABLE FROM UI' },
      ]);
    }, 900000);
  });

  /* --------------------------------------------------------------- invert-colors */
  describe('invert-colors', () => {
    it('MEASURED: a true channel inversion (mean, histogram-inverse r, block-inverse MAE), and the text layer is destroyed', async () => {
      const srcPath = path.join(STATEMENTS, 'July 2026.pdf');
      const evSrc = ev('invert-src.pdf', fs.readFileSync(srcPath));
      const bytes = await asBuf(await invertPdfColors(fileFrom(srcPath)));
      const outPath = ev('invert-out.pdf', bytes);
      expect(magic(bytes, '255044462d')).toBe(true);

      execFileSync('pdftoppm', ['-r', '144', '-png', '-f', '1', '-l', '1', evSrc, path.join(EV, 'inv-before')]);
      execFileSync('pdftoppm', ['-r', '144', '-png', '-f', '1', '-l', '1', outPath, path.join(EV, 'inv-after')]);
      const before = fs.readFileSync(path.join(EV, 'inv-before-1.png'));
      const after = fs.readFileSync(path.join(EV, 'inv-after-1.png'));
      const b = await pix(before), a = await pix(after);
      expect(Math.abs(a.w - b.w)).toBeLessThanOrEqual(2);
      expect(Math.abs(a.h - b.h)).toBeLessThanOrEqual(2);
      expect(Math.abs(a.mean - (255 - b.mean)), 'not an inversion: mean is not 255-original').toBeLessThan(12);
      expect(a.darkFrac).toBeGreaterThan(0.5);
      expect(b.darkFrac).toBeLessThan(0.5);

      // (1) alignment-free signature: the output's luminance histogram must be the source's
      // histogram read backwards. A black/grey box or a redrawn page cannot satisfy this.
      const histR = pearson(await histogram(before), flipHistogram(await histogram(after)));
      // (2) layout signature: invert the source 32x32 fingerprint and compare with the output's.
      const blockInvMae = blockMae(Float64Array.from(b.blocks, (v) => 255 - v), a.blocks);
      // (3) per-pixel on the matched 144 dpi grid, re-inverting the output must reproduce the source.
      const A = await decode(before), B = await decode(after);
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, cnt = 0, mad = 0;
      const wmin = Math.min(A.w, B.w), hmin = Math.min(A.h, B.h);
      for (let y = 0; y < hmin; y += 3) for (let x = 0; x < wmin; x += 3) {
        const i = (y * A.w + x) * 4, j = (y * B.w + x) * 4;
        const xa = lum(A.d, i);
        const inv = 255 - (B.d[j] + B.d[j + 1] + B.d[j + 2]) / 3;
        mad += Math.abs(xa - inv);
        sa += xa; sb += inv; saa += xa * xa; sbb += inv * inv; sab += xa * inv; cnt++;
      }
      const corr = pearsonFromMoments(sa, sb, saa, sbb, sab, cnt);
      const meanAbsErr = mad / Math.max(1, cnt);
      expect(histR, `output histogram is not the inverse of the source (r=${histR.toFixed(4)})`).toBeGreaterThan(0.95);
      expect(blockInvMae, `output layout is not the inverse of the source (mae=${blockInvMae.toFixed(2)})`).toBeLessThan(25);

      // the photograph region: "smart inversion keeps images natural" must show up here
      const photoRegion = await cropRegionPair(before, after, 0.04, 0.03, 0.55, 0.22);
      const txtBefore = execFileSync('pdftotext', [evSrc, '-'], { encoding: 'utf8' }).trim();
      const txtAfter = execFileSync('pdftotext', [outPath, '-'], { encoding: 'utf8' }).trim();
      const report = {
        before: { dims: `${b.w}x${b.h}`, mean: +b.mean.toFixed(2), darkFrac: +b.darkFrac.toFixed(4) },
        after: { dims: `${a.w}x${a.h}`, mean: +a.mean.toFixed(2), darkFrac: +a.darkFrac.toFixed(4) },
        expectedAfterMean: +(255 - b.mean).toFixed(2),
        histogramInversePearsonR: +histR.toFixed(4),
        blockInverseMae: +blockInvMae.toFixed(2),
        perPixel: { samples: cnt, pearsonR: +corr.toFixed(4), meanAbsErrorAfterReinverting: +meanAbsErr.toFixed(2),
          note: 'pdf.js raster at scale 2.0 re-rasterised by poppler: resampling + JPEG loss make strict per-pixel agreement impossible' },
        photoRegion, textChars: { before: txtBefore.length, after: txtAfter.length },
      };
      ev('invert-colors-report.json', JSON.stringify(report, null, 2));
      expect(Math.abs(photoRegion.afterMean - (255 - photoRegion.beforeMean))).toBeLessThan(14); // photos are inverted too
      expect(txtAfter.length).toBeLessThan(5);
      expect(txtBefore.length).toBeGreaterThan(100);
      claimCheck('invert-colors', [
        { claim: 'src/registry/toolRegistry.ts:959 "Invert page color spectrum for dark-mode reading"',
          measured: `channel inversion confirmed: mean ${b.mean.toFixed(1)} -> ${a.mean.toFixed(1)} (expected ${report.expectedAfterMean}), histogram-inverse r=${histR.toFixed(4)}, block-inverse mae=${blockInvMae.toFixed(2)}`, result: 'PASS' },
        { claim: 'site/assets/features.data.js:115 "Smart inversion keeps images and figures natural"',
          measured: `photo crop mean ${photoRegion.beforeMean} -> ${photoRegion.afterMean}: inverted like everything else; no region/asset awareness in services/pdfService.ts:1976-2033`, result: 'FALSE' },
        { claim: 'site/assets/features.data.js:114 "Flip a document to a dark background ... without turning it into a negative mess"',
          measured: 'output is a flattened raster: colour photos become negatives (darkFrac>0.5) and the text layer is destroyed', result: 'OVERSTATEMENT' },
      ]);
    }, 900000);

    it('MEASURED: embedded colour images become channel negatives — there is no "smart" protection', async () => {
      // Fixture page (500x500 pt) carries four known rasters; the first is a pale-red JPEG
      // (rgb ~255/221/221) placed at x 10..160, y 300..400 (PDF coords, origin bottom-left).
      const { srcPath } = await imageBearingPdf();
      const bytes = await asBuf(await invertPdfColors(fileFrom(srcPath)));
      const outPath = ev('invert-images-out.pdf', bytes);
      execFileSync('pdftoppm', ['-r', '144', '-png', '-f', '1', '-l', '1', srcPath, path.join(EV, 'invimg-before')]);
      execFileSync('pdftoppm', ['-r', '144', '-png', '-f', '1', '-l', '1', outPath, path.join(EV, 'invimg-after')]);
      const before = fs.readFileSync(path.join(EV, 'invimg-before-1.png'));
      const after = fs.readFileSync(path.join(EV, 'invimg-after-1.png'));
      // 500 pt page at 144 dpi = 1000 px, so pt * 2 == px; PDF y-up flips against image y-down.
      const crop = { x0: 20 / 1000, y0: (500 - 400) * 2 / 1000, w: 140 / 1000, h: 90 / 1000 };
      const cb = await cropChannelStats(before, crop.x0, crop.y0, crop.w, crop.h);
      const ca = await cropChannelStats(after, crop.x0, crop.y0, crop.w, crop.h);
      const expected = { r: 255 - cb.r, g: 255 - cb.g, b: 255 - cb.b };
      const err = Math.abs(ca.r - expected.r) + Math.abs(ca.g - expected.g) + Math.abs(ca.b - expected.b);
      const coloured = Math.abs(cb.r - cb.b) > 10;   // the source crop really is coloured
      ev('invert-images-report.json', JSON.stringify({
        cropPx: { x: Math.round(crop.x0 * 1000), y: Math.round(crop.y0 * 1000), w: Math.round(crop.w * 1000), h: Math.round(crop.h * 1000) },
        sourceImageMeanRgb: { r: +cb.r.toFixed(2), g: +cb.g.toFixed(2), b: +cb.b.toFixed(2) },
        outputImageMeanRgb: { r: +ca.r.toFixed(2), g: +ca.g.toFixed(2), b: +ca.b.toFixed(2) },
        expectedIfInverted: { r: +expected.r.toFixed(2), g: +expected.g.toFixed(2), b: +expected.b.toFixed(2) },
        channelAbsErrorTotal: +err.toFixed(2), samples: cb.samples,
      }, null, 2));
      expect(coloured, 'fixture crop is not coloured — probe is void').toBe(true);
      expect(err, 'colour image was NOT inverted like the rest of the page').toBeLessThan(30);
      claimCheck('invert-colors:images', [
        { claim: 'site/assets/features.data.js:115 "Smart inversion keeps images and figures natural"',
          measured: `pale-red embedded JPEG (mean RGB ${cb.r.toFixed(0)}/${cb.g.toFixed(0)}/${cb.b.toFixed(0)}) comes out at ${ca.r.toFixed(0)}/${ca.g.toFixed(0)}/${ca.b.toFixed(0)} — the exact complement, channel error ${err.toFixed(1)}`,
          result: 'FALSE — photographs are turned into colour negatives' },
      ]);
    }, 900000);

    it('MEASURED: inverted scan is dark, inked and still readable as an image', async () => {
      const bytes = await asBuf(await invertPdfColors(fileFrom(path.join(FIX, 'scanned-statement.pdf'))));
      const outPath = ev('invert-scanned.pdf', bytes);
      execFileSync('pdftoppm', ['-r', '36', '-png', '-f', '1', '-l', '1', outPath, path.join(EV, 'inv-scan-after')]);
      const s = await pix(fs.readFileSync(path.join(EV, 'inv-scan-after-1.png')));
      expect(s.mean).toBeLessThan(200);
      expect(s.darkFrac).toBeGreaterThan(0.5);
      expect(s.levels).toBeGreaterThan(20); // not a flat black box
      ev('invert-scanned.json', JSON.stringify({ dims: `${s.w}x${s.h}`, mean: +s.mean.toFixed(2), darkFrac: +s.darkFrac.toFixed(4), levels: s.levels }, null, 2));
    }, 600000);
  });
});

/* ----------------------------------------------------------- pixel helpers */
async function cropRegionPair(a: Buffer, b: Buffer, x0: number, y0: number, w: number, h: number) {
  const A = await cropStats(a, x0, y0, w, h);
  const B = await cropStats(b, x0, y0, w, h);
  return { beforeMean: +A.mean.toFixed(2), afterMean: +B.mean.toFixed(2), beforeStd: +A.std.toFixed(2), afterStd: +B.std.toFixed(2), samples: A.n };
}

/* ------------------------------------------------------------- pixel maths */
async function cropChannelStats(buf: Buffer, x0: number, y0: number, w: number, h: number) {
  const { d, w: W, h: H } = await decode(buf);
  const X0 = Math.floor(x0 * W), Y0 = Math.floor(y0 * H), X1 = Math.min(W, X0 + Math.floor(w * W)), Y1 = Math.min(H, Y0 + Math.floor(h * H));
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
    const i = (y * W + x) * 4;
    if (d[i + 3] < 250) continue;
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  return { r: r / Math.max(1, n), g: g / Math.max(1, n), b: b / Math.max(1, n), samples: n };
}
function histogram(buf: Buffer) {
  return decode(buf).then(({ d, w, h }) => {
    const out = new Float64Array(256);
    for (let i = 0; i < w * h; i += 3) out[Math.min(255, Math.round(lum(d, i * 4)))]++;
    return out;
  });
}
const flipHistogram = (a: Float64Array) => { const o = new Float64Array(256); for (let i = 0; i < 256; i++) o[i] = a[255 - i]; return o; };
function pearson(x: ArrayLike<number>, y: ArrayLike<number>) {
  const n = Math.min(x.length, y.length);
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; syy += y[i] * y[i]; sxy += x[i] * y[i]; }
  return pearsonFromMoments(sx, sy, sxx, syy, sxy, n);
}
function pearsonFromMoments(sx: number, sy: number, sxx: number, syy: number, sxy: number, n: number) {
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return den === 0 ? 0 : (n * sxy - sx * sy) / den;
}
