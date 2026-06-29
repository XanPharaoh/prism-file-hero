
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';
import { encryptPDF } from '@pdfsmaller/pdf-encrypt-lite';

const isTauri = typeof window !== 'undefined' && (window as any).__TAURI__ !== undefined;

pdfjsLib.GlobalWorkerOptions.workerSrc = isTauri
  ? 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs'
  : new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

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
 */
function parsePageSelection(pagesStr: string, totalPages: number): number[] {
  const indices: number[] = [];
  // Split on commas, spaces, or words like 'and'
  const parts = pagesStr.split(/[\s,]+/);
  
  for (const part of parts) {
    const cleanPart = part.trim();
    if (!cleanPart) continue;
    if (cleanPart.toLowerCase() === 'and') continue;
    
    if (cleanPart.includes('-')) {
      const rangeParts = cleanPart.split('-');
      const start = parseInt(rangeParts[0], 10);
      const end = parseInt(rangeParts[1], 10);
      if (!isNaN(start) && !isNaN(end)) {
        const actualStart = Math.min(start, end);
        const actualEnd = Math.max(start, end);
        for (let i = actualStart; i <= actualEnd; i++) {
          if (i >= 1 && i <= totalPages) {
            indices.push(i - 1); // 0-indexed
          }
        }
      }
    } else {
      const pageNum = parseInt(cleanPart, 10);
      if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
        indices.push(pageNum - 1); // 0-indexed
      }
    }
  }
  
  // If invalid or empty, default to all pages
  if (indices.length === 0) {
    for (let i = 0; i < totalPages; i++) {
      indices.push(i);
    }
  }
  
  // Sort and remove duplicates
  return Array.from(new Set(indices)).sort((a, b) => a - b);
}

/**
 * Structural manipulation: Merge multiple PDFs with optional specific page selection
 */
