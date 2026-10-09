import { describe, it, expect } from 'vitest';
import {
  parseSelection,
  parsePermutation,
  assertPermutation,
  keepIndicesForDeletion,
  nUpGrid,
  cellFor,
  SelectionError,
} from '../shared/pdf/pageSelection';

describe('parseSelection (shared, strict)', () => {
  it('parses single pages, ranges, mixed, and de-duplicates — zero-indexed ascending', () => {
    expect(parseSelection('2', 4, { strict: true })).toEqual([1]);
    expect(parseSelection('2,4-5', 6, { strict: true })).toEqual([1, 3, 4]);
    expect(parseSelection('1,1,2,2', 4, { strict: true })).toEqual([0, 1]); // BUG-10 dedup
    expect(parseSelection('4-1', 4, { strict: true })).toEqual([0, 1, 2, 3]); // reversed range
    expect(parseSelection('1 and 3', 4, { strict: true })).toEqual([0, 2]);
    expect(parseSelection([2, 3], 4, { strict: true })).toEqual([1, 2]);
  });

  it('rejects out-of-range and malformed input in strict mode', () => {
    expect(() => parseSelection('9', 4, { strict: true })).toThrowError(SelectionError);
    expect(() => parseSelection('0', 4, { strict: true })).toThrowError(SelectionError);
    expect(() => parseSelection('abc', 4, { strict: true })).toThrowError(SelectionError);
    try {
      parseSelection('abc', 4, { strict: true });
    } catch (e) {
      expect((e as SelectionError).code).toBe('MALFORMED');
    }
  });

  it('drops junk / out-of-range silently in non-strict mode', () => {
    expect(parseSelection('abc', 4)).toEqual([]);
    expect(parseSelection('9,2', 4)).toEqual([1]);
  });

  it('refuses oversized expansion', () => {
    expect(() => parseSelection('1-100', 100, { strict: true, maxExpansion: 50 })).toThrowError(
      /oversized/i
    );
  });

  it('supports fallback to all pages when nothing is selected', () => {
    expect(parseSelection('', 3, { fallback: 'all' })).toEqual([0, 1, 2]);
    expect(parseSelection('', 3, { fallback: 'none' })).toEqual([]);
  });
});

describe('permutation validation (BUG-11)', () => {
  it('accepts a true permutation', () => {
    expect(parsePermutation('3,1,2', 3)).toEqual([2, 0, 1]);
  });
  it('rejects duplicates that happen to match the length', () => {
    expect(() => parsePermutation('1,1,1', 3)).toThrowError(/more than once/i);
    try {
      assertPermutation([0, 0, 0], 3);
    } catch (e) {
      expect((e as SelectionError).code).toBe('NOT_A_PERMUTATION');
    }
  });
  it('rejects wrong length', () => {
    expect(() => assertPermutation([0, 1], 3)).toThrowError(/Expected 3 distinct pages/i);
  });
});

describe('keepIndicesForDeletion', () => {
  it('keeps everything except the unique deleted set', () => {
    expect(keepIndicesForDeletion([1, 1], 4)).toEqual([0, 2, 3]);
  });
  it('refuses to delete every page', () => {
    expect(() => keepIndicesForDeletion([0, 1, 2], 3)).toThrowError(/empty document/i);
  });
});

describe('nUpGrid (BUG-12) + cellFor', () => {
  it('two-up is 1 column x 2 rows', () => {
    expect(nUpGrid(2)).toEqual({ cols: 1, rows: 2 });
  });
  it('four-up and nine-up are square', () => {
    expect(nUpGrid(4)).toEqual({ cols: 2, rows: 2 });
    expect(nUpGrid(9)).toEqual({ cols: 3, rows: 3 });
  });
  it('cell positions stay inside the grid (no off-sheet row)', () => {
    const g = nUpGrid(2);
    expect(cellFor(0, g)).toEqual({ col: 0, row: 0 });
    expect(cellFor(1, g)).toEqual({ col: 0, row: 1 }); // was row 1 of a 1-row sheet → y < 0
    const g9 = nUpGrid(9);
    expect(cellFor(8, g9)).toEqual({ col: 2, row: 2 });
  });
});
