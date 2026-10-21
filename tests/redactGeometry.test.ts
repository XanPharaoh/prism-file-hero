import { describe, it, expect } from 'vitest';
import {
  rasterScale,
  visibleBoxToRasterRect,
  paintVisibleBlackout,
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

describe('visibleBoxToRasterRect', () => {
  it('maps a visible top-origin box by the render scale alone', () => {
    expect(visibleBoxToRasterRect({ x: 100, y: 40, width: 200, height: 30 }, 2))
      .toEqual({ x: 200, y: 80, width: 400, height: 60 });
  });

  it('keeps the caller box in visible space on a /Rotate 90 page', () => {
    // A page whose MediaBox is 400x700 but which carries /Rotate 90 is DRAWN as 700x400.
    // The caller measured the box on what it saw, so scaling is the only conversion.
    const box = { x: 300, y: 50, width: 60, height: 20 };
    expect(visibleBoxToRasterRect(box, 2)).toEqual({ x: 600, y: 100, width: 120, height: 40 });
  });

  it('proves the old round trip through user space landed the blackout elsewhere', () => {
    // This is the defect C1 described: converting a visible box "back" into PDF user space and
    // then through the viewport applies /Rotate a second time.
    const vp = viewport(2, 400, 700, 90);
    const box = { x: 300, y: 50, width: 60, height: 20 };
    const direct = visibleBoxToRasterRect(box, 2);
    const asUserSpace: [number, number, number, number] = [
      box.x, 400 - box.y - box.height, box.x + box.width, 400 - box.y,
    ];
    const roundTrip = pdfRectToRaster(vp, asUserSpace);
    expect(roundTrip).not.toEqual(direct);
    // Measured against the fake /Rotate 90 viewport: the caller meant 600,100 and the old path
    // painted at 700,600 — a 400pt vertical displacement, which is the off-content blackout C1 measured.
    expect(direct).toEqual({ x: 600, y: 100, width: 120, height: 40 });
    expect(roundTrip.x).toBe(700);
    expect(roundTrip.y).toBe(600);
  });
});

describe('paintVisibleBlackout', () => {
  it('fills at the render scale with a bleed on every side', () => {
    const calls: number[][] = [];
    const ctx = { fillStyle: '', fillRect: (...a: number[]) => calls.push(a) };
    paintVisibleBlackout(ctx, { x: 100, y: 40, width: 200, height: 30 }, 2);
    expect(ctx.fillStyle).toBe('#000000');
    expect(calls[0]).toEqual([199, 79, 402, 62]);
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
