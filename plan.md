# 🎯 MASTER INSTRUCTION FOR QWEN 2.5 CODER AGENT

**ATTENTION CODER:**

You are executing a **CRITICAL ENHANCEMENT** to the Prism File Hero PDF-to-Excel extraction system. The goal is to transform the current bank-statement-focused extractor into a **universal, fail-proof financial document extraction engine** capable of handling any structured financial document.

---

## 📋 CONTEXT & CURRENT STATE

### Current Architecture (from knowledge base):
- **`documentService.ts`** - Main orchestrator
- **`deterministicExtractService.ts`** - Text-layer extraction via pdfjs-dist
- **`geminiService.ts`** - AI vision extraction (actually uses Groq `llama-3.2-90b-vision-preview`)
- **`reconciliationService.ts`** - Mathematical row reconciliation
- **`ledgerGuard.ts`** - Flow conservation validation
- **`transactionClassifier.ts`** - Transaction type classification
- **`excelService.ts`** - XLSX generation

### Current Limitations:
1. ❌ Only optimized for bank statements
2. ❌ Single extraction strategy (text-layer → AI fallback)
3. ❌ No document type detection
4. ❌ No OCR preprocessing pipeline
5. ❌ No multi-model AI fallback
6. ❌ No confidence scoring
7. ❌ No support for invoices, financial reports, data collection forms

---

## 🎯 OBJECTIVES

Transform the system to handle:
- ✅ **Bank Statements** (all banks, all formats)
- ✅ **Invoices** (vendor invoices, purchase orders)
- ✅ **Financial Reports** (P&L, balance sheets, cash flow)
- ✅ **Data Collection Forms** (surveys, questionnaires with tabular data)
- ✅ **Receipts** (expense receipts, POS receipts)
- ✅ **Tax Documents** (W-2, 1099, tax returns)
- ✅ **Contracts** (with payment schedules)
- ✅ **Inventory Lists** (stock sheets, asset registers)

---

## 🏗️ ARCHITECTURE ENHANCEMENT PLAN

### Phase 1: Multi-Strategy Extraction Pipeline

**Create `services/extractionPipeline.ts`:**

```typescript
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

export async function extractDocument(
  file: File,
  options: ExtractionOptions
): Promise<ExtractionResult> {
  // Phase 1: Document Type Detection
  const docType = await detectDocumentType(file);
  
  // Phase 2: Multi-Strategy Extraction
  const strategies = [
    extractFromTextLayer,      // Fastest, most accurate if text layer exists
    extractFromOCR,            // For scanned documents
    extractFromVisionAI,       // For complex layouts
    extractHybrid              // Combines multiple strategies
  ];
  
  for (const strategy of strategies) {
    try {
      const result = await strategy(file, docType, options);
      if (result.confidence > 0.8) {
        return result;
      }
    } catch (error) {
      console.warn(`Strategy ${strategy.name} failed:`, error);
      continue;
    }
  }
  
  // Fallback: Return best effort with low confidence
  return await extractWithLowConfidence(file, docType);
}
```

### Phase 2: Document Type Detection

**Create `services/documentTypeDetector.ts`:**

```typescript
import * as pdfjsLib from 'pdfjs-dist';

export async function detectDocumentType(file: File): Promise<DocumentType> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  // Extract text from first 2 pages for classification
  let fullText = '';
  for (let i = 1; i <= Math.min(2, pdf.numPages); i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    fullText += textContent.items.map((item: any) => item.str).join(' ') + '\n';
  }
  
  const textLower = fullText.toLowerCase();
  
  // Keyword-based classification
  const patterns = {
    'bank-statement': [
      'statement', 'account', 'balance', 'transaction', 'debit', 'credit',
      'opening balance', 'closing balance', 'bank', 'account number'
    ],
    'invoice': [
      'invoice', 'bill to', 'ship to', 'invoice number', 'due date',
      'subtotal', 'tax', 'total', 'payment terms', 'vendor'
    ],
    'financial-report': [
      'profit and loss', 'p&l', 'balance sheet', 'cash flow',
      'income statement', 'assets', 'liabilities', 'equity', 'revenue'
    ],
    'receipt': [
      'receipt', 'thank you', 'change due', 'subtotal', 'tax',
      'total', 'cash', 'credit card', 'store'
    ],
    'tax-document': [
      'w-2', '1099', 'tax return', 'irs', 'social security',
      'wages', 'federal tax', 'state tax'
    ],
    'contract': [
      'agreement', 'contract', 'party', 'terms', 'conditions',
      'payment schedule', 'milestone', 'deliverable'
    ],
    'inventory': [
      'inventory', 'stock', 'sku', 'quantity', 'unit price',
      'total value', 'item', 'description'
    ]
  };
  
  // Score each document type
  const scores: Record<DocumentType, number> = {} as any;
  for (const [docType, keywords] of Object.entries(patterns)) {
    scores[docType as DocumentType] = keywords.filter(kw => textLower.includes(kw)).length;
  }
  
  // Return highest scoring type, or 'unknown' if no strong match
  const maxScore = Math.max(...Object.values(scores));
  if (maxScore < 3) return 'unknown';
  
  return (Object.entries(scores).find(([_, score]) => score === maxScore)?.[0] || 'unknown') as DocumentType;
}
```

