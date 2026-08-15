/**
 * PDF Validator - Detects and handles problematic PDFs
 * Handles corrupted compression, blank pages, and format errors.
 *
 * Strategy: Check text layer FIRST (what FNB/generic extractors use).
 * Only check canvas rendering if no text layer (for OCR/TymeBank path).
 *
 * This matches production 845a6c92 behavior where FNB worked without validation.
 */

// pdfjs-dist requires Promise.withResolvers (Node 22+ / modern browsers)
if (typeof (Promise as any).withResolvers !== 'function') {
  (Promise as any).withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

export interface PDFValidationResult {
  isValid: boolean;
  issues: string[];
  canExtract: boolean;
  suggestedAction?: string;
}

/**
 * Validate PDF for extraction capability.
 *
 * Strategy: Check text layer FIRST (what FNB/generic extractors use).
 * Only check canvas rendering if no text layer (for OCR/TymeBank path).
 *
 * This matches production 845a6c92 behavior where FNB worked without validation.
 */
export async function validatePDF(file: File): Promise<PDFValidationResult> {
  const issues: string[] = [];

  try {
    const pdfjsLib = await import('pdfjs-dist');
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({
      data: arrayBuffer,
      // @ts-expect-error verbosity exists on getDocument params
      verbosity: 0,
    }).promise;

    if (pdf.numPages === 0) {
      return {
        isValid: false,
        issues: ['PDF has no pages'],
        canExtract: false,
        suggestedAction:
          'This PDF appears to be empty. Please upload a different file.',
      };
    }

    // PHASE 1: Check text layer (PRIMARY - what FNB/generic extractors use)
    const pagesToCheck = Math.min(2, pdf.numPages);
    let textItemsFound = 0;
    let hasTextLayer = false;

    for (let i = 1; i <= pagesToCheck; i++) {
      try {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const items = textContent.items.filter(
          (item: any) => item.str && item.str.trim().length > 0
        );
        textItemsFound += items.length;

        if (items.length > 10) {
          hasTextLayer = true;
          console.log(`[PDF Validator] Page ${i}: Found ${items.length} text items`);
          break; // Found text layer, no need to check more pages
        }
      } catch (textError: any) {
        console.warn(
          `[PDF Validator] Page ${i} text extraction failed:`,
          textError?.message || textError
        );
        // Continue to next page
      }
    }

    // If text layer found, extraction CAN proceed (skip canvas check entirely)
    if (hasTextLayer) {
      console.log(
        `[PDF Validator] Text layer detected (${textItemsFound} items). Extraction can proceed.`
      );
      return {
        isValid: true,
        issues: [],
        canExtract: true,
      };
    }

    // PHASE 2: No text layer - check canvas rendering (SECONDARY - for OCR/TymeBank)
    console.log(
      '[PDF Validator] No text layer found. Checking canvas rendering for OCR path...'
    );
    let allPagesBlank = true;
    let renderFailed = false;
    let blankLikelyDueToCompression = false; // pages rendered but produced blank canvas (flate stream issue)
    const hasBrowserCanvas =
      typeof document !== 'undefined' && typeof document.createElement === 'function';

    if (hasBrowserCanvas) {
      for (let i = 1; i <= pagesToCheck; i++) {
        try {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.0 });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (!context) {
            // Cannot probe canvas — do not treat as blank (may still OCR later)
            allPagesBlank = false;
            break;
          }
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          try {
            await page.render({ canvasContext: context, viewport }).promise;

            // Check if canvas is mostly blank (>95% white pixels)
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            let whitePixels = 0;
            const totalPixels = data.length / 4;

            for (let j = 0; j < data.length; j += 4) {
              if (data[j] > 250 && data[j + 1] > 250 && data[j + 2] > 250) {
                whitePixels++;
              }
            }

            const blankRatio = whitePixels / totalPixels;
            console.log(
              `[PDF Validator] Page ${i}: ${(blankRatio * 100).toFixed(1)}% white pixels`
            );

            if (blankRatio < 0.95) {
              allPagesBlank = false;
              break; // Found non-blank page
            } else {
              // Page rendered but is blank — likely flate/compression issue
              blankLikelyDueToCompression = true;
            }
          } catch (renderError: any) {
            console.warn(
              `[PDF Validator] Page ${i} rendering failed (non-standard compression):`,
              renderError?.message || renderError
            );
            // Rendering failure doesn't mean no content - text layer might still work.
            // But we already checked text layer and it failed, so this is truly problematic.
            renderFailed = true;
            break;
          } finally {
            canvas.width = 0;
            canvas.height = 0;
          }
        } catch (pageError: any) {
          console.warn(
            `[PDF Validator] Page ${i} access failed:`,
            pageError?.message || pageError
          );
          renderFailed = true;
          break;
        }
      }
    } else {
      // Node / no canvas: cannot prove blank — allow extraction attempt
      allPagesBlank = false;
    }

    // Build issues list
    if (allPagesBlank) {
      issues.push('All checked pages appear to be blank');
    }

    if (!hasTextLayer) {
      issues.push('No text layer detected - will use OCR');
    }

    if (renderFailed && !hasTextLayer) {
      issues.push('Canvas rendering failed (non-standard compression)');
    }

    if (blankLikelyDueToCompression && !hasTextLayer) {
      issues.push('Pages rendered blank — likely unsupported compression (flate stream). Will attempt alternative extraction.');
    }

    // Decision logic:
    // - If text layer found → can extract (FNB/generic path)
    // - If no text layer but pages not blank → can extract (OCR path)
    // - If no text layer AND all pages blank → only block if rendering succeeded AND not compression-related
    // - If render failed OR blank due to compression → allow fallback to AI/Docling paths
    const renderIssues = renderFailed || blankLikelyDueToCompression;
    const definitelyEmpty = !hasTextLayer && allPagesBlank && !renderIssues;
    const canExtract = !definitelyEmpty;

    if (!canExtract) {
      return {
        isValid: false,
        issues,
        canExtract: false,
        suggestedAction:
          'This PDF appears to have unsupported compression or all pages are blank. ' +
          'Please try re-saving the PDF from the original application, converting to a different PDF format, or using a different file.',
      };
    }

    return {
      isValid: issues.length === 0,
      issues,
      canExtract: true,
      suggestedAction: undefined,
    };
  } catch (error: any) {
    console.error('[PDF Validator] Validation error:', error);
    const errorMessage = error?.message || 'Unknown error';

    if (errorMessage.includes('Invalid PDF structure')) {
      return {
        isValid: false,
        issues: ['PDF structure is corrupted'],
        canExtract: false,
        suggestedAction:
          'This PDF has a corrupted structure. Please try re-saving the PDF from the original source or converting it to a different format.',
      };
    }

    if (errorMessage.includes('Password') || errorMessage.includes('password')) {
      return {
        isValid: false,
        issues: ['PDF is password protected'],
        canExtract: false,
        suggestedAction:
          'This PDF is password protected. Please provide the password or upload an unprotected version.',
      };
    }

    if (
      errorMessage.includes('compression') ||
      errorMessage.includes('flate') ||
      errorMessage.includes('FormatError')
    ) {
      return {
        isValid: false,
        issues: ['PDF uses unsupported compression method'],
        canExtract: false,
        suggestedAction:
          'This PDF uses a compression method that cannot be processed. Please try re-saving the PDF with standard compression or converting to a different format.',
      };
    }

    return {
      isValid: false,
      issues: [`PDF validation error: ${errorMessage}`],
      canExtract: false,
      suggestedAction: 'Unable to process this PDF. Please try a different file.',
    };
  }
}

