/**
 * A2 + A3 — the page-selection contract, verified on produced bytes.
 *
 * The shared parser in shared/pdf/pageSelection.ts documents that reorder asserts a permutation and
 * that malformed input is refused. Neither held in practice: reorderPages hand-rolled its own split
 * and filtered out-of-range indices, so "3,1" on a 4-page document quietly returned a 2-page file,
 * and splitPdf parsed with fallback:'all', so a junk token copied the ENTIRE document into one
 * "part". Both are silent wrong-output paths, which is the class this suite exists to close.
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { reorderPages, splitPdf, mergePdfs } from '../../services/pdfService';

function tok(i: number) {
  return `SEQ${i}`;
}

/** Each page carries a document-name prefix, so a merge's page provenance is checkable. */
function t(name: string, i: number) {
  return `${name}-${tok(i)}`;
}

async function labeledDoc(name: string, pages: number): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([320, 420]);
    p.drawText(`${name}-${tok(i)}`, { x: 30, y: 300, size: 22, font });
  }
  return new File([await doc.save()], `${name}.pdf`, { type: 'application/pdf' });
}

/** Page tokens read back out of a produced PDF with pdf.js, in page order. */
async function pageTokens(blob: Blob): Promise<string[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    out.push((tc.items as Array<{ str?: string }>).map((x) => x.str ?? '').join('').trim());
  }
  await doc.destroy();
  return out;
}

describe('reorder-pages — rearrange the page sequence, never lose a page quietly', () => {
  it('applies a full permutation in the order given', async () => {
    const file = await labeledDoc('PERM', 4);
    const tokens = await pageTokens(await reorderPages(file, '3,1,4,2'));
    expect(tokens).toEqual([t('PERM', 3), t('PERM', 1), t('PERM', 4), t('PERM', 2)]);
  });

  it('expands a range into the sequence it spells, in that direction', async () => {
    const file = await labeledDoc('RANGE', 3);
    expect(await pageTokens(await reorderPages(file, '1-3'))).toEqual([t('RANGE', 1), t('RANGE', 2), t('RANGE', 3)]);
    // "4-1" is the whole point of a reorder tool: a descending range means reverse the document.
    const four = await labeledDoc('REV', 4);
    expect(await pageTokens(await reorderPages(four, '4-1'))).toEqual([t('REV', 4), t('REV', 3), t('REV', 2), t('REV', 1)]);
  });

  it('refuses an order that omits pages, naming what is missing', async () => {
    const file = await labeledDoc('DROP', 4);
    await expect(reorderPages(file, '3,1')).rejects.toThrow(/2, 4|4, 2/);
    await expect(reorderPages(file, '3,1')).rejects.toThrow(/every page exactly once|permutation/i);
  });

  it('refuses a repeated page instead of duplicating it', async () => {
    const file = await labeledDoc('DUP', 3);
    await expect(reorderPages(file, '1,1,1')).rejects.toThrow(/exactly once|duplicate/i);
  });

  it('refuses an out-of-range page number', async () => {
    const file = await labeledDoc('OOR', 3);
    await expect(reorderPages(file, '1,2,9')).rejects.toThrow(/outside|out of range|1-3/i);
  });

  it('refuses input that selects nothing at all', async () => {
    const file = await labeledDoc('NONE', 3);
    await expect(reorderPages(file, 'oops')).rejects.toThrow(/page order/i);
  });

  it('still accepts an explicit array permutation', async () => {
    const file = await labeledDoc('ARR', 3);
    const tokens = await pageTokens(await reorderPages(file, [3, 1, 2]));
    expect(tokens).toEqual([t('ARR', 3), t('ARR', 1), t('ARR', 2)]);
  });
});

describe('split — a bad selection is an error, not a copy of the whole document', () => {
  it('splits every page individually when no range is given', async () => {
    const parts = await splitPdf(await labeledDoc('EACH', 3));
    expect(parts).toHaveLength(3);
    expect((await pageTokens(parts[1].blob))[0]).toBe(t('EACH', 2));
  });

  it('builds one file per listed group', async () => {
    const parts = await splitPdf(await labeledDoc('GRP', 5), '1-2, 4-5');
    expect(parts).toHaveLength(2);
    expect(await pageTokens(parts[0].blob)).toEqual([t('GRP', 1), t('GRP', 2)]);
    expect(await pageTokens(parts[1].blob)).toEqual([t('GRP', 4), t('GRP', 5)]);
  });

  it('rejects a junk token instead of returning the whole document as one part', async () => {
    await expect(splitPdf(await labeledDoc('JUNK', 4), 'banana')).rejects.toThrow(/banana|page|selection|range/i);
  });

  it('rejects a group that runs past the end of the document', async () => {
    await expect(splitPdf(await labeledDoc('PAST', 3), '2-9')).rejects.toThrow(/outside|1-3|range/i);
  });
});

describe('merge keeps its documented "no selection means every page" behaviour', () => {
  it('merges whole documents when no page list is supplied', async () => {
    const merged = await mergePdfs([await labeledDoc('M1', 2), await labeledDoc('M2', 3)]);
    expect((await pageTokens(merged))).toEqual([t('M1', 1), t('M1', 2), t('M2', 1), t('M2', 2), t('M2', 3)]);
  });
});