### Phase 3: Enhanced Text Layer Extraction

**Enhance `services/deterministicExtractService.ts`:**

```typescript
export async function extractTableDeterministically(
  file: File,
  docType: DocumentType
): Promise<DeterministicResult> {
  const bytes = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  
  const allTables: DetectedTable[] = [];
  
  for (let i = 1; i <= Math.min(pdf.numPages, 50); i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    
    if (textContent.items.length === 0) continue;
    
    // Detect tables on this page
    const tables = await detectTablesOnPage(textContent.items, page, docType);
    allTables.push(...tables);
  }
  
  // Merge tables across pages if they're continuations
  const mergedTables = mergeContinuationTables(allTables);
  
  // Extract rows based on document type
  const rows = await extractRowsFromTables(mergedTables, docType);
  
  return {
    rows,
    metadata: {
      documentType: docType,
      tablesDetected: mergedTables.length,
      hasTextLayer: true
    },
    tables: mergedTables
  };
}

async function detectTablesOnPage(
  items: any[],
  page: any,
  docType: DocumentType
): Promise<DetectedTable[]> {
  // Group items into lines based on Y-coordinate
  const lines = groupItemsIntoLines(items);
  
  // Detect table headers based on document type
  const headerPatterns = getHeaderPatterns(docType);
  const tables: DetectedTable[] = [];
  
  let currentTable: string[][] | null = null;
  let headers: string[] | null = null;
  
  for (const line of lines) {
    const lineText = line.map(item => item.str).join(' ').toLowerCase();
    
    // Check if this line is a table header
    const isHeader = headerPatterns.some(pattern => 
      pattern.some(keyword => lineText.includes(keyword))
    );
    
    if (isHeader && !currentTable) {
      // Start new table
      headers = line.map(item => item.str.trim());
      currentTable = [];
    } else if (currentTable && headers) {
      // Add row to current table
      const row = alignRowToHeaders(line, headers, items);
      if (row.some(cell => cell.trim().length > 0)) {
        currentTable.push(row);
      }
    }
    
    // Detect table end (empty line or new section)
    if (currentTable && line.every(item => item.str.trim() === '')) {
      tables.push({
        pageIndex: page.pageIndex,
        boundingBox: calculateBoundingBox(currentTable, items),
        rows: currentTable,
        headers: headers!,
        confidence: calculateTableConfidence(currentTable, headers!)
      });
      currentTable = null;
      headers = null;
    }
  }
  
  return tables;
}

function getHeaderPatterns(docType: DocumentType): string[][] {
  const patterns: Record<DocumentType, string[][]> = {
    'bank-statement': [
      ['date', 'description', 'amount'],
      ['date', 'transaction', 'debit', 'credit', 'balance'],
      ['posting date', 'description', 'amount', 'balance']
    ],
    'invoice': [
      ['item', 'description', 'quantity', 'unit price', 'total'],
      ['product', 'qty', 'price', 'amount'],
      ['description', 'qty', 'rate', 'amount']
    ],
    'financial-report': [
      ['account', 'debit', 'credit'],
      ['category', 'amount', 'percentage'],
      ['line item', 'current', 'prior', 'change']
    ],
    'receipt': [
      ['item', 'qty', 'price', 'total'],
      ['description', 'amount']
    ],
    'inventory': [
      ['sku', 'description', 'quantity', 'unit price', 'total'],
      ['item', 'qty', 'price', 'value']
    ],
    // Add patterns for other document types
  };
  
  return patterns[docType] || patterns['unknown'];
}
```

