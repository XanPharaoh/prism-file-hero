import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mapTesseractDataToSpatialItems,
  extractRowsFromOCRText,
  type TesseractPageData,
} from '../services/ocrService';
import {
  compressVisionImage,
  compressVisionImages,
  type ImageInput,
} from '../services/aiExtractionService';

describe('OCR spatial fallback chain (mapTesseractDataToSpatialItems)', () => {
  const bbox = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

  it('uses word-level tokens when data.words is present', () => {
    const data: TesseractPageData = {
      text: 'Hello World',
      words: [
        { text: 'Hello', bbox: bbox(10, 20, 50, 40) },
        { text: 'World', bbox: bbox(60, 20, 110, 40) },
      ],
    };

    const items = mapTesseractDataToSpatialItems(data, 1);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      str: 'Hello',
      page: 1,
      bbox: { x: 10, y: 20, width: 40, height: 20 },
    });
    expect(items[1].str).toBe('World');
  });

  it('falls back to nested words under blocks when top-level words is empty', () => {
    const data: TesseractPageData = {
      text: 'nested',
      words: [],
      blocks: [
        {
          paragraphs: [
            {
              lines: [
                {
                  words: [{ text: 'nested', bbox: bbox(1, 2, 11, 12) }],
                },
              ],
            },
          ],
        },
      ],
    };

    const items = mapTesseractDataToSpatialItems(data, 2);
    expect(items).toHaveLength(1);
    expect(items[0].str).toBe('nested');
    expect(items[0].page).toBe(2);
  });

  it('falls back to line-level tokens when words are empty', () => {
    const data: TesseractPageData = {
      text: 'line only text',
      words: [],
      lines: [
        { text: 'line only text', bbox: bbox(5, 15, 200, 35) },
      ],
    };

    const items = mapTesseractDataToSpatialItems(data, 3);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      str: 'line only text',
      page: 3,
      bbox: { x: 5, y: 15, width: 195, height: 20 },
    });
  });

  it('falls back to nested lines under blocks when top-level lines and words are empty', () => {
    const data: TesseractPageData = {
      text: 'block line',
      words: [],
      lines: [],
      blocks: [
        {
          text: 'block',
          bbox: bbox(0, 0, 100, 50),
          paragraphs: [
            {
              lines: [{ text: 'block line', bbox: bbox(0, 0, 80, 20) }],
            },
          ],
        },
      ],
    };

    const items = mapTesseractDataToSpatialItems(data, 1);
    expect(items).toHaveLength(1);
    expect(items[0].str).toBe('block line');
  });

  it('falls back to block-level tokens when words and lines are empty', () => {
    const data: TesseractPageData = {
      text: 'block text',
      words: [],
      lines: [],
      blocks: [
        { text: 'block text', bbox: bbox(0, 10, 300, 80) },
      ],
    };

    const items = mapTesseractDataToSpatialItems(data, 4);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      str: 'block text',
      page: 4,
      bbox: { x: 0, y: 10, width: 300, height: 70 },
    });
  });

  it('returns empty array when all fallback levels are empty', () => {
    const data: TesseractPageData = {
      text: 'ghost text with no geometry',
      words: [],
      lines: [],
      blocks: [],
    };

    const items = mapTesseractDataToSpatialItems(data, 1);
    expect(items).toEqual([]);
  });

  it('skips blank/whitespace tokens', () => {
    const data: TesseractPageData = {
      text: 'a',
      words: [
        { text: '   ', bbox: bbox(0, 0, 10, 10) },
        { text: 'a', bbox: bbox(10, 0, 20, 10) },
      ],
    };

    const items = mapTesseractDataToSpatialItems(data, 1);
    expect(items).toHaveLength(1);
    expect(items[0].str).toBe('a');
  });
});

describe('Vision AI image compression', () => {
  let createElementSpy: ReturnType<typeof vi.spyOn> | undefined;
  let OriginalImage: typeof Image;

  beforeEach(() => {
    OriginalImage = globalThis.Image;
  });

  afterEach(() => {
    globalThis.Image = OriginalImage;
    createElementSpy?.mockRestore();
    vi.restoreAllMocks();
  });

  it('skips compression when base64 is already under the size threshold', async () => {
    const small: ImageInput = { base64: 'a'.repeat(1000), pageNumber: 1 };
    const result = await compressVisionImage(small);
    expect(result).toBe(small);
    expect(result.base64.length).toBe(1000);
  });

  it('resizes and re-encodes large images', async () => {
    class MockImage {
      width = 2400;
      height = 1800;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        Promise.resolve().then(() => this.onload?.());
      }
    }
    // @ts-expect-error test mock
    globalThis.Image = MockImage;

    const mockCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({ drawImage: vi.fn() }),
      toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,' + 'b'.repeat(2000)),
    };
    createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as any);

    const large: ImageInput = { base64: 'x'.repeat(600000), pageNumber: 2 };
    const result = await compressVisionImage(large);

    expect(result.pageNumber).toBe(2);
    expect(result.base64).toBe('b'.repeat(2000));
    expect(result.base64.length).toBeLessThan(large.base64.length);
    expect(mockCanvas.width).toBe(1200);
    expect(mockCanvas.height).toBe(900);
    expect(mockCanvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.7);
  });

  it('falls back to original image when Image fails to load', async () => {
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        Promise.resolve().then(() => this.onerror?.());
      }
    }
    // @ts-expect-error test mock
    globalThis.Image = FailingImage;

    const large: ImageInput = { base64: 'z'.repeat(600000), pageNumber: 7 };
    const result = await compressVisionImage(large);
    expect(result).toBe(large);
  });

  it('compressVisionImages processes a batch and returns same page numbers', async () => {
    const images: ImageInput[] = [
      { base64: 'a'.repeat(100), pageNumber: 1 },
      { base64: 'b'.repeat(200), pageNumber: 2 },
    ];
    const result = await compressVisionImages(images);
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.pageNumber)).toEqual([1, 2]);
    // Small images pass through unchanged
    expect(result[0].base64.length).toBe(100);
    expect(result[1].base64.length).toBe(200);
  });
});


describe('OCR line-by-line regex fallback (extractRowsFromOCRText)', () => {
  it('extracts rows with date and amount patterns', () => {
    const text = [
      '01/02/2024 Grocery Store R 123.45',
      'noise without money or date',
      '15 Mar 2024 Salary 1,234.56',
    ].join('\n');
    const rows = extractRowsFromOCRText(text, 1, 'bank-statement');
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ Page: 1, Date: '01/02/2024' });
    expect(String(rows[0].Amount)).toContain('123.45');
    expect(rows[1].Date).toBe('15 Mar 2024');
  });

  it('returns empty when no date/amount patterns exist', () => {
    const rows = extractRowsFromOCRText('hello world\nno numbers here', 2, 'unknown');
    expect(rows).toEqual([]);
  });
});
