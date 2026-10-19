/**
 * A5 · the appearance placement math, proven with exact numbers rather than pixel sampling.
 *
 * These are the values a conforming viewer applies. If this module is wrong, every flattened page is
 * subtly wrong — the value painted at the wrong offset, or stretched — and the output still looks
 * like a successful run. So the geometry is pinned here directly.
 */
import { describe, expect, it } from 'vitest';
import {
  AppearanceError, appearanceMatrix, bakeOperators, concatMatrices, pdfNumber,
} from '../../shared/pdf/appearanceBake';

describe('appearanceMatrix — ISO 32000-1 §12.5.5 placement', () => {
  it('paints an exactly-sized appearance at the annotation rect', () => {
    // The fixture shapes in tests/features/page-ops.test.ts: BBox 240x20, Rect [50,600]-[290,620].
    expect(appearanceMatrix([50, 600, 290, 620], [0, 0, 240, 20])).toEqual([1, 0, 0, 1, 50, 600]);
  });

  it('never stretches: a wide rect gets the smaller scale, not sx', () => {
    // sx would be 2, sy is 1. Uniform scale takes the minimum, so the artwork keeps its proportions.
    expect(appearanceMatrix([0, 0, 200, 50], [0, 0, 100, 50])).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('shifts by the bbox origin, because a /BBox need not start at 0 0', () => {
    expect(appearanceMatrix([0, 0, 100, 50], [10, 10, 110, 60])).toEqual([1, 0, 0, 1, -10, -10]);
  });

  it('scales down when the rect is smaller than the appearance', () => {
    expect(appearanceMatrix([0, 0, 100, 100], [0, 0, 200, 100])).toEqual([0.5, 0, 0, 0.5, 0, 0]);
  });

  it('applies the element /Matrix first, then the default matrix', () => {
    const element: [number, number, number, number, number, number] = [2, 0, 0, 2, 5, 5];
    expect(appearanceMatrix([50, 600, 290, 620], [0, 0, 240, 20], element)).toEqual([2, 0, 0, 2, 55, 605]);
  });

  it('handles a negative-origin rect', () => {
    expect(appearanceMatrix([-100, -50, 0, 50], [0, 0, 100, 100])).toEqual([1, 0, 0, 1, -100, -50]);
  });

  it('refuses geometry it cannot place, instead of emitting a misplaced mark', () => {
    expect(() => appearanceMatrix([0, 0, 100, 100], [0, 0, 0, 50])).toThrow(AppearanceError);
    expect(() => appearanceMatrix([0, 0, 100, 100], [0, 0, 100, 0])).toThrow(/BBox/);
    expect(() => appearanceMatrix([50, 50, 50, 90], [0, 0, 10, 10])).toThrow(/Rect/);
    expect(() => appearanceMatrix([0, 0, 10, 10], [0, 0, 5, 5], [1, 0, 0, 1, 0] as any)).toThrow(/Matrix/);
  });

  it('concatenates in PDF order', () => {
    const translate: [number, number, number, number, number, number] = [1, 0, 0, 1, 10, 0];
    const scale: [number, number, number, number, number, number] = [2, 0, 0, 2, 0, 0];
    // scale applied first, then translate: (1,1) -> (2,2) -> (12,2)
    expect(concatMatrices(scale, translate)).toEqual([2, 0, 0, 2, 10, 0]);
    // and the reverse order really does mean the reverse: (1,1) -> (11,1) -> (22,2)
    expect(concatMatrices(translate, scale)).toEqual([2, 0, 0, 2, 20, 0]);
  });
});

describe('content-stream emission', () => {
  it('writes PDF numbers, never JavaScript exponent notation', () => {
    expect(pdfNumber(1)).toBe('1');
    expect(pdfNumber(0.5)).toBe('0.5');
    expect(pdfNumber(-0)).toBe('0');
    expect(pdfNumber(1e-7)).toBe('0');
    expect(pdfNumber(1.5e-5)).not.toMatch(/e/i);
    expect(pdfNumber(1234.5)).toBe('1234.5');
    expect(() => pdfNumber(Number.NaN)).toThrow(AppearanceError);
  });

  it('emits a self-contained q/cm/Do/Q group', () => {
    expect(bakeOperators([1, 0, 0, 1, 50, 600], 'FlatWidget0')).toBe('q 1 0 0 1 50 600 cm /FlatWidget0 Do Q\n');
    // pdf-lib hands back a PDFName whose string form already carries the slash.
    expect(bakeOperators([2, 0, 0, 2, 55, 605], '/PrismBake3')).toBe('q 2 0 0 2 55 605 cm /PrismBake3 Do Q\n');
  });

  it('escapes characters that would break a name token', () => {
    expect(bakeOperators([1, 0, 0, 1, 0, 0], 'a b')).toContain('/a#20b Do');
  });
});