### Phase 4: OCR Integration

**Create `services/ocrService.ts`:**

```typescript
import Tesseract from 'tesseract.js';

export async function extractFromOCR(
  file: File,
  docType: DocumentType,
  options: ExtractionOptions
): Promise<ExtractionResult> {
  const images = await convertPdfToImages(file, undefined, 50, true);
  
  const allText: string[] = [];
  const allTables: DetectedTable[] = [];
  
  for (const image of images) {
    // Preprocess image for better OCR
    const preprocessed = await preprocessImageForOCR(image.base64);
    
    // Run OCR
    const result = await Tesseract.recognize(preprocessed, 'eng', {
      logger: m => console.log(m),
    });
    
    allText.push(result.data.text);
    
    // Detect tables in OCR output
    const tables = await detectTablesInOCRText(result.data, image.pageNumber);
    allTables.push(...tables);
  }
  
  // Extract structured data from tables
  const rows = await extractRowsFromOCRTables(allTables, docType);
  
  return {
    rows,
    metadata: {
      documentType: docType,
      confidence: calculateOCRConfidence(allTables),
      extractionMethod: 'ocr',
      pagesProcessed: images.length,
      tablesDetected: allTables.length
    },
    rawText: allText.join('\n\n'),
    tables: allTables
  };
}

async function preprocessImageForOCR(base64Image: string): Promise<string> {
  // Apply image preprocessing:
  // 1. Convert to grayscale
  // 2. Apply adaptive thresholding
  // 3. Remove noise
  // 4. Deskew if necessary
  // 5. Enhance contrast
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  
  const img = new Image();
  img.src = `data:image/jpeg;base64,${base64Image}`;
  await img.decode();
  
  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);
  
  // Get image data
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  // Convert to grayscale
  for (let i = 0; i < data.length; i += 4) {
    const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
    data[i] = avg;
    data[i + 1] = avg;
    data[i + 2] = avg;
  }
  
  // Apply adaptive thresholding
  const blockSize = 15;
  const C = 5;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const idx = (y * canvas.width + x) * 4;
      const threshold = calculateLocalThreshold(data, x, y, canvas.width, canvas.height, blockSize);
      const pixel = data[idx];
      const binary = pixel > threshold - C ? 255 : 0;
      data[idx] = binary;
      data[idx + 1] = binary;
      data[idx + 2] = binary;
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.9);
}
```

### Phase 5: Enhanced AI Vision Extraction

**Enhance `services/geminiService.ts` (rename to `services/aiExtractionService.ts`):**

```typescript
export async function extractFromVisionAI(
  file: File,
  docType: DocumentType,
  options: ExtractionOptions
): Promise<ExtractionResult> {
  const images = await convertPdfToImages(file, undefined, 20, true);
  
  // Use document-type-specific prompts
  const prompt = getExtractionPrompt(docType);
  
  // Try multiple AI models in sequence
  const models = [
    { name: 'groq-llama-vision', endpoint: GROQ_URL, key: getGroqKey() },
    { name: 'nvidia-phi-4', endpoint: NVIDIA_URL, key: getNvidiaKey() },
    // Add more models as fallbacks
  ];
  
  for (const model of models) {
    try {
      const result = await callVisionModel(model, images, prompt, docType);
      if (result.confidence > 0.7) {
        return result;
      }
    } catch (error) {
      console.warn(`Model ${model.name} failed:`, error);
      continue;
    }
  }
  
  throw new Error('All AI models failed');
}

function getExtractionPrompt(docType: DocumentType): string {
  const prompts: Record<DocumentType, string> = {
    'bank-statement': `Extract all transactions from this bank statement. Return JSON with structure:
{
  "openingBalance": "string",
  "closingBalance": "string",
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "string",
      "debit": "number or null",
      "credit": "number or null",
      "balance": "number or null"
    }
  ]
}`,
    'invoice': `Extract all line items from this invoice. Return JSON with structure:
{
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "dueDate": "YYYY-MM-DD",
  "vendor": "string",
  "customer": "string",
  "lineItems": [
    {
      "description": "string",
      "quantity": "number",
      "unitPrice": "number",
      "total": "number"
    }
  ],
  "subtotal": "number",
  "tax": "number",
  "total": "number"
}`,
    'financial-report': `Extract all line items from this financial report. Return JSON with structure:
{
  "reportType": "string",
  "period": "string",
  "lineItems": [
    {
      "category": "string",
      "account": "string",
      "amount": "number",
      "percentage": "number or null"
    }
  ]
}`,
    // Add prompts for other document types
  };
  
  return prompts[docType] || prompts['unknown'];
}

async function callVisionModel(
  model: AIModel,
  images: { base64: string; pageNumber: number }[],
  prompt: string,
  docType: DocumentType
): Promise<ExtractionResult> {
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        ...images.map(img => ({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${img.base64}` }
        }))
      ]
    }
  ];
  
  const response = await fetch(model.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${model.key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model.modelName,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 4096
    })
  });
  
  const data = await response.json();
  const content = data.choices[0].message.content;
  const parsed = JSON.parse(content);
  
  // Validate and normalize the extracted data
  const rows = normalizeExtractedData(parsed, docType);
  const confidence = calculateAIConfidence(parsed, docType);
  
  return {
    rows,
    metadata: {
      documentType: docType,
      confidence,
      extractionMethod: 'vision-ai',
      pagesProcessed: images.length,
      tablesDetected: 1
    }
  };
}
```

### Phase 6: Enhanced Post-Processing

**Enhance `services/reconciliationService.ts`:**

```typescript
export function reconcileRows(
  rows: any[],
  openingBalanceStr: string,
  docType: DocumentType
): ReconciledRow[] {
  if (docType === 'bank-statement') {
    return reconcileBankStatement(rows, openingBalanceStr);
  } else if (docType === 'invoice') {
    return reconcileInvoice(rows);
  } else if (docType === 'financial-report') {
    return reconcileFinancialReport(rows);
  } else {
    return reconcileGeneric(rows);
  }
}

