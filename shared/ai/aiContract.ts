/**
 * Batch 03 — Typed AI contract shared by every AI path (app geminiService,
 * aiExtractionService, semanticCellParser, toolRegistry, the Cloudflare Worker,
 * and the static-site adapters).
 *
 * Design goals (guide §14 Batch 03 "Fix AI contracts, truncation and schema mismatch"):
 *   1. A result carries COVERAGE, so a partial run is reported as partial and
 *      never silently shipped as if it processed every requested page.
 *   2. Text vs structured(table/redaction) responses have distinct, validated
 *      shapes; empty/malformed output is a typed failure, not a silent "".
 *   3. Prompts and model selection live on the SERVER. The client request carries
 *      only the toolId + a page manifest + the payload — never a system prompt.
 *   4. Bounded metering: page count is explicit and capped so oversized input is
 *      rejected before spend rather than truncated after.
 */

export type AiToolId =
  | 'pdf-to-excel'
  | 'pdf-to-word'
  | 'ocr'
  | 'compare'
  | 'redact'
  | 'grammar-check'
  | 'pdf-qa'
  | 'pdf-summary';

/** One image the server may read. `docLabel` disambiguates the two compare docs. */
export interface AiImagePayload {
  base64: string;
  pageNumber: number;
  docLabel?: string; // e.g. "A" | "B" for compare
}

/** Client → Worker request. NOTE: no system prompt, no model name — server owns both. */
export interface AiRequest {
  toolId: AiToolId;
  /** Explicit, ordered list of (document, page) pairs the caller wants processed. */
  pageManifest: PageRef[];
  images?: AiImagePayload[];
  text?: string;
  /** Tool-specific, NON-prompt options (e.g. { qaQuestion } or { summaryFocus }). */
  options?: Record<string, unknown>;
}

export interface PageRef {
  doc: string; // stable per-file label ("A", "B", or the file name)
  page: number; // 1-based
}

export type AiCoverageStatus = 'complete' | 'partial' | 'failed';

export interface AiCoverage {
  requested: number; // page-references the caller asked for
  processed: number; // page-references the server actually read
  failedPages: PageRef[]; // which ones did NOT succeed — drives retry-missing
  status: AiCoverageStatus;
}

/** Structured shape for pdf-to-excel. */
export interface AiTableResult {
  kind: 'table';
  rows: unknown[];
  documentMetadata: Record<string, unknown>;
}

/** Structured shape for redact PII detection. */
export interface AiRedactResult {
  kind: 'redact';
  regions: AiRedactRegion[];
}

export interface AiRedactRegion {
  page: number;
  text: string;
  category: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Plain-text shape (ocr, word, summary, qa, grammar, compare report). */
export interface AiTextResult {
  kind: 'text';
  text: string;
}

export type AiPayload = AiTableResult | AiRedactResult | AiTextResult;

/** Everything a caller needs to decide "trust / retry / show warning". */
export interface AiResult {
  toolId: AiToolId;
  coverage: AiCoverage;
  payload: AiPayload;
  /** Human-readable note about truncation/partiality, surfaced to the UI. */
  notice?: string;
}

export class AiContractError extends Error {
  code: 'EMPTY' | 'MALFORMED' | 'OVERSIZED' | 'MISMATCH';
  constructor(message: string, code: AiContractError['code']) {
    super(message);
    this.name = 'AiContractError';
    this.code = code;
  }
}

export function makeCoverage(requested: number, processed: number, failedPages: PageRef[]): AiCoverage {
  const status: AiCoverageStatus =
    processed === 0 ? 'failed' : failedPages.length === 0 ? 'complete' : 'partial';
  return { requested, processed, failedPages, status };
}

/** Refuse to label a run complete when pages are missing — keeps callers honest. */
export function assertCoverageComplete(result: AiResult): void {
  if (result.coverage.status !== 'complete') {
    throw new AiContractError(
      `AI run was ${result.coverage.status} (${result.coverage.processed}/${result.coverage.requested} pages).`,
      'MISMATCH'
    );
  }
}

/**
 * Parse a table response. MALFORMED (non-object / no rows[]) is a typed failure;
 * a valid reply with zero rows is legitimate (an empty ledger is not a contract
 * breach) and is returned so callers can fall back to other extraction strategies.
 */
export function parseTablePayload(raw: unknown): AiTableResult {
  const obj = typeof raw === 'string' ? safeJson(raw) : raw;
  if (!obj || typeof obj !== 'object') {
    throw new AiContractError('Table response was not valid JSON.', 'MALFORMED');
  }
  const rows = (obj as any).rows;
  if (!Array.isArray(rows)) {
    throw new AiContractError('Table response was missing a rows[] array.', 'MALFORMED');
  }
  return { kind: 'table', rows, documentMetadata: (obj as any).document_metadata ?? {} };
}

export function parseRedactPayload(raw: unknown): AiRedactResult {
  const obj = typeof raw === 'string' ? safeJson(raw) : raw;
  if (!obj || typeof obj !== 'object') {
    throw new AiContractError('Redaction response was not valid JSON.', 'MALFORMED');
  }
  const regions = (obj as any).regions ?? (obj as any).data ?? obj;
  if (!Array.isArray(regions)) {
    throw new AiContractError('Redaction response was missing a regions[] array.', 'MALFORMED');
  }
  return { kind: 'redact', regions: regions as AiRedactRegion[] };
}

/** A blank transcript IS a failure to read the page (unlike an empty table), so
 *  empty text throws rather than silently returning "". */
export function parseTextPayload(raw: unknown): AiTextResult {
  const text = typeof raw === 'string' ? raw : (raw as any)?.text ?? '';
  if (typeof text !== 'string') {
    throw new AiContractError('Text response was not a string.', 'MALFORMED');
  }
  if (text.trim().length === 0) {
    throw new AiContractError('Text response was empty.', 'EMPTY');
  }
  return { kind: 'text', text };
}

/** Extract the first JSON object/array from a possibly fenced model reply. */
export function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const body = fence ? fence[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) throw new AiContractError('No JSON found in model response.', 'MALFORMED');
  return safeJson(body.slice(start));
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    throw new AiContractError('Malformed JSON from model.', 'MALFORMED');
  }
}

/** Compare must pair the two documents, not send two batches of one document. */
export function pairCompareManifest(docA: PageRef[], docB: PageRef[]): PageRef[][] {
  const max = Math.max(docA.length, docB.length);
  const pairs: PageRef[][] = [];
  for (let i = 0; i < max; i++) {
    const pair: PageRef[] = [];
    if (i < docA.length) pair.push(docA[i]);
    if (i < docB.length) pair.push(docB[i]);
    if (pair.length === 2) pairs.push(pair); // only comparable (both-doc) pairs
  }
  return pairs;
}
