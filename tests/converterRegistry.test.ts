import { describe, it, expect } from 'vitest';
import { ConversionRegistry, CONVERSION_JOBS, type ConversionProvider } from '../worker/src/processing/converterProvider';

describe('Batch 09 conversion registry (local seam)', () => {
  it('every declared job is in-browser-capable OR needs a provider', () => {
    for (const job of Object.keys(CONVERSION_JOBS)) {
      expect(CONVERSION_JOBS[job as keyof typeof CONVERSION_JOBS]).toHaveProperty('needs');
    }
  });
  it('throws NOT_CONFIGURED when no provider serves a job (never a silent corrupt file)', async () => {
    const reg = new ConversionRegistry();
    await expect(reg.convert({ job: 'office-to-pdf', inputBytes: new ArrayBuffer(0), inputMime: 'application/pdf' }))
      .rejects.toMatchObject({ code: 'NOT_CONFIGURED', job: 'office-to-pdf' });
  });
  it('uses a registered provider that supports the job', async () => {
    const reg = new ConversionRegistry();
    const fake: ConversionProvider = {
      name: 'fake-lo',
      supports: j => j === 'office-to-pdf',
      convert: async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: 'application/pdf', engine: 'fake-lo', engineVersion: '0' }),
    };
    reg.register(fake);
    const r = await reg.convert({ job: 'office-to-pdf', inputBytes: new ArrayBuffer(0), inputMime: 'application/msword' });
    expect(r.engine).toBe('fake-lo');
    // A job no provider serves still throws.
    await expect(reg.convert({ job: 'pdf-sign', inputBytes: new ArrayBuffer(0), inputMime: 'application/pdf' }))
      .rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });
});
