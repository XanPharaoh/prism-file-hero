import { describe, it, expect, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { normalizePdf } from '../services/pdfNormalizer';

describe('pdfNormalizer', () => {
  it('normalizes a simple PDF via pdf-lib re-save', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const bytes = await doc.save();
    const file = new File([bytes], 'sample.pdf', { type: 'application/pdf' });

    const result = await normalizePdf(file);
    expect(result.wasNormalized).toBe(true);
    expect(result.file).toBeInstanceOf(File);
    expect(result.file.name).toBe('sample.pdf');
    expect(result.normalizedSizeKB).toBeGreaterThan(0);
  });

  it('skips normalization for files larger than 25MB', async () => {
    const huge = new Uint8Array(25 * 1024 * 1024 + 1);
    // PDF header so it looks like a pdf name-wise
    huge[0] = 0x25;
    huge[1] = 0x50;
    huge[2] = 0x44;
    huge[3] = 0x46;
    const file = new File([huge], 'huge.pdf', { type: 'application/pdf' });
    const result = await normalizePdf(file);
    expect(result.wasNormalized).toBe(false);
    expect(result.file).toBe(file);
  });

  it('returns original file when pdf-lib cannot load', async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'broken.pdf', {
      type: 'application/pdf',
    });
    const result = await normalizePdf(file);
    expect(result.wasNormalized).toBe(false);
    expect(result.file).toBe(file);
    expect(result.issues?.length).toBeGreaterThan(0);
  });
});
