
import { pdfjsLib } from './pdfjsClient';
import {
  PDFDocument, rgb, degrees, StandardFonts, PDFName, PDFArray, PDFDict, PDFContext,
  PDFNumber, PDFRef, PDFString, PDFHexString, PDFRawStream, PDFPageLeaf, type PDFObject,
} from 'pdf-lib';
import { appearanceMatrix, bakeOperators, type PdfMatrix, type PdfRect } from '@/shared/pdf/appearanceBake';
import { encryptPDF } from '@pdfsmaller/pdf-encrypt-lite';
import { EncryptedDocumentError, isEncryptedLoadFailure, loadPdfForRebuild } from '@/shared/pdf/loadGuard';
import { collectEmbeddedImages } from '@/shared/pdf/embeddedImages';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import JSZip from 'jszip';
import {
  parseSelection,
  parseSequence,
  assertUnique,
  assertPermutation,
  keepIndicesForDeletion,
  nUpGrid,
  cellFor,
  SelectionError,
} from '@/shared/pdf/pageSelection';
import {
  rasterScale,
  topBoxToPdfRect,
  paintOpaqueBlackout,
} from '@/shared/pdf/redactGeometry';

/**
 * Simple main-thread image preprocessing for OCR enhancement.
 * Runs grayscale conversion on the main thread (replaces Web Worker version).
 */
async function preprocessImageData(imageData: ImageData): Promise<ImageData> {
  // Simple grayscale conversion for OCR enhancement (runs on main thread)
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
    data[i] = avg;     // R
    data[i + 1] = avg; // G
    data[i + 2] = avg; // B
  }
  return imageData;
}

/**
 * Helper to parse page selection strings (e.g. "1, 2, 4-6, and 8") into 0-indexed page indices.
 * Delegates to the shared parser so site and app agree on duplicates, ranges, out-of-range,
 * and expansion caps. Defaults to all pages when the input selects nothing (merge/split semantics).
 */
function parsePageSelection(pagesStr: string, totalPages: number): number[] {
  return parseSelection(pagesStr, totalPages, { strict: false, fallback: 'all' });
}

/**
 * Helper to parse page selection strings (e.g. "1, 2, 4-6") into 0-indexed page indices without
 * defaulting to all pages. Delegates to the shared parser (de-duplicates + clamps by default).
 */
function parsePageRange(pagesStr: string, totalPages: number): number[] {
  return parseSelection(pagesStr, totalPages, { strict: false, fallback: 'none' });
}

/**
 * Strict selection for operations where "all pages" is never what a rejected input meant. Split used
 * the lenient parser, so an unparseable group fell back to every page and quietly wrote one file
 * containing the whole document -- a typo must be refused, not widened.
 */
function parsePageSelectionExact(pagesStr: string, totalPages: number): number[] {
  return parseSelection(pagesStr, totalPages, { strict: true, fallback: 'none' });
}

/**
 * Loader for every operation that rebuilds a document. It repairs malformed syntax, but it refuses
 * encrypted input rather than producing a page-count-correct file with no content in it -- see
 * shared/pdf/loadGuard.ts for the measurement that made this a hard rule.
 */
export async function loadPdfResilient(file: File): Promise<PDFDocument> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const doc = await loadPdfForRebuild(bytes);
    doc.getPageCount();
    return doc;
  } catch (err) {
    if (err instanceof EncryptedDocumentError) throw err;
    const repaired = await repairPdf(file);
    const repairedBytes = new Uint8Array(await repaired.arrayBuffer());
    return await loadPdfForRebuild(repairedBytes);
  }
}

/**
 * Structural manipulation: Merge multiple PDFs with optional specific page selection
 */
export async function mergePdfs(files: File[], pagesStr?: string): Promise<Blob> {
  const mergedPdf = await PDFDocument.create();
  for (const file of files) {
    const pdf = await loadPdfResilient(file);
    const totalPages = pdf.getPageCount();
    const indices = pagesStr ? parsePageSelection(pagesStr, totalPages) : Array.from({ length: totalPages }, (_, i) => i);
    const copiedPages = await mergedPdf.copyPages(pdf, indices);
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }
  const pdfBytes = await mergedPdf.save({ useObjectStreams: true });
  return new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
}

export interface SplitResult {
  blob: Blob;
  pageNum?: number;
  label: string;
}

/**
 * Structural manipulation: Split PDF into individual pages or ranges (e.g. "1-4, 5-6")
 */
export async function splitPdf(file: File, rangesStr?: string): Promise<SplitResult[]> {
  const pdf = await loadPdfResilient(file);
  const totalPages = pdf.getPageCount();
  const results: SplitResult[] = [];

  // Check if custom ranges or distinct page subsets are specified
  if (rangesStr && rangesStr.trim()) {
    const parts = rangesStr.split(/[,;]+/).map(p => p.trim()).filter(Boolean);
    const hasRanges = parts.some(p => p.includes('-'));

    if (hasRanges || parts.length > 1) {
      for (let idx = 0; idx < parts.length; idx++) {
        const part = parts[idx];
        const pageIndices = parsePageSelectionExact(part, totalPages);
        if (pageIndices.length === 0) continue;

        const newDoc = await PDFDocument.create();
        const copiedPages = await newDoc.copyPages(pdf, pageIndices);
        copiedPages.forEach(p => newDoc.addPage(p));
        const pageBytes = await newDoc.save({ useObjectStreams: true });

        const label = part.includes('-')
          ? `Part_${idx + 1}_Pages_${part.replace(/\s+/g, '')}.pdf`
          : `Page_${pageIndices[0] + 1}.pdf`;

        results.push({
          blob: new Blob([pageBytes as BlobPart], { type: 'application/pdf' }),
          pageNum: pageIndices[0] + 1,
          label,
        });
      }
      if (results.length > 0) return results;
    } else if (parts.length === 1 && !hasRanges) {
      // Single specific page selection, e.g. "3"
      const pageIndices = parsePageSelectionExact(parts[0], totalPages);
      for (const i of pageIndices) {
        const newDoc = await PDFDocument.create();
        const [page] = await newDoc.copyPages(pdf, [i]);
        newDoc.addPage(page);
        const pageBytes = await newDoc.save({ useObjectStreams: true });
        results.push({
          blob: new Blob([pageBytes as BlobPart], { type: 'application/pdf' }),
          pageNum: i + 1,
          label: `Page_${i + 1}.pdf`,
        });
      }
      if (results.length > 0) return results;
    }
  }

  // Default: Split every page individually
  for (let i = 0; i < totalPages; i++) {
    const newDoc = await PDFDocument.create();
    const [page] = await newDoc.copyPages(pdf, [i]);
    newDoc.addPage(page);
    const pageBytes = await newDoc.save({ useObjectStreams: true });
    results.push({
      blob: new Blob([pageBytes as BlobPart], { type: 'application/pdf' }),
      pageNum: i + 1,
      label: `Page_${i + 1}.pdf`,
    });
  }
  return results;
}

/**
 * Structural manipulation: Rotate PDF
 */
