import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const TINY_JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/Aaf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Aaf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/Iaf/xAAVEQEBAAAAAAAAAAAAAAAAAAAAEf/aAAgBAwEBPxCP/8QAFREBAQAAAAAAAAAAAAAAAAAAABH/2gAIAQIBAT8Qj//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z';
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLk7wAAAABJRU5ErkJggg==';

// PDF.js rendering requires a real browser canvas. This adapter keeps the handler
// archive contract deterministic while the rest of this suite exercises real PDF bytes.
vi.mock('../services/pdfService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/pdfService')>();
  return {
    ...actual,
    convertPdfToImages: vi.fn(async (file: File, onProgress?: (percent: number) => void) => {
      if (file.name === 'corrupt.pdf') throw new Error('PDF Render Error: malformed fixture');
      onProgress?.(100);
      return [1, 2, 3].map(pageNumber => ({ base64: TINY_JPEG, pageNumber }));
    }),
  };
});

import { getToolById } from '../src/registry/toolRegistry';
import type { ToolExecutionPayload } from '../src/types';

async function pdfFixture(name: string, sizes: Array<[number, number]>): Promise<File> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  sizes.forEach(([width, height], index) => {
    const page = pdf.addPage([width, height]);
    page.drawText(`fixture-page-${index + 1}`, { x: 12, y: height - 24, font, size: 12 });
  });
  return new File([await pdf.save() as BlobPart], name, { type: 'application/pdf' });
}

function imageFixture(name: string, type: string, base64: string): File {
  return new File([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], name, { type });
}

function payload(files: File[], options: Record<string, unknown> = {}, onProgress?: (percent: number) => void): ToolExecutionPayload {
  return { files, options, onProgress };
}

async function readPdf(blob: Blob): Promise<PDFDocument> {
  return PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
}

function handler(id: Parameters<typeof getToolById>[0]) {
  const localHandler = getToolById(id)?.handler;
  if (!localHandler) throw new Error(`Missing local handler: ${id}`);
  return localHandler;
}

