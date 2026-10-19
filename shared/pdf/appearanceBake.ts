/**
 * Appearance-stream placement math (ISO 32000-1 §12.5.5).
 *
 * An annotation's appearance is a Form XObject with its own /BBox, which is *not* generally the same
 * size or origin as the annotation's /Rect. Baking an appearance into page content therefore needs the
 * same transform a conforming viewer applies, or the flattened page shows the value in the wrong place,
 * at the wrong size, or clipped — which is worse than the bug this replaces, because it looks like
 * success.
 *
 * Kept separate from `services/pdfService.ts` so the geometry can be proven with exact numbers instead
 * of pixel sampling, and so both PDF engines can share one definition.
 */

export type PdfRect = [number, number, number, number];
export type PdfMatrix = [number, number, number, number, number, number];

export class AppearanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppearanceError';
  }
}

/**
 * Concatenate two matrices in PDF order: applying `first` and then `second`, which is how /Matrix
 * composes with the default appearance matrix (`first` = the element's own /Matrix).
 */
export function concatMatrices(first: PdfMatrix, second: PdfMatrix): PdfMatrix {
  const [a1, b1, c1, d1, e1, f1] = first;
  const [a2, b2, c2, d2, e2, f2] = second;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

const degenerate = (v: number) => !Number.isFinite(v) || Math.abs(v) < 1e-6;

/**
 * The matrix that maps an appearance stream's /BBox onto an annotation's /Rect.
 *
 * Uniform scale (the smaller of the two axes) so the artwork keeps its aspect ratio, then translate so
 * the bbox's lower-left lands on the rect's lower-left. A rect wider than the bbox therefore leaves
 * the artwork right-aligned-short rather than stretching it — matching Acrobat.
 */
export function appearanceMatrix(rect: PdfRect, bbox: PdfRect, elementMatrix?: PdfMatrix | null): PdfMatrix {
  if (rect.length !== 4 || bbox.length !== 4) {
    throw new AppearanceError('An annotation /Rect or appearance /BBox is not a 4-number array.');
  }

  const [llx, lly, urx, ury] = rect;
  const [blx, bly, brx, bry] = bbox;
  const rectW = urx - llx;
  const rectH = ury - lly;
  const bboxW = brx - blx;
  const bboxH = bry - bly;

  if (degenerate(bboxW) || degenerate(bboxH)) {
    throw new AppearanceError(
      `The appearance /BBox [${bbox.join(' ')}] has no width or height, so it cannot be placed on the page.`,
    );
  }
  if (degenerate(rectW) || degenerate(rectH)) {
    throw new AppearanceError(
      `The annotation /Rect [${rect.join(' ')}] has no width or height, so there is nothing to bake into.`,
    );
  }

  const scale = Math.min(rectW / bboxW, rectH / bboxH);
  const base: PdfMatrix = [scale, 0, 0, scale, llx - scale * blx, lly - scale * bly];

  if (!elementMatrix) return base;
  if (elementMatrix.length !== 6 || elementMatrix.some((n) => !Number.isFinite(n))) {
    throw new AppearanceError(`The annotation /Matrix ${JSON.stringify(elementMatrix)} is not a 6-number matrix.`);
  }
  return concatMatrices(elementMatrix as PdfMatrix, base);
}

/** PDF number text: fixed notation, no trailing noise, never exponent form (`1e-7` is not a PDF number). */
export function pdfNumber(value: number): string {
  if (!Number.isFinite(value)) throw new AppearanceError(`Cannot write ${value} as a PDF number.`);
  const rounded = Math.round(value * 1e6) / 1e6;
  const text = Object.is(rounded, -0) ? '0' : String(rounded);
  return text.includes('e') || text.includes('E') ? rounded.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : text;
}

/** The content-stream operators that paint one appearance at its rect. */
export function bakeOperators(matrix: PdfMatrix, xObjectName: string): string {
  const name = xObjectName.startsWith('/') ? xObjectName.slice(1) : xObjectName;
  return `q ${matrix.map(pdfNumber).join(' ')} cm /${PDFNameEscape(name)} Do Q\n`;
}

/** Names in a content stream escape a space as `#20`; generated keys do not contain any, but do it right anyway. */
function PDFNameEscape(raw: string): string {
  return raw.replace(/([()<>[\]{}/*%#~\s])/g, (c) => `#${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}