function reconcileBankStatement(rows: any[], openingBalanceStr: string): ReconciledRow[] {
  let runningBalance = parseMoney(openingBalanceStr);
  
  return rows.map(row => {
    const debit = parseMoney(row.Debit || row.Debits || 0);
    const credit = parseMoney(row.Credit || row.Credits || 0);
    const statedBalance = parseMoney(row.Balance || 0);
    
    const expectedBalance = runningBalance + credit - debit;
    const isReconciled = Math.abs(expectedBalance - statedBalance) < 0.02;
    
    const reconciled: ReconciledRow = {
      ...row,
      Amount: credit - debit,
      _math_reconciled: isReconciled,
      Direction: credit > debit ? 'In' : 'Out'
    };
    
    runningBalance = statedBalance;
    return reconciled;
  });
}

function reconcileInvoice(rows: any[]): ReconciledRow[] {
  // Validate that line item totals match
  return rows.map(row => {
    const quantity = parseFloat(row.Quantity || 0);
    const unitPrice = parseFloat(row.UnitPrice || row.Price || 0);
    const statedTotal = parseFloat(row.Total || row.Amount || 0);
    const calculatedTotal = quantity * unitPrice;
    
    const isReconciled = Math.abs(calculatedTotal - statedTotal) < 0.02;
    
    return {
      ...row,
      Amount: statedTotal,
      _math_reconciled: isReconciled,
      _calculated_total: calculatedTotal
    };
  });
}
```

### Phase 7: Confidence Scoring & Error Recovery

**Create `services/confidenceScoring.ts`:**

```typescript
export interface ConfidenceMetrics {
  overall: number;
  textExtraction: number;
  tableDetection: number;
  dataValidation: number;
  reconciliation: number;
}

