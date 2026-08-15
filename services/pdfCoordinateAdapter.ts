/**
 * Coordinate conversions for PDF.js pages and rendered OCR canvases.
 * PageViewport owns CropBox, rotation and origin handling; callers must not
 * invert coordinates themselves.
 */

export interface PdfViewport {
  width: number;
  height: number;
  rotation: number;
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}

export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A top-left-origin rectangle expressed as a fraction of the rendered page. */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CoordinateConvention {
  version: 1;
  space: 'page-relative-top-left';
  rotation: number;
}

export function canvasToPdf(viewport: PdfViewport, cssX: number, cssY: number): { x: number; y: number } {
  const [x, y] = viewport.convertToPdfPoint(cssX, cssY);
  return { x, y };
}

export function pdfToCanvas(viewport: PdfViewport, x: number, y: number): { left: number; top: number } {
  const [left, top] = viewport.convertToViewportPoint(x, y);
  return { left, top };
}

export function pdfRectToNormalized(viewport: PdfViewport, rect: PdfRect): NormalizedRect {
  const corners = [
    pdfToCanvas(viewport, rect.x, rect.y),
    pdfToCanvas(viewport, rect.x + rect.width, rect.y),
    pdfToCanvas(viewport, rect.x, rect.y + rect.height),
    pdfToCanvas(viewport, rect.x + rect.width, rect.y + rect.height),
  ];
  const left = Math.min(...corners.map((point) => point.left));
  const right = Math.max(...corners.map((point) => point.left));
  const top = Math.min(...corners.map((point) => point.top));
  const bottom = Math.max(...corners.map((point) => point.top));

  return {
    x: clamp(left / viewport.width),
    y: clamp(top / viewport.height),
    width: clamp((right - left) / viewport.width),
    height: clamp((bottom - top) / viewport.height),
  };
}

export function ocrRectToNormalized(
  x: number,
  y: number,
  width: number,
  height: number,
  imageWidth: number,
  imageHeight: number,
): NormalizedRect {
  if (imageWidth <= 0 || imageHeight <= 0) {
    throw new Error('OCR image dimensions must be positive.');
  }
  return {
    x: clamp(x / imageWidth),
    y: clamp(y / imageHeight),
    width: clamp(width / imageWidth),
    height: clamp(height / imageHeight),
  };
}

export function normalizedXToPdf(viewport: PdfViewport, normalizedX: number): number {
  return canvasToPdf(viewport, clamp(normalizedX) * viewport.width, 0).x;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