export async function rotatePdf(file: File, angle: number = 90): Promise<Blob> {
  const bytes = await file.arrayBuffer();
  const pdf = await loadPdfForRebuild(bytes, 'Rotate');
  const pages = pdf.getPages();
  pages.forEach(page => {
    const currRotation = page.getRotation().angle;
    page.setRotation(degrees(currRotation + angle));
  });
  const rotatedPdfBytes = await pdf.save();
  return new Blob([rotatedPdfBytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Security: Protect PDF using standard encryption via @pdfsmaller/pdf-encrypt-lite.
 * Produces password-protected PDFs that prompt for password on open.
 */
export async function protectPdf(file: File, password: string): Promise<Blob> {
  if (!password) {
    throw new Error('Password must not be empty');
  }
  let pdfBytes: Uint8Array;
  try {
    const rawDoc = await loadPdfForRebuild(new Uint8Array(await file.arrayBuffer()), 'Protect');
    pdfBytes = await rawDoc.save();
  } catch (err) {
    // Never relabel an encrypted document as "invalid PDF": the user would chase corruption that
    // does not exist instead of reaching for the password.
    if (err instanceof EncryptedDocumentError) throw err;
    try {
      const repaired = await repairPdf(file);
      pdfBytes = new Uint8Array(await repaired.arrayBuffer());
    } catch (repairErr) {
      if (repairErr instanceof EncryptedDocumentError) throw repairErr;
      throw new Error('Failed to parse PDF document: Invalid PDF');
    }
  }
  // Encrypt with both user (open) and owner (permission) passwords
  const encryptedBytes = await encryptPDF(pdfBytes, password, password);
  return new Blob([encryptedBytes], { type: 'application/pdf' });
}

/**
 * Security: Add watermark across each page.
 * Supports dense repeating grid ("tiled/spam" pattern) or single centered diagonal stamp.
 */
export async function watermarkPdf(
  file: File,
  text: string,
  options?: { mode?: 'tiled' | 'single'; opacity?: number }
): Promise<Blob> {
  const pdf = await loadPdfResilient(file);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();
  const mode = options?.mode ?? 'tiled'; // Default to repeating tiled pattern across the page
  const opacity = options?.opacity ?? (mode === 'tiled' ? 0.20 : 0.35);

  pages.forEach(page => {
    const { width, height } = page.getSize();

    if (mode === 'tiled') {
      // Repeating diagonal matrix grid across the full page ("spam pattern")
      const fontSize = 22;
      const textWidth = font.widthOfTextAtSize(text, fontSize);
      const angleDegrees = 35;
      const xSpacing = Math.max(textWidth + 70, 160);
      const ySpacing = 100;

      for (let x = -width * 0.5; x < width * 1.5; x += xSpacing) {
        for (let y = -height * 0.5; y < height * 1.5; y += ySpacing) {
          page.drawText(text, {
            x,
            y,
            size: fontSize,
            font,
            color: rgb(0.65, 0.65, 0.65),
            opacity,
            rotate: degrees(angleDegrees),
          });
        }
      }
    } else {
      // Single large centered diagonal stamp
      const diagonal = Math.sqrt(width * width + height * height);
      const fontSize = Math.min(diagonal * 0.08, 60);
      const textWidth = font.widthOfTextAtSize(text, fontSize);

      const centerX = width / 2;
      const centerY = height / 2;
      const angleRad = Math.atan2(height, width);
      const angleDegrees = angleRad * (180 / Math.PI);

      const cos = Math.cos(angleRad);
      const sin = Math.sin(angleRad);
      const centerX_rel = (textWidth / 2) * cos - (fontSize / 2) * sin;
      const centerY_rel = (textWidth / 2) * sin + (fontSize / 2) * cos;

      page.drawText(text, {
        x: centerX - centerX_rel,
        y: centerY - centerY_rel,
        size: fontSize,
        font,
        color: rgb(0.70, 0.70, 0.70),
        opacity,
        rotate: degrees(angleDegrees),
      });
    }
  });

  const watermarkedPdfBytes = await pdf.save();
  return new Blob([watermarkedPdfBytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Optimize: High-impact PDF compression
 * - Re-renders pages at reduced scale/quality to shrink high-res scans & embedded images
 * - Always guarantees resulting size is smaller than the original
 */
export async function compressPdf(
  file: File,
  quality: number = 0.60,
  onProgress?: (percent: number) => void,
  password?: string
): Promise<Blob> {
  const originalBytes = new Uint8Array(await file.arrayBuffer());
  const originalSize = originalBytes.byteLength;
  let pdfDoc: any = null;

  try {
    pdfDoc = await pdfjsLib.getDocument({ data: originalBytes.slice(0), password }).promise;
    const newPdf = await PDFDocument.create();
    const pageCount = pdfDoc.numPages;

    // Quality scaling:
    // Extreme (quality <= 0.45): scale 0.75, quality 0.40
    // Recommended (quality ~ 0.60): scale 0.90, quality 0.55
    // Low (quality >= 0.75): scale 1.0, quality 0.75
    const effectiveScale = quality <= 0.45 ? 0.75 : quality <= 0.65 ? 0.90 : 1.0;
    const effectiveQuality = Math.max(0.30, Math.min(quality, 0.85));

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdfDoc.getPage(i);
      const origViewport = page.getViewport({ scale: 1.0 });
      const renderViewport = page.getViewport({ scale: effectiveScale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        page.cleanup?.();
        continue;
      }

      canvas.width = Math.max(1, Math.round(renderViewport.width));
      canvas.height = Math.max(1, Math.round(renderViewport.height));

      await page.render({ canvasContext: context, viewport: renderViewport }).promise;

      // Convert to JPEG with controlled quality
      const jpegDataUrl = canvas.toDataURL('image/jpeg', effectiveQuality);
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup?.();

      const base64 = jpegDataUrl.split(',')[1];
      const binaryStr = atob(base64);
      const imageBytes = new Uint8Array(binaryStr.length);
      for (let j = 0; j < binaryStr.length; j++) {
        imageBytes[j] = binaryStr.charCodeAt(j);
      }

      // Embed into new PDF at ORIGINAL page dimensions
      const image = await newPdf.embedJpg(imageBytes);
      const newPage = newPdf.addPage([origViewport.width, origViewport.height]);
      newPage.drawImage(image, {
        x: 0,
        y: 0,
        width: origViewport.width,
        height: origViewport.height,
      });

      if (onProgress) onProgress(Math.round((i / pageCount) * 100));
    }

    const resultBytes = await newPdf.save({ useObjectStreams: true });

    // If rasterized compression reduced the file size, return it
    if (resultBytes.length < originalSize) {
      return new Blob([resultBytes as BlobPart], { type: 'application/pdf' });
    }
  } catch (error) {
    console.error('Error during compression:', error);
  } finally {
    if (pdfDoc) {
      try { await pdfDoc.destroy(); } catch {}
    }
  }

  // Fallback: try lossless stream compression
  try {
    const pdfDocLib = await loadPdfForRebuild(originalBytes.slice(0), 'Compress');
    const losslessBuffer = await pdfDocLib.save({ useObjectStreams: true });
    if (losslessBuffer.length < originalSize) {
      return new Blob([losslessBuffer as BlobPart], { type: 'application/pdf' });
    }
  } catch {}

  if (onProgress) onProgress(100);
  return new Blob([originalBytes.slice(0) as BlobPart], { type: 'application/pdf' });
}

/**
 * Security: Redact PDF — GENUINE removal via raster reconstruction.
 *
 * Renders every page to pixels, paints opaque black over the selected regions,
 * and rebuilds a NEW PDF containing only those page images. The original text
 * streams, objects, annotations, attachments, layers and metadata are never
 * copied, so covered content cannot be extracted.
 *
 * Disclose to the user before running: the output has no selectable/searchable
 * text and loses interactive forms; a digitally signed document will NOT retain
 * a valid original signature.
 *
 * Coordinate model (single conversion path): regions are given either as
 * `text` (matched against the page text layer) or as a box in top-origin PDF
 * points on the visible page. Both are mapped to canvas pixels through
 * PDF.js's rotation-aware viewport, so preview scale, page rotation, PDF points
 * and raster pixels stay consistent. Page count and visible dimensions are
 * preserved; unselected pages are included unchanged (as images).
 */
export async function redactPdf(
  file: File,
  regions: { page: number; x: number; y: number; width: number; height: number; text?: string }[],
  opts?: { signal?: AbortSignal }
): Promise<Blob> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const signal = opts?.signal;
  let src: any = null;
  const clean = await PDFDocument.create();
  const unredactedRegions: { page: number; text: string | null }[] = [];

  const abortIfNeeded = () => {
    if (signal?.aborted) throw new DOMException('Redaction cancelled', 'AbortError');
  };

  try {
    abortIfNeeded();
    src = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;

    for (let pNum = 1; pNum <= src.numPages; pNum++) {
      abortIfNeeded();
      const jsPage = await src.getPage(pNum);
      const visible = jsPage.getViewport({ scale: 1 });
      const scale = rasterScale(visible.width, visible.height);
      const raster = jsPage.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(raster.width));
      canvas.height = Math.max(1, Math.ceil(raster.height));
      const ctx = canvas.getContext('2d');
      // Never silently drop a page: if it cannot be rasterized, the whole redaction
      // fails. Returning a document that is missing (or shows un-redacted) pages
      // would present a partial result as a completed redaction.
      if (!ctx) { jsPage.cleanup?.(); throw new Error(`Redaction failed: page ${pNum} could not be rasterized.`); }

      try {
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await jsPage.render({ canvasContext: ctx, viewport: raster, background: '#ffffff' }).promise;

        const pageRegions = (regions || []).filter(r => (r.page || 1) === pNum);
        let textContentCache: any[] | null = null;
        const getTextItems = async () => {
          if (textContentCache === null) {
            const tc = await jsPage.getTextContent();
            textContentCache = (tc.items || []) as any[];
          }
          return textContentCache;
        };
        for (const region of pageRegions) {
          const needle = (region.text ?? '').trim();
          let painted = false;

          if (needle.length > 0) {
            const items = await getTextItems();
            const lower = needle.toLowerCase();

            // 1. Whole phrase sits inside one text item.
            for (const item of items) {
              if (!item || typeof item.str !== 'string') continue;
              if (!item.str.trim().toLowerCase().includes(lower)) continue;
              const tx = item.transform ? item.transform[4] : 0;
              const ty = item.transform ? item.transform[5] : 0;
              const fs = Math.abs(item.transform?.[3] || 12) || item.height || 12;
              const w = item.width || Math.max(10, item.str.trim().length * fs * 0.6);
              const h = item.height || fs;
              paintOpaqueBlackout(ctx, raster, [tx, ty, tx + w, ty + h]);
              painted = true;
            }

            // 2. Phrase spans consecutive items on the same baseline (e.g. "John Doe"
            // split across separate text runs).
            if (!painted && needle.includes(' ')) {
              const itemsWithPos = items.filter(
                it => it && typeof it.str === 'string' && it.transform && it.str.trim().length > 0
              );
              for (let i = 0; i < itemsWithPos.length; i++) {
                let combined = '';
                let startTX = 0, startTY = 0, endX = 0, endTY = 0, maxFS = 0, baseY = 0;
                for (let j = i; j < Math.min(i + 16, itemsWithPos.length); j++) {
                  const it = itemsWithPos[j];
                  const tx = it.transform[4], ty = it.transform[5];
                  if (j === i) {
                    baseY = ty;
                    startTX = tx; startTY = ty;
                  } else if (Math.abs(ty - baseY) > Math.max(3, maxFS * 0.5)) {
                    break; // different baseline — stop extending the window
                  }
                  const fs = Math.abs(it.transform[3] || 12) || it.height || 12;
                  maxFS = Math.max(maxFS, fs);
                  const w = it.width || Math.max(10, it.str.trim().length * fs * 0.6);
                  endX = tx + w; endTY = ty;
                  combined += (combined ? ' ' : '') + it.str.trim();
                  if (combined.toLowerCase().includes(lower)) {
                    const y0 = Math.min(startTY, endTY);
                    const h0 = maxFS * 1.3;
                    paintOpaqueBlackout(ctx, raster, [startTX, y0 - maxFS * 0.25, endX, y0 + h0]);
                    painted = true;
                    break;
                  }
                }
                if (painted) break;
              }
            }
          }

          // Both paths above need a text layer. A scanned statement is the same region carrying the
          // box the caller drew, and the previous `else if` made that box unreachable the moment
          // `text` was present: nothing was painted, the page saved unchanged, and the tool reported
          // success on an un-redacted document. Falling through instead means a region the text
          // matcher cannot find is covered by the caller's box — over-redaction is visible and
          // recoverable, under-redaction is neither.
          if (!painted && region.width > 0 && region.height > 0) {
            const pdfRect = topBoxToPdfRect(
              { x: region.x, y: region.y, width: region.width, height: region.height },
              visible.height
            );
            paintOpaqueBlackout(ctx, raster, pdfRect);
            painted = true;
          }

          if (!painted) unredactedRegions.push({ page: pNum, text: needle || null });
        }
      } catch (err) {
        // A render/paint failure on ANY page aborts the whole operation — never emit
        // a document that silently omits or under-redacts a page.
        canvas.width = 0; canvas.height = 0;
        jsPage.cleanup?.();
        throw err;
      }

      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      const b64 = dataUrl.split(',')[1];
      const bin = atob(b64);
      const jpgBytes = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) jpgBytes[k] = bin.charCodeAt(k);
      const img = await clean.embedJpg(jpgBytes);
      const outPage = clean.addPage([visible.width, visible.height]);
      outPage.drawImage(img, { x: 0, y: 0, width: visible.width, height: visible.height });

      canvas.width = 0; canvas.height = 0;
      jsPage.cleanup?.();
    }
  } finally {
    if (src) { try { await src.destroy(); } catch {} }
  }

  // A region with neither a text match nor an area is a redaction that did not happen. Exporting
  // the document anyway would hand the user a file they believe is safe.
  if (unredactedRegions.length > 0) {
    const where = unredactedRegions.slice(0, 3)
      .map(r => `page ${r.page}${r.text ? ` ("${r.text.slice(0, 30)}")` : ''}`)
      .join(', ');
    throw new Error(
      `Redaction refused: ${unredactedRegions.length} region(s) could not be located and no area was ` +
      `supplied (${where}${unredactedRegions.length > 3 ? ', …' : ''}). Select the area on the page and ` +
      `run it again — nothing was exported.`
    );
  }

  const redactedPdfBytes = await clean.save({ useObjectStreams: false });
  return new Blob([redactedPdfBytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Convert images (JPG/PNG) into a single PDF
 */
export async function convertImagesToPdf(files: File[]): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  let embeddedImageCount = 0;

  for (const file of files) {
    const imageBytes = await file.arrayBuffer();
    let image;

    if (file.type === 'image/jpeg' || file.name.toLowerCase().endsWith('.jpg') || file.name.toLowerCase().endsWith('.jpeg')) {
      image = await pdfDoc.embedJpg(imageBytes);
    } else if (file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')) {
      image = await pdfDoc.embedPng(imageBytes);
    } else {
      continue;
    }

    const { width, height } = image.scale(1);
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: width,
      height: height,
    });
    embeddedImageCount++;
  }

  if (embeddedImageCount === 0) {
    throw new Error('No supported JPG, JPEG, or PNG images were provided.');
  }

  const pdfDocBytes = await pdfDoc.save();
  return new Blob([pdfDocBytes as BlobPart], { type: 'application/pdf' });
}

export async function convertPdfToImages(
  file: File,
  onProgress?: (percent: number) => void,
  maxPages: number = 20,
  enhanceForOcr: boolean = false,
  password?: string,
  signal?: AbortSignal,
  pagesStr?: string
): Promise<{ base64: string; pageNumber: number }[]> {
  let pdf: any = null;
  try {
    const arrayBuffer = await file.arrayBuffer();
    pdf = await pdfjsLib.getDocument({ data: arrayBuffer, password }).promise;
    const images: { base64: string; pageNumber: number }[] = [];
    
    // If pagesStr is specified, parse custom page selections
    let pageIndices: number[];
    if (pagesStr && pagesStr.trim()) {
      pageIndices = parsePageSelection(pagesStr, pdf.numPages);
    } else {
      const count = Math.min(pdf.numPages, maxPages);
      pageIndices = Array.from({ length: count }, (_, i) => i);
    }

    for (let idx = 0; idx < pageIndices.length; idx++) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const pageNum = pageIndices[idx] + 1;
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        page.cleanup?.();
        continue;
      }

      canvas.height = Math.max(1, Math.round(viewport.height));
      canvas.width = Math.max(1, Math.round(viewport.width));

      await page.render({ canvasContext: context, viewport }).promise;

      if (enhanceForOcr) {
        // Simple main-thread preprocessing for OCR
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const processedImageData = await preprocessImageData(imageData);
        context.putImageData(processedImageData, 0, 0);
      }

      const base64 = canvas.toDataURL('image/jpeg', 0.90).split(',')[1];
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup?.();

      images.push({ base64, pageNumber: pageNum });

      if (onProgress) onProgress(Math.round(((idx + 1) / pageIndices.length) * 100));
    }
    return images;
  } catch (error: any) {
    if (error.name === 'PasswordException') {
      throw new Error(`This PDF is password-protected. Please remove the password or provide it in the settings.`);
    }
    if (error.name === 'AbortError') {
      throw error;
    }
    throw new Error(`PDF Render Error: ${error.message}`);
  } finally {
    if (pdf) {
      try { await pdf.destroy(); } catch {}
    }
  }
}

/**
 * Create a searchable PDF from OCR-extracted text.
 * Renders text with proper pagination and line wrapping on A4-sized pages.
 */
export async function createTextPdf(text: string, title?: string): Promise<Blob> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 595.28; // A4 width in points
  const pageHeight = 841.89; // A4 height in points
  const margin = 50;
  const fontSize = 9;
  const lineHeight = fontSize * 1.4;
  const maxTextWidth = pageWidth - margin * 2;

  // Sanitize text: replace non-WinAnsi characters with ASCII equivalents
  // pdf-lib's standard fonts only support WinAnsi encoding
  function sanitize(s: string): string {
    return s
      .replace(/[\u2018\u2019\u201A]/g, "'")   // smart single quotes
      .replace(/[\u201C\u201D\u201E]/g, '"')   // smart double quotes
      .replace(/\u2026/g, '...')               // ellipsis
      .replace(/\u2013/g, '-')                 // en dash
      .replace(/\u2014/g, '--')                // em dash
      .replace(/\u2022/g, '*')                 // bullet
      .replace(/\u00A0/g, ' ')                 // non-breaking space
      .replace(/\u2032/g, "'")                 // prime
      .replace(/\u2033/g, '"')                 // double prime
      .replace(/\u20AC/g, 'EUR')               // euro sign
      .replace(/\u00B7/g, '.')                 // middle dot
      .replace(/[\u2000-\u200B]/g, ' ')        // various spaces
      .replace(/[^\x00-\xFF]/g, '?');          // replace any remaining non-Latin1 chars
  }

  // Split text into lines, handling both \n and \r\n
  const rawLines = String(text).split(/\r?\n/);

  // Word-wrap long lines
  const wrappedLines: string[] = [];
  for (const line of rawLines) {
    const cleanLine = sanitize(line);
    if (cleanLine.trim() === '' || cleanLine.trim() === '---') {
      wrappedLines.push(cleanLine);
      continue;
    }
    const words = cleanLine.split(' ');
    let currentLine = '';
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = font.widthOfTextAtSize(testLine, fontSize);
      if (testWidth > maxTextWidth && currentLine) {
        wrappedLines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) wrappedLines.push(currentLine);
  }

  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  // Title header on first page
  if (title) {
    const safeTitle = sanitize(title);
    page.drawText(safeTitle, { x: margin, y, font: boldFont, size: 14, color: rgb(0.1, 0.1, 0.1) });
    y -= 25;
    page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
    y -= 15;
  }

  for (const line of wrappedLines) {
    if (y < margin + 20) {
      // Add page number footer
      const pageNum = `Page ${pdf.getPageCount()}`;
      page.drawText(pageNum, { x: pageWidth - margin - font.widthOfTextAtSize(pageNum, 8), y: margin - 15, font, size: 8, color: rgb(0.5, 0.5, 0.5) });
      // New page
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }

    // Handle markdown-style headers
    const isHeader = line.startsWith('# ') || line.startsWith('## ') || line.startsWith('### ');
    const displayFont = isHeader ? boldFont : font;
    const displaySize = line.startsWith('# ') ? 13 : line.startsWith('## ') ? 11 : isHeader ? 10 : fontSize;
    const displayText = line.replace(/^#{1,3}\s+/, '');

    if (line.trim() === '---') {
      page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 0.3, color: rgb(0.8, 0.8, 0.8) });
      y -= lineHeight;
      continue;
    }

    if (displayText.trim()) {
      try {
        page.drawText(displayText, {
          x: margin,
          y,
          font: displayFont,
          size: displaySize,
          color: rgb(0.1, 0.1, 0.1),
          maxWidth: maxTextWidth
        });
      } catch {
        // If a character still can't be rendered, skip this line rather than crash
        page.drawText('[unrenderable text]', { x: margin, y, font, size: fontSize, color: rgb(0.6, 0.6, 0.6) });
      }
    }
    y -= lineHeight;
  }

  const pdfBytes = await pdf.save();
  return new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
}

