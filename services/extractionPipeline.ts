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
    extractFromTextLayer,      // Fastest, most accurate if text layer exists
    extractFromOCR,            // For scanned documents
    extractFromVisionAI,       // For complex layouts
    extractHybrid              // Combines multiple strategies
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
 * Strategy 1: Extract from text layer (fastest, most accurate for digital PDFs)
 */
async function extractFromTextLayer(
  file: File,
  docType: DocumentType,
  options: ExtractionOptions
): Promise<ExtractionResult> {
  // Import here to avoid circular dependencies
  const { extractTableDeterministically } = await import('./deterministicExtractService');
  
  const result = await extractTableDeterministically(file);

  return {
    rows: result.rows,
    metadata: {
      documentType: docType,
      confidence: result.hasTextLayer ? 0.9 : 0.3,
      extractionMethod: 'text-layer',
      pagesProcessed: 0, // Will be populated by caller
      tablesDetected: 1
    },
    rawText: undefined,
    tables: undefined
  };
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
 * Strategy 3: Extract using Vision AI (for complex layouts)
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
 * Strategy 4: Hybrid extraction (combines multiple methods)
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
      
      // Add OCR rows that don't duplicate text layer rows
      const existingKeys = new Set(
        textLayerResult.rows.map(r => JSON.stringify(r))
      );
      
      ocrResult.rows.forEach(row => {
        if (!existingKeys.has(JSON.stringify(row))) {
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