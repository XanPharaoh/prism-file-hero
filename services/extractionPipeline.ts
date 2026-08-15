/**
 * Universal Financial Document Extraction Pipeline
 * Multi-strategy extraction with confidence scoring and fallback chains
 */

export interface ExtractionResult {
  rows: Record<string, any>[];
  metadata: {
    documentType: DocumentType;
    confidence: number;
    extractionMethod: 'text-layer' | 'ocr' | 'vision-ai' | 'hybrid';
    pagesProcessed: number;
    tablesDetected: number;
  };
  rawText?: string;
  tables?: DetectedTable[];
}

export interface DetectedTable {
  pageIndex: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  rows: string[][];
  headers: string[];
  confidence: number;
}

export interface ExtractionOptions {
  docType?: DocumentType;
  openingBalance?: string;
  password?: string;
  enhanceForOcr?: boolean;
}

export type DocumentType =
  | 'bank-statement'
  | 'invoice'
  | 'financial-report'
  | 'data-collection'
  | 'receipt'
  | 'tax-document'
  | 'contract'
  | 'inventory'
  | 'unknown';

export type ExtractionStrategy = (
  file: File,
  docType: DocumentType,
  options: ExtractionOptions
) => Promise<ExtractionResult>;

/**
 * Main extraction orchestrator - tries multiple strategies in sequence
 * Returns first result with confidence > 0.8, or best effort
 */
export async function extractDocument(
  file: File,
  options: ExtractionOptions
): Promise<ExtractionResult> {
  // Phase 1: Document Type Detection (if not provided)
  const docType = options.docType || await detectDocumentType(file);

  // Phase 2: Multi-Strategy Extraction with fallback chain
  const strategies: ExtractionStrategy[] = [
    extractFromTextLayer,              // Fastest, most accurate if text layer exists
    extractFromOCR,                    // For scanned documents
    extractFromNormalizedAI,           // Normalize PDF then try AI vision (fixes compression issues)
    extractFromGeminiAI,               // Gemini vision AI for complex layouts (requires auth)
    extractFromVisionAI,               // Generic vision AI for complex layouts
    extractHybrid                      // Combines multiple strategies
  ];

  let bestResult: ExtractionResult | null = null;
  let bestConfidence = 0;

  for (const strategy of strategies) {
    try {
      const result = await strategy(file, docType, options);
      
      // Return immediately if confidence is high enough
      if (result.metadata.confidence > 0.8) {
        return result;
      }

      // Track best result for fallback
      if (result.metadata.confidence > bestConfidence) {
        bestConfidence = result.metadata.confidence;
        bestResult = result;
      }
    } catch (error) {
      console.warn(`Strategy ${strategy.name} failed:`, error);
      continue;
    }
  }

  // Phase 3: Return best result or fallback to low-confidence extraction
  if (bestResult) {
    return bestResult;
  }

  return await extractWithLowConfidence(file, docType);
}

/**
 * Document Type Detection using keyword analysis
 */
async function detectDocumentType(file: File): Promise<DocumentType> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdfjsLib = await import('pdfjs-dist');
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // Extract text from first 2 pages for classification
    let fullText = '';
    for (let i = 1; i <= Math.min(2, pdf.numPages); i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      fullText += textContent.items.map((item: any) => item.str).join(' ') + '\n';
    }

    return classifyDocumentType(fullText);
  } catch (error) {
    console.error('Document type detection failed:', error);
    return 'unknown';
  }
}

