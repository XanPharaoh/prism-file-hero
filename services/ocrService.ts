/**
 * OCR EXTRACTION SERVICE (SPATIAL BRIDGE)
 * Renders PDF to images, runs Tesseract, captures word-level bounding boxes,
 * and feeds them into the exact same Spatial Clustering & X-Projection engine
 * used for digital PDFs. Completely eliminates regex-based data destruction.
 */

import Tesseract from 'tesseract.js';
import * as pdfjs from 'pdfjs-dist';
import type { SearchablePage, SearchableWord } from './pdfService';
import type { DocumentType, ExtractionResult } from './extractionPipeline';
import type { SpatialTextItem } from './spatialTableExtractor';
import { discoverColumnBoundaries, assignCells, mergeMultiLineRows } from './spatialTableExtractor';
import { ocrRectToNormalized } from './pdfCoordinateAdapter';
import { parseMatrixWithLLM } from './semanticCellParser';
import { detectBank } from './bankRegistry';
import {
  convertTymeBankToExcelRows,
  extractTymeBankStatementFromText,
} from './tymebankExtractService';

export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  right: number;
  center: number;
  page: number;
}

/**
 * Check if a canvas is blank (mostly white pixels).
 * Detects pdf.js flate/compression render failures that produce empty pages.
 */
export function isCanvasBlank(canvas: HTMLCanvasElement): boolean {
  if (!canvas || canvas.width === 0 || canvas.height === 0) return true;

  const ctx = canvas.getContext('2d');
  if (!ctx) return true;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const totalPixels = data.length / 4;
  if (totalPixels === 0) return true;

  // Sample pixels for performance (check every 10th pixel; denser on small canvases)
  const sampleRate = totalPixels > 200_000 ? 16 : totalPixels > 50_000 ? 10 : 4;
  let whitePixels = 0;
  let sampledCount = 0;

  for (let i = 0; i < data.length; i += 4 * sampleRate) {
    sampledCount++;
    if (data[i] > 250 && data[i + 1] > 250 && data[i + 2] > 250) {
      whitePixels++;
    }
  }

  return sampledCount > 0 && whitePixels / sampledCount > 0.95;
}

export const BLANK_PDF_USER_MESSAGE =
  'All pages appear to be blank or have unsupported compression. Please try re-saving the PDF or uploading a different file.';

/** Minimal Tesseract page shape used by the spatial-bridge fallback chain. */
export interface TesseractBBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface TesseractToken {
  text?: string;
  bbox?: TesseractBBox;
  words?: TesseractToken[];
  lines?: TesseractToken[];
  paragraphs?: TesseractToken[];
}

export interface TesseractPageData {
  text?: string;
  words?: TesseractToken[];
  lines?: TesseractToken[];
  blocks?: TesseractToken[];
}

function tokenToSpatialItem(
  token: TesseractToken,
  page: number
): SpatialTextItem | null {
  if (!token.text || !token.text.trim() || !token.bbox) return null;
  const { x0, y0, x1, y1 } = token.bbox;
  return {
    str: token.text.trim(),
    // Keep Y in image-top-origin (Tesseract Y=0 is top) so TSR sort ascending = top-to-bottom.
    bbox: {
      x: x0,
      y: y0,
      width: x1 - x0,
      height: y1 - y0,
    },
    page,
  };
}

function flattenNestedWords(data: TesseractPageData): TesseractToken[] {
  if (data.words && data.words.length > 0) return data.words;
  const words: TesseractToken[] = [];
  for (const block of data.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        for (const word of line.words || []) {
          words.push(word);
        }
      }
    }
  }
  return words;
}

function flattenNestedLines(data: TesseractPageData): TesseractToken[] {
  if (data.lines && data.lines.length > 0) return data.lines;
  const lines: TesseractToken[] = [];
  for (const block of data.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        lines.push(line);
      }
    }
  }
  return lines;
}

/**
 * Map Tesseract page data to SpatialTextItems with fallback chain:
 * word-level → line-level → block-level.
 * Exported for unit tests.
 */
