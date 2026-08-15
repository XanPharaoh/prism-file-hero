import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
}));

import * as pdfjsLib from 'pdfjs-dist';
import { validatePDF } from '../services/pdfValidator';

describe('PDF Validator - Text Layer vs Canvas Rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows extraction when text layer exists even if canvas rendering fails', async () => {
    // Mock PDF with text layer but broken canvas rendering (like Robbie Accountants)
    const richItems = Array.from({ length: 15 }, (_, i) => ({
      str: i === 0 ? 'Date' : i === 1 ? 'Description' : `Item ${i}`,
      transform: [1, 0, 0, 1, 10 + i, 700 - i],
    }));

    const mockPage = {
      getTextContent: vi.fn().mockResolvedValue({ items: richItems }),
      getViewport: vi.fn().mockReturnValue({ width: 100, height: 100 }),
      // Would fail if called — text-layer path must skip render entirely
      render: vi.fn().mockImplementation(() => {
        throw new Error('FormatError: Unknown compression method');
      }),
    };

    (pdfjsLib.getDocument as any).mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(mockPage),
      }),
    });

    const file = new File(['dummy'], 'test.pdf', { type: 'application/pdf' });
    const result = await validatePDF(file);

    expect(result.canExtract).toBe(true);
    expect(result.issues).toHaveLength(0);
    // Canvas render must not be required when text layer is present
    expect(mockPage.render).not.toHaveBeenCalled();
  });

  it('allows fallback when no text layer pages render blank', async () => {
    const mockPage = {
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      getViewport: vi.fn().mockReturnValue({ width: 100, height: 100 }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve(undefined) }),
    };

    const whiteData = new Uint8ClampedArray(100 * 100 * 4);
    for (let i = 0; i < whiteData.length; i += 4) {
      whiteData[i] = 255;
      whiteData[i + 1] = 255;
      whiteData[i + 2] = 255;
      whiteData[i + 3] = 255;
    }

    const mockCtx = {
      fillStyle: '',
      fillRect: vi.fn(),
      getImageData: vi.fn().mockReturnValue({ data: whiteData, width: 100, height: 100 }),
    };
    const createEl = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => mockCtx,
        } as any;
      }
      return document.createElementNS('http://www.w3.org/1999/xhtml', tag);
    });

    (pdfjsLib.getDocument as any).mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(mockPage),
      }),
    });

    const file = new File(['dummy'], 'blank.pdf', { type: 'application/pdf' });
    const result = await validatePDF(file);

    createEl.mockRestore();

    // A rendered white canvas can be an unsupported-compression artifact, so
    // validation preserves the OCR/normalization fallback instead of declaring
    // the upload definitely empty.
    expect(result.canExtract).toBe(true);
    expect(result.issues.some((i) => i.includes('blank'))).toBe(true);
  });

  it('allows extraction when canvas render fails and no text layer (extractor decides)', async () => {
    const mockPage = {
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      getViewport: vi.fn().mockReturnValue({ width: 100, height: 100 }),
      // pdf.js API: render() returns { promise }
      render: vi.fn().mockReturnValue({
        get promise() {
          return (async () => {
            throw new Error('FormatError: Unknown compression method');
          })();
        },
      }),
    };

    const mockCtx = {
      fillStyle: '',
      fillRect: vi.fn(),
      getImageData: vi.fn(),
    };
    const createEl = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => mockCtx,
        } as any;
      }
      return document.createElementNS('http://www.w3.org/1999/xhtml', tag);
    });

    (pdfjsLib.getDocument as any).mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(mockPage),
      }),
    });

    const file = new File(['dummy'], 'render-fail.pdf', { type: 'application/pdf' });
    const result = await validatePDF(file);

    createEl.mockRestore();

    // No text + render fail is uncertain, not definitely empty; allow extractor/OCR to decide.
    expect(result.canExtract).toBe(true);
    expect(
      result.issues.some(
        (i) => i.toLowerCase().includes('compression') || i.includes('blank') || i.includes('rendering')
      )
    ).toBe(true);
  });

  it('allows OCR path when no text layer but pages are not blank', async () => {
    const mockPage = {
      getTextContent: vi.fn().mockResolvedValue({ items: [] }),
      getViewport: vi.fn().mockReturnValue({ width: 100, height: 100 }),
      render: vi.fn().mockReturnValue({ promise: Promise.resolve(undefined) }),
    };

    const mixedData = new Uint8ClampedArray(100 * 100 * 4);
    for (let i = 0; i < mixedData.length; i += 4) {
      // ~50% non-white so blankRatio < 0.95
      const dark = (i / 4) % 2 === 0;
      mixedData[i] = dark ? 50 : 255;
      mixedData[i + 1] = dark ? 50 : 255;
      mixedData[i + 2] = dark ? 50 : 255;
      mixedData[i + 3] = 255;
    }

    const mockCtx = {
      fillStyle: '',
      fillRect: vi.fn(),
      getImageData: vi.fn().mockReturnValue({ data: mixedData, width: 100, height: 100 }),
    };
    const createEl = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext: () => mockCtx,
        } as any;
      }
      return document.createElementNS('http://www.w3.org/1999/xhtml', tag);
    });

    (pdfjsLib.getDocument as any).mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(mockPage),
      }),
    });

    const file = new File(['dummy'], 'scanned.pdf', { type: 'application/pdf' });
    const result = await validatePDF(file);

    createEl.mockRestore();

    expect(result.canExtract).toBe(true);
    expect(result.issues.some((i) => i.includes('No text layer'))).toBe(true);
  });
});
