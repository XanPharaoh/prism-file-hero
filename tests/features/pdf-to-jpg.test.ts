/**
 * B2 — "Convert each PDF page into high-quality JPG images."
 *
 * Two claims to hold: *each* page, and the quality/size the user sets. The tool used to pass a
 * 50-page ceiling that `convertPdfToImages` honoured by quietly returning the first 50, so a
 * 60-page document produced 50 images and a success message; and it rendered at a fixed scale 2.0
 * with JPEG quality 0.90 no matter what was asked for.
 */
import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { getToolById } from '../../src/registry/toolRegistry';

async function pageDoc(pages: number, size: [number, number] = [200, 120]): Promise<File> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage(size);
    page.drawText(`PAGE ${i + 1}`, { x: 10, y: size[1] / 2, size: 12, font });
  }
  const bytes = new Uint8Array(await doc.save());
  return new File([bytes], `${pages}-page.pdf`, { type: 'application/pdf' });
}

async function runJpg(file: File, options: Record<string, unknown> = {}) {
  const tool = getToolById('pdf-to-jpg')!;
  const result = await tool.handler({ files: [file], options, onProgress: () => {} } as never);
  const zip = await JSZip.loadAsync(await result.blob!.arrayBuffer());
  return Object.keys(zip.files).filter((n) => n.endsWith('.jpg')).sort();
}

async function runJpgBytes(file: File, options: Record<string, unknown> = {}): Promise<Buffer> {
  const tool = getToolById('pdf-to-jpg')!;
  const result = await tool.handler({ files: [file], options, onProgress: () => {} } as never);
  const zip = await JSZip.loadAsync(await result.blob!.arrayBuffer());
  return Buffer.from(await zip.file('Page_1.jpg')!.async('arraybuffer'));
}

describe('pdf-to-jpg — every page, at the settings asked for', () => {
  it('converts all 60 pages, not the first 50', async () => {
    const names = await runJpg(await pageDoc(60));
    expect(names.length, `got ${names.length} images from a 60-page document`).toBe(60);
    expect(names).toContain('Page_1.jpg');
    expect(names).toContain('Page_60.jpg');
  }, 600_000);

  it('honours the page range instead of silently truncating', async () => {
    const names = await runJpg(await pageDoc(30), { jpgPages: '5-8' });
    expect(names.sort((a, b) => (+a.match(/\d+/)![0]) - (+b.match(/\d+/)![0]))).toEqual([
      'Page_5.jpg', 'Page_6.jpg', 'Page_7.jpg', 'Page_8.jpg',
    ]);
  }, 600_000);

  it('refuses an over-large document out loud rather than shipping part of it', async () => {
    const tool = getToolById('pdf-to-jpg')!;
    // 501 pages would take minutes to render, and the refusal happens before any of that: the check
    // reads only the page count.
    const huge = await pageDoc(501);
    let error: Error | null = null;
    try {
      await tool.handler({ files: [huge], options: {}, onProgress: () => {} } as never);
    } catch (e) { error = e as Error; }
    expect(error?.message).toMatch(/501 pages/);
    expect(error?.message).toMatch(/page range/);
  }, 600_000);

  it('the DPI control changes the output dimensions', async () => {
    // A 200x120 pt page: at 72 DPI the sheet is 200x120 px, at 300 DPI it is 833x500.
    const dir = mkdtempSync(path.join(tmpdir(), 'prism-jpg-'));
    const dimsOf = async (dpi: number) => {
      const bytes = await runJpgBytes(await pageDoc(1), { jpgDpi: dpi });
      const p = path.join(dir, `dpi-${dpi}.jpg`);
      writeFileSync(p, bytes);
      // An independent decoder, not the harness's own reader.
      return execFileSync('identify', ['-format', '%wx%h', p], { encoding: 'utf8' });
    };

    expect(await dimsOf(72)).toBe('200x120');
    expect(await dimsOf(300)).toBe('833x500');
  }, 900_000);
});