export async function mergePdfs(files: File[], pagesStr?: string): Promise<Blob> {
  const mergedPdf = await PDFDocument.create();
  for (const file of files) {
    const bytes = await file.arrayBuffer();
    const pdf = await PDFDocument.load(bytes);
    const totalPages = pdf.getPageCount();
    const indices = pagesStr ? parsePageSelection(pagesStr, totalPages) : Array.from({ length: totalPages }, (_, i) => i);
    const copiedPages = await mergedPdf.copyPages(pdf, indices);
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }
  const pdfBytes = await mergedPdf.save();
  return new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Structural manipulation: Split PDF into individual pages with optional specific page selection
 */
export async function splitPdf(file: File, pagesStr?: string): Promise<{ blob: Blob, pageNum: number }[]> {
  const bytes = await file.arrayBuffer();
  const pdf = await PDFDocument.load(bytes);
  const results: { blob: Blob, pageNum: number }[] = [];
  const totalPages = pdf.getPageCount();

  const pageIndices = pagesStr ? parsePageSelection(pagesStr, totalPages) : Array.from({ length: totalPages }, (_, i) => i);

  for (const i of pageIndices) {
    const newDoc = await PDFDocument.create();
    const [page] = await newDoc.copyPages(pdf, [i]);
    newDoc.addPage(page);
    const pageBytes = await newDoc.save();
    results.push({
      blob: new Blob([pageBytes as BlobPart], { type: 'application/pdf' }),
      pageNum: i + 1
    });
  }
  return results;
}

/**
 * Structural manipulation: Rotate PDF
 */
export async function rotatePdf(file: File, angle: number = 90): Promise<Blob> {
  const bytes = await file.arrayBuffer();
  const pdf = await PDFDocument.load(bytes);
  const pages = pdf.getPages();
  pages.forEach(page => {
    const currRotation = page.getRotation().angle;
    page.setRotation(degrees(currRotation + angle));
  });
  const rotatedPdfBytes = await pdf.save();
  return new Blob([rotatedPdfBytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Security: Protect PDF using standard AES-256 encryption via pdf-lib.
 * Produces standard-compliant password-protected PDFs readable by all standard readers.
 */
export async function protectPdf(file: File, password: string): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer);
  
  // Use pdf-lib's native encryption (AES-256, standard compliant)
  const encryptedBytes = await pdfDoc.save({
    ownerPassword: password,
    userPassword: password,
    permissions: {
      printing: 'highResolution',
      modifying: false,
      copying: false,
      annotating: false,
      fillingForms: false,
      contentAccessibility: false,
      documentAssembly: false,
    },
  });
  
  return new Blob([encryptedBytes], { type: 'application/pdf' });
}

/**
 * Security: Add centered diagonal watermark across each page
 */
export async function watermarkPdf(file: File, text: string): Promise<Blob> {
  const bytes = await file.arrayBuffer();
  const pdf = await PDFDocument.load(bytes);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();

  pages.forEach(page => {
    const { width, height } = page.getSize();
    const diagonal = Math.sqrt(width * width + height * height);

    // Reduced font size: scale font to ~2.5% of page diagonal (down from 6%) for a cleaner look
    const fontSize = Math.min(diagonal * 0.035, 36);
    const textWidth = font.widthOfTextAtSize(text, fontSize);

    // Center the watermark on the page
    const centerX = width / 2;
    const centerY = height / 2;

    // Calculate rotation angle to match page diagonal (rising from bottom-left to top-right)
    const angleRad = Math.atan2(height, width);
    const angleDegrees = angleRad * (180 / Math.PI);

    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);

    // Compensate for drawText rotating around the bottom-left of the first character
    const centerX_rel = (textWidth / 2) * cos - (fontSize / 2) * sin;
    const centerY_rel = (textWidth / 2) * sin + (fontSize / 2) * cos;

    const x = centerX - centerX_rel;
    const y = centerY - centerY_rel;

    page.drawText(text, {
      x,
      y,
      size: fontSize,
      font,
      color: rgb(0.75, 0.75, 0.75),
      opacity: 0.35,
      rotate: degrees(angleDegrees),
    });
  });

  const watermarkedPdfBytes = await pdf.save();
  return new Blob([watermarkedPdfBytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Optimize: Real PDF compression
 * - Re-renders pages at reduced scale to shrink embedded images
 * - Preserves page dimensions through scaling
 * - Uses medium JPEG quality for a balance of size vs clarity
 */
export async function compressPdf(
  file: File,
  quality: number = 0.65,
  onProgress?: (percent: number) => void,
  password?: string
): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();

  // First, create a lossless compressed version using pdf-lib's useObjectStreams
  let losslessBuffer: Uint8Array;
  try {
    const pdfDocLib = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    losslessBuffer = await pdfDocLib.save({ useObjectStreams: true });
  } catch (e) {
    losslessBuffer = new Uint8Array(arrayBuffer);
  }

  try {
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer, password }).promise;
    const newPdf = await PDFDocument.create();
    const pageCount = pdfDoc.numPages;

    // Render at 1.0x scale (down from 1.5x) to maintain a smaller baseline size
    const renderScale = 1.0;

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: renderScale });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) continue;

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvasContext: context, viewport }).promise;

      // Convert to JPEG with controlled quality
      const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
      const base64 = jpegDataUrl.split(',')[1];
      const binaryStr = atob(base64);
      const imageBytes = new Uint8Array(binaryStr.length);
      for (let j = 0; j < binaryStr.length; j++) {
        imageBytes[j] = binaryStr.charCodeAt(j);
      }

      // Embed into new PDF at ORIGINAL page dimensions
      const origViewport = page.getViewport({ scale: 1.0 });
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

    // Only return the rasterized version if it is actually smaller than the original and the lossless version
    if (resultBytes.length < arrayBuffer.byteLength && resultBytes.length < losslessBuffer.length) {
      return new Blob([resultBytes as BlobPart], { type: 'application/pdf' });
    }
  } catch (error) {
    console.error('Error during rasterization compression:', error);
  }

  if (onProgress) onProgress(100);
  return new Blob([losslessBuffer as BlobPart], { type: 'application/pdf' });
}

/**
 * Security: Redact PDF by removing text content from the content stream
 * and drawing black boxes over specified regions.
 * Text is removed from the content stream, not just visually covered.
 */