function classifyDocumentType(text: string): DocumentType {
  const textLower = text.toLowerCase();

  // Keyword-based classification with scoring
  const patterns: Partial<Record<DocumentType, string[]>> = {
    'bank-statement': [
      'statement', 'account', 'balance', 'transaction', 'debit', 'credit',
      'opening balance', 'closing balance', 'bank', 'account number',
      'tran list', 'statement period'
    ],
    'invoice': [
      'invoice', 'bill to', 'ship to', 'invoice number', 'due date',
      'subtotal', 'tax', 'total due', 'payment terms', 'vendor',
      'purchase order'
    ],
    'financial-report': [
      'profit and loss', 'p&l', 'balance sheet', 'cash flow',
      'income statement', 'assets', 'liabilities', 'equity', 'revenue',
      'operating expenses'
    ],
    'receipt': [
      'receipt', 'thank you', 'change due', 'subtotal', 'tax',
      'total', 'cash', 'credit card', 'store', 'payment method'
    ],
    'tax-document': [
      'w-2', '1099', 'tax return', 'irs', 'social security',
      'wages', 'federal tax', 'state tax', 'taxable income'
    ],
    'contract': [
      'agreement', 'contract', 'party', 'terms', 'conditions',
      'payment schedule', 'milestone', 'deliverable', 'effective date'
    ],
    'inventory': [
      'inventory', 'stock', 'sku', 'quantity', 'unit price',
      'total value', 'item', 'description', 'warehouse'
    ],
    'data-collection': [
      'survey', 'questionnaire', 'response', 'participant',
      'data collection', 'form', 'field', 'entry'
    ]
  };

  // Score each document type
  const scores: Record<string, number> = {};
  for (const [docType, keywords] of Object.entries(patterns)) {
    scores[docType] = keywords.filter(kw => textLower.includes(kw)).length;
  }

  // Return highest scoring type
  const maxScore = Math.max(...Object.values(scores));
  if (maxScore < 3) return 'unknown';

  const bestMatch = Object.entries(scores).find(([_, score]) => score === maxScore);
  return (bestMatch?.[0] as DocumentType) || 'unknown';
}

/**
 * Strategy 1: Spatial TSR Engine (2D coordinate-based Table Structure Recognition)
 * Replaces regex-based text layer extraction with geometric grid analysis
 */
async function extractFromTextLayer(
  file: File,
  docType: DocumentType,
  options: ExtractionOptions
): Promise<ExtractionResult> {
  try {
    // 1. Run the Spatial TSR Engine
    const { extractSpatialMatrix } = await import('./spatialTableExtractor');
    const { matrix, headers, confidence } = await extractSpatialMatrix(file, docType);

    if (matrix.length === 0) {
      throw new Error('Spatial matrix is empty');
    }

    // 2. Run the Semantic Cell Parser (LLM as a cleaner, not an extractor)
    const { parseMatrixWithLLM } = await import('./semanticCellParser');
    const structuredRows = await parseMatrixWithLLM(matrix, headers, docType);

    // If the cell parser produced no usable rows, force low confidence so the
    // pipeline falls through to OCR/Vision instead of returning an empty result.
    const effectiveConfidence = structuredRows.length === 0 ? 0 : confidence;

    return {
      rows: structuredRows,
      metadata: {
        documentType: docType,
        confidence: effectiveConfidence, // Dynamic confidence from spatial engine (0..0.95)
        extractionMethod: 'text-layer',
        pagesProcessed: 0, // Handled internally
        tablesDetected: 1
      },
      rawText: undefined,
      tables: undefined
    };
  } catch (error) {
    console.warn('Spatial extraction failed, falling back to next strategy:', error);
    throw error; // Let the pipeline catch the next strategy
  }
}

/**
 * Strategy 2: Extract using OCR (for scanned documents)
 */
async function extractFromOCR(
  file: File,
  docType: DocumentType,
  options: ExtractionOptions
): Promise<ExtractionResult> {
  const { extractWithOCR } = await import('./ocrService');
  
  // Verify the function exists before calling
  if (typeof extractWithOCR !== 'function') {
    throw new Error('extractWithOCR not found in ocrService');
  }
  
  return await extractWithOCR(file, docType, options);
}

/**
 * Strategy 2b: Normalize PDF then extract using Gemini Vision AI.
 * Fixes flate stream / compression issues by re-encoding the PDF with pdf-lib
 * before rendering pages to images for AI vision.
 */