describe('local advertised tool handlers: deterministic in-memory stress suite', () => {
  it('merges selected pages from several PDFs in stable source/page order', async () => {
    const result = await handler('merge')(payload([
      await pdfFixture('first.pdf', [[200, 100], [210, 100]]),
      await pdfFixture('second.pdf', [[300, 100], [310, 100]]),
    ], { mergePages: '2, 1' }));
    const output = await readPdf(result.blob!);

    expect(result.filename).toMatch(/^Merged_\d+\.pdf$/);
    expect(output.getPageCount()).toBe(4);
    expect(output.getPages().map(page => page.getWidth())).toEqual([200, 210, 300, 310]);
  });

  it('splits requested pages into individually readable PDFs with stable archive names', async () => {
    const source = await pdfFixture('three-pages.pdf', [[200, 100], [210, 100], [220, 100]]);
    const result = await handler('split')(payload([source], { splitPages: '3, 1, 3' }));
    const archive = await JSZip.loadAsync(await result.blob!.arrayBuffer());
    const names = Object.keys(archive.files).filter(name => !archive.files[name].dir).sort();

    expect(result.filename).toMatch(/^Split_\d+\.zip$/);
    expect(names).toEqual(['Page_1.pdf', 'Page_3.pdf']);
    await Promise.all(names.map(async (name, index) => {
      const document = await PDFDocument.load(await archive.file(name)!.async('arraybuffer'));
      expect(document.getPageCount()).toBe(1);
      expect(document.getPage(0).getWidth()).toBe([200, 220][index]);
    }));
  });

  it('compresses readable PDFs without changing page count or dimensions', async () => {
    const source = await pdfFixture('compress.pdf', [[200, 100], [300, 150], [400, 200]]);
    const progress: number[] = [];
    const result = await handler('compress')(payload([source], {}, value => progress.push(value)));
    const output = await readPdf(result.blob!);

    expect(result.filename).toMatch(/^Compressed_\d+\.pdf$/);
    expect(output.getPages().map(page => [page.getWidth(), page.getHeight()])).toEqual([[200, 100], [300, 150], [400, 200]]);
    expect(progress).toContain(100);
    // The output should be a valid PDF no larger than the input
    expect(result.blob!.size).toBeGreaterThan(0);
    expect(result.blob!.size).toBeLessThanOrEqual(source.size);
  });

  it('rotates every page while preserving readable page geometry', async () => {
    const source = await pdfFixture('secured.pdf', [[200, 100], [300, 150]]);
    const rotated = await handler('rotate')(payload([source], { rotationAngle: '90' }));

    expect((await readPdf(rotated.blob!)).getPages().map(page => page.getRotation().angle)).toEqual([90, 90]);
  });

  it('watermarks every page with visible text and preserves page geometry', async () => {
    const source = await pdfFixture('watermark-test.pdf', [[400, 200], [500, 250]]);
    const watermarked = await handler('watermark')(payload([source], { watermarkText: 'CONFIDENTIAL' }));

    const output = await readPdf(watermarked.blob!);
    expect(output.getPageCount()).toBe(2);
    expect(output.getPages().map(page => [page.getWidth(), page.getHeight()])).toEqual([[400, 200], [500, 250]]);

    // Verify watermark text is present in every page by extracting text content
    const pdfjsDoc = await (await import('pdfjs-dist')).getDocument({ data: await watermarked.blob!.arrayBuffer() }).promise;
    for (let i = 1; i <= pdfjsDoc.numPages; i++) {
      const textContent = await (await pdfjsDoc.getPage(i)).getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      expect(pageText).toContain('CONFIDENTIAL');
    }
  });

  it('protects readable PDFs and rejects a missing encryption key', async () => {
    const source = await pdfFixture('private.pdf', [[200, 100]]);
    const protectedResult = await handler('protect')(payload([source], { password: 'strong-password' }));

    expect(protectedResult.blob!.type).toBe('application/pdf');
    expect((await readPdf(protectedResult.blob!)).getPageCount()).toBe(1);
    await expect(handler('protect')(payload([source]))).rejects.toThrow('Encryption key required.');
  });

  it('converts ordered valid PNG/JPEG fixtures into a readable multi-page PDF', async () => {
    const result = await handler('jpg-to-pdf')(payload([
      imageFixture('one.png', 'image/png', TINY_PNG),
      imageFixture('two.jpg', 'image/jpeg', TINY_JPEG),
    ]));
    const output = await readPdf(result.blob!);

    expect(output.getPageCount()).toBe(2);
    expect(output.getPages().map(page => [page.getWidth(), page.getHeight()])).toEqual([[1, 1], [1, 1]]);
  });

  it('packages readable, sequential JPEGs and propagates local rasterizer failure', async () => {
    const source = await pdfFixture('source.pdf', [[200, 100], [210, 100], [220, 100]]);
    const result = await handler('pdf-to-jpg')(payload([source]));
    const archive = await JSZip.loadAsync(await result.blob!.arrayBuffer());
    const names = Object.keys(archive.files).filter(name => !archive.files[name].dir).sort();

    expect(names).toEqual(['Page_1.jpg', 'Page_2.jpg', 'Page_3.jpg']);
    for (const name of names) {
      const bytes = new Uint8Array(await archive.file(name)!.async('arraybuffer'));
      expect([bytes[0], bytes[1], bytes.at(-2), bytes.at(-1)]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    }
    await expect(handler('pdf-to-jpg')(payload([new File(['broken'], 'corrupt.pdf', { type: 'application/pdf' })]))).rejects.toThrow('malformed fixture');
  });

  it('rejects malformed PDFs and unsupported images instead of emitting misleading output', async () => {
    const malformed = new File(['not a PDF'], 'malformed.pdf', { type: 'application/pdf' });
    const unsupported = new File(['plain text'], 'not-an-image.txt', { type: 'text/plain' });

    await expect(handler('merge')(payload([malformed]))).rejects.toThrow();
    await expect(handler('split')(payload([malformed]))).rejects.toThrow();
    await expect(handler('jpg-to-pdf')(payload([unsupported]))).rejects.toThrow('No supported JPG, JPEG, or PNG images were provided.');
  });
});
