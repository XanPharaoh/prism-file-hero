/**
 * Batch 01 — One tested coordinate converter shared by every raster PDF tool.
 *
 * A redaction region arrives as PDF points in one of two spaces:
 *   • page text items: PDF user space, BOTTOM-left origin, in the page's own
 *     (possibly rotated) coordinate system;
 *   • caller-supplied boxes: TOP-origin points on the *visible* page (what the
 *     preview / AI bounding boxes are measured against).
 *
 * Both must land on the same raster pixel as the rendered page — through preview
 * scale AND page rotation. PDF.js's viewport already encodes rotation and scale,
 * so the ONLY correct mapping is via a rotation-aware viewport's
 * `convertToViewportRectangle`. This module centralises that so the app and the
 * site share one implementation, and so rotation/scale can be unit-tested.
 */

export interface PdfJsViewportLike {
  width: number;
  height: number;
  convertToViewportRectangle: (rect: [number, number, number, number]) => number[];
}

/** Raster pixel budget so huge pages don't OOM; keeps scale within [minScale, maxScale]. */
export function rasterScale(
  visibleWidth: number,
  visibleHeight: number,
  maxPixels = 16_000_000,
  maxScale = 2,
  minScale = 0.5
): number {
  const area = Math.max(1, visibleWidth * visibleHeight);
  return Math.min(maxScale, Math.max(minScale, Math.sqrt(maxPixels / area)));
}

/**
 * Convert a TOP-origin box (x,y = distance from the top-left of the visible page,
 * as a preview overlay or AI box uses) into the same PDF-space rectangle the text
 * items use, for a page of height `pageHeight`. PDF is bottom-origin, so:
 *   pdfY0 = pageHeight - y - height   (bottom edge)
 *   pdfY1 = pageHeight - y            (top edge)
 */
export function topBoxToPdfRect(
  box: { x: number; y: number; width: number; height: number },
  pageHeight: number
): [number, number, number, number] {
  const x0 = box.x;
  const x1 = box.x + box.width;
  const yBottom = pageHeight - box.y - box.height;
  const yTop = pageHeight - box.y;
  return [x0, yBottom, x1, yTop];
}

/**
 * Map any PDF-space rectangle to a device/canvas rectangle [x0,y0,x1,y1] in
 * raster pixels, honouring the viewport's rotation + scale. This is the single
 * conversion path — never hand-multiply by scale or flip y elsewhere.
 */
export function pdfRectToRaster(
  raster: PdfJsViewportLike,
  pdfRect: [number, number, number, number]
): { x: number; y: number; width: number; height: number } {
  const [dx0, dy0, dx1, dy1] = raster.convertToViewportRectangle(pdfRect) as [number, number, number, number];
  const x = Math.min(dx0, dx1);
  const y = Math.min(dy0, dy1);
  return { x, y, width: Math.abs(dx1 - dx0), height: Math.abs(dy1 - dy0) };
}

/** Paint an opaque black rectangle over a raster rect with a small bleed so no
 *  sub-pixel of the underlying content survives at the edges. */
export function paintOpaqueBlackout(
  ctx: { fillStyle: unknown; fillRect: (x: number, y: number, w: number, h: number) => void },
  raster: PdfJsViewportLike,
  pdfRect: [number, number, number, number],
  bleed = 1
): void {
  const r = pdfRectToRaster(raster, pdfRect);
  ctx.fillStyle = '#000000';
  ctx.fillRect(r.x - bleed, r.y - bleed, r.width + bleed * 2, r.height + bleed * 2);
}
