import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { protectPdf } from '../services/pdfService';

async function createPdfFixture(): Promise<File> {
  const document = await PDFDocument.create();
  document.addPage([200, 200]);
  return new File([await document.save() as BlobPart], 'test.pdf', { type: 'application/pdf' });
}

describe('protectPdf', () => {
  it('returns a PDF blob for a valid in-memory fixture', async () => {
    const mockFile = await createPdfFixture();
    const result = await protectPdf(mockFile, 'securepassword123');
    expect(result).toBeInstanceOf(Blob);
    expect(result.type).toBe('application/pdf');
    expect(result.size).toBeGreaterThan(0);
  });

  it('rejects an invalid PDF before attempting protection', async () => {
    const mockFile = new File(['dummy content'], 'test.pdf', { type: 'application/pdf' });
    await expect(protectPdf(mockFile, 'password')).rejects.toThrow('Failed to parse PDF document');
  });
});
