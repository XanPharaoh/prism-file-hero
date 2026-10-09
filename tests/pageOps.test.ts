/**
 * Batch 02 runner-level regressions. Real pdf-lib fixtures, real pdfjs-dist text
 * extraction (no mocks). Each source page carries a unique token so we can prove
 * exactly which original pages survive, in which order, and whether any landed
 * off-sheet.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { deletePages, reorderPages, nUpPageLayout } from '../services/pdfService';

function token(i: number) {
  return `PRISMPAGE-${i}`;
}

async function labeledPdf(pages: number): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([300, 400]);
    p.drawText(token(i), { x: 40, y: 300, size: 18, font });
  }
  const bytes = await doc.save();
  return new File([bytes], 'labeled.pdf', { type: 'application/pdf' });
}

async function pageTexts(blob: Blob): Promise<string[]> {
  const u8 = new Uint8Array(await blob.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data: u8.slice(0) }).promise;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p);
    const tc = await pg.getTextContent();
    out.push(tc.items.map((i: any) => i.str).join(' '));
  }
  return out;
}

describe('BUG-10: delete de-duplicates before removal', () => {
  it('"2,2" removes ONLY original page 2, leaving 1,3,4 each once', async () => {
    const file = await labeledPdf(4);
    const out = await deletePages(file, '2,2');
    const texts = await pageTexts(out);
    const joined = texts.join(' ');
    expect(out && texts.length).toBe(3);
    expect(joined).not.toContain(token(2));
    // every surviving original appears exactly once
    expect(texts.filter(t => t.includes(token(1))).length).toBe(1);
    expect(texts.filter(t => t.includes(token(3))).length).toBe(1);
    expect(texts.filter(t => t.includes(token(4))).length).toBe(1);
  }, 60000);

  it('deleting every page produces no output (throws)', async () => {
    const file = await labeledPdf(3);
    await expect(deletePages(file, '1-3')).rejects.toThrow(/delete all pages/i);
  }, 30000);
});

describe('BUG-11: reorder requires a full permutation', () => {
  it('"1,1,1" is rejected instead of duplicating page 1', async () => {
    const file = await labeledPdf(3);
    await expect(reorderPages(file, '1,1,1')).rejects.toThrow(/more than once|Invalid page order/i);
  }, 30000);

  it('a valid order reorders pages and keeps each exactly once', async () => {
    const file = await labeledPdf(3);
    const out = await reorderPages(file, '3,1,2');
    const texts = await pageTexts(out);
    expect(texts.length).toBe(3);
    expect(texts[0]).toContain(token(3));
    expect(texts[1]).toContain(token(1));
    expect(texts[2]).toContain(token(2));
  }, 60000);
});

describe('BUG-12: two-up places every page on-sheet', () => {
  it('2-up packs 2 source pages onto one sheet, both extractable', async () => {
    const file = await labeledPdf(2);
    const out = await nUpPageLayout(file, 2);
    const texts = await pageTexts(out);
    expect(texts.length).toBe(1); // one A4 sheet holds both
    expect(texts[0]).toContain(token(1));
    expect(texts[0]).toContain(token(2));
  }, 60000);

  it('4-up packs 4 pages onto one sheet', async () => {
    const file = await labeledPdf(4);
    const out = await nUpPageLayout(file, 4);
    const texts = await pageTexts(out);
    expect(texts.length).toBe(1);
    for (let i = 1; i <= 4; i++) expect(texts[0]).toContain(token(i));
  }, 60000);
});