async function extractFromNormalizedAI(
  file: File,
  docType: DocumentType,
  options: ExtractionOptions
): Promise<ExtractionResult> {
  try {
    const { normalizePdfBytes } = await import('./pdfNormalizer');
    const { processWithAI } = await import('./geminiService');
    const pdfjsLib = await import('pdfjs-dist');

    // Step 1: Normalize the PDF bytes to fix compression issues
    const originalBytes = await file.arrayBuffer();
    let workingBytes: ArrayBuffer;
    try {
      const norm = await normalizePdfBytes(originalBytes);
      workingBytes = norm.data;
      console.log('[Pipeline] PDF normalized for AI extraction.');
    } catch (normErr) {
      console.warn('[Pipeline] PDF normalization failed, using original bytes:', normErr);
      workingBytes = originalBytes;
    }

    // Step 2: Render pages from the (possibly normalized) PDF
    const pdf = await pdfjsLib.getDocument({ data: workingBytes }).promise;
    const maxPages = Math.min(pdf.numPages, 10);
    const images: { base64: string; pageNumber: number }[] = [];

    for (let p = 1; p <= maxPages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 1.5 }); // Lower scale for speed
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d')!;

      try {
        await page.render({ canvasContext: ctx, viewport }).promise;
      } catch (renderErr) {
        console.warn(`[Pipeline] Page ${p} render failed after normalization, skipping.`);
        canvas.width = 0;
        canvas.height = 0;
        continue;
      }

      // Check if canvas is blank (still broken render)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let nonWhite = 0;
      for (let i = 0; i < imageData.data.length; i += 16) {
        if (imageData.data[i] < 250 || imageData.data[i+1] < 250 || imageData.data[i+2] < 250) {
          nonWhite++;
        }
      }
      if (nonWhite < 10) {
        console.warn(`[Pipeline] Page ${p} still blank after normalization, skipping.`);
        canvas.width = 0;
        canvas.height = 0;
        continue;
      }

      const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
      images.push({ base64, pageNumber: p });
      canvas.width = 0;
      canvas.height = 0;
    }

    if (images.length === 0) {
      throw new Error('All pages blank even after normalization');
    }

    const aiResult = await processWithAI('pdf-to-excel', images);

    const rows: Record<string, any>[] = [];
    if (aiResult?.rows && Array.isArray(aiResult.rows)) {
      for (const row of aiResult.rows) {
        if (row && typeof row === 'object') rows.push(row);
      }
    }

    return {
      rows,
      metadata: {
        documentType: docType,
        confidence: rows.length > 0 ? 0.72 : 0,
        extractionMethod: 'vision-ai',
        pagesProcessed: images.length,
        tablesDetected: rows.length > 0 ? 1 : 0,
      },
    };
  } catch (error: any) {
    console.warn('Normalized AI extraction failed:', error?.message || error);
    throw error;
  }
}

/**
 * Strategy 3: Extract using Gemini Vision AI (for complex layouts)
 * Requires authentication — gracefully falls through if auth fails.
 */
async function extractFromGeminiAI(
  file: File,
  docType: DocumentType,
  options: ExtractionOptions
): Promise<ExtractionResult> {
  try {
    const { processWithAI } = await import('./geminiService');
    const pdfjsLib = await import('pdfjs-dist');
    const bytes = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const maxPages = Math.min(pdf.numPages, 10);

    // Render PDF pages to base64 images
    const images: { base64: string; pageNumber: number }[] = [];
    for (let p = 1; p <= maxPages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport }).promise;
      const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      images.push({ base64, pageNumber: p });
    }

    if (images.length === 0) {
      throw new Error('No pages rendered for AI extraction');
    }

    const aiResult = await processWithAI('pdf-to-excel', images);

    // Convert AI response to ExtractionResult format
    const rows: Record<string, any>[] = [];
    if (aiResult?.rows && Array.isArray(aiResult.rows)) {
      for (const row of aiResult.rows) {
        if (row && typeof row === 'object') {
          rows.push(row);
        }
      }
    }

    const confidence = rows.length > 0 ? 0.75 : 0;
    return {
      rows,
      metadata: {
        documentType: docType,
        confidence,
        extractionMethod: 'vision-ai',
        pagesProcessed: maxPages,
        tablesDetected: rows.length > 0 ? 1 : 0,
      },
    };
  } catch (error: any) {
    // Auth failures and service errors gracefully fall through
    console.warn('Gemini AI extraction not available:', error?.message || error);
    throw error;
  }
}

