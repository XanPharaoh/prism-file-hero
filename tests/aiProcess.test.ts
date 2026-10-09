/**
 * Batch 03: consumer-level tests for processWithAI. fetch + auth are stubbed so
 * we can assert the CLIENT contract: canonical `.data` shape, honest coverage on
 * a middle-batch failure, retry-that-only-redoes-missing-pages, and compare
 * pairing that puts both documents in one request.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/authService', () => ({ getAuthToken: vi.fn(async () => 'test-token') }));
vi.mock('../services/internalDeviceAuth', () => ({ getInternalAiHeaders: vi.fn(() => ({})) }));
vi.mock('../src/config/distribution', () => ({ isInternalDesktopDistribution: false }));

import { processWithAI } from '../services/geminiService';

function openAIResponse(content: string) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
}

let calls: any[] = [];
function installFetch(impl: (body: any, n: number) => Promise<any>) {
  calls = [];
  (globalThis as any).fetch = vi.fn(async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    return impl(body, calls.length);
  });
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { delete (globalThis as any).fetch; });

const img = (page: number, docLabel = 'A') => ({ base64: 'ZGVhZGJlZWY=', pageNumber: page, docLabel });

describe('processWithAI contract', () => {
  it('complete run returns canonical .data and complete coverage', async () => {
    installFetch(async () => openAIResponse('Hello extracted text'));
    const res = await processWithAI('ocr', [img(1), img(2)]);
    expect(typeof res.data).toBe('string');
    expect(res.data).toBe('Hello extracted text');
    expect(res.coverage.status).toBe('complete');
    expect(res.coverage.processed).toBe(2);
  });

  it('middle-batch failure is PARTIAL, never a silent success', async () => {
    // 4 images -> 2 batches. Any call after the first fails with a NON-retryable
    // 400 so callGroqAPI does not internally loop; the outer coverage retry also
    // fails, leaving the run partial.
    installFetch(async () => {
      if (calls.length > 1) throw new Error('400 bad request from provider');
      return openAIResponse('page one text');
    });
    const res = await processWithAI('ocr', [img(1), img(2), img(3), img(4)]);
    expect(res.coverage.status).toBe('partial');
    expect(res.coverage.failedPages.length).toBe(2); // the two pages in batch 2
    expect(res.notice).toMatch(/partial/i);
    expect(res.data).toBe('page one text'); // merged from the one good batch
  });

  it('retries only the failed batch and reports complete when the retry succeeds', async () => {
    installFetch(async () => {
      // The 2nd batch fails once (call 2), then succeeds on the retry (call 3).
      if (calls.length === 2) throw new Error('400 bad request');
      return openAIResponse('ok');
    });
    const res = await processWithAI('ocr', [img(1), img(2), img(3), img(4)]);
    expect(res.coverage.status).toBe('complete');
    expect(res.coverage.failedPages).toHaveLength(0);
    // 2 initial + 1 retry of the missing batch = 3 fetches
    expect(calls.length).toBe(3);
  });

  it('redact returns an ARRAY under .data (the shape consumers read)', async () => {
    installFetch(async () => openAIResponse('```json\n{"regions":[{"page":1,"text":"a@b.com","category":"Email","x":0,"y":0,"width":10,"height":10}]}\n```'));
    const res = await processWithAI('redact', [img(1)]);
    expect(Array.isArray(res.data)).toBe(true);
    expect((res.data as any[])[0].category).toBe('Email');
  });

  it('excel returns {rows, document_metadata} under .data and .rows alias', async () => {
    installFetch(async () => openAIResponse('{"rows":[{"Date":"2026-01-01"}],"document_metadata":{"bank":"ABSA"}}'));
    const res = await processWithAI('pdf-to-excel', [img(1)]);
    expect((res.data as any).rows).toHaveLength(1);
    expect((res as any).rows).toHaveLength(1); // legacy alias kept for callers
    expect((res as any).document_metadata.bank).toBe('ABSA');
  });

  it('valid-but-empty table is a complete run with zero rows (no throw)', async () => {
    installFetch(async () => openAIResponse('{"rows":[]}'));
    const res = await processWithAI('pdf-to-excel', [img(1)]);
    expect((res.data as any).rows).toHaveLength(0);
    expect(res.coverage.status).toBe('complete');
  });

  it('blank transcript and malformed JSON throw (no silent empty success)', async () => {
    installFetch(async () => openAIResponse('   ')); // blank OCR
    await expect(processWithAI('ocr', [img(1)])).rejects.toThrow(/batches failed/i);

    installFetch(async () => openAIResponse('this is not json at all')); // malformed table
    await expect(processWithAI('pdf-to-excel', [img(1)])).rejects.toThrow(/batches failed/i);
  });

  it('compare pairs document A and B page-for-page in one request', async () => {
    installFetch(async () => openAIResponse('Differences: line 5 changed'));
    await processWithAI('compare', [img(1, 'A'), img(1, 'B'), img(2, 'A'), img(2, 'B')]);
    // Each compare request must carry exactly one A and one B image (2 image parts).
    for (const body of calls) {
      const parts = body.messages[1].content.filter((p: any) => p.type === 'image_url');
      expect(parts.length).toBe(2);
    }
    expect(calls.length).toBe(2); // two A/B pairs, not two single-doc batches
  });
});
