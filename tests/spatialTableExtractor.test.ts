import { describe, expect, it } from 'vitest';
import { alignSpatialItems, recomputeTableAlignment, type SpatialTextItem } from '../services/spatialTableExtractor';

function item(str: string, x: number, y: number, page = 1): SpatialTextItem {
  return { str, page, bbox: { x, y, width: 0.08, height: 0.02 } };
}

describe('spatial table alignment', () => {
  it('keeps page boundaries, clusters rows, and assigns normalized columns', () => {
    const result = alignSpatialItems([
      item('Date', 0.05, 0.10), item('Description', 0.30, 0.10), item('Amount', 0.72, 0.10),
      item('01/01/2026', 0.05, 0.16), item('Coffee', 0.30, 0.16), item('12.50', 0.72, 0.16),
      item('Date', 0.05, 0.10, 2), item('Description', 0.30, 0.10, 2), item('Amount', 0.72, 0.10, 2),
      item('02/01/2026', 0.05, 0.16, 2), item('Salary', 0.30, 0.16, 2), item('100.00', 0.72, 0.16, 2),
    ], {
      coordinateSource: 'text-layer',
      dividers: [0, 0.2, 0.6, 1],
    });

    expect(result.pages).toHaveLength(2);
    expect(result.headers).toEqual(['Date', 'Description', 'Amount']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(['01/01/2026', 'Coffee', '12.50']);
    expect(result.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it('reassigns cells when dividers are adjusted', () => {
    const result = alignSpatialItems([
      item('Date', 0.05, 0.10), item('Description', 0.35, 0.10), item('Amount', 0.72, 0.10),
      item('01/01/2026', 0.05, 0.16), item('Transfer', 0.35, 0.16), item('12.50', 0.72, 0.16),
    ], { coordinateSource: 'ocr', dividers: [0, 0.2, 0.6, 1] });

    const corrected = recomputeTableAlignment(result, [0, 0.2, 0.5, 1]);
    expect(corrected.dividers).toEqual([0, 0.2, 0.5, 1]);
    expect(corrected.rows[0][1]).toBe('Transfer');
  });
});
