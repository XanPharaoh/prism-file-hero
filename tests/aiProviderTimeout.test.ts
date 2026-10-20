/**
 * Per-provider wall-clock budget in the AI chain.
 *
 * Motivated by measurement, not theory: a load test of the free gateway (`docs/omniroute-model-selection.md`)
 * caught one provider answering in 52,795 ms at four concurrent requests while its p50 was ~15 s. With
 * no timeout, that request simply held the chain open — the paid provider sitting behind it was never
 * asked, and the user got whatever the Worker's own ceiling decided.
 *
 * The behaviour that matters is not "time out" but "time out *and keep going*", so these assert that a
 * hung provider becomes a retryable status rather than an exception.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiProviderTimeoutMs, callAiProvider, callAiProviderResult, getProviderChain, shouldTryNextProvider } from '../worker/src/index';

const ENV = { NVIDIA_API_KEY: 'nv', GROQ_API_KEY_1: 'g1' } as any;
const MESSAGES = [{ role: 'user', content: 'hi' }] as never;
const provider = (over = {}) => ({ name: 'nvidia', endpoint: 'https://example.invalid/v1', model: 'm', ...over }) as never;

describe('per-provider timeout', () => {
  it('defaults above the slowest accepted answer and below the measured straggler', () => {
    expect(aiProviderTimeoutMs(undefined)).toBe(30_000);
    expect(aiProviderTimeoutMs('25000')).toBe(25_000);
    expect(aiProviderTimeoutMs('')).toBe(30_000);
    expect(aiProviderTimeoutMs('nonsense')).toBe(30_000);
    expect(aiProviderTimeoutMs('-5')).toBe(30_000);
    expect(aiProviderTimeoutMs('0')).toBe(30_000);
    // Clamped both ways: a typo must not disable the timeout or outlive a Worker request.
    expect(aiProviderTimeoutMs('1')).toBe(5_000);
    expect(aiProviderTimeoutMs('999999')).toBe(90_000);
  });

  it('stamps the budget onto every provider the chain builds', () => {
    const chain = getProviderChain({ ...ENV, AI_PROVIDER_TIMEOUT_MS: '21000' }, 'ocr');
    expect(chain.length).toBeGreaterThan(1);
    for (const p of chain) expect(p.timeoutMs).toBe(21_000);
    expect(getProviderChain(ENV, 'ocr')[0].timeoutMs).toBe(30_000);
  });

  it('504 is retryable, so a stall reaches the next provider instead of ending the request', () => {
    expect(shouldTryNextProvider(504)).toBe(true);
  });
});

describe('callAiProvider against a hung provider', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => { globalThis.fetch = vi.fn(); });
  afterEach(() => { globalThis.fetch = realFetch; });

  it('passes an AbortSignal carrying the budget', async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response('{"ok":1}', { status: 200 }));
    const res = await callAiProvider(provider({ timeoutMs: 7000 }), 'ocr', MESSAGES);
    expect(res.status).toBe(200);
    const init = (globalThis.fetch as any).mock.calls[0][1];
    // Only that it is a signal: whether the budget is real is proved below, by letting it fire.
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal.aborted).toBe(false);
  });

  // Budget is supplied directly rather than via env, so it stays below vitest's own 5s test timeout.
  // aiProviderTimeoutMs() clamps the *configured* value to >=5s; a caller-supplied timeoutMs is used
  // verbatim, which is what makes a fast test of this path possible at all.
  it('turns a timeout into a 504 response rather than a rejection', async () => {
    (globalThis.fetch as any).mockImplementation((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted due to timeout');
          err.name = 'TimeoutError';
          reject(err);
        });
      }));

    const res = await callAiProvider(provider({ timeoutMs: 800 }), 'ocr', MESSAGES);
    expect(res.status).toBe(504);
  });

  it('also survives a bare connection failure, which previously escaped the loop', async () => {
    (globalThis.fetch as any).mockRejectedValue(new TypeError('fetch failed'));
    const res = await callAiProvider(provider({ timeoutMs: 800 }), 'ocr', MESSAGES);
    expect(res.status).toBe(504);
  });

  it('the budget actually fires: a provider that never answers is released', async () => {
    (globalThis.fetch as any).mockImplementation((_url: string, init: { signal: AbortSignal }) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted'); err.name = 'TimeoutError'; reject(err);
        });
      }));
    const started = Date.now();
    const res = await callAiProvider(provider({ timeoutMs: 800 }), 'ocr', MESSAGES);
    expect(res.status).toBe(504);
    expect(Date.now() - started).toBeLessThan(4_000);
  }, 20_000);
});

describe('callAiProviderResult — the body read is inside the guard', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => { globalThis.fetch = vi.fn(); });
  afterEach(() => { globalThis.fetch = realFetch; });

  const hangAfterHeaders = (ms: number) => ({
    ok: true, status: 200, headers: new Headers(),
    text: () => new Promise<string>((_resolve, reject) => {
      setTimeout(() => {
        const err = new Error('aborted while reading body');
        err.name = 'TimeoutError';
        reject(err);
      }, ms);
    }),
  });

  it('a body that stalls after headers becomes 504 instead of rejecting the loop', async () => {
    (globalThis.fetch as any).mockResolvedValue(hangAfterHeaders(120));
    const res = await callAiProviderResult(provider({ timeoutMs: 5_000 }), 'ocr', MESSAGES);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(504);
    // Asserted as a return, not a throw: the point is that the caller's loop keeps going.
  });

  it('passes a good response through with its body intact', async () => {
    const payload = JSON.stringify({ choices: [{ message: { content: 'ok' } }] });
    (globalThis.fetch as any).mockResolvedValue(new Response(payload, { status: 200 }));
    const res = await callAiProviderResult(provider(), 'ocr', MESSAGES);
    expect(res).toEqual({ status: 200, ok: true, body: payload });
    expect(() => JSON.parse(res.body)).not.toThrow();
  });

  it('keeps the error body for a failed status, so the log line is not empty', async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response('upstream exploded', { status: 503 }));
    const res = await callAiProviderResult(provider(), 'ocr', MESSAGES);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
    expect(res.body).toBe('upstream exploded');
  });

  it('regression witness: reading that same Response outside the guard still rejects', async () => {
    (globalThis.fetch as any).mockResolvedValue(hangAfterHeaders(60));
    const response = await callAiProvider(provider({ timeoutMs: 5_000 }), 'ocr', MESSAGES);
    // This is the hole the helper closes. Before it, exactly this rejection escaped the provider loop
    // and turned one slow provider into a 502 with no fallback attempted.
    await expect(response.text()).rejects.toThrow(/aborted while reading body/);
  });

  it('a stalled body is still retryable, which is what the caller branches on', async () => {
    (globalThis.fetch as any).mockResolvedValue(hangAfterHeaders(60));
    const res = await callAiProviderResult(provider({ timeoutMs: 5_000 }), 'ocr', MESSAGES);
    expect(shouldTryNextProvider(res.status)).toBe(true);
  });
});