/**
 * Strategy 4: Extract using Vision AI (for complex layouts)
 */
async function extractFromVisionAI(
  file: File,
  docType: DocumentType,
  options: ExtractionOptions
): Promise<ExtractionResult> {
  try {
    const { extractWithVisionAI } = await import('./aiExtractionService');
    return await extractWithVisionAI(file, docType, options);
  } catch (error) {
    console.warn('Vision AI extraction not available:', error);
    throw error;
  }
}

/**
 * Strategy 5: Hybrid extraction (combines multiple methods)
 */
async function extractHybrid(
  file: File,
  docType: DocumentType,
  options: ExtractionOptions
): Promise<ExtractionResult> {
  // Try to combine text layer + OCR results
  try {
    const [textLayerResult, ocrResult] = await Promise.all([
      extractFromTextLayer(file, docType, options).catch(() => null),
      extractFromOCR(file, docType, options).catch(() => null)
    ]);

    // Use the result with more rows, or merge them
    if (textLayerResult && ocrResult) {
      const combinedRows = [...textLayerResult.rows];
      
      // Add OCR rows that don't duplicate text layer rows.
      // Deduplicate by normalised date+amount+description rather than JSON.stringify
      // (which is key-order-dependent and fails when the two extractors produce
      // different column names or ordering for the same row).
      const normaliseRow = (r: Record<string, any>) => {
        const vals = Object.values(r).map(v =>
          v === null || v === undefined ? '' : String(v).trim().toLowerCase()
        );
        return vals.join('|');
      };

      const existingKeys = new Set(
        textLayerResult.rows.map(normaliseRow)
      );

      ocrResult.rows.forEach(row => {
        if (!existingKeys.has(normaliseRow(row))) {
          combinedRows.push(row);
        }
      });

      return {
        rows: combinedRows,
        metadata: {
          documentType: docType,
          confidence: Math.max(
            textLayerResult.metadata.confidence,
            ocrResult.metadata.confidence
          ) * 0.9, // Slight penalty for hybrid
          extractionMethod: 'hybrid',
          pagesProcessed: Math.max(
            textLayerResult.metadata.pagesProcessed,
            ocrResult.metadata.pagesProcessed
          ),
          tablesDetected: (textLayerResult.metadata.tablesDetected || 0) +
                         (ocrResult.metadata.tablesDetected || 0)
        },
        rawText: ocrResult.rawText,
        tables: [...(textLayerResult.tables || []), ...(ocrResult.tables || [])]
      };
    }

    // Fallback to whichever succeeded
    return textLayerResult || ocrResult || {
      rows: [],
      metadata: {
        documentType: docType,
        confidence: 0,
        extractionMethod: 'hybrid',
        pagesProcessed: 0,
        tablesDetected: 0
      }
    };
  } catch (error) {
    console.error('Hybrid extraction failed:', error);
    throw error;
  }
}

/**
 * Fallback: Extract with low confidence when all strategies fail
 */
async function extractWithLowConfidence(
  file: File,
  docType: DocumentType
): Promise<ExtractionResult> {
  try {
    // Last resort: try Docling or generic extraction
    const { extractTable } = await import('./tableExtractor');
    const table = await extractTable(file);

    const rows = table.rows.map(row => {
      const obj: Record<string, any> = {};
      table.headers.forEach((header, i) => {
        obj[header] = row[i] ?? '';
      });
      return obj;
    });

    return {
      rows,
      metadata: {
        documentType: docType,
        confidence: 0.2,
        extractionMethod: 'text-layer',
        pagesProcessed: 0,
        tablesDetected: rows.length > 0 ? 1 : 0
      }
    };
  } catch (error) {
    console.error('Low-confidence extraction failed:', error);
    return {
      rows: [],
      metadata: {
        documentType: docType,
        confidence: 0,
        extractionMethod: 'text-layer',
        pagesProcessed: 0,
        tablesDetected: 0
      }
    };
  }
}