export function mapTesseractDataToSpatialItems(
  data: TesseractPageData,
  pageNumber: number
): SpatialTextItem[] {
  const words = flattenNestedWords(data);
  const lines = flattenNestedLines(data);
  const blocks = data.blocks || [];

  console.log(
    `[OCR] Page ${pageNumber} Results -> Text Length: ${data.text?.length || 0}, Words: ${words.length}, Lines: ${lines.length}`
  );

  const spatialItems: SpatialTextItem[] = [];

  if (words.length > 0) {
    for (const word of words) {
      const item = tokenToSpatialItem(word, pageNumber);
      if (item) spatialItems.push(item);
    }
    return spatialItems;
  }

  if (lines.length > 0) {
    console.warn(
      `[OCR] Page ${pageNumber}: data.words is empty, falling back to data.lines (${lines.length} lines)`
    );
    for (const line of lines) {
      const item = tokenToSpatialItem(line, pageNumber);
      if (item) spatialItems.push(item);
    }
    return spatialItems;
  }

  if (blocks.length > 0) {
    console.warn(
      `[OCR] Page ${pageNumber}: data.words and data.lines empty, falling back to data.blocks`
    );
    for (const block of blocks) {
      const item = tokenToSpatialItem(block, pageNumber);
      if (item) spatialItems.push(item);
    }
    return spatialItems;
  }

  return spatialItems;
}

/**
 * Last-resort line-by-line regex parse when Tesseract returns text but no geometry.
 */
export function extractRowsFromOCRText(
  text: string,
  pageNumber: number,
  _docType: DocumentType
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const lines = text.split('\n').filter(l => l.trim().length > 0);

  for (const line of lines) {
    const dateMatch = line.match(/(\d{2}[-/]\d{2}[-/]\d{4}|\d{2}\s[A-Za-z]{3}\s\d{4})/);
    const amountMatch = line.match(/([R$£€]?\s?\d{1,3}(?:,\d{3})*\.\d{2})/);

    if (dateMatch || amountMatch) {
      rows.push({
        Page: pageNumber,
        RawText: line.trim(),
        Date: dateMatch?.[1] || '',
        Amount: amountMatch?.[1] || '',
      });
    }
  }
  return rows;
}

/**
 * Local OCR Fallback (Free & Private)
 * Used exclusively by documentService.ts for initial bank detection on scanned PDFs.
 * Skips blank pages produced by pdf.js rendering failures.
 */