export function calculateConfidence(result: ExtractionResult): ConfidenceMetrics {
  const metrics: ConfidenceMetrics = {
    overall: 0,
    textExtraction: 0,
    tableDetection: 0,
    dataValidation: 0,
    reconciliation: 0
  };
  
  // Text extraction confidence
  if (result.rawText) {
    const textLength = result.rawText.length;
    metrics.textExtraction = Math.min(1, textLength / 1000);
  }
  
  // Table detection confidence
  if (result.tables && result.tables.length > 0) {
    const avgTableConfidence = result.tables.reduce((sum, t) => sum + t.confidence, 0) / result.tables.length;
    metrics.tableDetection = avgTableConfidence;
  }
  
  // Data validation confidence
  if (result.rows && result.rows.length > 0) {
    const validRows = result.rows.filter(row => {
      // Check if row has required fields for document type
      return validateRowForDocumentType(row, result.metadata.documentType);
    });
    metrics.dataValidation = validRows.length / result.rows.length;
  }
  
  // Reconciliation confidence
  if (result.rows && result.rows.length > 0) {
    const reconciledRows = result.rows.filter((row: any) => row._math_reconciled);
    metrics.reconciliation = reconciledRows.length / result.rows.length;
  }
  
  // Overall confidence is weighted average
  metrics.overall = (
    metrics.textExtraction * 0.2 +
    metrics.tableDetection * 0.3 +
    metrics.dataValidation * 0.3 +
    metrics.reconciliation * 0.2
  );
  
  return metrics;
}
```

### Phase 8: Integration & Testing

**Update `services/documentService.ts`:**

```typescript
export async function processDocumentExcel(
  file: File,
  options: any
): Promise<ExtractionResult> {
  console.log('[DocumentService] Starting extraction pipeline...');
  
  // Phase 1: Detect document type
  const docType = await detectDocumentType(file);
  console.log(`[DocumentService] Detected document type: ${docType}`);
  
  // Phase 2: Run extraction pipeline
  const result = await extractDocument(file, { ...options, docType });
  console.log(`[DocumentService] Extraction complete. Confidence: ${result.metadata.confidence}`);
  
  // Phase 3: Post-processing based on document type
  const reconciled = reconcileRows(result.rows, options.openingBalance || '0', docType);
  
  // Phase 4: Validation
  const health = validateExtraction(reconciled, docType);
  
  // Phase 5: If confidence is too low, warn user
  if (result.metadata.confidence < 0.6) {
    console.warn('[DocumentService] Low confidence extraction. Results may be inaccurate.');
  }
  
  return {
    rows: reconciled,
    metadata: {
      ...result.metadata,
      ledgerHealth: health,
      confidenceMetrics: calculateConfidence(result)
    }
  };
}
```

---

## 🧪 TESTING STRATEGY

### Unit Tests:
1. **Document Type Detection** - Test with sample documents of each type
2. **Text Layer Extraction** - Test with PDFs containing text layers
3. **OCR Extraction** - Test with scanned PDFs
4. **AI Extraction** - Test with complex layouts
5. **Reconciliation** - Test mathematical validation
6. **Confidence Scoring** - Test scoring accuracy

### Integration Tests:
1. **End-to-End Pipeline** - Test full extraction flow
2. **Fallback Chain** - Test strategy fallback when primary fails
3. **Multi-Page Documents** - Test table continuation across pages
4. **Error Recovery** - Test graceful degradation

### Test Documents:
Create a test suite with:
- 5 bank statements (different banks)
- 5 invoices (different formats)
- 5 financial reports (P&L, balance sheet, cash flow)
- 5 receipts (POS, online, handwritten)
- 5 data collection forms
- 5 tax documents
- 5 contracts with payment schedules
- 5 inventory lists

---

## 📦 DEPENDENCIES TO ADD

```bash
npm install tesseract.js
npm install pdf-parse
npm install camelot-js  # For advanced table detection
npm install sharp       # For image preprocessing
```

---

## 🎯 SUCCESS CRITERIA

The enhanced system must:
1. ✅ Achieve >80% accuracy on all document types
2. ✅ Handle scanned documents via OCR
3. ✅ Detect document type with >90% accuracy
4. ✅ Provide confidence scores for all extractions
5. ✅ Gracefully degrade when extraction fails
6. ✅ Support multi-page table continuation
7. ✅ Validate extracted data mathematically
8. ✅ Generate clean XLSX output with proper formatting

---

## 🚀 EXECUTION ORDER

1. **Phase 1**: Create `extractionPipeline.ts` with multi-strategy orchestration
2. **Phase 2**: Implement `documentTypeDetector.ts`
3. **Phase 3**: Enhance `deterministicExtractService.ts` with table detection
4. **Phase 4**: Create `ocrService.ts` with Tesseract.js
5. **Phase 5**: Enhance `geminiService.ts` (rename to `aiExtractionService.ts`)
6. **Phase 6**: Enhance `reconciliationService.ts` with document-type-specific logic
7. **Phase 7**: Create `confidenceScoring.ts`
8. **Phase 8**: Integrate all components in `documentService.ts`
9. **Phase 9**: Write comprehensive tests
10. **Phase 10**: Deploy and monitor

---

**EXECUTE NOW.** Start with Phase 1 and work sequentially through all phases. Verify each phase before proceeding to the next. Report progress after each phase completion.