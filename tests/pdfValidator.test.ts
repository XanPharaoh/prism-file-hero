import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validatePDF, hasCompressionIssues } from '../services/pdfValidator';

describe('pdfValidator', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hasCompressionIssues returns true for non-PDF bytes', async () => {
    const file = new File([new Uint8Array([0, 1, 2, 3])], 'bad.pdf', { type: 'application/pdf' });
    await expect(hasCompressionIssues(file)).resolves.toBe(true);
  });

  it('validatePDF returns unprocessable result when getDocument rejects with flate error', async () => {
    vi.doMock('pdfjs-dist', () => ({
      getDocument: vi.fn(() => ({
        promise: Promise.reject(new Error('FormatError: Unknown compression method in flate stream')),
      })),
    }));

    // Re-import after mock is awkward with static import; call through dynamic path
    const pdfjs = await import('pdfjs-dist');
    vi.spyOn(pdfjs, 'getDocument' as any).mockReturnValue({
      promise: Promise.reject(new Error('FormatError: Unknown compression method in flate stream')),
    } as any);

    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], 'broken.pdf', {
      type: 'application/pdf',
    });
    const result = await validatePDF(file);
    expect(result.canExtract).toBe(false);
    expect(result.suggestedAction).toMatch(/compression|re-saving|different format/i);
    expect(result.issues.some((i) => /compression/i.test(i))).toBe(true);
  });

  it('validatePDF returns password message for password errors', async () => {
    const pdfjs = await import('pdfjs-dist');
    vi.spyOn(pdfjs, 'getDocument' as any).mockReturnValue({
      promise: Promise.reject(new Error('Password required to open this PDF')),
    } as any);

    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'locked.pdf', {
      type: 'application/pdf',
    });
    const result = await validatePDF(file);
    expect(result.canExtract).toBe(false);
    expect(result.suggestedAction).toMatch(/password/i);
  });
});