export async function ocrPdfToTextItems(file: File, maxPages = 10): Promise<TextItem[]> {
  const bytes = await file.arrayBuffer();
  // pdf.js detaches ArrayBuffers after consuming them, so keep a Uint8Array
  // copy that we can re-slice for each getDocument call.
  const bytesSafe = new Uint8Array(bytes);
  // @ts-ignore
  const pdf = await pdfjs.getDocument({ data: bytesSafe.slice().buffer }).promise;
  const pageCount = Math.min(pdf.numPages, maxPages);
  
  const items: TextItem[] = [];
  let renderErrorPages = 0;

  for (let p = 1; p <= pageCount; p++) {
    const page = await pdf.getPage(p);
    let viewport = page.getViewport({ scale: 2.0 });
    let canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    let ctx = canvas.getContext('2d')!;
    let rendered = false;
    let hadRenderError = false;

    // Attempt 1: Normal render at scale 2.0
    try {
      await page.render({ canvasContext: ctx, viewport }).promise;
      rendered = true;
    } catch (renderError) {
      console.warn(`[OCR] Page ${p} render failed (attempt 1, scale 2.0):`, renderError);
      hadRenderError = true;
    }

    // Attempt 2: Retry with lower scale and disableFontFace if first attempt failed or blank
    if (!rendered || isCanvasBlank(canvas)) {
      if (hadRenderError || isCanvasBlank(canvas)) {
        console.warn(`[OCR] Page ${p}: ${hadRenderError ? 'Render failed' : 'Blank canvas (flate stream error)'}. Retrying with alt params...`);
        canvas.width = 0; canvas.height = 0;
        // @ts-ignore
        const altPdf = await pdfjs.getDocument({
          data: bytesSafe.slice().buffer,
          disableFontFace: true,
          useSystemFonts: false,
        }).promise;
        const altPage = await altPdf.getPage(p);
        viewport = altPage.getViewport({ scale: 1.0 });
        canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        ctx = canvas.getContext('2d')!;
        try {
          await altPage.render({ canvasContext: ctx, viewport }).promise;
          rendered = true;
          hadRenderError = false;
          console.log(`[OCR] Page ${p}: Alt render succeeded (scale 1.0, disableFontFace)`);
        } catch (altError) {
          console.warn(`[OCR] Page ${p} alt render also failed:`, altError);
          rendered = false;
          hadRenderError = true;
        }
      }
    }

    // If all rendering attempts failed, pass whatever we have to Tesseract rather than skipping
    if (!rendered) {
      renderErrorPages++;
      console.warn(`[OCR] Page ${p}: All render attempts failed. Passing raw text content to fallback.`);
      // Try to get text content directly from the page as last resort
      try {
        const textContent = await page.getTextContent();
        const rawText = textContent.items.map((item: any) => item.str || '').join(' ');
        if (rawText.trim()) {
          // Synthesize a minimal TextItem from raw text content
          items.push({
            str: rawText.trim(),
            x: 0, y: 0, width: 100,
            right: 100, center: 50,
            page: p,
          });
          console.log(`[OCR] Page ${p}: Recovered ${rawText.trim().length} chars from text layer despite render failure`);
        }
      } catch { /* no text layer available */ }
      canvas.width = 0;
      canvas.height = 0;
      continue;
    }

    // If canvas is still blank after retry, log but still attempt OCR (something > nothing)
    if (isCanvasBlank(canvas)) {
      console.warn(`[OCR] Page ${p}: Canvas still blank after retry. Attempting OCR anyway (partial content is better than none).`);
      renderErrorPages++;
    }

    const { data } = await Tesseract.recognize(canvas, 'eng', {});

    for (const block of data.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const line of paragraph.lines || []) {
          const text = line.words.map(w => w.text).join(' ');
          const bbox = line.bbox || line.words[0]?.bbox;
          if (!bbox || !text.trim()) continue;

          const x = bbox.x0 / 2;
          // Keep Y in image-top-origin (same as Tesseract) so that
          // sort-by-Y-ascending = top-to-bottom within a page.
          const y = bbox.y0 / 2;
          const width = (bbox.x1 - bbox.x0) / 2;

          items.push({
            str: text,
            x, y, width,
            right: x + width,
            center: x + width / 2,
            page: p,
          });
        }
      }
    }
    canvas.width = 0;
    canvas.height = 0;
  }

  // If ALL pages had render errors but we recovered text from text layers, return what we have
  if (items.length === 0 && renderErrorPages === pageCount) {
    console.warn(`[OCR] All ${pageCount} pages had render failures and no text could be recovered.`);
  }

  return items;
}

/**
 * Strategy 2: Extract using OCR (Spatial Bridge)
 * Replaces regex parsing with 2D coordinate-based Table Structure Recognition.
 */
