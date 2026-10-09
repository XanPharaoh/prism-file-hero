/**
 * Shared, framework-agnostic page-selection primitives for every PDF page
 * operation (delete / extract / reorder / split / N-up) across BOTH the web
 * app (`services/pdfService.ts`) and the static site (`site/assets/tool.js`).
 *
 * Why this exists (Batch 02, guide §14): page operations had three separate
 * hand-rolled parsers that disagreed on duplicates, out-of-range values and
 * malformed input, producing silent data loss:
 *   - BUG-10 delete "2,2" removed original pages 2 AND 3 (no de-dup before
 *     descending removal).
 *   - BUG-11 reorder "1,1,1" replaced a whole document with three copies of
 *     page 1 (permutation only checked by length, not uniqueness).
 *   - BUG-12 N-up used 1x1 for two-up, drawing the second page off-sheet.
 *
 * Contract:
 *   - All public functions return ZERO-indexed page numbers.
 *   - `parseSelection` is the single parser. `strict: true` (the default for
 *     task runners) THROWS SelectionError on any malformed / out-of-range /
 *     oversized request so the caller can refuse to download anything.
 *   - `assertPermutation` is used by reorder so a reorder can never duplicate
 *     or drop a page.
 *   - `nUpGrid` returns a declared grid for every supported pages-per-sheet.
 */

export const DEFAULT_MAX_EXPANSION = 5000;

export class SelectionError extends Error {
  code: 'MALFORMED' | 'OUT_OF_RANGE' | 'OVERSIZED' | 'NOT_A_PERMUTATION' | 'EMPTY';
  constructor(message: string, code: SelectionError['code']) {
    super(message);
    this.name = 'SelectionError';
    this.code = code;
  }
}

export interface ParseOptions {
  /** Reject malformed / out-of-range / oversized input by throwing. Default false. */
  strict?: boolean;
  /** Maximum number of pages a single expression may expand to. Default 5000. */
  maxExpansion?: number;
  /** Pages to return when the input selects nothing. Default [] (empty). */
  fallback?: 'all' | 'none';
}

// "1-3", "3-1", "1 to 3", "1–3" (en/em dash). Groups: start, end.
const RANGE_RE = /^(\d+)\s*(?:[-–—]|to)\s*(\d+)$/i;

/**
 * Parse a human page selection ("2", "2,4-5", "1 and 3", "1;2") into a
 * sorted, de-duplicated array of ZERO-indexed pages within [0, totalPages-1].
 */
export function parseSelection(
  input: string | number | number[] | null | undefined,
  totalPages: number,
  options: ParseOptions = {}
): number[] {
  const strict = options.strict ?? false;
  const maxExpansion = options.maxExpansion ?? DEFAULT_MAX_EXPANSION;
  const fallback = options.fallback ?? 'none';

  if (totalPages <= 0) {
    if (strict) throw new SelectionError('The document has no pages.', 'EMPTY');
    return [];
  }

  const tokens = tokenize(input);
  const selected = new Set<number>(); // zero-indexed
  let expandedCount = 0;

  for (const token of tokens) {
    if (token === '') continue;

    const range = token.match(RANGE_RE);
    if (range) {
      let start = parseInt(range[1], 10);
      let end = parseInt(range[2], 10);
      if (start > end) [start, end] = [end, start]; // tolerate reversed ranges
      if (strict && (start < 1 || end > totalPages)) {
        throw new SelectionError(
          `Range "${range[1]}-${range[2]}" is outside the document (1-${totalPages}).`,
          'OUT_OF_RANGE'
        );
      }
      const lo = Math.max(1, start);
      const hi = Math.min(totalPages, end);
      for (let p = lo; p <= hi; p++) {
        if (++expandedCount > maxExpansion) {
          throw new SelectionError(
            `Selection expands beyond ${maxExpansion} pages — refusing to build an oversized document.`,
            'OVERSIZED'
          );
        }
        selected.add(p - 1);
      }
      continue;
    }

    if (/^\d+$/.test(token)) {
      const page = parseInt(token, 10);
      if (page < 1 || page > totalPages) {
        if (strict) {
          throw new SelectionError(`Page ${page} is outside the document (1-${totalPages}).`, 'OUT_OF_RANGE');
        }
        continue; // drop out-of-range silently in non-strict mode
      }
      if (++expandedCount > maxExpansion) {
        throw new SelectionError(`Selection expands beyond ${maxExpansion} pages.`, 'OVERSIZED');
      }
      selected.add(page - 1);
      continue;
    }

    if (strict) {
      throw new SelectionError(`"${token}" is not a valid page or range.`, 'MALFORMED');
    }
    // non-strict: ignore the junk token
  }

  let result = Array.from(selected).sort((a, b) => a - b);

  if (result.length === 0 && fallback === 'all') {
    result = Array.from({ length: totalPages }, (_, i) => i);
  }
  return result;
}

