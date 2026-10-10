import { describe, it, expect } from 'vitest';
import { buildSofficeArgs, looksLikePdf, libreOfficeProvider, sofficeAvailable } from '../processing/libreofficeProvider';

describe('LibreOffice adapter (pure guards)', () => {
  it('builds an isolated-profile headless convert-to-pdf command', () => {
    const args = buildSofficeArgs('/tmp/in.docx', '/tmp', '/tmp/profile');
    expect(args).toContain('--headless');
    expect(args).toContain('pdf');
    expect(args).toContain('/tmp/in.docx');
    expect(args.join(' ')).toMatch(/-env:UserInstallation=file:\/\/\/tmp\/profile/); // parallel-safe
  });
  it('looksLikePdf accepts a real header, rejects junk/short', () => {
    expect(looksLikePdf(new TextEncoder().encode('%PDF-1.7\n' + 'x'.repeat(2000)))).toBe(true);
    expect(looksLikePdf(new TextEncoder().encode('PK not a pdf'))).toBe(false);
    expect(looksLikePdf(new Uint8Array([0x25]))).toBe(false);
  });
  it('rejects unsupported input type and oversize before spawning', async () => {
    await expect(libreOfficeProvider.convert({ job: 'office-to-pdf', inputBytes: new Uint8Array(10).buffer as any, inputMime: 'application/zip' } as any))
      .rejects.toThrow(/unsupported input/i);
    await expect(libreOfficeProvider.convert({ job: 'office-to-pdf', inputBytes: new ArrayBuffer(60 * 1024 * 1024), inputMime: 'application/msword' } as any))
      .rejects.toThrow(/size limit/i);
  });
  it('supports only office-to-pdf', () => {
    expect(libreOfficeProvider.supports('office-to-pdf')).toBe(true);
    expect(libreOfficeProvider.supports('pdf-sign' as any)).toBe(false);
  });
});

describe('LibreOffice adapter live conversion (guarded by binary presence)', () => {
  it('converts a real docx when soffice exists; skipped with a reason otherwise', async () => {
    if (!(await sofficeAvailable())) {
      // Honest skip: this environment has no soffice binary. The live conversion is verified
      // wherever LibreOffice is installed (dev container / staging worker image), not claimed here.
      console.warn('SKIP: soffice not installed in this environment — live office->pdf unverified.');
      return;
    }
    // Build a minimal .docx is non-trivial; real e2e lives in the browser/CI stage. If present,
    // we at least assert the provider returns a PDF for a known-good input generated here.
    const { Document, Packer, Paragraph, TextRun } = await import('docx');
    const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ children: [new TextRun('Hello conversion')] })] }] }));
    const res = await libreOfficeProvider.convert({ job: 'office-to-pdf', inputBytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), inputMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    expect(new TextDecoder().decode(res.bytes.slice(0, 5))).toBe('%PDF-');
  }, 120000);
});