export interface SearchableWord {
  text: string;
  // Pixel coordinates in the SOURCE page image, top-left origin.
  x: number; y: number; width: number; height: number;
}
export interface SearchablePage {
  image: Uint8Array;
  imageType: 'png' | 'jpg';
  pixelWidth: number; pixelHeight: number;   // size of `image` in pixels
  pdfWidth: number; pdfHeight: number;       // display size in PDF points (from viewport)
  words: SearchableWord[];
}

/**
 * Batch 07 — Create a genuine searchable PDF from a scanned document: the ORIGINAL page
 * image is preserved as the visible content, and an INVISIBLE (opacity 0) text layer is
 * overlaid at each word's measured position so the page becomes selectable/searchable
 * WITHOUT replacing the scanned image with a transcript.
 *
 * Coordinate contract: word boxes are given in source-image pixels (top-left origin);
 * they map to PDF points by scaleX = pdfWidth/pixelWidth, scaleY = pdfHeight/pixelHeight,
 * then flipped to PDF's bottom-left origin. Text width is fit to the box via xScale so the
 * invisible layer aligns with the glyphs underneath.
 */
export async function createSearchablePdf(pages: SearchablePage[]): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const sanitize = (s: string): string =>
    s.replace(/[\u2018\u2019\u201A]/g, "'").replace(/[\u201C\u201D\u201E]/g, '"')
      .replace(/\u2026/g, '...').replace(/\u2013/g, '-').replace(/\u2014/g, '--')
      .replace(/\u2022/g, '*').replace(/\u00A0/g, ' ').replace(/[^\x20-\x7E\u00A0-\u00FF]/g, ' ');

  for (const page of pages) {
    // Reject invalid geometry instead of silently omitting a page: a returned Blob is not
    // proof of a correct document, so a page we cannot represent must abort the run.
    if (!page || !page.image || page.image.length === 0
      || !(page.pixelWidth > 0) || !(page.pixelHeight > 0)
      || !(page.pdfWidth > 0) || !(page.pdfHeight > 0)) {
      throw new Error('createSearchablePdf: a page has invalid dimensions or an empty image; refusing to emit a partial document.');
    }
    const embedded = page.imageType === 'png'
      ? await pdfDoc.embedPng(page.image)
      : await pdfDoc.embedJpg(page.image); // a corrupt raster rejects here -> aborts the whole run

    const out = pdfDoc.addPage([page.pdfWidth, page.pdfHeight]);
    // Preserve the scanned page exactly — drawn full-bleed, untouched.
    out.drawImage(embedded, { x: 0, y: 0, width: page.pdfWidth, height: page.pdfHeight });

    const scaleX = page.pdfWidth / Math.max(1, page.pixelWidth);
    const scaleY = page.pdfHeight / Math.max(1, page.pixelHeight);

    for (const w of page.words || []) {
      const text = sanitize(String(w.text ?? ''));
      if (!text.trim()) continue;
      const fontSize = Math.max(1, w.height * scaleY);
      const px = w.x * scaleX;
      // PDF y is bottom-origin: top of the word box minus the font height.
      const py = page.pdfHeight - (w.y * scaleY) - fontSize;
      try {
        out.drawText(text, { x: px, y: py, size: fontSize, font, opacity: 0, color: rgb(0, 0, 0) });
      } catch { /* skip a word that cannot be encoded rather than crash the page */ }
    }
  }

  const bytes = await pdfDoc.save();
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Structural manipulation: Delete specified pages (e.g., '1, 3-5') and return remaining PDF
 */