function tokenize(input: string | number | number[] | null | undefined): string[] {
  if (input == null) return [];
  if (typeof input === 'number') return [String(input)];
  if (Array.isArray(input)) return input.map(n => String(n).trim());
  return String(input)
    .replace(/\band\b/gi, ',')
    .replace(/&/g, ',')
    .split(/[\s,;]+/)
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

/**
 * Reorder must be a permutation of the current pages: every original page
 * appears exactly once. Returns ZERO-indexed order, or throws.
 */
export function assertPermutation(order: number[], totalPages: number): number[] {
  if (order.length !== totalPages) {
    throw new SelectionError(
      `Expected ${totalPages} distinct pages but got ${order.length}.`,
      'NOT_A_PERMUTATION'
    );
  }
  const seen = new Set<number>();
  for (const idx of order) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= totalPages) {
      throw new SelectionError(`Page index ${idx + 1} is not valid.`, 'OUT_OF_RANGE');
    }
    if (seen.has(idx)) {
      throw new SelectionError(
        `Page ${idx + 1} appears more than once — reorder must list each page exactly once.`,
        'NOT_A_PERMUTATION'
      );
    }
    seen.add(idx);
  }
  return order;
}

/** Parse a reorder string ("3,1,2") into a validated zero-indexed permutation. */
export function parsePermutation(
  input: string | number | number[] | null | undefined,
  totalPages: number
): number[] {
  const raw = tokenize(input)
    .map(t => parseInt(t, 10))
    .filter(n => !Number.isNaN(n))
    .map(n => n - 1);
  return assertPermutation(raw, totalPages);
}

/**
 * Reject DUPLICATE page selections and out-of-range indices while ALLOWING a
 * subset. This is the reorder-pages contract: "3,2,1" out of 16 pages is a valid
 * subset reorder, but "1,1,1" is not — the old code accepted the latter because
 * it only de-duplicated when the length differed from the page count (BUG-11).
 */
export function assertUnique(indices: number[], totalPages: number): number[] {
  const seen = new Set<number>();
  for (const idx of indices) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= totalPages) {
      throw new SelectionError(`Page ${idx + 1} is not valid (1-${totalPages}).`, 'OUT_OF_RANGE');
    }
    if (seen.has(idx)) {
      throw new SelectionError(
        `Page ${idx + 1} appears more than once — each page may be listed only once.`,
        'NOT_A_PERMUTATION'
      );
    }
    seen.add(idx);
  }
  return indices;
}

/** Parse a reorder string into a validated, duplicate-free zero-indexed order (subset allowed). */
export function parseReorder(
  input: string | number | number[] | null | undefined,
  totalPages: number
): number[] {
  const raw = tokenize(input)
    .map(t => parseInt(t, 10))
    .filter(n => !Number.isNaN(n))
    .map(n => n - 1);
  return assertUnique(raw, totalPages);
}

/**
 * Pages to keep when the given (zero-indexed) pages are deleted. Guards the
 * "delete everything" case so callers never emit an empty document.
 */
export function keepIndicesForDeletion(deletePages: number[], totalPages: number): number[] {
  const del = new Set(deletePages);
  const keep = Array.from({ length: totalPages }, (_, i) => i).filter(i => !del.has(i));
  if (keep.length === 0) {
    throw new SelectionError('Deleting every page would leave an empty document.', 'EMPTY');
  }
  return keep;
}

export interface Grid {
  cols: number;
  rows: number;
}

/**
 * Declared N-up grids. Reading order is left-to-right, top-to-bottom, but the
 * layout is defined by these explicit dimensions so a two-up sheet is a single
 * column of two rows (never 1x1, which put the second page off the page edge).
 */
export function nUpGrid(pagesPerSheet: number): Grid {
  switch (pagesPerSheet) {
    case 1: return { cols: 1, rows: 1 };
    case 2: return { cols: 1, rows: 2 };
    case 4: return { cols: 2, rows: 2 };
    case 6: return { cols: 2, rows: 3 };
    case 9: return { cols: 3, rows: 3 };
    case 16: return { cols: 4, rows: 4 };
    default: {
      const cols = Math.ceil(Math.sqrt(pagesPerSheet));
      const rows = Math.ceil(pagesPerSheet / cols);
      return { cols, rows };
    }
  }
}

/**
 * Position of the k-th cell (0-indexed within a sheet) for a grid, using a
 * top-left origin in cell units. Callers convert to PDF points.
 */
export function cellFor(k: number, grid: Grid): { col: number; row: number } {
  return { col: k % grid.cols, row: Math.floor(k / grid.cols) };
}
