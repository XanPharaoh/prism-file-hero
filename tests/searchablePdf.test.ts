/**
 * Batch 07 — searchable-PDF builder test (local, no tesseract/network). A scanned page is
 * a raster with NO native text; we preserve that image and overlay an invisible positioned
 * text layer. Asserts BOTH: the words are extractable (searchable) AND the original page
 * image is still visible (a transcript PDF would lose the raster).
 */
import { describe, it, expect } from 'vitest';
import * as pdfjsLib from 'pdfjs-dist';
import { createSearchablePdf } from '../services/pdfService';

function pageImage(): { png: Uint8Array; w: number; h: number } {
  const w = 240, h = 120;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  // A solid black band on the LEFT third — the "scanned glyph" a transcript would erase.
  ctx.fillStyle = '#000000'; ctx.fillRect(10, 20, 60, 40);
  const png = Uint8Array.from(atob(c.toDataURL('image/png').split(',')[1]), ch => ch.charCodeAt(0));
  return { png, w, h };
}

async function textOf(blob: Blob): Promise<string> {
  const u8 = new Uint8Array(await blob.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data: u8.slice(0) }).promise;
  let out = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    out += tc.items.map((i: any) => i.str).join(' ');
  }
  return out;
}

async function leftBandIsDark(blob: Blob): Promise<boolean> {
  const u8 = new Uint8Array(await blob.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data: u8.slice(0) }).promise;
  const p = await doc.getPage(1);
  const vp = p.getViewport({ scale: 1 });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const ctx = c.getContext('2d')!;
  await p.render({ canvasContext: ctx, viewport: vp }).promise;
  const { data } = ctx.getImageData(20, 30, 20, 20); // inside the black band region
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return sum / (data.length / 4) < 60; // dark ⇒ the scanned image survived
}

describe('createSearchablePdf preserves the scan + adds a positioned text layer', () => {
  it('words are extractable and the original page image is retained', async () => {
    const { png, w, h } = pageImage();
    const blob = await createSearchablePdf([{
      image: png, imageType: 'png',
      pixelWidth: w, pixelHeight: h, pdfWidth: w, pdfHeight: h,
      words: [
        { text: 'INVOICE', x: 10, y: 20, width: 60, height: 14 },
        { text: 'TOTAL 42.00', x: 10, y: 70, width: 120, height: 14 },
      ],
    }]);

    const text = await textOf(blob);
    expect(text).toMatch(/INVOICE/);          // searchable text layer present
    expect(text).toMatch(/TOTAL 42\.00/);
    expect(await leftBandIsDark(blob)).toBe(true); // scanned raster preserved, not re-typeset
  }, 60000);

  it('rejects invalid page dimensions instead of silently omitting a page', async () => {
    await expect(createSearchablePdf([
      { image: new Uint8Array(), imageType: 'png', pixelWidth: 0, pixelHeight: 0, pdfWidth: 0, pdfHeight: 0, words: [] },
    ])).rejects.toThrow(/invalid dimensions|empty image/i);
  }, 30000);

  it('places each invisible word near its source box (search maps to the scanned position)', async () => {
    const { png, w, h } = pageImage();
    const box = { text: 'HELLO', x: 120, y: 40, width: 100, height: 20 }; // right half, away from the band
    const blob = await createSearchablePdf([{
      image: png, imageType: 'png', pixelWidth: w, pixelHeight: h, pdfWidth: w, pdfHeight: h, words: [box],
    }]);
    const u8 = new Uint8Array(await blob.arrayBuffer());
    const doc = await pdfjsLib.getDocument({ data: u8.slice(0) }).promise;
    const tc = await (await doc.getPage(1)).getTextContent();
    const item = tc.items.find((i: any) => i.str === 'HELLO') as any;
    expect(item).toBeTruthy();
    // pdf.js transform is [a,b,c,d,e,f] with e=x, f=y (bottom-origin, viewport scale 1).
    const exX = item.transform[4];
    const exYbottom = item.transform[5];
    // Expected left edge ~ box.x; top edge => baseline y ~ h - (box.y + box.height)
    expect(exX).toBeGreaterThan(100);
    expect(exX).toBeLessThan(w);
    expect(Math.abs(exYbottom - (h - (box.y + box.height)))).toBeLessThan(6); // placed at source box, not arbitrary
  }, 60000);
});
