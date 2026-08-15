import { describe, expect, it } from 'vitest';
import { canvasToPdf, ocrRectToNormalized, pdfRectToNormalized, pdfToCanvas, type PdfViewport } from '../services/pdfCoordinateAdapter';

function viewportForRotation(rotation: number): PdfViewport {
  const width = rotation % 180 === 0 ? 200 : 100;
  const height = rotation % 180 === 0 ? 100 : 200;
  return {
    width,
    height,
    rotation,
    convertToPdfPoint(x, y) {
      if (rotation === 90) return [y, 100 - x];
      if (rotation === 180) return [200 - x, 100 - y];
      if (rotation === 270) return [200 - y, x];
      return [x, 100 - y];
    },
    convertToViewportPoint(x, y) {
      if (rotation === 90) return [100 - y, x];
      if (rotation === 180) return [200 - x, 100 - y];
      if (rotation === 270) return [y, 200 - x];
      return [x, 100 - y];
    },
  };
}

describe('PDF coordinate adapter', () => {
  it.each([0, 90, 180, 270])('round-trips points for %i degree pages', (rotation) => {
    const viewport = viewportForRotation(rotation);
    const canvas = pdfToCanvas(viewport, 20, 30);
    expect(canvasToPdf(viewport, canvas.left, canvas.top)).toEqual({ x: 20, y: 30 });
  });

  it('normalizes viewport rectangles without assuming a PDF origin', () => {
    const viewport: PdfViewport = {
      width: 400,
      height: 200,
      rotation: 0,
      convertToPdfPoint: (x, y) => [x + 50, y + 75],
      convertToViewportPoint: (x, y) => [x - 50, y - 75],
    };
    expect(pdfRectToNormalized(viewport, { x: 150, y: 125, width: 80, height: 40 })).toEqual({
      x: 0.25,
      y: 0.25,
      width: 0.2,
      height: 0.2,
    });
  });

  it('normalizes OCR pixels independently of render scale', () => {
    expect(ocrRectToNormalized(200, 100, 80, 40, 800, 400)).toEqual({
      x: 0.25,
      y: 0.25,
      width: 0.1,
      height: 0.1,
    });
  });
});
