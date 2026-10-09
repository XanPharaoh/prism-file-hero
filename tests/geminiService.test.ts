import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force the public-distribution code path so the tests always exercise
// getAuthToken → fetch regardless of the VITE_DISTRIBUTION env var.
vi.mock('../src/config/distribution', () => ({
  distribution: 'public',
  isInternalDesktopDistribution: false,
  isPublicDistribution: true,
}));

vi.mock('../services/authService', () => ({
  getAuthToken: vi.fn().mockResolvedValue('test-token'),
}));

import { processWithAI } from '../services/geminiService';

global.fetch = vi.fn();

describe('geminiService (concurrent batch processing)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle partial batch failures gracefully and merge successful results', async () => {
    let callCount = 0;
    (global.fetch as any).mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ choices: [{ message: { content: '{"rows": [{"date": "2023-01-01", "amount": 100}]}' } }] }),
        });
      }
      return Promise.reject(new Error('400 bad request from provider'));
    });

    const images = [
      { base64: 'img1', pageNumber: 1 },
      { base64: 'img2', pageNumber: 2 },
      { base64: 'img3', pageNumber: 3 },
      { base64: 'img4', pageNumber: 4 },
    ];

    const result = await processWithAI('pdf-to-excel', images);

    expect(result).toHaveProperty('rows');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].date).toBe('2023-01-01');
    expect(result.rows[0].amount).toBe(100);
    // New Batch 03 contract: a partial run is reported honestly, never silent.
    expect(result.coverage.status).toBe('partial');
    expect(result.coverage.failedPages.length).toBeGreaterThan(0);
    expect(result.notice).toMatch(/partial/i);
    // At least 1 call should have been made (the successful batch)
    expect(global.fetch).toHaveBeenCalled();
  });

  it('should throw if all batches fail', async () => {
    (global.fetch as any).mockRejectedValue(new Error('400 bad request'));

    const images = [{ base64: 'img1', pageNumber: 1 }];

    await expect(processWithAI('pdf-to-excel', images)).rejects.toThrow('All AI batches failed');
  });

  it('should batch images into groups of MAX_IMAGES_PER_REQUEST', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify({ rows: [] }) } }],
      }),
    });

    const images = Array.from({ length: 10 }, (_, i) => ({
      base64: `img${i}`,
      pageNumber: i + 1,
    }));

    await processWithAI('pdf-to-excel', images);

    // 10 images / 2 metered images per batch = 5 batches
    expect(global.fetch).toHaveBeenCalledTimes(5);
  });

  it('should limit concurrency with p-limit', async () => {
    let concurrentCalls = 0;
    let maxConcurrent = 0;

    (global.fetch as any).mockImplementation(async () => {
      concurrentCalls++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
      await new Promise(r => setTimeout(r, 10));
      concurrentCalls--;
      return {
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: JSON.stringify({ rows: [] }) } }],
        }),
      };
    });

    const images = Array.from({ length: 9 }, (_, i) => ({
      base64: `img${i}`,
      pageNumber: i + 1,
    }));

    await processWithAI('pdf-to-excel', images);

    // Metered requests are intentionally serialized.
    expect(maxConcurrent).toBeLessThanOrEqual(1);
  });

  it('should send correct request structure to worker', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"text": "processed"}' } }],
      }),
    });

    await processWithAI('ocr', [{ base64: 'abc123', pageNumber: 1 }]);

    const callUrl = (global.fetch as any).mock.calls[0][0];
    expect(callUrl).toContain('/api/ai');

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.toolId).toBe('ocr');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
  });

  it('should merge redact results across batches', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{
          message: {
            content: JSON.stringify({
              regions: [{ page: 1, text: 'John', category: 'name' }],
            }),
          },
        }],
      }),
    });

    const images = [
      { base64: 'img1', pageNumber: 1 },
      { base64: 'img2', pageNumber: 2 },
      { base64: 'img3', pageNumber: 3 },
      { base64: 'img4', pageNumber: 4 },
    ];

    const result = await processWithAI('redact', images);
    expect(result).toHaveProperty('regions');
    expect(result.regions.length).toBeGreaterThanOrEqual(1);
  });

  it('should retry on retryable errors', async () => {
    (global.fetch as any)
      .mockRejectedValueOnce(new Error('Rate limit exceeded'))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '{"rows": [{"date": "2023-01-01"}]}' } }],
        }),
      });

    const result = await processWithAI('pdf-to-excel', [{ base64: 'img1', pageNumber: 1 }]);
    expect(result).toHaveProperty('rows');
    expect(result.rows).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
