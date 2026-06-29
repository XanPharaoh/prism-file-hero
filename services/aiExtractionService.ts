/**
 * AI-Powered Vision Extraction Service
 * Uses NVIDIA NIM / Groq models for complex document extraction
 */

import type { DocumentType, ExtractionResult } from './extractionPipeline';

const WORKER_BASE_URL = (import.meta as any).env?.VITE_WORKER_URL || 'http://localhost:8787';

interface ImageInput {
  base64: string;
  pageNumber: number;
}

const MAX_IMAGES_PER_REQUEST = 3;

/**
 * Extract structured data using Vision AI models
 * Supports document-type-specific prompts for optimal extraction
 */
export async function extractWithVisionAI(
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
      20,
      options.enhanceForOcr || false,
      options.password
    );

    if (images.length === 0) {
      throw new Error('No images extracted from PDF');
    }

    // Get document-type-specific prompt
    const prompt = getExtractionPrompt(docType);

    // Call AI through worker proxy
    const response = await fetch(`${WORKER_BASE_URL}/api/proxy-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolId: 'pdf-to-excel', // Use pdf-to-excel endpoint for structured extraction
        messages: [
          {
            role: 'system',
            content: prompt,
          },
          {
            role: 'user',
            content: images.slice(0, MAX_IMAGES_PER_REQUEST).map(img => ({
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${img.base64}` },
            })),
          },
        ],
        options: { docType },
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(
        (errData as Record<string, unknown>).error as string ||
          `AI API request failed with status ${response.status}`
      );
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || data.data || '';

    // Parse JSON from AI response
    let parsed: Record<string, unknown>;
    try {
      const jsonMatch = typeof text === 'string' ? text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) : null;
      const jsonString = jsonMatch ? jsonMatch[1] : text;
      parsed = JSON.parse(typeof jsonString === 'string' ? jsonString : JSON.stringify(jsonString));
    } catch (e) {
      console.warn('Failed to parse JSON from AI response, returning raw text', e);
      return {
        rows: [{ rawText: typeof text === 'string' ? text : JSON.stringify(text) }],
        metadata: {
          documentType: docType,
          confidence: 0.4,
          extractionMethod: 'vision-ai',
          pagesProcessed: images.length,
          tablesDetected: 0,
        },
      };
    }

    // Normalize extracted data based on document type
    const rows = normalizeExtractedData(parsed, docType);
    const confidence = calculateAIConfidence(parsed, docType);

    return {
      rows,
      metadata: {
        documentType: docType,
        confidence,
        extractionMethod: 'vision-ai',
        pagesProcessed: images.length,
        tablesDetected: 1,
      },
    };
  } catch (error) {
    console.error('Vision AI extraction failed:', error);
    throw error;
  }
}

/**
 * Get document-type-specific extraction prompt
 */
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
    'receipt': `Extract all items from this receipt. Return JSON with structure:
{
  "storeName": "string",
  "date": "YYYY-MM-DD",
  "items": [
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
    'tax-document': `Extract all tax information from this document. Return JSON with structure:
{
  "documentType": "string",
  "taxYear": "string",
  "taxpayerInfo": {
    "name": "string",
    "ssn": "string",
    "address": "string"
  },
  "income": "number",
  "deductions": "number",
  "taxDue": "number"
}`,
    'contract': `Extract payment schedule and key terms from this contract. Return JSON with structure:
{
  "contractType": "string",
  "parties": ["string"],
  "effectiveDate": "YYYY-MM-DD",
  "milestones": [
    {
      "description": "string",
      "dueDate": "YYYY-MM-DD",
      "amount": "number",
      "status": "string"
    }
  ],
  "totalValue": "number"
}`,
    'inventory': `Extract all inventory items from this document. Return JSON with structure:
{
  "items": [
    {
      "sku": "string",
      "description": "string",
      "quantity": "number",
      "unitPrice": "number",
      "totalValue": "number"
    }
  ],
  "totalItems": "number",
  "totalValue": "number"
}`,
    'data-collection': `Extract all form responses from this document. Return JSON with structure:
{
  "formTitle": "string",
  "responses": [
    {
      "field": "string",
      "value": "string"
    }
  ]
}`,
    'unknown': `Extract all structured data from this document. Return JSON with structure:
{
  "title": "string",
  "date": "YYYY-MM-DD",
  "data": [
    {
      "field": "string",
      "value": "string"
    }
  ]
}`,
  };

  return prompts[docType] || prompts['unknown'];
}

/**
 * Normalize extracted data to standard row format
 */
function normalizeExtractedData(parsed: Record<string, unknown>, docType: DocumentType): Record<string, unknown>[] {
  // Handle bank statements
  if (docType === 'bank-statement' && parsed.transactions && Array.isArray(parsed.transactions)) {
    return (parsed.transactions as Record<string, unknown>[]).map((tx: Record<string, unknown>) => ({
      Date: tx.date || '',
      Description: tx.description || '',
      Amount: tx.debit || tx.credit || 0,
      Balance: tx.balance || '',
      Direction: tx.credit && tx.debit ? (Number(tx.credit) > Number(tx.debit) ? 'In' : 'Out') : (tx.credit ? 'In' : 'Out'),
    }));
  }

  // Handle invoices
  if (docType === 'invoice' && parsed.lineItems && Array.isArray(parsed.lineItems)) {
    return (parsed.lineItems as Record<string, unknown>[]).map((item: Record<string, unknown>) => ({
      Description: item.description || '',
      Quantity: item.quantity || 1,
      UnitPrice: item.unitPrice || item.price || 0,
      Total: item.total || item.amount || 0,
      InvoiceNumber: parsed.invoiceNumber || '',
      InvoiceDate: parsed.invoiceDate || '',
      Vendor: parsed.vendor || parsed.customer || '',
    }));
  }

  // Handle generic data
  if (parsed.data && Array.isArray(parsed.data)) {
    const rows: Record<string, unknown>[] = [];
    (parsed.data as Record<string, unknown>[]).forEach(item => {
      if (item.field && item.value !== undefined) {
        rows.push({ Field: item.field, Value: item.value });
      }
    });
    return rows;
  }

  // Fallback: convert top-level object to single row
  return [parsed as Record<string, unknown>];
}

/**
 * Calculate confidence score for AI extraction
 */
function calculateAIConfidence(parsed: Record<string, unknown>, docType: DocumentType): number {
  if (!parsed || typeof parsed !== 'object') return 0;

  let score = 0.5; // Base score for successful AI call

  // Bonus for having expected fields
  const expectedFields: Record<DocumentType, string[]> = {
    'bank-statement': ['transactions', 'openingBalance', 'closingBalance'],
    'invoice': ['lineItems', 'invoiceNumber', 'total'],
    'financial-report': ['lineItems', 'reportType'],
    'receipt': ['items', 'total', 'storeName'],
    'tax-document': ['taxYear', 'taxpayerInfo'],
    'contract': ['milestones', 'totalValue'],
    'inventory': ['items', 'totalItems'],
    'data-collection': ['responses'],
    'unknown': ['data'],
  };

  const required = expectedFields[docType] || [];
  const presentCount = required.filter(field => parsed[field] !== undefined && parsed[field] !== null).length;
  score += (presentCount / required.length) * 0.5;

  return Math.min(1, score);
}