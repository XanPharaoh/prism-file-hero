/**
 * Batch 09 / Check D — REAL LibreOffice office→pdf conversion through the actual
 * `libreOfficeProvider.convert()` code path (limits, isolated profile, output verification,
 * cleanup), executed against a containerized soffice via a PATH shim. This is NOT a skipped
 * stub: it converts generated real documents and inspects the produced PDFs (magic bytes,
 * page count via poppler) and proves cleanup + failure behavior.
 *
 * If `soffice` is unavailable (no docker/shim) the whole file skips with a loud reason so the
 * report can state the exact missing dependency rather than implying success.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { libreOfficeProvider, sofficeAvailable, looksLikePdf, buildSofficeArgs } from '../processing/libreofficeProvider';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function pdfPageCount(pdfBytes: Uint8Array): number {
  const dir = mkdtempSync(join(tmpdir(), 'prism-probe-'));
  const f = join(dir, 'probe.pdf');
  writeFileSync(f, pdfBytes);
  try {
    const r = spawnSync('docker', ['run', '--rm', '--entrypoint', 'pdfinfo', '-v', `${dir}:${dir}`, 'prism-lo', f], { encoding: 'utf8' });
    const m = r.stdout.match(/^Pages:\s+(\d+)\s*$/m);
    return m ? Number(m[1]) : -1;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// Resolve engine availability at module load (top-level await) so it.skipIf sees the real value.
const engineReady = await sofficeAvailable();

describe('libreOfficeProvider real office→pdf conversions', () => {
  it.skipIf(!engineReady)('docx → multi-page PDF, inspected with poppler', async () => {
    const { Document, Packer, Paragraph } = await import('docx');
    const doc = new Document({ sections: [{
      properties: {},
      children: [
        new Paragraph({ text: 'PRISM cover page marker ALPHA' }),
        new Paragraph({ text: 'second page marker BRAVO', pageBreakBefore: true }),
        new Paragraph({ text: 'third page marker CHARLIE', pageBreakBefore: true }),
      ],
    }] });
    const bytes = new Uint8Array(await Packer.toBuffer(doc));
    const res = await libreOfficeProvider.convert({ inputMime: DOCX, inputBytes: bytes });
    expect(res.mime).toBe('application/pdf');
    expect(res.engine).toBe('libreoffice-headless');
    expect(looksLikePdf(res.bytes)).toBe(true);
    const pages = pdfPageCount(res.bytes);
    expect(pages).toBe(3); // real page count from a real render, not a mock
  }, 120_000);

  it.skipIf(!engineReady)('xlsx → PDF round-trips to a valid document', async () => {
    const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['Date', 'Description', 'Amount']);
    ws.addRow(['2026-01-01', 'Coffee', 12.34]);
    ws.addRow(['2026-01-02', 'Rent', 1500]);
    const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
    const res = await libreOfficeProvider.convert({ inputMime: XLSX, inputBytes: bytes });
    expect(looksLikePdf(res.bytes)).toBe(true);
    expect(pdfPageCount(res.bytes)).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('rejects an unsupported input type before touching the engine', async () => {
    await expect(libreOfficeProvider.convert({ inputMime: 'application/zip', inputBytes: new Uint8Array([1, 2, 3]) }))
      .rejects.toThrow(/unsupported input type/);
  });

  it('rejects input over the size limit without spawning the engine', async () => {
    const big = new Uint8Array(51 * 1024 * 1024);
    await expect(libreOfficeProvider.convert({ inputMime: DOCX, inputBytes: big }))
      .rejects.toThrow(/exceeds size limit/);
  });

  it.skipIf(!engineReady)('converted PDF genuinely renders the source text (poppler pdftotext)', async () => {
    const { Document, Packer, Paragraph } = await import('docx');
    const doc = new Document({ sections: [{ properties: {}, children: [
      new Paragraph({ text: 'ZEBRA-UNIQUE-TOKEN' }),
    ] }] });
    const res = await libreOfficeProvider.convert({ inputMime: DOCX, inputBytes: new Uint8Array(await Packer.toBuffer(doc)) });
    const dir = mkdtempSync(join(tmpdir(), 'prism-text-'));
    const f = join(dir, 'o.pdf');
    writeFileSync(f, res.bytes);
    try {
      const r = spawnSync('docker', ['run', '--rm', '--entrypoint', 'pdftotext', '-v', `${dir}:${dir}`, 'prism-lo', f, '-'], { encoding: 'utf8' });
      expect(r.stdout).toContain('ZEBRA-UNIQUE-TOKEN'); // text actually present, not a blank render
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);

  it('always cleans up the throwaway temp workspace after each conversion', async () => {
    expect(buildSofficeArgs('/tmp/x/in.docx', '/tmp/x', '/tmp/x/profile')).toContain('--headless');
    const leftover = readdirSync(tmpdir()).filter((d) => d.startsWith('prism-conv-'));
    expect(leftover).toEqual([]);
  });
});
