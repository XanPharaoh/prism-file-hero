/**
 * Batch 01 hardening — non-mocked redaction coverage beyond text removal:
 *   • a TEXT-FREE (scanned/image-only) PDF must still be VISUALLY blacked out
 *     (verified by rendering the output and sampling pixels), because text
 *     extraction alone cannot prove a redaction;
 *   • rotated pages and mixed page sizes keep page count + dimensions;
 *   • cancellation throws and returns nothing (never a partial redaction).
 * Real pdf-lib to build, real pdfjs-dist to render + extract.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { redactPdf } from '../services/pdfService';

const SECRET = 'SCAN-SECRET-9F3C';

async function grayImagePdf(pageW = 400, pageH = 300): Promise<File> {
  // A page that is ONLY a flat gray raster — no text layer at all (scanned proxy).
  const c = document.createElement('canvas');
  c.width = pageW; c.height = pageH;
  const g = c.getContext('2d')!;
  g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, pageW, pageH);
  const jpg = Uint8Array.from(atob(c.toDataURL('image/jpeg', 0.95).split(',')[1]), ch => ch.charCodeAt(0));

  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(jpg);
  const page = doc.addPage([pageW, pageH]);
  page.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
  const bytes = await doc.save();
  return new File([bytes], 'scanned.pdf', { type: 'application/pdf' });
}

async function renderMeanLuma(blob: Blob, page: number, box: { x: number; y: number; w: number; h: number }): Promise<number> {
  const u8 = new Uint8Array(await blob.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data: u8.slice(0) }).promise;
  const p = await doc.getPage(page);
  const vp = p.getViewport({ scale: 1 });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = c.getContext('2d')!;
  await p.render({ canvasContext: ctx, viewport: vp }).promise;
  const { data } = ctx.getImageData(Math.max(0, box.x), Math.max(0, box.y), Math.max(1, box.w), Math.max(1, box.h));
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  void SECRET;
  return sum / (data.length / 4);
}

describe('redaction is visually enforced, not just text removal', () => {
  it('blacks out a region on a text-free (scanned) PDF', async () => {
    const file = await grayImagePdf();
    const out = await redactPdf(file, [
      { page: 1, x: 0, y: 0, width: 200, height: 300 }, // left half, top-origin box
    ]);
    // Left half should now be near-black; right half should stay mid-gray.
    const left = await renderMeanLuma(out, 1, { x: 20, y: 20, w: 120, h: 200 });
    const right = await renderMeanLuma(out, 1, { x: 240, y: 20, w: 120, h: 200 });
    expect(left).toBeLessThan(40);   // blacked out
    expect(right).toBeGreaterThan(120); // preserved (gray ~ 154)
  }, 60000);
});

describe('geometry preservation', () => {
  it('preserves page count and per-page dimensions for mixed sizes', async () => {
    const doc = await PDFDocument.create();
    const f = await doc.embedFont(StandardFonts.Helvetica);
    const p1 = doc.addPage([612, 792]); p1.drawText(`X ${SECRET}`, { x: 50, y: 700, size: 16, font: f });
    const p2 = doc.addPage([400, 300]); p2.drawText('SECOND UNSELECTED', { x: 40, y: 200, size: 14, font: f });
    const bytes = await doc.save();
    const file = new File([bytes], 'mixed.pdf', { type: 'application/pdf' });

    const out = await redactPdf(file, [{ page: 1, text: SECRET, x: 0, y: 0, width: 0, height: 0 }]);
    const outDoc = await PDFDocument.load(await out.arrayBuffer());
    expect(outDoc.getPageCount()).toBe(2);
    const s1 = outDoc.getPage(0).getSize();
    const s2 = outDoc.getPage(1).getSize();
    expect(Math.round(s1.width)).toBe(612);
    expect(Math.round(s2.width)).toBe(400); // unselected page kept, not dropped
  }, 60000);

  it('redacts a 90°-rotated page and preserves orientation', async () => {
    const doc = await PDFDocument.create();
    const f = await doc.embedFont(StandardFonts.Helvetica);
    const p = doc.addPage([400, 600]);
    p.drawText(`ROT ${SECRET}`, { x: 40, y: 500, size: 16, font: f });
    p.setRotation(degrees(90));
    const bytes = await doc.save();
    const file = new File([bytes], 'rot.pdf', { type: 'application/pdf' });

    const out = await redactPdf(file, [{ page: 1, text: SECRET, x: 0, y: 0, width: 0, height: 0 }]);
    const u8 = new Uint8Array(await out.arrayBuffer());
    const pd = await pdfjsLib.getDocument({ data: u8.slice(0) }).promise;
    expect(pd.numPages).toBe(1);
    const vp = (await pd.getPage(1)).getViewport({ scale: 1 });
    // A 400x600 page rotated 90° is displayed 600x400 — orientation preserved.
    expect(Math.round(vp.width)).toBe(600);
    expect(Math.round(vp.height)).toBe(400);
    // Rasterized output has no extractable text, so the rotated secret is gone too.
    const tc = await (await pd.getPage(1)).getTextContent();
    expect(tc.items.map((i: any) => i.str).join(' ')).not.toContain(SECRET);
  }, 60000);
});

describe('cancellation and no-partial guarantee', () => {
  it('throws AbortError and produces no output when the signal is already aborted', async () => {
    const doc = await PDFDocument.create();
    const p = doc.addPage([300, 300]); p.drawText('hi', { x: 40, y: 200 });
    const file = new File([await doc.save()], 'c.pdf', { type: 'application/pdf' });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      redactPdf(file, [{ page: 1, x: 0, y: 0, width: 10, height: 10 }], { signal: ctrl.signal })
    ).rejects.toThrow(/cancel|abort/i);
  }, 30000);

  it('aborts mid-document when cancellation fires after the first page', async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 3; i++) { const p = doc.addPage([300, 300]); p.drawText(`P${i}`, { x: 40, y: 200 }); }
    const file = new File([await doc.save()], 'multi.pdf', { type: 'application/pdf' });
    const ctrl = new AbortController();
    // Abort as soon as work starts; the loop checks between pages.
    setTimeout(() => ctrl.abort(), 0);
    await expect(
      redactPdf(file, [{ page: 1, x: 0, y: 0, width: 10, height: 10 }], { signal: ctrl.signal })
    ).rejects.toThrow(/cancel|abort/i);
  }, 30000);
});