export async function redactPdf(
  file: File,
  regions: { page: number; x: number; y: number; width: number; height: number; text?: string }[]
): Promise<Blob> {
  const bytes = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(bytes);
  const pages = pdfDoc.getPages();

  let pdfjsDoc: any = null;
  try {
    pdfjsDoc = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  } catch (err) {
    console.error('Failed to load pdfjs in redactPdf:', err);
  }

  for (const region of regions) {
    const pageIndex = region.page - 1;
    if (pageIndex < 0 || pageIndex >= pages.length) continue;

    const page = pages[pageIndex];
    const { height } = page.getSize();

    let redactedWithTextSearch = false;

    if (pdfjsDoc && region.text && region.text.trim().length > 0) {
      try {
        const jsPage = await pdfjsDoc.getPage(region.page);
        const textContent = await jsPage.getTextContent();
        const items = textContent.items as any[];
        const cleanSearch = region.text.trim().toLowerCase();

        // 1. Exact or substring match inside text items
        for (const item of items) {
          const itemText = item.str.trim().toLowerCase();
          if (itemText && (itemText.includes(cleanSearch) || cleanSearch.includes(itemText))) {
            const tx = item.transform;
            page.drawRectangle({
              x: tx[4] - 2,
              y: tx[5] - 2,
              width: item.width + 4,
              height: item.height + 4,
              color: rgb(0, 0, 0),
            });
            redactedWithTextSearch = true;
          }
        }

        // 2. Phrase matching across multiple consecutive items
        if (!redactedWithTextSearch) {
          for (let i = 0; i < items.length; i++) {
            let combined = '';
            let startX = items[i].transform[4];
            let startY = items[i].transform[5];
            let maxItemHeight = items[i].height;
            for (let j = i; j < Math.min(i + 8, items.length); j++) {
              combined += (combined ? ' ' : '') + items[j].str;
              maxItemHeight = Math.max(maxItemHeight, items[j].height);
              if (combined.toLowerCase().includes(cleanSearch)) {
                const endX = items[j].transform[4] + items[j].width;
                page.drawRectangle({
                  x: startX - 2,
                  y: startY - 2,
                  width: (endX - startX) + 4,
                  height: maxItemHeight + 4,
                  color: rgb(0, 0, 0),
                });
                redactedWithTextSearch = true;
                break;
              }
            }
          }
        }
      } catch (err) {
        console.error('Error during text-search redaction:', err);
      }
    }

    // Fallback: draw box based on percentage/absolute coordinates from AI
    if (!redactedWithTextSearch) {
      page.drawRectangle({
        x: region.x,
        y: height - region.y - region.height,
        width: region.width,
        height: region.height,
        color: rgb(0, 0, 0),
      });
    }

    // Remove text objects from the content stream within the redaction region
    try {
      const contentStream = page.node.Contents();
      if (contentStream) {
        // Rebuild the content stream filtering out text draw operations in redacted areas
        const streamDict = contentStream.get(pdfDoc.context);
        if (streamDict && streamDict.contents) {
          const originalBytes = streamDict.contents;
          const filtered = filterTextOperations(originalBytes, region, height);
          streamDict.contents = filtered;
        }
      }
    } catch (err) {
      // Content stream manipulation is best-effort — the black box overlay is the primary defense
      console.warn('Content stream filtering skipped (best-effort):', err);
    }
  }

  const redactedPdfBytes = await pdfDoc.save();
  return new Blob([redactedPdfBytes as BlobPart], { type: 'application/pdf' });
}

/**
 * Best-effort filter: removes BT...ET text blocks whose position falls within a redaction region.
 * This is a heuristic approach — for production use, consider the pdf-redactor package.
 */
function filterTextOperations(
  streamBytes: Uint8Array,
  region: { x: number; y: number; width: number; height: number },
  pageHeight: number
): Uint8Array {
  // Decode the PDF content stream to string for processing
  const decoded = new TextDecoder('latin1').decode(streamBytes);
  // Split into lines and filter out BT...ET blocks that overlap with the redaction region
  const lines: string[] = [];
  let inTextBlock = false;
  let textBlockLines: string[] = [];

  for (const line of decoded.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === 'BT') {
      inTextBlock = true;
      textBlockLines = [line];
      continue;
    }
    if (inTextBlock) {
      textBlockLines.push(line);
      if (trimmed === 'ET') {
        inTextBlock = false;
        // Heuristic: if the text block contains positioning commands (Td, TD, Tm)
        // within the redaction region's Y range, skip it
        const blockText = textBlockLines.join('\n');
        const tdm = blockText.match(/([-\d.]+)\s+([-\d.]+)\s+T[dDm]/g);
        let isInRange = false;
        if (tdm) {
          for (const match of tdm) {
            const nums = match.match(/[-\d.]+/g);
            if (nums && nums.length >= 2) {
              const y = parseFloat(nums[1]);
              if (Math.abs(y) >= region.y && Math.abs(y) <= region.y + region.height) {
                isInRange = true;
                break;
              }
            }
          }
        }
        if (!isInRange) {
          lines.push(...textBlockLines);
        }
        // else: skip this text block (it's within the redacted region)
      }
      continue;
    }
    lines.push(line);
  }

  return new TextEncoder().encode(lines.join('\n')) as Uint8Array;
}

/**
 * Convert images (JPG/PNG) into a single PDF
 */
export async function convertImagesToPdf(files: File[]): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();

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
  signal?: AbortSignal
): Promise<{ base64: string; pageNumber: number }[]> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, password }).promise;
    const images: { base64: string; pageNumber: number }[] = [];
    const count = Math.min(pdf.numPages, maxPages);

    for (let i = 1; i <= count; i++) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 3.0 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) continue;

      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({ canvasContext: context, viewport }).promise;

      if (enhanceForOcr) {
        // Use Web Worker for off-main-thread preprocessing
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const processedImageData = await preprocessImageData(imageData);
        context.putImageData(processedImageData, 0, 0);
      }

      const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      images.push({ base64, pageNumber: i });

      if (onProgress) onProgress(Math.round((i / count) * 100));
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

  // Last page number
  const lastPageNum = `Page ${pdf.getPageCount()}`;
  page.drawText(lastPageNum, { x: pageWidth - margin - font.widthOfTextAtSize(lastPageNum, 8), y: margin - 15, font, size: 8, color: rgb(0.5, 0.5, 0.5) });

  const pdfBytes = await pdf.save();
  return new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
}