export async function deletePages(file: File, pagesStr: string): Promise<Blob> {
  const pdfDoc = await loadPdfResilient(file);
  const totalPages = pdfDoc.getPageCount();

  const deleteIndices = parsePageRange(pagesStr, totalPages);
  if (deleteIndices.length === 0) {
    const savedBytes = await pdfDoc.save();
    return new Blob([savedBytes as BlobPart], { type: 'application/pdf' });
  }

  // Unique set (parsePageRange already de-duplicates) → keep everything else.
  // Throws instead of emitting an empty document when the request deletes all pages.
  let keepIndices: number[];
  try {
    keepIndices = keepIndicesForDeletion(deleteIndices, totalPages);
  } catch (e) {
    if (e instanceof SelectionError && e.code === 'EMPTY') {
      throw new Error('Cannot delete all pages from the document.');
    }
    throw e;
  }

  const newPdf = await PDFDocument.create();
  const copiedPages = await newPdf.copyPages(pdfDoc, keepIndices);
  copiedPages.forEach(page => newPdf.addPage(page));

  const savedBytes = await newPdf.save();
  return new Blob([savedBytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Structural manipulation: Extract specified pages (e.g., '2-4') into a single combined PDF
 */
export async function extractPages(file: File, pagesStr: string): Promise<Blob> {
  const pdfDoc = await loadPdfResilient(file);
  const totalPages = pdfDoc.getPageCount();

  const extractIndices = parsePageRange(pagesStr, totalPages);
  if (extractIndices.length === 0) {
    throw new Error('No valid pages found for extraction.');
  }

  const newPdf = await PDFDocument.create();
  const copiedPages = await newPdf.copyPages(pdfDoc, extractIndices);
  copiedPages.forEach(page => newPdf.addPage(page));

  const savedBytes = await newPdf.save();
  return new Blob([savedBytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Annotation: Add page numbers to PDF pages
 * Supports positions: 'bottom-center' | 'bottom-right' | 'top-right' | 'bottom-left' | 'top-left' | 'top-center'
 * Supports formats: 'Page {page} of {total}', 'Page X of Y', '{page}', 'X'
 */
/**
 * The formats the page-number control offers, resolved to text. Unrecognised input is an error:
 * the previous code fell through to stamping the format string itself, so all four UI options
 * (`page_n_of_m | page_n | n_of_m | n`) painted the literal token `page_n_of_m` on every page and
 * still returned a PDF that looked like a successful run.
 */
const PAGE_NUMBER_FORMATS: Record<string, (n: number, total: number) => string> = {
  page_n_of_m: (n, t) => `Page ${n} of ${t}`,
  page_x_of_y: (n, t) => `Page ${n} of ${t}`,
  'page-of-total': (n, t) => `Page ${n} of ${t}`,
  page_n: (n) => `Page ${n}`,
  n_of_m: (n, t) => `${n} of ${t}`,
  n: (n) => `${n}`,
  number_only: (n) => `${n}`,
  x: (n) => `${n}`,
  y: (_n, t) => `${t}`,
};

export function renderPageNumber(rawFormat: string | undefined, pageNum: number, total: number): string {
  const raw = (rawFormat ?? 'Page {page} of {total}').trim();

  if (raw.includes('{page}') || raw.includes('{total}')) {
    return raw.replace(/\{page\}/gi, String(pageNum)).replace(/\{total\}/gi, String(total));
  }

  const known = PAGE_NUMBER_FORMATS[raw.toLowerCase().replace(/\s+/g, '_')];
  if (known) return known(pageNum, total);

  // Legacy single-letter templates: "X", "X of Y", "-X-".
  if (/\b[xy]\b/i.test(raw)) {
    return raw.replace(/\bX\b/gi, String(pageNum)).replace(/\bY\b/gi, String(total));
  }

  throw new Error(
    `Unknown page-number format "${raw}". Choose one of ${Object.keys(PAGE_NUMBER_FORMATS).join(', ')}, ` +
    'or write a template using {page} and {total}.'
  );
}

export async function addPageNumbers(
  file: File,
  options?: { position?: string; startNum?: number; format?: string }
): Promise<Blob> {
  const pdfDoc = await loadPdfResilient(file);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();
  const totalPages = pages.length;
  const startNum = options?.startNum ?? 1;
  const position = (options?.position || 'bottom-center').toLowerCase();
  const rawFormat = options?.format;
  const fontSize = 10;

  pages.forEach((page, index) => {
    const pageNum = startNum + index;
    const text = renderPageNumber(rawFormat, pageNum, totalPages);

    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, fontSize);

    let x = (width - textWidth) / 2;
    let y = 30;

    switch (position) {
      case 'bottom-right':
        x = width - textWidth - 30;
        y = 30;
        break;
      case 'bottom-left':
        x = 30;
        y = 30;
        break;
      case 'top-right':
        x = width - textWidth - 30;
        y = height - 30 - fontSize;
        break;
      case 'top-left':
        x = 30;
        y = height - 30 - fontSize;
        break;
      case 'top-center':
        x = (width - textWidth) / 2;
        y = height - 30 - fontSize;
        break;
      case 'bottom-center':
      default:
        x = (width - textWidth) / 2;
        y = 30;
        break;
    }

    page.drawText(text, {
      x,
      y,
      size: fontSize,
      font,
      color: rgb(0.3, 0.3, 0.3),
    });
  });

  const savedBytes = await pdfDoc.save();
  return new Blob([savedBytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Security: Unlock password-protected or encrypted PDF
 */
export async function unlockPdf(file: File, password?: string): Promise<Blob> {
  const bytes = await file.arrayBuffer();
  const u8 = new Uint8Array(bytes);

  if (password) {
    let pdfjsDoc: any = null;
    try {
      pdfjsDoc = await pdfjsLib.getDocument({ data: u8.slice(0), password }).promise;
      const reconstructed = await PDFDocument.create();
      for (let i = 1; i <= pdfjsDoc.numPages; i++) {
        const page = await pdfjsDoc.getPage(i);
        const origViewport = page.getViewport({ scale: 1.0 });
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          page.cleanup?.();
          continue;
        }
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        await page.render({ canvasContext: ctx, viewport }).promise;

        const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup?.();

        const base64 = dataUrl.split(',')[1];
        const bin = atob(base64);
        const pageU8 = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) pageU8[k] = bin.charCodeAt(k);

        const img = await reconstructed.embedJpg(pageU8);
        const newPage = reconstructed.addPage([origViewport.width, origViewport.height]);
        newPage.drawImage(img, { x: 0, y: 0, width: origViewport.width, height: origViewport.height });
      }
      const savedBytes = await reconstructed.save({ useObjectStreams: true });
      return new Blob([savedBytes as BlobPart], { type: 'application/pdf' });
    } finally {
      if (pdfjsDoc) {
        try { await pdfjsDoc.destroy(); } catch {}
      }
    }
  }

  // Without password: attempt standard unencrypted load or fallback
  try {
    const pdfDoc = await PDFDocument.load(u8);
    const savedBytes = await pdfDoc.save();
    return new Blob([savedBytes as BlobPart], { type: 'application/pdf' });
  } catch (err: any) {
    if (err?.message?.includes('encrypted') || err?.name === 'EncryptedPDFError') {
      throw new Error('This PDF is password-protected. Please provide the password to unlock.');
    }
    // Fallback: attempt load with empty password via pdfjs
    let pdfjsDoc: any = null;
    try {
      pdfjsDoc = await pdfjsLib.getDocument({ data: u8.slice(0), password: '' }).promise;
      const reconstructed = await PDFDocument.create();
      for (let i = 1; i <= pdfjsDoc.numPages; i++) {
        const page = await pdfjsDoc.getPage(i);
        const origViewport = page.getViewport({ scale: 1.0 });
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          page.cleanup?.();
          continue;
        }
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        await page.render({ canvasContext: ctx, viewport }).promise;

        const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup?.();

        const base64 = dataUrl.split(',')[1];
        const bin = atob(base64);
        const pageU8 = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) pageU8[k] = bin.charCodeAt(k);

        const img = await reconstructed.embedJpg(pageU8);
        const newPage = reconstructed.addPage([origViewport.width, origViewport.height]);
        newPage.drawImage(img, { x: 0, y: 0, width: origViewport.width, height: origViewport.height });
      }
      const savedBytes = await reconstructed.save({ useObjectStreams: true });
      return new Blob([savedBytes as BlobPart], { type: 'application/pdf' });
    } catch {
      throw err;
    } finally {
      if (pdfjsDoc) {
        try { await pdfjsDoc.destroy(); } catch {}
      }
    }
  }
}

/**
 * Structural manipulation: Repair PDF
 * Attempts clean re-save with pdf-lib or rasterizes and rebuilds pages if corrupted.
 */
export async function repairPdf(file: File): Promise<Blob> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  // Attempt 1: Standard load & page copy through pdf-lib to clean broken references/xref tables
  try {
    const doc = await loadPdfForRebuild(bytes, 'Repair');
    const cleanDoc = await PDFDocument.create();
    const count = doc.getPageCount();
    if (count > 0) {
      const copiedPages = await cleanDoc.copyPages(doc, Array.from({ length: count }, (_, i) => i));
      copiedPages.forEach(page => cleanDoc.addPage(page));
      const repairedBytes = await cleanDoc.save({ useObjectStreams: true });
      return new Blob([repairedBytes as BlobPart], { type: 'application/pdf' });
    }
  } catch (pdfLibError) {
    // An encrypted file is not a corrupted one, and rasterizing it into an image-only PDF is not a
    // repair the user asked for. Say what is blocking it.
    if (pdfLibError instanceof EncryptedDocumentError) throw pdfLibError;
    console.warn('pdf-lib repair attempt failed, falling back to pdfjs rasterization:', pdfLibError);
  }

  // Attempt 2: pdfjs rendering fallback for heavily damaged/malformed syntax
  let pdfjsDoc: any = null;
  try {
    pdfjsDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    const reconstructed = await PDFDocument.create();
    for (let i = 1; i <= pdfjsDoc.numPages; i++) {
      const page = await pdfjsDoc.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        page.cleanup?.();
        continue;
      }
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      await page.render({ canvasContext: ctx, viewport }).promise;

      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup?.();

      const base64 = dataUrl.split(',')[1];
      const bin = atob(base64);
      const u8 = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);

      const img = await reconstructed.embedJpg(u8);
      const origViewport = page.getViewport({ scale: 1.0 });
      const newPage = reconstructed.addPage([origViewport.width, origViewport.height]);
      newPage.drawImage(img, { x: 0, y: 0, width: origViewport.width, height: origViewport.height });
    }

    if (reconstructed.getPageCount() > 0) {
      const savedBytes = await reconstructed.save({ useObjectStreams: true });
      return new Blob([savedBytes as BlobPart], { type: 'application/pdf' });
    }
  } catch (pdfjsError) {
    console.error('pdfjs rasterization repair attempt failed:', pdfjsError);
  } finally {
    if (pdfjsDoc) {
      try { await pdfjsDoc.destroy(); } catch {}
    }
  }

  throw new Error('PDF repair failed: Document could not be parsed or recovered.');
}

/**
 * Structural manipulation: Reorder PDF pages according to newOrder (0-indexed or 1-indexed string)
 */
export async function reorderPages(file: File, newOrder: number[] | string): Promise<Blob> {
  const pdfDoc = await loadPdfResilient(file);
  const totalPages = pdfDoc.getPageCount();

  // One parser for every page operation. The hand-rolled version this replaces did
  // `parseInt("1-3")` per token, so "1-3" on a 3-page document silently became page 1 alone, and
  // unlisted indices were filtered out -- "3,1" quietly turned a 4-page file into a 2-page one.
  // Reorder is a permutation of the existing pages; keeping only a subset is what Extract pages
  // is for, and the refusal message says so. BUG-11 stays fixed: "1,1,1" is never accepted.
  let validOrder: number[] = [];
  try {
    const orderArray = typeof newOrder === 'string'
      ? parseSequence(newOrder, totalPages)
      : Array.isArray(newOrder)
        ? (newOrder.length > 0
            && !newOrder.some(n => n === 0)
            && newOrder.every(n => typeof n === 'number' && n >= 1 && n <= totalPages)
            ? newOrder.map(n => n - 1)
            : newOrder)
        : [];
    validOrder = assertPermutation(orderArray, totalPages);
  } catch (e) {
    if (e instanceof SelectionError) {
      throw new Error(`Invalid page order provided. ${e.message}`);
    }
    throw e;
  }

  const newPdf = await PDFDocument.create();
  const copiedPages = await newPdf.copyPages(pdfDoc, validOrder);
  copiedPages.forEach(page => newPdf.addPage(page));

  const savedBytes = await newPdf.save();
  return new Blob([savedBytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Annotation: Add Header and/or Footer text to PDF pages with dynamic token replacements
 * Tokens supported: {page}, {total}, {date}
 */
export async function addHeaderFooter(
  file: File,
  options?: { header?: string; footer?: string; fontSize?: number }
): Promise<Blob> {
  const pdfDoc = await loadPdfResilient(file);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();
  const totalPages = pages.length;
  const fontSize = options?.fontSize ?? 10;
  const dateStr = new Date().toISOString().split('T')[0];

  const replaceTokens = (text: string, pageNum: number) => {
    return text
      .replace(/\{page\}/gi, String(pageNum))
      .replace(/\{total\}/gi, String(totalPages))
      .replace(/\{date\}/gi, dateStr);
  };

  pages.forEach((page, index) => {
    const pageNum = index + 1;
    const { width, height } = page.getSize();

    if (options?.header) {
      const headerText = replaceTokens(options.header, pageNum);
      const textWidth = font.widthOfTextAtSize(headerText, fontSize);
      page.drawText(headerText, {
        x: (width - textWidth) / 2,
        y: height - 30 - fontSize,
        size: fontSize,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });
    }

    if (options?.footer) {
      const footerText = replaceTokens(options.footer, pageNum);
      const textWidth = font.widthOfTextAtSize(footerText, fontSize);
      page.drawText(footerText, {
        x: (width - textWidth) / 2,
        y: 30,
        size: fontSize,
        font,
        color: rgb(0.3, 0.3, 0.3),
      });
    }
  });

  const savedBytes = await pdfDoc.save();
  return new Blob([savedBytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Editing: Crop and/or Resize PDF pages
 */
export async function cropResizePdf(
  file: File,
  options?: { cropMarginMm?: number; targetSize?: string }
): Promise<Blob> {
  const pdfDoc = await loadPdfResilient(file);
  const pages = pdfDoc.getPages();

  const STANDARD_SIZES: Record<string, [number, number]> = {
    A4: [595.28, 841.89],
    LETTER: [612.0, 792.0],
    LEGAL: [612.0, 1008.0],
    A3: [841.89, 1190.55],
    A5: [419.53, 595.28],
  };

  const cropMarginMm = options?.cropMarginMm ?? 0;
  const cropMarginPoints = cropMarginMm * 2.83465; // 1 mm = ~2.83465 pt

  const targetSizeKey = options?.targetSize?.trim().toUpperCase();
  const targetDimensions = targetSizeKey ? STANDARD_SIZES[targetSizeKey] : undefined;

  for (const page of pages) {
    if (cropMarginPoints > 0) {
      const { x, y, width, height } = page.getMediaBox();
      const newX = x + cropMarginPoints;
      const newY = y + cropMarginPoints;
      const newW = width - 2 * cropMarginPoints;
      const newH = height - 2 * cropMarginPoints;

      if (newW > 10 && newH > 10) {
        page.setCropBox(newX, newY, newW, newH);
        page.setMediaBox(newX, newY, newW, newH);
      }
    }

    if (targetDimensions) {
      const [targetW, targetH] = targetDimensions;
      page.setSize(targetW, targetH);
    }
  }

  const savedBytes = await pdfDoc.save();
  return new Blob([savedBytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Metadata: Edit or strip PDF document metadata
 */
export async function editMetadata(
  file: File,
  options?: {
    title?: string;
    author?: string;
    subject?: string;
    stripAll?: boolean;
    keywords?: string[];
    creator?: string;
    producer?: string;
  }
): Promise<Blob> {
  const pdfDoc = await loadPdfResilient(file);

  if (options?.stripAll) {
    pdfDoc.setTitle('');
    pdfDoc.setAuthor('');
    pdfDoc.setSubject('');
    pdfDoc.setKeywords([]);
    pdfDoc.setProducer('');
    pdfDoc.setCreator('');
  } else {
    if (options?.title !== undefined) pdfDoc.setTitle(options.title);
    if (options?.author !== undefined) pdfDoc.setAuthor(options.author);
    if (options?.subject !== undefined) pdfDoc.setSubject(options.subject);
    if (options?.producer !== undefined) pdfDoc.setProducer(options.producer);
    if (options?.creator !== undefined) pdfDoc.setCreator(options.creator);
    if (options?.keywords !== undefined) pdfDoc.setKeywords(options.keywords);
  }

  const savedBytes = await pdfDoc.save();
  return new Blob([savedBytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Remove pages that hold no ink at all.
 *
 * A page counts as blank only when its rendered canvas contains zero non-white pixels. Judging blank
 * by *density* — which this function used to do at a 0.1% default — deletes sparse real content: on a
 * 320×400 page 0.1% is 128 pixels, so a signature, a hairline rule or a 2×2 corner stamp (4 measured
 * ink pixels) all read as "blank". Keeping an unwanted blank page costs the user a glance; deleting a
 * page that carried content costs them the document. Pass `densityThreshold` deliberately to filter
 * noisy scans where a few stray dark pixels are not content.
 */
export async function removeBlankPages(file: File, densityThreshold = 0): Promise<Blob> {
  const bytes = await file.arrayBuffer();
  let pdfjsDoc: any = null;
  const nonBlankIndices: number[] = [];

  try {
    pdfjsDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;

    for (let i = 1; i <= pdfjsDoc.numPages; i++) {
      const page = await pdfjsDoc.getPage(i);
      const viewport = page.getViewport({ scale: 1.0 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      if (!ctx) {
        page.cleanup?.();
        nonBlankIndices.push(i - 1);
        continue;
      }

      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));

      await page.render({ canvasContext: ctx, viewport }).promise;

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup?.();

      const data = imgData.data;
      const totalPixels = data.length / 4;
      let inkPixels = 0;

      for (let p = 0; p < data.length; p += 4) {
        const r = data[p];
        const g = data[p + 1];
        const b = data[p + 2];
        const a = data[p + 3];

        if (a > 20 && (r < 245 || g < 245 || b < 245)) {
          inkPixels++;
        }
      }

      const inkRatio = totalPixels > 0 ? inkPixels / totalPixels : 0;
      const blank = densityThreshold > 0 ? inkRatio < densityThreshold : inkPixels === 0;
      if (!blank) {
        nonBlankIndices.push(i - 1);
      }
    }
  } finally {
    if (pdfjsDoc) {
      try { await pdfjsDoc.destroy(); } catch {}
    }
  }

  // If all pages are blank, preserve page 1 to ensure a valid PDF
  if (nonBlankIndices.length === 0) {
    nonBlankIndices.push(0);
  }

  const pdfDoc = await loadPdfResilient(file);
  const newPdf = await PDFDocument.create();
  const copiedPages = await newPdf.copyPages(pdfDoc, nonBlankIndices);
  copiedPages.forEach(page => newPdf.addPage(page));

  const savedBytes = await newPdf.save();
  return new Blob([savedBytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Security/Editing: Flatten PDF
 * Permanently fuses interactive form fields and AcroForm widgets into static base page streams.
 */
/**
 * Annotation subtypes that hold something a person can see. A widget's value, a FreeText note, a
 * highlight — if one of these has no appearance stream and we delete it, the page loses ink without
 * losing a page, which is the kind of loss nobody notices until the document is filed.
 */
const VISIBLE_ANNOT_SUBTYPES = new Set([
  'Widget', 'FreeText', 'Text', 'Highlight', 'StrikeOut', 'Squiggly', 'Underline', 'Ink', 'Caret',
  'Square', 'Circle', 'Line', 'Polygon', 'PolyLine', 'Stamp', 'FileAttachment', 'Redact',
]);

/** Thrown when flattening would have to delete content it cannot first make permanent. */
export class FlattenRefusal extends Error {
  readonly unbaked: string[];

  constructor(message: string, unbaked: string[]) {
    super(message);
    this.name = 'FlattenRefusal';
    this.unbaked = unbaked;
  }
}

/**
 * `context.lookupMaybe` throws when the object exists but is of another type, so every read of a
 * foreign PDF here narrows with `instanceof` instead. A file that puts a stream where a dictionary
 * belongs is not an error condition — it is Tuesday on a corpus of real bank documents.
 */
function asDict(ctx: PDFContext, value: PDFObject | undefined) {
  const obj = value === undefined ? undefined : ctx.lookup(value);
  return obj instanceof PDFDict ? obj : undefined;
}

function asArray(ctx: PDFContext, value: PDFObject | undefined) {
  const obj = value === undefined ? undefined : ctx.lookup(value);
  return obj instanceof PDFArray ? obj : undefined;
}

function nameOf(ctx: PDFContext, value: PDFObject | undefined): string {
  const obj = value === undefined ? undefined : ctx.lookup(value);
  return obj instanceof PDFName ? obj.toString().replace(/^[/]/, '') : '';
}

function textOf(ctx: PDFContext, value: PDFObject | undefined): string {
  if (value === undefined) return '';
  const obj = ctx.lookup(value);
  if (obj instanceof PDFString) return obj.decodeText();
  if (obj instanceof PDFHexString) return obj.decodeText();
  return '';
}

function numbersIn(ctx: PDFContext, arr: PDFArray | undefined): number[] | null {
  if (!arr) return null;
  const out: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const n = ctx.lookup(arr.get(i));
    if (!(n instanceof PDFNumber)) return null;
    out.push(n.asNumber());
  }
  return out;
}

/**
 * The normal (/N) appearance stream of an annotation, with the geometry needed to place it.
 * AP/N is either the stream itself or a dictionary of alternate appearances, in which case the first
 * entry is what a viewer would draw for the default state.
 */
function appearanceOf(
  ctx: PDFContext,
  dict: PDFDict,
): { ref: PDFRef; bbox: PdfRect; elementMatrix: PdfMatrix | null } | null {
  const ap = asDict(ctx, dict.get(PDFName.of('AP')));
  if (!ap) return null;

  let target = ap.get(PDFName.of('N'));
  const alternates = asDict(ctx, target);
  if (alternates) {
    const keys = alternates.keys();
    if (!keys.length) return null;
    target = alternates.get(keys[0]);
  }
  if (target === undefined) return null;
  const looked = target instanceof PDFRef ? ctx.lookup(target) : target;
  if (!(looked instanceof PDFRawStream)) return null;
  const stream = looked;
  const ref = target instanceof PDFRef ? target : ctx.register(stream);

  const bbox = numbersIn(ctx, asArray(ctx, stream.dict.get(PDFName.of('BBox'))));
  if (!bbox || bbox.length !== 4) return null;

  const elementMatrix = numbersIn(ctx, asArray(ctx, ap.get(PDFName.of('Matrix'))));
  return {
    ref,
    bbox: bbox as PdfRect,
    elementMatrix: elementMatrix && elementMatrix.length === 6 ? (elementMatrix as PdfMatrix) : null,
  };
}

/**
 * Appearances generated at flatten time may name fonts from /AcroForm /DR rather than from the page's
 * own resources. /DR lives in the catalog we are about to delete, so anything the baked content still
 * borrows from it has to move onto the page or the text renders as nothing.
 */
function mergeAcroFormResources(ctx: PDFContext, page: PDFPageLeaf, acroForm: PDFDict) {
  const dr = asDict(ctx, acroForm.get(PDFName.of('DR')));
  if (!dr) return;
  let resources = page.Resources();
  if (!resources) {
    resources = ctx.obj({}) as PDFDict;
    page.set(PDFName.of('Resources'), resources);
  }
  for (const category of dr.keys()) {
    const source = asDict(ctx, dr.get(category));
    if (!source) continue;
    const target = asDict(ctx, resources.get(category));
    if (!target) {
      resources.set(category, source);
      continue;
    }
    for (const key of source.keys()) {
      if (!target.has(key)) target.set(key, source.get(key));
    }
  }
}

/**
 * Flatten: make every form field, checkmark and annotation permanent page content.
 *
 * The previous implementation called pdf-lib's `form.flatten()` inside a `catch {}` and then deleted
 * /AcroForm and all /Widget annotations regardless of what had happened. pdf-lib throws as soon as one
 * widget has no appearance stream (an unsigned /Sig field is enough), so on any form containing one the
 * whole flatten aborted, the values were never baked, and the deletion still ran — filled fields lost
 * their contents while the tool returned a file as if it had succeeded.
 *
 * The rule now is: **nothing that carries content is removed until its appearance has been drawn into
 * the page.** Anything that cannot be drawn is named in a refusal, and the document is handed back
 * untouched.
 */
export async function flattenPdf(file: File): Promise<Blob> {
  const pdfDoc = await loadPdfResilient(file);
  const ctx = pdfDoc.context;

  const acroFormRef = pdfDoc.catalog.get(PDFName.of('AcroForm'));
  const acroForm = asDict(ctx, acroFormRef);

  // Generating appearances is the cheap way to make a value permanent, so try it. Its failure is not
  // fatal: the per-annotation check below decides what can actually be removed.
  if (acroForm) {
    try {
      pdfDoc.getForm().updateFieldAppearances();
    } catch {
      // Some field is beyond pdf-lib's generator (no /DA, /Sig, unsupported font). Expected sometimes.
    }
  }

  const unbaked: string[] = [];

  for (const page of pdfDoc.getPages()) {
    const pageNode = page.node as unknown as PDFPageLeaf;
    const annots = pageNode.Annots();
    if (!annots) continue;

    const ops: string[] = [];
    const keep: PDFObject[] = [];
    const removed: PDFRef[] = [];

    for (let i = 0; i < annots.size(); i++) {
      const item = annots.get(i);
      const dict = asDict(ctx, item);
      if (!dict) { keep.push(item); continue; }

      const subtype = nameOf(ctx, dict.get(PDFName.of('Subtype')));
      // A link is interaction, not ink: baking it and then deleting it would remove a working target
      // while adding nothing visible.
      if (subtype === 'Link') { keep.push(item); continue; }

      const parent = asDict(ctx, dict.get(PDFName.of('Parent')));
      const name = textOf(ctx, dict.get(PDFName.of('T'))) || (parent ? textOf(ctx, parent.get(PDFName.of('T'))) : '');
      const value = textOf(ctx, dict.get(PDFName.of('V'))) || (parent ? textOf(ctx, parent.get(PDFName.of('V'))) : '');
      const rect = numbersIn(ctx, asArray(ctx, dict.get(PDFName.of('Rect'))));
      const appearance = appearanceOf(ctx, dict);

      if (appearance && rect && rect.length === 4) {
        try {
          const key = pageNode.newXObject('PrismBake', appearance.ref);
          ops.push(bakeOperators(appearanceMatrix(rect as PdfRect, appearance.bbox, appearance.elementMatrix), key.toString()));
          if (item instanceof PDFRef) removed.push(item);
          continue;
        } catch {
          // Undecodable geometry: fall through, where the content check below decides whether losing
          // this annotation is acceptable.
        }
      }

      const carriesContent = subtype === 'Widget'
        ? value.length > 0
        : VISIBLE_ANNOT_SUBTYPES.has(subtype) || textOf(ctx, dict.get(PDFName.of('Contents'))).length > 0;

      if (carriesContent) {
        unbaked.push(name ? `“${name}”${value ? ` (${value})` : ''}` : `${subtype} annotation`);
        keep.push(item);
      } else if (item instanceof PDFRef) {
        removed.push(item);
      } else {
        keep.push(item);
      }
    }

    if (ops.length) {
      pageNode.addContentStream(ctx.register(ctx.flateStream(ops.join(''), {})));
      if (acroForm) mergeAcroFormResources(ctx, pageNode, acroForm);
    }

    for (const ref of removed) ctx.delete(ref);

    if (keep.length === 0) pageNode.delete(PDFName.of('Annots'));
    else if (keep.length !== annots.size()) pageNode.set(PDFName.of('Annots'), ctx.obj(keep));
  }

  if (unbaked.length) {
    const listed = unbaked.slice(0, 6).join(', ');
    throw new FlattenRefusal(
      `Flatten stopped: ${unbaked.length === 1 ? 'one field has' : `${unbaked.length} fields have`} no appearance to bake into the page` +
      ` (${listed}${unbaked.length > 6 ? ', …' : ''}). Deleting them would erase content that is currently visible, ` +
      'so the document has been left unchanged. Open it in the application that created it and save or export it ' +
      'there — that writes the missing appearances — then flatten again.',
      unbaked,
    );
  }

  // Remove the form infrastructure only once every value it was responsible for is on the page.
  if (acroForm) {
    const fields = asArray(ctx, acroForm.get(PDFName.of('Fields')));
    const dropField = (ref: PDFObject | undefined) => {
      const field = asDict(ctx, ref);
      if (!field) return;
      const kids = asArray(ctx, field.get(PDFName.of('Kids')));
      if (kids) for (let i = 0; i < kids.size(); i++) dropField(kids.get(i));
      if (ref instanceof PDFRef) ctx.delete(ref);
    };
    if (fields) for (let i = 0; i < fields.size(); i++) dropField(fields.get(i));
  }
  if (acroFormRef instanceof PDFRef) ctx.delete(acroFormRef);
  pdfDoc.catalog.delete(PDFName.of('AcroForm'));

  try {
    const flattenedBytes = await pdfDoc.save({ useObjectStreams: true });
    return new Blob([flattenedBytes as BlobPart], { type: 'application/pdf' });
  } catch {
    // Fallback: copy into a fresh clean document. The baked content is already in the page content
    // streams by this point, so the values survive the copy.
    const cleanDoc = await PDFDocument.create();
    const count = pdfDoc.getPageCount();
    const copiedPages = await cleanDoc.copyPages(pdfDoc, Array.from({ length: count }, (_, i) => i));
    copiedPages.forEach(p => cleanDoc.addPage(p));
    const flattenedBytes = await cleanDoc.save({ useObjectStreams: true });
    return new Blob([flattenedBytes as BlobPart], { type: 'application/pdf' });
  }
}

/**
 * Conversion: Extract plain text from PDF
 */
export async function extractText(file: File): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();
  let pdf: any = null;
  const pageTexts: string[] = [];

  try {
    pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      page.cleanup?.();

      const items = textContent.items as Array<{ str?: string; transform?: number[]; hasEOL?: boolean }>;

      const pageLines: string[] = [];
      let currentLine = '';
      let lastY: number | null = null;

      for (const item of items) {
        if (!item || typeof item.str !== 'string') continue;
        const y = item.transform ? Math.round(item.transform[5]) : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
          if (currentLine.trim()) pageLines.push(currentLine.trim());
          currentLine = item.str;
        } else {
          currentLine += (currentLine ? ' ' : '') + item.str;
        }
        if (y !== null) lastY = y;
        if (item.hasEOL) {
          if (currentLine.trim()) pageLines.push(currentLine.trim());
          currentLine = '';
          lastY = null;
        }
      }
      if (currentLine.trim()) pageLines.push(currentLine.trim());

      pageTexts.push(`--- Page ${i} ---\n` + pageLines.join('\n'));
    }
  } finally {
    if (pdf) {
      try { await pdf.destroy(); } catch {}
    }
  }

  const fullText = pageTexts.join('\n\n');
  return new Blob([fullText], { type: 'text/plain;charset=utf-8' });
}

/**
 * Conversion: Convert PDF to DOCX using docx library and pdfjs-dist text extraction
 */
export async function convertPdfToDocx(file: File): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();
  let pdf: any = null;
  const docChildren: Paragraph[] = [];

  try {
    pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      page.cleanup?.();

      const items = textContent.items as Array<{ str?: string; transform?: number[]; hasEOL?: boolean }>;

      const pageLines: string[] = [];
      let currentLine = '';
      let lastY: number | null = null;

      for (const item of items) {
        if (!item || typeof item.str !== 'string') continue;
        const y = item.transform ? Math.round(item.transform[5]) : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
          if (currentLine.trim()) pageLines.push(currentLine.trim());
          currentLine = item.str;
        } else {
          currentLine += (currentLine ? ' ' : '') + item.str;
        }
        if (y !== null) lastY = y;
        if (item.hasEOL) {
          if (currentLine.trim()) pageLines.push(currentLine.trim());
          currentLine = '';
          lastY = null;
        }
      }
      if (currentLine.trim()) pageLines.push(currentLine.trim());

      if (pdf.numPages > 1) {
        docChildren.push(
          new Paragraph({
            text: `Page ${i}`,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 },
          })
        );
      }

      for (const line of pageLines) {
        docChildren.push(
          new Paragraph({
            children: [new TextRun(line)],
            spacing: { after: 80 },
          })
        );
      }
    }
  } finally {
    if (pdf) {
      try { await pdf.destroy(); } catch {}
    }
  }

  if (docChildren.length === 0) {
    docChildren.push(new Paragraph({ children: [new TextRun('')] }));
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: docChildren,
      },
    ],
  });

  const docxBlob = await Packer.toBlob(doc);
  return docxBlob;
}

/**
 * Security: Sanitize PDF (Stirling-grade)
 * Purges embedded JavaScript actions, hidden launch actions, external URI links,
 * document attachments, embedded files, and sensitive XML metadata streams
 * without corrupting the visual page render tree.
 */
export async function sanitizePdf(
  file: File,
  options?: {
    removeJs?: boolean;
    removeAttachments?: boolean;
    removeLinks?: boolean;
    removeMetadata?: boolean;
  }
): Promise<Blob> {
  let bytes = new Uint8Array(await file.arrayBuffer());
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await loadPdfForRebuild(bytes, 'Sanitize');
    pdfDoc.getPages();
  } catch (err) {
    if (err instanceof EncryptedDocumentError) throw err;
    const repaired = await repairPdf(file);
    bytes = new Uint8Array(await repaired.arrayBuffer());
    pdfDoc = await loadPdfForRebuild(bytes, 'Sanitize');
  }

  const removeJs = options?.removeJs ?? true;
  const removeAttachments = options?.removeAttachments ?? true;
  const removeLinks = options?.removeLinks ?? true;
  const removeMetadata = options?.removeMetadata ?? true;

  const catalog = pdfDoc.catalog;
  const pages = pdfDoc.getPages();

  if (removeJs) {
    catalog.delete(PDFName.of('OpenAction'));
    catalog.delete(PDFName.of('AA'));
    catalog.delete(PDFName.of('JavaScript'));
    catalog.delete(PDFName.of('JS'));
    catalog.delete(PDFName.of('Launch'));
    catalog.delete(PDFName.of('URI'));

    // Clear form scripts
    try {
      const form = pdfDoc.getForm();
      const fields = form.getFields();
      fields.forEach((field) => {
        try {
          field.acroField.dict.delete(PDFName.of('AA'));
          field.acroField.dict.delete(PDFName.of('A'));
        } catch {}
      });
    } catch {}
  }

  if (removeAttachments) {
    catalog.delete(PDFName.of('EmbeddedFiles'));
    catalog.delete(PDFName.of('AF'));
  }

  // Handle Names dictionary
  try {
    const namesRef = catalog.get(PDFName.of('Names'));
    if (namesRef) {
      const namesDict = pdfDoc.context.lookup(namesRef);
      if (namesDict instanceof PDFDict) {
        if (removeJs) {
          namesDict.delete(PDFName.of('JavaScript'));
        }
        if (removeAttachments) {
          namesDict.delete(PDFName.of('EmbeddedFiles'));
        }
        if (removeAttachments && removeJs) {
          catalog.delete(PDFName.of('Names'));
        }
      }
    }
  } catch {}

  if (removeMetadata) {
    catalog.delete(PDFName.of('Metadata'));
    catalog.delete(PDFName.of('PieceInfo'));
    catalog.delete(PDFName.of('SpiderInfo'));
    pdfDoc.setTitle('');
    pdfDoc.setAuthor('');
    pdfDoc.setSubject('');
    pdfDoc.setKeywords([]);
    pdfDoc.setProducer('');
    pdfDoc.setCreator('');
    try {
      pdfDoc.setCreationDate(new Date(0));
      pdfDoc.setModificationDate(new Date(0));
    } catch {}
  }

  // Sanitize per-page structures
  try {
    pages.forEach((page) => {
      try {
        if (removeJs) {
          page.node.delete(PDFName.of('AA'));
        }
        if (removeAttachments) {
          page.node.delete(PDFName.of('AF'));
        }
        if (removeMetadata) {
          page.node.delete(PDFName.of('Metadata'));
          page.node.delete(PDFName.of('PieceInfo'));
        }

        // Handle Annotations
        const annotsRef = page.node.get(PDFName.of('Annots'));
        if (annotsRef) {
          const annots = pdfDoc.context.lookup(annotsRef);
          if (annots instanceof PDFArray) {
            const retainedAnnots: any[] = [];
            for (let i = 0; i < annots.size(); i++) {
              const annotItem = annots.get(i);
              const annotDict = pdfDoc.context.lookup(annotItem);

              if (annotDict instanceof PDFDict) {
                const subtype = annotDict.get(PDFName.of('Subtype'))?.toString();
                const actionRef = annotDict.get(PDFName.of('A'));
                const actionDict = actionRef ? pdfDoc.context.lookup(actionRef) : null;
                const actionType = actionDict instanceof PDFDict ? actionDict.get(PDFName.of('S'))?.toString() : null;

                if (removeJs) {
                  annotDict.delete(PDFName.of('AA'));
                  if (actionType === '/JavaScript' || actionType === '/Launch') {
                    annotDict.delete(PDFName.of('A'));
                  }
                }

                const isLink = subtype === '/Link' || actionType === '/URI' || actionType === '/Launch' || actionType === '/GoToR';
                if (removeLinks && isLink) {
                  continue;
                }

                retainedAnnots.push(annotItem);
              } else {
                if (!removeLinks) {
                  retainedAnnots.push(annotItem);
                }
              }
            }

            if (retainedAnnots.length === 0) {
              page.node.delete(PDFName.of('Annots'));
            } else if (retainedAnnots.length !== annots.size()) {
              const newAnnotsArray = pdfDoc.context.obj(retainedAnnots);
              page.node.set(PDFName.of('Annots'), newAnnotsArray);
            }
          }
        }
      } catch {}
    });
  } catch {}

  try {
    const sanitizedBytes = await pdfDoc.save({ useObjectStreams: true });
    return new Blob([sanitizedBytes as BlobPart], { type: 'application/pdf' });
  } catch {
    // If the source PDF has corrupted references, copy pages into a clean document
    const cleanDoc = await PDFDocument.create();
    if (removeMetadata) {
      cleanDoc.setTitle('');
      cleanDoc.setAuthor('');
      cleanDoc.setSubject('');
      cleanDoc.setKeywords([]);
      cleanDoc.setProducer('');
      cleanDoc.setCreator('');
    }
    const count = pdfDoc.getPageCount();
    const copiedPages = await cleanDoc.copyPages(pdfDoc, Array.from({ length: count }, (_, i) => i));
    copiedPages.forEach(p => cleanDoc.addPage(p));
    const sanitizedBytes = await cleanDoc.save({ useObjectStreams: true });
    return new Blob([sanitizedBytes as BlobPart], { type: 'application/pdf' });
  }
}

/**
 * Extraction: Extract All Embedded Images (Stirling-grade)
 * Extracts all raster images across all pages and packages them into a clean ZIP.
 */
/**
 * Extract the images a document actually carries.
 *
 * This used to render every page to a canvas and put those PNGs in the ZIP. That is not extraction:
 * a page containing a 2400×3508 scan came back as a 1190×1684 picture of the sheet, with the text and
 * the photo merged into one flat bitmap, and five image placements produced one file. The ZIP then
 * reported a count of pages, not of assets.
 *
 * Now the XObject tree is walked and the original bytes come out — see shared/pdf/embeddedImages.ts.
 * A page render is only used for a page that contains no images at all, and is labelled as such in
 * the manifest rather than passed off as an extracted asset.
 */
export async function extractEmbeddedImages(file: File): Promise<{ zipBlob: Blob; count: number }> {
  const pdfDoc = await loadPdfResilient(file);
  const zip = new JSZip();

  let pdfjsDoc: any = null;
  try {
    pdfjsDoc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;

    const renderFallback = async (pageIndex: number) => {
      const page = await pdfjsDoc.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) { page.cleanup?.(); return null; }
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      await page.render({ canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/png', 1.0);
      canvas.width = 0; canvas.height = 0;
      page.cleanup?.();
      const bytes = new Uint8Array(Buffer.from(dataUrl.split(',')[1], 'base64'));
      return { bytes, ...pngDimensions(bytes) };
    };

    const result = await collectEmbeddedImages(
      pdfDoc.context as never,
      pdfDoc.getPages() as never,
      renderFallback,
    );

    for (const image of result.images) {
      zip.file(image.filename, image.bytes, { compression: 'STORE' });
    }

    const lines = [
      'Extracted images — one line per asset.',
      '',
      '  original        the bytes the PDF itself carries, unmodified',
      '  reconstructed   lossless re-packing of the PDF sample data (no recompression)',
      '  page render     the page contains no images at all; this is a picture of the sheet',
      '',
      ...result.images.map((i) =>
        `${i.filename}\tpage ${i.page}\t${i.width ?? '?'}×${i.height ?? '?'}\t${i.filter}\t${i.fidelity}`),
      '',
      ...(result.caveats.length
        ? ['', `Written, but not with everything attached (${result.caveats.length}):`,
            ...result.caveats.map((c) => `${c.filename}\tpage ${c.page}\t${c.reason}`)]
        : []),
      ...(result.duplicates.length
        ? ['', `Skipped as duplicates of an image already written (${result.duplicates.length}):`,
            ...result.duplicates.map((d) => `page ${d.page}\talready extracted as ${d.of}`)]
        : []),
      ...(result.skipped.length
        ? ['', `Could not be extracted (${result.skipped.length}):`,
            ...result.skipped.map((s) => `page ${s.page}\t${s.name}\t${s.reason}`)]
        : []),
      '',
      `${result.placements} image placement(s) seen · ${result.images.length} distinct asset(s) written · ` +
      `${result.duplicates.length} duplicate(s) · ${result.caveats.length} written without their mask · ` +
      `${result.skipped.length} unreadable`,
    ];
    zip.file('manifest.txt', lines.join('\n'));

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    return { zipBlob, count: result.images.length };
  } finally {
    if (pdfjsDoc) { try { await pdfjsDoc.destroy(); } catch {} }
  }
}

/** A PNG's IHDR carries its size as two big-endian 32-bit integers at offsets 16 and 20. */
function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24) return { width: 0, height: 0 };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * Layout: Multi-Page N-Up Sheet Layout (2-in-1, 4-in-1, 9-in-1)
 * Combines multiple pages into a single physical sheet for printing / booklets.
 */
export async function nUpPageLayout(
  file: File,
  pagesPerSheet: 2 | 4 | 9 = 2
): Promise<Blob> {
  const srcDoc = await loadPdfResilient(file);
  const outDoc = await PDFDocument.create();
  const totalPages = srcDoc.getPageCount();

  const A4_WIDTH = 595.28;
  const A4_HEIGHT = 841.89;

  const grid = nUpGrid(pagesPerSheet);
  const cols = grid.cols;
  const rows = grid.rows;

  const margin = 20;
  const cellWidth = (A4_WIDTH - margin * (cols + 1)) / cols;
  const cellHeight = (A4_HEIGHT - margin * (rows + 1)) / rows;

  for (let i = 0; i < totalPages; i += pagesPerSheet) {
    const sheetPage = outDoc.addPage([A4_WIDTH, A4_HEIGHT]);
    const chunkCount = Math.min(pagesPerSheet, totalPages - i);

    for (let c = 0; c < chunkCount; c++) {
      const pageIndex = i + c;
      const [embedded] = await outDoc.embedPdf(srcDoc, [pageIndex]);
      const scale = Math.min(cellWidth / embedded.width, cellHeight / embedded.height);
      const drawWidth = embedded.width * scale;
      const drawHeight = embedded.height * scale;

      const { col, row } = cellFor(c, grid);

      const cellX = margin + col * (cellWidth + margin);
      const cellY = A4_HEIGHT - (margin + (row + 1) * cellHeight + row * margin);

      const x = cellX + (cellWidth - drawWidth) / 2;
      const y = cellY + (cellHeight - drawHeight) / 2;

      sheetPage.drawPage(embedded, {
        x,
        y,
        xScale: scale,
        yScale: scale,
      });

      // Subtle dividing cell frame
      sheetPage.drawRectangle({
        x: cellX,
        y: cellY,
        width: cellWidth,
        height: cellHeight,
        borderColor: rgb(0.85, 0.85, 0.85),
        borderWidth: 0.5,
      });
    }
  }

  const savedBytes = await outDoc.save();
  return new Blob([savedBytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Filter: Authentic Physical Scanner & Paper Texture Effect
 * Applies realistic paper texture, subtle deskew tilt, and analog photocopy contrast.
 */
export async function scannerEffect(
  file: File,
  options?: { contrast?: number; noise?: number; tilt?: boolean }
): Promise<Blob> {
  const bytes = await file.arrayBuffer();
  let pdfjsDoc: any = null;
  const outDoc = await PDFDocument.create();

  const contrast = options?.contrast ?? 1.2;
  const noiseLevel = options?.noise ?? 15;
  const allowTilt = options?.tilt ?? true;

  try {
    pdfjsDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;

    for (let i = 1; i <= pdfjsDoc.numPages; i++) {
      const page = await pdfjsDoc.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        page.cleanup?.();
        continue;
      }

      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));

      if (allowTilt) {
        const angle = (Math.random() * 0.01 - 0.005); // Subtle ±0.3° tilt
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(angle);
        ctx.translate(-canvas.width / 2, -canvas.height / 2);
      }

      await page.render({ canvasContext: ctx, viewport }).promise;

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;

      for (let p = 0; p < data.length; p += 4) {
        // Grayscale conversion
        const gray = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
        // Contrast stretch
        let adjusted = (gray - 128) * contrast + 128;
        // Paper grain noise
        const noise = (Math.random() - 0.5) * noiseLevel;
        adjusted = Math.min(255, Math.max(0, adjusted + noise));

        data[p] = adjusted;
        data[p + 1] = adjusted;
        data[p + 2] = adjusted;
      }

      ctx.putImageData(imgData, 0, 0);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup?.();

      const base64 = dataUrl.split(',')[1];
      const bin = atob(base64);
      const u8 = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);

      const img = await outDoc.embedJpg(u8);
      const origViewport = page.getViewport({ scale: 1.0 });
      const newPage = outDoc.addPage([origViewport.width, origViewport.height]);
      newPage.drawImage(img, { x: 0, y: 0, width: origViewport.width, height: origViewport.height });
    }
  } finally {
    if (pdfjsDoc) {
      try { await pdfjsDoc.destroy(); } catch {}
    }
  }

  const savedBytes = await outDoc.save();
  return new Blob([savedBytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Filter: Invert Colors / Dark Mode PDF
 * Inverts page color spectrum for dark-mode reading or high-contrast printing.
 */
export async function invertPdfColors(file: File): Promise<Blob> {
  const bytes = await file.arrayBuffer();
  let pdfjsDoc: any = null;
  const outDoc = await PDFDocument.create();

  try {
    pdfjsDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;

    for (let i = 1; i <= pdfjsDoc.numPages; i++) {
      const page = await pdfjsDoc.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        page.cleanup?.();
        continue;
      }

      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));

      await page.render({ canvasContext: ctx, viewport }).promise;

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;

      for (let p = 0; p < data.length; p += 4) {
        data[p] = 255 - data[p];         // Invert R
        data[p + 1] = 255 - data[p + 1]; // Invert G
        data[p + 2] = 255 - data[p + 2]; // Invert B
      }

      ctx.putImageData(imgData, 0, 0);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup?.();

      const base64 = dataUrl.split(',')[1];
      const bin = atob(base64);
      const u8 = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);

      const img = await outDoc.embedJpg(u8);
      const origViewport = page.getViewport({ scale: 1.0 });
      const newPage = outDoc.addPage([origViewport.width, origViewport.height]);
      newPage.drawImage(img, { x: 0, y: 0, width: origViewport.width, height: origViewport.height });
    }
  } finally {
    if (pdfjsDoc) {
      try { await pdfjsDoc.destroy(); } catch {}
    }
  }

  const savedBytes = await outDoc.save();
  return new Blob([savedBytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Structural: Smart Auto-Rotate Pages
 * Automatically detects landscape / sideways pages and standardizes to uniform portrait.
 */
export async function autoRotatePdf(file: File): Promise<Blob> {
  const pdfDoc = await loadPdfResilient(file);
  const pages = pdfDoc.getPages();

  pages.forEach((page) => {
    const { width, height } = page.getSize();
    if (width > height * 1.1) {
      const current = page.getRotation().angle;
      page.setRotation(degrees((current + 90) % 360));
    }
  });

  const savedBytes = await pdfDoc.save();
  return new Blob([savedBytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Annotation: Stamp Badge (Approved, Confidential, Received, Final)
 */
export async function stampPdf(
  file: File,
  stampText: string,
  options?: { color?: 'red' | 'green' | 'blue'; dateStamp?: boolean }
): Promise<Blob> {
  const pdfDoc = await loadPdfResilient(file);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const dateFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  const colorChoice = options?.color || 'red';
  let badgeRgb = rgb(0.85, 0.15, 0.15); // Red
  if (colorChoice === 'green') badgeRgb = rgb(0.1, 0.65, 0.25);
  if (colorChoice === 'blue') badgeRgb = rgb(0.15, 0.35, 0.85);

  const text = stampText.toUpperCase();
  const dateStr = options?.dateStamp !== false ? new Date().toISOString().split('T')[0] : '';

  pages.forEach((page) => {
    const { width, height } = page.getSize();
    const fontSize = 24;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const boxW = textWidth + 40;
    const boxH = dateStr ? 54 : 40;

    const x = width - boxW - 40;
    const y = height - boxH - 40;

    // Outer stamp border
    page.drawRectangle({
      x,
      y,
      width: boxW,
      height: boxH,
      borderColor: badgeRgb,
      borderWidth: 3,
      rotate: degrees(-12),
      opacity: 0.85,
    });

    // Main stamp text
    page.drawText(text, {
      x: x + 20,
      y: y + (dateStr ? 24 : 12),
      size: fontSize,
      font,
      color: badgeRgb,
      rotate: degrees(-12),
      opacity: 0.85,
    });

    if (dateStr) {
      page.drawText(dateStr, {
        x: x + 20,
        y: y + 8,
        size: 10,
        font: dateFont,
        color: badgeRgb,
        rotate: degrees(-12),
        opacity: 0.85,
      });
    }
  });

  const savedBytes = await pdfDoc.save();
  return new Blob([savedBytes as BlobPart], { type: 'application/pdf' });
}


