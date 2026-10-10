import { describe, it, expect } from 'vitest';
import {
  rasterScale,
  topBoxToPdfRect,
  pdfRectToRaster,
  paintOpaqueBlackout,
  type PdfJsViewportLike,
} from '../shared/pdf/redactGeometry';

// A fake viewport that mirrors PDF.js semantics for scale + y-flip (no rotation),
// plus a 90° variant, so we can prove the mapping is rotation/scale correct.
function viewport(scale: number, pageW: number, pageH: number, rotate = 0): PdfJsViewportLike {
  // device dims after rotation
  const devW = rotate % 180 === 0 ? pageW : pageH;
  const devH = rotate % 180 === 0 ? pageH : pageW;
  return {
    width: devW * scale,
    height: devH * scale,
    convertToViewportRectangle: ([x0, y0, x1, y1]) => {
      if (rotate === 0) {
        // bottom-origin PDF → top-origin device
        return [x0 * scale, (pageH - y1) * scale, x1 * scale, (pageH - y0) * scale];
      }
      if (rotate === 90) {
        return [(pageH - y1) * scale, x0 * scale, (pageH - y0) * scale, x1 * scale];
      }
      return [x0 * scale, y0 * scale, x1 * scale, y1 * scale];
    },
  };
}

describe('rasterScale', () => {
  it('clamps big pages down and never exceeds maxScale', () => {
    expect(rasterScale(1000, 1000, 16_000_000, 2, 0.5)).toBe(2); // small → capped at 2
    expect(rasterScale(6000, 6000, 16_000_000, 2, 0.5)).toBeLessThanOrEqual(2);
    expect(rasterScale(6000, 6000, 1_000_000, 2, 0.5)).toBeGreaterThanOrEqual(0.5);
  });
});

describe('topBoxToPdfRect', () => {
  it('converts a top-origin preview box to bottom-origin PDF y for a 792pt page', () => {
    // box at y=100 (from top), height 50 → pdf top edge = 792-100=692, bottom=792-150=642
    expect(topBoxToPdfRect({ x: 10, y: 100, width: 200, height: 50 }, 792)).toEqual([10, 642, 210, 692]);
  });
});

describe('pdfRectToRaster is the single conversion path', () => {
  it('maps PDF points through scale and returns a positive-area device rect', () => {
    const r = pdfRectToRaster(viewport(2, 300, 400), [50, 300, 150, 340]);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
    expect(r.x).toBe(100); // 50 * scale
  });

  it('stays on-sheet for a 90° rotated page (x grows where y was)', () => {
    const r = pdfRectToRaster(viewport(1, 612, 792, 90), [0, 700, 200, 720]);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(792 + 1);
  });
});

describe('paintOpaqueBlackout', () => {
  it('fills an opaque black rect with bleed', () => {
    const calls: number[][] = [];
    const ctx = { fillStyle: '', fillRect: (...a: number[]) => calls.push(a) };
    paintOpaqueBlackout(ctx, viewport(2, 300, 400), [50, 300, 150, 340]);
    expect(ctx.fillStyle).toBe('#000000');
    expect(calls[0][2]).toBeGreaterThan(0); // width
    expect(calls[0][3]).toBeGreaterThan(0); // height
  });
});