export async function extractWithOCR(
  file: File,
  docType: DocumentType,
  options: { password?: string; enhanceForOcr?: boolean }
): Promise<ExtractionResult> {
  try {
    // 1. Convert PDF to Images
    const { convertPdfToImages } = await import('./pdfService');
    const images = await convertPdfToImages(
      file,
      undefined,
      50, // Process up to 50 pages
      options.enhanceForOcr || false,
      options.password
    );

    if (images.length === 0) {
      throw new Error(BLANK_PDF_USER_MESSAGE);
    }

    const allSpatialItems: SpatialTextItem[] = [];
    const allText: string[] = [];
    let maxPageWidth = 0;
    let blankPageCount = 0;
    let processedPageCount = 0;

    // 2. Run Tesseract with word → line → block spatial fallback
    for (const image of images) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      
      const img = new Image();
      img.src = `data:image/jpeg;base64,${image.base64}`;
      try {
        await img.decode();
      } catch (decodeErr) {
        console.error(`[OCR] Failed to decode page ${image.pageNumber}:`, decodeErr);
        blankPageCount++;
        canvas.width = 0;
        canvas.height = 0;
        continue;
      }
      
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      if (isCanvasBlank(canvas)) {
        blankPageCount++;
        console.warn(
          `[OCR] Page ${image.pageNumber} appears to be blank (unusual PDF compression). Skipping.`
        );
        canvas.width = 0;
        canvas.height = 0;
        continue;
      }

      processedPageCount++;
      // The shared alignment engine consumes page-relative coordinates, not
      // Tesseract image pixels. This makes rendered scale/crop differences
      // irrelevant to row and column inference.
      maxPageWidth = 1;

      const { data } = await Tesseract.recognize(canvas, 'eng', {
        logger: m => console.log(`OCR Page ${image.pageNumber}:`, m.status)
      });

      if (data.text && data.text.trim()) {
        allText.push(data.text.trim());
      }

      const spatialItems = mapTesseractDataToSpatialItems(data as TesseractPageData, image.pageNumber)
        .map((item) => ({
          ...item,
          bbox: ocrRectToNormalized(
            item.bbox.x,
            item.bbox.y,
            item.bbox.width,
            item.bbox.height,
            img.width,
            img.height,
          ),
        }));

      if (spatialItems.length === 0) {
        console.warn(
          `[OCR] Page ${image.pageNumber}: All fallback levels empty. Text was: ${data.text?.substring(0, 100)}...`
        );
        canvas.width = 0;
        canvas.height = 0;
        continue;
      }

      allSpatialItems.push(...spatialItems);
      
      // Cleanup
      canvas.width = 0;
      canvas.height = 0;
    }

    if (processedPageCount === 0 || (blankPageCount === images.length && allText.length === 0 && allSpatialItems.length === 0)) {
      throw new Error(BLANK_PDF_USER_MESSAGE);
    }

    const fullText = allText.join('\n\n---PAGE BREAK---\n\n');
    const bankDetection = detectBank(fullText);
    const bankConfidence =
      bankDetection.confidence > 1
        ? bankDetection.confidence / 100
        : bankDetection.confidence;
    console.log(
      `[OCR] Detected bank: ${bankDetection.bankName} (${bankDetection.bankCode}) with confidence ${bankDetection.confidence}`
    );

    if (bankDetection.bankCode === 'TYMEBANK_SA' && bankConfidence > 0.5 && fullText.trim()) {
      console.log('[OCR] Using TymeBank-specific extractor');
      const result = extractTymeBankStatementFromText(fullText, images.length);
      if (result.transactions.length > 0) {
        return {
          rows: convertTymeBankToExcelRows(result.transactions),
          metadata: {
            documentType: 'bank-statement',
            confidence: result.metadata.parseErrors === 0 ? 0.9 : 0.7,
            extractionMethod: 'ocr',
            pagesProcessed: images.length,
            tablesDetected: 1,
          },
          rawText: fullText,
        };
      }
    }

    if (allSpatialItems.length === 0) {
      console.warn('[OCR] No spatial items extracted. Attempting line-by-line fallback from raw text.');

      const fallbackRows: Record<string, unknown>[] = [];
      allText.forEach((text, index) => {
        const parsed = extractRowsFromOCRText(text, index + 1, docType);
        fallbackRows.push(...parsed);
      });

      if (fallbackRows.length > 0) {
        return {
          rows: fallbackRows,
          metadata: {
            documentType: docType,
            confidence: 0.4,
            extractionMethod: 'ocr',
            pagesProcessed: images.length,
            tablesDetected: 1,
          },
          rawText: fullText,
        };
      }

      console.warn('[OCR] Line-by-line fallback also failed.');
      if (allText.length === 0) {
        throw new Error(BLANK_PDF_USER_MESSAGE);
      }
      return {
        rows: [{ RawText: fullText }],
        metadata: {
          documentType: docType,
          confidence: 0.15,
          extractionMethod: 'ocr',
          pagesProcessed: images.length,
          tablesDetected: 0,
        },
        rawText: fullText,
      };
    }

    // 3. Spatial Clustering (Y-Axis Tolerance Grouping)
    // Sort by page first, then ASCENDING by Y (Top to Bottom, Tesseract Y=0 is top).
    // CRITICAL: a pure Y sort interleaves items across pages because image Y
    // coordinates reset to 0 on each page. We key on (page, y) so page 1 always
    // precedes page 2 regardless of Y values.
    const sortedItems = [...allSpatialItems].sort((a, b) => {
      if (a.page !== b.page) return a.page - b.page;
      return a.bbox.y - b.bbox.y;
    });
    const rows: SpatialTextItem[][] = [];
    let currentRow: SpatialTextItem[] = [];
    let currentY = -9999;
    let currentPage = 1;
    const yTolerance = 0.012; // Normalized equivalent of OCR baseline jitter

    for (const item of sortedItems) {
      const pageBreak = item.page !== currentPage;
      const yGap = pageBreak ? 9999 : Math.abs(item.bbox.y - currentY);
      if (yGap > yTolerance) {
        if (currentRow.length > 0) rows.push(currentRow);
        currentRow = [item];
        currentY = item.bbox.y;
        currentPage = item.page;
      } else {
        currentRow.push(item);
      }
    }
    if (currentRow.length > 0) rows.push(currentRow);

    // Sort items within each row by X coordinate (Left to Right)
    const orderedRows = rows.map(row => row.sort((a, b) => a.bbox.x - b.bbox.x));

    // 4. Column Discovery & Cell Assignment (Reusing TSR Engine)
    const colBoundaries = discoverColumnBoundaries(allSpatialItems, maxPageWidth);
    let matrix = assignCells(orderedRows, colBoundaries);
    
    // 5. Multi-Line Row Merging
    matrix = mergeMultiLineRows(matrix);

    // Extract headers (assume first row is headers)
    const headers = matrix.length > 0 ? matrix[0] : [];
    const dataMatrix = matrix.slice(1);

    if (dataMatrix.length === 0) {
       throw new Error('OCR spatial matrix is empty after header extraction');
    }

    // 6. Semantic Cell Parsing (LLM as Cleaner)
    const structuredRows = await parseMatrixWithLLM(dataMatrix, headers, docType);

    return {
      rows: structuredRows,
      metadata: {
        documentType: docType,
        confidence: 0.85, // High confidence: Spatial Geometry + LLM Normalization
        extractionMethod: 'ocr',
        pagesProcessed: images.length,
        tablesDetected: 1,
      },
      rawText: undefined, // We no longer dump raw flat text
    };
  } catch (error) {
    console.error('OCR Spatial extraction failed:', error);
    throw error;
  }
}

