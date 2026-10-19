/**
 * A1 — page numbers must render a number.
 *
 * The UI's format control sends the tokens `page_n_of_m | page_n | n_of_m | n`
 * (src/components/views/ProcessingView.tsx:357-370, typed in src/types.ts:160) while the engine
 * understood `{page}/{total}` templates plus a couple of older tokens. The unmatched tokens fell
 * through to "paint the string as given", so all four formats stamped the literal text
 * `page_n_of_m` on every page. Measured here by extracting the text back out of the output.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { addPageNumbers } from '../../services/pdfService';

async function labeledDoc(pages: number): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([420, 300]);
    p.drawText(`BODY-PAGE-${i}`, { x: 40, y: 200, size: 18, font });
  }
  return new File([await doc.save()], 'numbered-source.pdf', { type: 'application/pdf' });
}

type Word = { text: string; x: number; y: number };

async function words(blob: Blob, page: number): Promise<Word[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const js = await doc.getPage(page);
  const tc = await js.getTextContent();
  const out = (tc.items as Array<{ str?: string; transform?: number[] }>).map((i) => ({
    text: (i.str ?? '').trim(),
    x: i.transform ? Math.round(i.transform[4]) : 0,
    y: i.transform ? Math.round(i.transform[5]) : 0,
  })).filter((w) => w.text.length > 0);
  await doc.destroy();
  return out;
}

const lineOf = (ws: Word[], page: number) => ws.filter((w) => w.text !== `BODY-PAGE-${page}`).map((w) => w.text).join(' ').trim();

describe('the four formats the UI actually offers', () => {
  it.each([
    ['page_n_of_m', 'Page 1 of 3', 'Page 3 of 3'],
    ['page_n', 'Page 1', 'Page 3'],
    ['n_of_m', '1 of 3', '3 of 3'],
    ['n', '1', '3'],
  ])('format %s stamps %s on page 1 and %s on page 3', async (format, first, last) => {
    const out = await addPageNumbers(await labeledDoc(3), { format });
    expect(lineOf(await words(out, 1), 1)).toBe(first);
    expect(lineOf(await words(out, 3), 3)).toBe(last);
  });

  it('the default format still reads "Page 1 of 3"', async () => {
    const out = await addPageNumbers(await labeledDoc(3));
    expect(lineOf(await words(out, 1), 1)).toBe('Page 1 of 3');
  });

  it('honours {page}/{total} templates written by a user', async () => {
    const out = await addPageNumbers(await labeledDoc(2), { format: 'p.{page}/{total}' });
    expect(lineOf(await words(out, 2), 2)).toBe('p.2/2');
  });

  it('applies startNum', async () => {
    const out = await addPageNumbers(await labeledDoc(3), { format: 'page_n', startNum: 5 });
    expect(lineOf(await words(out, 1), 1)).toBe('Page 5');
    expect(lineOf(await words(out, 3), 3)).toBe('Page 7');
  });

  it('positions change where the number lands, they do not change what it says', async () => {
    const left = await addPageNumbers(await labeledDoc(1), { format: 'n', position: 'bottom-left' });
    const right = await addPageNumbers(await labeledDoc(1), { format: 'n', position: 'bottom-right' });
    const lw = (await words(left, 1)).find((w) => w.text === '1')!;
    const rw = (await words(right, 1)).find((w) => w.text === '1')!;
    expect(lw.x).toBeLessThan(rw.x);

    const top = await addPageNumbers(await labeledDoc(1), { format: 'n', position: 'top-center' });
    const tw = (await words(top, 1)).find((w) => w.text === '1')!;
    expect(tw.y).toBeGreaterThan(rw.y);
  });

  it('an unrecognised format is refused instead of stamped on the page', async () => {
    await expect(addPageNumbers(await labeledDoc(2), { format: 'bogus_token' }))
      .rejects.toThrow(/bogus_token/);
    await expect(addPageNumbers(await labeledDoc(2), { format: 'bogus_token' }))
      .rejects.toThrow(/page_n_of_m/);
  });
});
