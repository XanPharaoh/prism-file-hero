/**
 * Batch 04: endpoint authority + usage-report schema conformance.
 * Verifies the single Worker URL resolver enforces production HTTPS with no
 * localhost fallback, and that reportUsage sends ONLY fields the strict Worker
 * UsageReportSchema accepts (the featureType bug made every report 400).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/config/distribution', () => ({
  distribution: 'public',
  isInternalDesktopDistribution: false,
  isPublicDistribution: true,
}));
vi.mock('../services/authService', () => ({ getAuthToken: vi.fn(async () => 'test-token') }));

import { resolveWorkerBaseUrl } from '../services/apiConfig';
import { reportUsage } from '../services/usageTrackingService';

describe('resolveWorkerBaseUrl (single source of truth)', () => {
  it('production with no override → deployed https origin', () => {
    expect(resolveWorkerBaseUrl(undefined, false)).toBe('https://prism-worker.prismfilehero.workers.dev');
  });
  it('production honors an explicit https override and trims trailing slash', () => {
    expect(resolveWorkerBaseUrl('https://api.example.com/', false)).toBe('https://api.example.com');
  });
  it('production REJECTS a localhost / http override (no silent local bind)', () => {
    expect(() => resolveWorkerBaseUrl('http://localhost:8787', false)).toThrow(/https/i);
  });
  it('development MAY point at a local wrangler worker', () => {
    expect(resolveWorkerBaseUrl('http://localhost:8787', true)).toBe('http://localhost:8787');
  });
});

describe('reportUsage → strict Worker schema', () => {
  let body: any;
  let url: string;
  beforeEach(() => {
    body = undefined; url = '';
    (globalThis as any).fetch = vi.fn(async (u: string, init: any) => {
      url = u;
      body = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({}) };
    });
  });
  afterEach(() => { delete (globalThis as any).fetch; });

  it('omits featureType and sends only schema fields', async () => {
    await reportUsage({ toolId: 'ocr', pagesProcessed: 3, featureType: 'ai', status: 'SUCCESS' } as any);
    expect(body).toBeDefined();
    expect(body.featureType).toBeUndefined();
    expect(Object.keys(body).sort()).toEqual(['pagesProcessed', 'status', 'toolId']);
    expect(url).toMatch(/^https:\/\//);
  });

  it('includes optional fileName/fileSizeBytes when provided, still no featureType', async () => {
    await reportUsage({ toolId: 'pdf-to-excel', pagesProcessed: 5, featureType: 'ai', fileName: 'a.pdf', fileSizeBytes: 1234 } as any);
    expect(body.fileName).toBe('a.pdf');
    expect(body.fileSizeBytes).toBe(1234);
    expect(body.featureType).toBeUndefined();
  });
});
