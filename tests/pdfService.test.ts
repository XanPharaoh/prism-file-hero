import { describe, it, expect, vi, beforeEach } from 'vitest';
import { convertPdfToImages } from '../services/pdfService';
import * as pdfjsLib from 'pdfjs-dist';

vi.mock('pdfjs-dist', () => ({
  get GlobalWorkerOptions() { return { workerSrc: '' }; },
  set GlobalWorkerOptions(v: any) {},
  getDocument: vi.fn(),
}));

describe('pdfService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('convertPdfToImages should respect AbortSignal and throw AbortError', async () => {
    const mockPage = {
      getViewport: vi.fn().mockReturnValue({ width: 100, height: 100 }),
      render: vi.fn().mockResolvedValue({ promise: Promise.resolve() }),
    };
    const mockPdf = {
      numPages: 2,
      getPage: vi.fn().mockResolvedValue(mockPage),
    };

    (pdfjsLib.getDocument as any).mockReturnValue({
      promise: Promise.resolve(mockPdf),
    });

    const mockCanvas = {
      getContext: vi.fn().mockReturnValue({
        getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(40000), width: 100, height: 100 }),
        putImageData: vi.fn(),
      }),
      toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,test'),
      width: 100,
      height: 100,
    };
    vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as any);

    const controller = new AbortController();
    controller.abort();

    await expect(
      convertPdfToImages(new File([], 'test.pdf'), undefined, 20, true, undefined, controller.signal)
    ).rejects.toThrow('Aborted');
  });
});