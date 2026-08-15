import { PDFDocument } from 'pdf-lib';

export interface NormalizationResult {
  file: File;
  wasNormalized: boolean;
  originalSizeKB: number;
  normalizedSizeKB: number;
  issues?: string[];
}

/**
 * Normalise raw PDF bytes (ArrayBuffer) by re-saving with pdf-lib.
 * Returns the normalised ArrayBuffer and a list of issues encountered.
 * Throws if pdf-lib cannot parse the PDF at all.
 */
export async function normalizePdfBytes(bytes: ArrayBuffer): Promise<{ data: ArrayBuffer; issues: string[] }> {
  const issues: string[] = [];
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });

  // Strategy 1: Save without object streams (maximum compatibility)
  try {
    const normalised = await pdfDoc.save({ useObjectStreams: false, addDefaultPage: false });
    if (normalised.byteLength > 0) {
      return { data: normalised, issues };
    }
  } catch (e: any) {
    issues.push(`Save strategy 1 failed: ${e?.message || e}`);
  }

  // Strategy 2: Save with object streams (smaller, sometimes fixes parsing)
  try {
    const normalised = await pdfDoc.save({ useObjectStreams: true, addDefaultPage: false });
    if (normalised.byteLength > 0) {
      return { data: normalised, issues };
    }
  } catch (e: any) {
    issues.push(`Save strategy 2 failed: ${e?.message || e}`);
  }

  throw new Error('Could not re-encode PDF with any strategy. Issues: ' + issues.join('; '));
}

/**
 * Attempts to normalize a PDF by re-saving it with standard compression.
 * Fixes unsupported flate streams, non-standard filters, and minor corruption.
 * Tries multiple save strategies for maximum compatibility.
 * Falls back to original file if pdf-lib cannot parse it.
 */
export async function normalizePdf(file: File): Promise<NormalizationResult> {
  const originalSizeKB = file.size / 1024;

  // Skip normalization for very large files to avoid memory pressure
  if (file.size > 25 * 1024 * 1024) {
    console.warn('[PDF Normalizer] File >25MB, skipping normalization to preserve memory.');
    return { file, wasNormalized: false, originalSizeKB, normalizedSizeKB: originalSizeKB };
  }

  try {
    const bytes = await file.arrayBuffer();

    // Use the multi-strategy normaliser
    const { data: normalizedBytes } = await normalizePdfBytes(bytes);

    const normalizedFile = new File([normalizedBytes], file.name, { type: 'application/pdf' });
    const normalizedSizeKB = normalizedBytes.byteLength / 1024;

    console.log(
      `[PDF Normalizer] Success. Original: ${originalSizeKB.toFixed(1)}KB → Normalized: ${normalizedSizeKB.toFixed(1)}KB`
    );

    return {
      file: normalizedFile,
      wasNormalized: true,
      originalSizeKB,
      normalizedSizeKB,
    };
  } catch (error: any) {
    console.warn('[PDF Normalizer] Normalization failed, returning original file:', error?.message);
    return {
      file,
      wasNormalized: false,
      originalSizeKB,
      normalizedSizeKB: originalSizeKB,
      issues: [`Normalization failed: ${error?.message || 'unknown error'}`],
    };
  }
}
