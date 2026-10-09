import pLimit from 'p-limit';
import type { ToolID } from '../src/types';
import { getAuthToken } from './authService';
import { isInternalDesktopDistribution } from '../src/config/distribution';
import { getInternalAiHeaders } from './internalDeviceAuth';
import {
  makeCoverage,
  parseTablePayload,
  parseRedactPayload,
  parseTextPayload,
  extractJson,
  type PageRef,
  type AiCoverage,
} from '@/shared/ai/aiContract';

const WORKER_BASE_URL = import.meta.env.VITE_WORKER_URL || 'https://prism-worker.prismfilehero.workers.dev';

const TOOL_PROMPTS: Record<string, string> = {
  'pdf-to-excel': `Extract ALL data from these images into a clean spreadsheet structure.
  Ensure verbatim accuracy, language agnostic extraction, and strict column fidelity.
  Return a valid JSON object with 'document_metadata' and 'rows' array.
  DO NOT attempt to calculate, verify, or reconcile mathematical balances. Focus solely on accurate text and number transcription.`,
  'pdf-to-word': `Perform high-fidelity document reconstruction as structured Markdown. Preserve headings, lists, and tables.`,
  'ocr': `Provide a COMPLETE, exhaustive, word-for-word transcript of the text in these images. Do not summarize.`,
  'compare': `Compare the two provided documents thoroughly and list all differences, additions, and deletions.`,
  'redact': `Analyze these document pages and identify EVERY SINGLE instance of PII (names, IDs, account numbers, addresses). Return bounding boxes.`,
  'grammar-check': `Perform a comprehensive grammar, spelling, and style check. Return corrected text with explanations.`,
  'pdf-qa': `You are an expert document assistant. Answer questions with absolute fidelity based solely on the provided document images. Be concise, clear, and cite specific pages or sections.`,
  'pdf-summary': `Provide a comprehensive, highly structured executive summary of the provided document. Include key takeaways, main topics, critical dates/numbers, and action items.`,
};

// The server enforces a two-page per-tool daily allocation. Keep a request
// within that allocation so page metering and UI behavior stay consistent.
const MAX_IMAGES_PER_REQUEST = 2;
const MAX_CONCURRENCY = 1;
const limit = pLimit(MAX_CONCURRENCY);