/**
 * Batch 07 — Local OCR that PRESERVES the scanned page image and adds a correctly positioned
 * invisible searchable text layer (never a transcript PDF). Each page is rasterized once;
 * Tesseract word boxes (image-pixel, top-origin) feed createSearchablePdf, which maps them
 * to PDF points. Any page that fails to render or encode aborts the whole run — a returned
 * Blob is not treated as proof of a correct document.
 */
export async function buildSearchablePdf(
  file: File,
  opts: { password?: string; onProgress?: (pct: number) => void; maxPages?: number } = {}
): Promise<Blob> {
  const { createSearchablePdf } = await import('./pdfService');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data: bytes.slice(0), password: opts.password }).promise;
  const worker: any = await Tesseract.createWorker('eng');
  const pages: SearchablePage[] = [];
  const maxPages = opts.maxPages ?? doc.numPages;
  try {
    for (let n = 1; n <= Math.min(maxPages, doc.numPages); n++) {
      const jsPage = await doc.getPage(n);
      const ov = jsPage.getViewport({ scale: 1 });              // PDF-point size (preserve orientation)
      const scale = Math.min(2, Math.sqrt(4_000_000 / Math.max(1, ov.width * ov.height)));
      const vp = jsPage.getViewport({ scale });                 // raster (image pixel) space
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(vp.width));
      canvas.height = Math.max(1, Math.round(vp.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error(`OCR page ${n}: canvas unavailable`);
      try {
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await jsPage.render({ canvasContext: ctx, viewport: vp }).promise;
        const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
        const words: SearchableWord[] = [];
        for (const block of (data as any).blocks || []) {
          for (const para of block.paragraphs || []) {
            for (const line of para.lines || []) {
              const text = (line.words || []).map((w: any) => w.text).join(' ').trim();
              const bbox = line.bbox || line.words?.[0]?.bbox;
              if (text && bbox) words.push({ text, x: bbox.x0, y: bbox.y0, width: bbox.x1 - bbox.x0, height: bbox.y1 - bbox.y0 });
            }
          }
        }
        const jpg = Uint8Array.from(atob(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]), ch => ch.charCodeAt(0));
        pages.push({ image: jpg, imageType: 'jpg', pixelWidth: canvas.width, pixelHeight: canvas.height, pdfWidth: ov.width, pdfHeight: ov.height, words });
      } finally {
        canvas.width = 0; canvas.height = 0;
        jsPage.cleanup?.();
      }
      opts.onProgress?.(Math.round((n / Math.min(maxPages, doc.numPages)) * 100));
    }
  } finally {
    try { await worker.terminate(); } catch { /* ignore */ }
    try { await doc.destroy(); } catch { /* ignore */ }
  }
  if (pages.length === 0) throw new Error('OCR produced no pages; refusing to emit an empty document.');
  return createSearchablePdf(pages);
}
