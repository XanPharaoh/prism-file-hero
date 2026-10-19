/**
 * OmniRoute free-model provider chain.
 *
 * The paid providers queue under subscriber load, so some tools can be routed to the operator's own
 * OmniRoute gateway using free models. The selection is not a guess: every model id asserted here is
 * one that passed a measured stage in evidence/features/omniroute/ (see the survey script header),
 * and the two stages that matter are vision (a bank statement arrives as page images) and long-form
 * arithmetic (a wrong total is worse than no total).
 *
 * Ground rules this file enforces:
 *  - nothing changes until OMNIROUTE_BASE_URL is set (the gate is config, not a code flag);
 *  - the free pool is a prefix of the chain, never a replacement — paid providers stay as fallback;
 *  - a plaintext http:// gateway is refused outside localtest, because these requests carry bank
 *    statements and PII;
 *  - `redact` never reaches a chat model: its NER endpoint is what makes the output a redaction.
 */
import { describe, expect, it } from 'vitest';
import { getProviderChain, shouldTryNextProvider } from '../worker/src/index';

const PAID_ENV = {
  NVIDIA_API_KEY: 'nv',
  GROQ_API_KEY_1: 'g1',
  MISTRAL_API_KEY_1: 'm1',
} as any;

const GATEWAY = 'https://omni.example.internal/v1';

function chainFor(env: Record<string, unknown>, toolId: string) {
  return getProviderChain({ ...PAID_ENV, ...env } as any, toolId);
}

describe('omniroute provider chain', () => {
  it('is inert with no gateway configured — today’s chain byte for byte', () => {
    const without = chainFor({}, 'ocr').map((p) => p.name);
    const blank = chainFor({ OMNIROUTE_BASE_URL: '   ' }, 'ocr').map((p) => p.name);
    expect(without).toEqual(['nvidia', 'groq', 'mistral']);
    expect(blank).toEqual(['nvidia', 'groq', 'mistral']);
  });

  it('routes only the tools the operator lists', () => {
    const env = { OMNIROUTE_BASE_URL: GATEWAY, OMNIROUTE_TOOLS: 'ocr,pdf-summary' };
    expect(chainFor(env, 'ocr').map((p) => p.name)).toEqual(['omniroute', 'omniroute', 'nvidia', 'groq', 'mistral']);
    expect(chainFor(env, 'pdf-summary').map((p) => p.name)[0]).toBe('omniroute');
    expect(chainFor(env, 'grammar-check').map((p) => p.name)).toEqual(['nvidia', 'groq', 'mistral']);
  });

  it('keeps every paid provider behind the free pool as fallback', () => {
    const env = { OMNIROUTE_BASE_URL: GATEWAY, OMNIROUTE_TOOLS: 'ocr' };
    const chain = chainFor(env, 'ocr');
    expect(chain.filter((p) => p.name === 'nvidia').length).toBe(1);
    expect(chain.at(-1)!.name).toBe('mistral');
    expect(chain.findIndex((p) => p.name === 'nvidia')).toBeGreaterThan(
      chain.findIndex((p) => p.name === 'omniroute'),
    );
  });

  it('puts the measured vision winner first for image tools, and a second free model behind it', () => {
    const env = { OMNIROUTE_BASE_URL: GATEWAY, OMNIROUTE_TOOLS: 'ocr,pdf-summary,grammar-check' };
    // north-mini-code:free is the only free model measured at both 5.5s on a statement image and
    // correct on the 12-row ledger sums. nemotron-3-super answers both too, 20s slower on vision.
    const ocr = chainFor(env, 'ocr').filter((p) => p.name === 'omniroute').map((p) => p.model);
    expect(ocr).toEqual([
      'kilocode/cohere/north-mini-code:free',
      'kilocode/nvidia/nemotron-3-super-120b-a12b:free',
    ]);
    // Summaries and QA are sent page images as well, so they take the same order.
    expect(chainFor(env, 'pdf-summary').filter((p) => p.name === 'omniroute').map((p) => p.model)).toEqual(ocr);
    // grammar-check sends text only: lead with the model that won the arithmetic stage instead.
    expect(chainFor(env, 'grammar-check').filter((p) => p.name === 'omniroute').map((p) => p.model)).toEqual([
      'kilocode/nvidia/nemotron-3-super-120b-a12b:free',
      'kilocode/cohere/north-mini-code:free',
    ]);
  });

  it('never routes redaction to a chat model', () => {
    const env = { OMNIROUTE_BASE_URL: GATEWAY, OMNIROUTE_TOOLS: 'redact,ocr' };
    expect(chainFor(env, 'redact').map((p) => p.name)).not.toContain('omniroute');
    expect(chainFor(env, 'redact')[0].model).toBe('nvidia/gliner-pii');
  });

  it('refuses a plaintext gateway, because these bodies carry bank statements', () => {
    const env = { OMNIROUTE_BASE_URL: 'http://100.75.214.23:20128/v1', OMNIROUTE_TOOLS: 'ocr' };
    expect(chainFor(env, 'ocr').map((p) => p.name)).not.toContain('omniroute');
    expect(chainFor({ ...env, ENVIRONMENT: 'localtest' }, 'ocr').map((p) => p.name)).toContain('omniroute');
  });

  it('works without a key — a self-hosted gateway may be unauthenticated', () => {
    const env = { OMNIROUTE_BASE_URL: GATEWAY, OMNIROUTE_TOOLS: 'ocr' };
    const first = chainFor(env, 'ocr')[0];
    expect(first.name).toBe('omniroute');
    expect(first.apiKey).toBeUndefined();
    expect(first.endpoint).toBe(`${GATEWAY}/chat/completions`);
  });

  it('rejects a malformed base URL instead of fetching a nonsense endpoint', () => {
    const env = { OMNIROUTE_BASE_URL: 'not a url', OMNIROUTE_TOOLS: 'ocr' };
    expect(chainFor(env, 'ocr').map((p) => p.name)).not.toContain('omniroute');
  });

  it('treats a dead free connection as retryable — 402 must fall through to a paid provider', () => {
    expect(shouldTryNextProvider(402)).toBe(true);
    expect(shouldTryNextProvider(429)).toBe(true);
    expect(shouldTryNextProvider(502)).toBe(true);
    expect(shouldTryNextProvider(401)).toBe(false);
  });
});
