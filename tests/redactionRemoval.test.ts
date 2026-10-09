/**
 * Batch 01 regression: PDF redaction must genuinely REMOVE content, not just
 * draw an opaque rectangle over it. Fixture is generated with real pdf-lib and
 * output is read with real pdfjs-dist text extraction (no mocks).
 */
import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { redactPdf } from '../services/pdfService';

const SECRET = 'TOPSECRET-4F7A-9ZQX-99';
const KEEP = 'VISIBLE-KEEP-77';

async function buildFixture(): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText(`Account ${SECRET}`, { x: 60, y: 700, size: 16, font });
  p1.drawText(KEEP, { x: 60, y: 600, size: 16, font });
  // a second page with no redaction to prove unselected pages are preserved
  const p2 = doc.addPage([612, 792]);
  p2.drawText('SECOND PAGE UNCHANGED', { x: 60, y: 700, size: 16, font });
  const bytes = await doc.save();
  return new File([bytes], 'redact-fixture.pdf', { type: 'application/pdf' });
}

async function extractText(blob: Blob): Promise<string> {
  const u8 = new Uint8Array(await blob.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data: u8.slice(0) }).promise;
  let t = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const pg = await doc.getPage(p);
    const tc = await pg.getTextContent();
    t += tc.items.map((i: any) => i.str).join(' ') + '\n';
  }
  return t;
}

describe('Batch 01: redaction removes text', () => {
  it('secret is present in the input (sanity)', async () => {
    const file = await buildFixture();
    expect(await extractText(file)).toContain(SECRET);
  }, 30000);

  it('secret is NOT extractable after redaction; page count preserved', async () => {
    const file = await buildFixture();
    const out = await redactPdf(file, [
      { page: 1, text: SECRET, x: 55, y: 84, width: 300, height: 22 },
    ]);
    const text = await extractText(out);
    expect(text).not.toContain(SECRET);
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await out.arrayBuffer()).slice(0) }).promise;
    expect(doc.numPages).toBe(2);
  }, 60000);
});
