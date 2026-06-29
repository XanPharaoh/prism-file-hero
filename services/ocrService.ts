/**
 * OCR Extraction Service Wrapper
 * Provides unified interface for Tesseract.js OCR extraction
 */

import Tesseract from 'tesseract.js';
import * as pdfjs from 'pdfjs-dist';
import type { DocumentType, ExtractionResult } from './extractionPipeline';

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
 * Local OCR Fallback (Free & Private)
 * Renders PDF pages to canvas and uses Tesseract.js to extract text patterns.
 */
export async function ocrPdfToTextItems(file: File, maxPages = 10): Promise<TextItem[]> {
  const bytes = await file.arrayBuffer();
  // @ts-ignore
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const pageCount = Math.min(pdf.numPages, maxPages);

  const items: TextItem[] = [];

  for (let p = 1; p <= pageCount; p++) {
    const page = await pdf.getPage(p);

    // Render at 2.0x scale for better OCR accuracy
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;

    await page.render({ canvasContext: ctx, viewport }).promise;

    // Run Tesseract OCR
    const { data } = await Tesseract.recognize(canvas, 'eng', {
      // logger: m => console.log(`OCR Page ${p}:`, m.status)
    });

    for (const block of data.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const line of paragraph.lines || []) {
          const text = line.words.map(w => w.text).join(' ');
          const bbox = line.bbox || line.words[0]?.bbox;
          if (!bbox || !text.trim()) continue;

          // Normalize coordinates back to a 1.0x scale (roughly)
          // pdf.js and tesseract systems differ; this is a best-effort alignment
          const x = bbox.x0 / 2;
          const y = (viewport.height - bbox.y0) / 2; // Flip Y axis for PDF coordinate systems
          const width = (bbox.x1 - bbox.x0) / 2;

          items.push({
            str: text,
            x,
            y,
            width,
            right: x + width,
            center: x + width / 2,
            page: p,
          });
        }
      }
    }

    // Garbage collection
    canvas.width = 0;
    canvas.height = 0;
  }

  return items;
}

/**
 * Extract structured data from PDF using OCR
 * Part of the multi-strategy extraction pipeline
 */
export async function extractWithOCR(
  file: File,
  docType: DocumentType,
  options: { password?: string; enhanceForOcr?: boolean }
): Promise<ExtractionResult> {
  try {
    // Convert PDF to images
    const { convertPdfToImages } = await import('./pdfService');
    const images = await convertPdfToImages(
      file,
      undefined,
      50, // Process up to 50 pages
      options.enhanceForOcr || false,
      options.password
    );

    if (images.length === 0) {
      throw new Error('No images extracted from PDF');
    }

    const allText: string[] = [];
    const rows: Record<string, unknown>[] = [];

    // Process each page with OCR
    for (const image of images) {
      // Create canvas for OCR
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      
      const img = new Image();
      img.src = `data:image/jpeg;base64,${image.base64}`;
      await img.decode();
      
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      // Run Tesseract OCR
      const { data } = await Tesseract.recognize(canvas, 'eng', {
        logger: m => console.log(`OCR Page ${image.pageNumber}:`, m.status)
      });
      
      allText.push(data.text);
      
      // Extract basic table structure from OCR text
      const ocrRows = extractRowsFromOCRText(data.text, image.pageNumber, docType);
      rows.push(...ocrRows);
      
      // Cleanup
      canvas.width = 0;
      canvas.height = 0;
    }

    // Calculate confidence based on extraction quality
    const confidence = calculateOCRConfidence(rows, allText.join('\n'));

    return {
      rows,
      metadata: {
        documentType: docType,
        confidence,
        extractionMethod: 'ocr',
        pagesProcessed: images.length,
        tablesDetected: rows.length > 0 ? 1 : 0,
      },
      rawText: allText.join('\n\n---PAGE BREAK---\n\n'),
    };
  } catch (error) {
    console.error('OCR extraction failed:', error);
    throw error;
  }
}

/**
 * Extract rows from OCR text based on document type
 */
function extractRowsFromOCRText(text: string, pageNumber: number, docType: DocumentType): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const lines = text.split('\n').filter(l => l.trim().length > 0);

  // Simple line-by-line extraction for OCR
  // In production, this would use more sophisticated table detection
  for (const line of lines) {
    // Try to detect if line contains date pattern
    const dateMatch = line.match(/(\d{2}[-/]\d{2}[-/]\d{4})/);
    const amountMatch = line.match(/(\d{1,3}(?:,\d{3})*\.\d{2})/);
    
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
 * Calculate confidence score for OCR extraction
 */
function calculateOCRConfidence(rows: Record<string, unknown>[], rawText: string): number {
  if (rows.length === 0) return 0.1;
  
  // Base confidence for successful OCR
  let confidence = 0.6;
  
  // Boost confidence based on number of extracted rows
  if (rows.length > 5) confidence += 0.1;
  if (rows.length > 20) confidence += 0.1;
  
  // Boost confidence if text contains expected patterns
  const hasDates = /\d{2}[-/]\d{2}[-/]\d{4}/.test(rawText);
  const hasAmounts = /\d{1,3}(?:,\d{3})*\.\d{2}/.test(rawText);
  
  if (hasDates) confidence += 0.1;
  if (hasAmounts) confidence += 0.1;
  
  return Math.min(0.85, confidence); // Cap at 0.85 for OCR
}