/**
 * Check if PDF has compression issues that pdf.js cannot handle.
 * Used to trigger client-side normalization — does NOT by itself block extraction.
 * Prefer text-layer success in validatePDF for canExtract decisions.
 */
export async function hasCompressionIssues(file: File): Promise<boolean> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
      return true;
    }

    const pdfjsLib = await import('pdfjs-dist');
    const loadingTask = pdfjsLib.getDocument({
      data: arrayBuffer,
      // @ts-expect-error verbosity exists on getDocument params
      verbosity: 0,
    });

    try {
      const pdf = await loadingTask.promise;

      // If text layer is extractable, compression is not a hard blocker for text extractors
      try {
        const page1 = await pdf.getPage(1);
        const tc = await page1.getTextContent();
        const items = tc.items.filter((item: any) => item.str && item.str.trim().length > 0);
        if (items.length > 10) {
          return false;
        }
      } catch {
        /* fall through to render probe */
      }

      // Probe first page render for flate/stream failures (OCR/canvas path)
      if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 0.5 });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          try {
            await page.render({ canvasContext: ctx, viewport }).promise;
          } catch (renderErr: any) {
            const msg = renderErr?.message || String(renderErr);
            canvas.width = 0;
            canvas.height = 0;
            return (
              msg.includes('compression') ||
              msg.includes('flate') ||
              msg.includes('FormatError') ||
              msg.includes('Invalid stream')
            );
          }
          canvas.width = 0;
          canvas.height = 0;
        }
      }
      return false;
    } catch (error: any) {
      const message = error?.message || '';
      return (
        message.includes('compression') ||
        message.includes('flate') ||
        message.includes('Invalid') ||
        message.includes('FormatError')
      );
    }
  } catch {
    return true;
  }
}