async function getAiHeaders(): Promise<Record<string, string>> {
  if (isInternalDesktopDistribution) {
    return getInternalAiHeaders();
  }

  const token = await getAuthToken();
  if (!token) {
    throw new Error('Sign in required for premium AI extraction.');
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

interface ImageInput {
  base64: string;
  pageNumber: number;
  docLabel?: string;
}

/** Result every AI consumer reads. `data` is the canonical payload; the extra
 *  keys are legacy aliases so nothing breaks while callers migrate to `.data`. */
export interface ProcessAIResult {
  data: unknown;            // excel: {rows, document_metadata} · redact: regions[] · text: string
  coverage: AiCoverage;     // never silent: complete | partial | failed with failedPages
  notice?: string;          // human note when coverage is partial
  // legacy aliases (safe during migration):
  rows?: unknown[];
  document_metadata?: Record<string, unknown>;
  regions?: unknown[];
  text?: string;
  summary?: string;
}

function pagesOf(images: ImageInput[], doc: string): PageRef[] {
  return images.map(im => ({ doc: im.docLabel || doc, page: im.pageNumber }));
}

/**
 * Process images through the metered AI endpoint with FULL requested coverage.
 *
 * - Batches of MAX_IMAGES_PER_REQUEST pages, all batches attempted (no silent cap).
 * - `compare` pairs page N of document A with page N of document B so every request
 *   actually contains BOTH versions — previously each 2-image batch held pages from
 *   a single document, so the model could never see the change to compare.
 * - A batch that fails is retried once; if it still fails the run is reported
 *   PARTIAL with the exact missing pages in `coverage.failedPages` — never a silent
 *   success built from only the batches that happened to work.
 */
export async function processWithAI(
  toolId: ToolID,
  images: ImageInput[],
  options?: Record<string, unknown>
): Promise<ProcessAIResult> {
  const batches: ImageInput[][] = [];
  if (toolId === 'compare') {
    for (const batch of buildCompareBatches(images)) batches.push(batch);
  } else {
    for (let i = 0; i < images.length; i += MAX_IMAGES_PER_REQUEST) {
      batches.push(images.slice(i, i + MAX_IMAGES_PER_REQUEST));
    }
  }

  // Each batch tracks the pages it is responsible for so failures are attributable.
  const tracked = batches.map(batch => ({ batch, pages: pagesOf(batch, 'A') }));
  let settled = await Promise.allSettled(
    tracked.map(t => limit(() => callGroqAPI(toolId, t.batch, options)))
  );

  // Retry ONLY the batches that failed (missing pages), once.
  const firstPass = settled.map((r, i) => ({ r, t: tracked[i] }));
  const retryIdx = firstPass.filter(x => x.r.status === 'rejected').map(x => tracked.indexOf(x.t));
  if (retryIdx.length > 0) {
    const retries = await Promise.allSettled(
      retryIdx.map(i => limit(() => callGroqAPI(toolId, tracked[i].batch, options)))
    );
    retries.forEach((rr, k) => { settled[retryIdx[k]] = rr; });
  }

  const succeeded: any[] = [];
  const failedPages: PageRef[] = [];
  settled.forEach((res, i) => {
    if (res.status === 'fulfilled') succeeded.push(res.value);
    else failedPages.push(...tracked[i].pages);
  });

  if (succeeded.length === 0) {
    const firstReason = settled.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
    const msg = firstReason?.reason instanceof Error ? firstReason.reason.message : String(firstReason?.reason ?? '');
    console.error('[AI] Batch processing failed:', firstReason?.reason);
    throw new Error(msg ? `All AI batches failed: ${msg}` : 'All AI batches failed. Check network and API keys.');
  }

  const requested = tracked.reduce((n, t) => n + t.pages.length, 0);
  const coverage = makeCoverage(requested, Math.max(0, requested - failedPages.length), failedPages);
  const notice = coverage.status === 'partial'
    ? `Some pages could not be processed (${failedPages.map(p => `${p.doc}#${p.page}`).join(', ')}); the result is partial.`
    : undefined;

  const merged = mergeResults(toolId, succeeded);
  return { data: merged.data, coverage, notice, ...merged.legacy };
}

async function callGroqAPI(
  toolId: ToolID,
  images: ImageInput[],
  options?: Record<string, unknown>,
  retryCount = 0
): Promise<any> {
  try {
    const systemPrompt = TOOL_PROMPTS[toolId] || 'Extract data accurately.';

    const content: Array<Record<string, unknown>> = images.map(img => ({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${img.base64}` },
    }));
    let promptText = 'Process the images according to the system prompt.';
    if (toolId === 'pdf-qa' && options?.qaQuestion) {
      promptText = `User Question: ${options.qaQuestion}\nAnswer based on these document pages.`;
    } else if (toolId === 'pdf-summary') {
      const length = options?.summaryLength ? `Summary length: ${options.summaryLength}.` : '';
      const focus = options?.summaryFocus ? `Focus area: ${options.summaryFocus}.` : '';
      promptText = `Generate a document summary. ${length} ${focus}`.trim();
    } else if (toolId === 'compare') {
      promptText = 'Two versions of the SAME document are attached (document A then document B, same page). List every change, addition and deletion between them.';
    }
    content.push({ type: 'text', text: promptText });

    const response = await fetch(`${WORKER_BASE_URL}/api/ai`, {
      method: 'POST',
      headers: await getAiHeaders(),
      body: JSON.stringify({
        toolId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content },
        ],
        options,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error('[Gemini/AI] Worker returned error:', errData);

      if (response.status === 502) {
        throw new Error(
          'AI service temporarily unavailable. The PDF may have unsupported compression or the AI service is down. Please try again later or try a different PDF file.'
        );
      } else if (response.status === 413) {
        throw new Error(
          'PDF file is too large for AI processing. Please try a smaller file or split it into smaller parts.'
        );
      } else if (response.status === 429) {
        throw new Error(
          'AI service rate limit exceeded. Please wait a moment and try again.'
        );
      }

      throw new Error((errData as any).error || `AI request failed: ${response.status}`);
    }

    const data = await response.json();
    return parseAIResponse(data, toolId);
  } catch (err: any) {
    if (retryCount < 2 && isRetryableError(err)) {
      const delay = 1000 * Math.pow(2, retryCount);
      await new Promise(r => setTimeout(r, delay));
      return callGroqAPI(toolId, images, options, retryCount + 1);
    }
    throw err;
  }
}

function isRetryableError(err: any): boolean {
  return (
    err?.status >= 500 ||
    err?.message?.toLowerCase().includes('rate limit') ||
    err?.message?.toLowerCase().includes('timeout') ||
    err?.message?.toLowerCase().includes('network')
  );
}

function parseAIResponse(data: any, toolId: ToolID): any {
  const text = data.choices?.[0]?.message?.content || data.data || data;

  // Delegated to the shared contract so an empty / malformed model reply is a
  // TYPED failure (thrown → the batch is retried, then counted as a missing page)
  // instead of a silent {} / "" that downstream merges into a fake success.
  if (toolId === 'pdf-to-excel') return parseTablePayload(extractJsonSafe(String(text)));
  if (toolId === 'redact') return parseRedactPayload(extractJsonSafe(String(text)));
  return parseTextPayload(String(text));
}

function extractJsonSafe(s: string) {
  try {
    return extractJson(s);
  } catch {
    // Let the parser produce the canonical MALFORMED error with a stable message.
    return s;
  }
}

/**
 * compare batches must each contain the SAME page from BOTH documents, otherwise
 * the model never sees a before/after pair (BUG-14: batches held pages from one doc).
 * Images arrive as [...docA, ...docB] tagged with docLabel "A"/"B"; pair by page.
 */
function buildCompareBatches(images: ImageInput[]): ImageInput[][] {
  const label = (im: ImageInput) => im.docLabel || 'A';
  const a = images.filter(im => label(im) === 'A');
  const b = images.filter(im => label(im) !== 'A');
  const pool = a.length >= b.length ? { first: a, second: b } : { first: b, second: a };
  const batches: ImageInput[][] = [];
  for (let i = 0; i < pool.first.length; i++) {
    const pair = [pool.first[i]];
    if (i < pool.second.length) pair.push(pool.second[i]);
    if (pair.length === 2) batches.push(pair); // only true A/B pairs are comparable
  }
  // If callers didn't label docs, fall back to consecutive 2-page batches.
  if (batches.length === 0) {
    for (let i = 0; i < images.length; i += MAX_IMAGES_PER_REQUEST) {
      batches.push(images.slice(i, i + MAX_IMAGES_PER_REQUEST));
    }
  }
  return batches;
}

function mergeResults(toolId: ToolID, results: any[]): { data: unknown; legacy: Record<string, unknown> } {
  if (toolId === 'pdf-to-excel') {
    const rows: any[] = [];
    let document_metadata: Record<string, any> = {};
    results.forEach(res => {
      if (Array.isArray(res.rows)) rows.push(...res.rows);
      if (res.documentMetadata && Object.keys(document_metadata).length === 0) document_metadata = res.documentMetadata;
    });
    return { data: { rows, document_metadata }, legacy: { rows, document_metadata } };
  }

  if (toolId === 'redact') {
    const regions: any[] = [];
    results.forEach(res => { if (Array.isArray(res.regions)) regions.push(...res.regions); });
    return { data: regions, legacy: { regions } };
  }

  const text = results.map(r => (typeof r === 'string' ? r : r?.text ?? JSON.stringify(r))).join('\n\n---\n\n');
  return { data: text, legacy: { text, summary: text } };
}
