/**
 * AI-Powered Vision Extraction Service
 * Uses NVIDIA NIM / Groq models for complex document extraction
 */

import type { DocumentType, ExtractionResult } from './extractionPipeline';
import { getAuthToken } from './authService';
import { isInternalDesktopDistribution } from '../src/config/distribution';
import { getInternalAiHeaders } from './internalDeviceAuth';
import { WORKER_BASE_URL } from './apiConfig';

export interface ImageInput {
  base64: string;
  pageNumber: number;
}

// Match the Worker’s two-page per-tool daily quota.
const MAX_IMAGES_PER_REQUEST = 2;
const VISION_MAX_DIM = 1200;
const VISION_JPEG_QUALITY = 0.7;
const VISION_SKIP_COMPRESS_BELOW = 500000;

/**
 * Check if an image (base64) is blank (>95% white pixels)
 * Used to skip blank pages that pdf.js failed to render properly.
 */
export async function isImageBlank(base64: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = `data:image/jpeg;base64,${base64}`;

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx || img.width === 0 || img.height === 0) {
        resolve(true);
        return;
      }
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const totalPixels = data.length / 4;
      if (totalPixels === 0) {
        resolve(true);
        return;
      }

      let whitePixels = 0;
      const sampleRate = 10;
      let sampledCount = 0;

      for (let i = 0; i < data.length; i += 4 * sampleRate) {
        sampledCount++;
        if (data[i] > 250 && data[i + 1] > 250 && data[i + 2] > 250) {
          whitePixels++;
        }
      }

      resolve(sampledCount > 0 && whitePixels / sampledCount > 0.95);
    };

    img.onerror = () => resolve(true);
  });
}

/**
 * Compress a single Vision AI page image (resize + JPEG) when base64 is large.
 * Exported for unit tests.
 */
export async function compressVisionImage(img: ImageInput): Promise<ImageInput> {
  // If already small enough (~375KB base64 ≈ ~500KB raw), skip compression
  if (img.base64.length < VISION_SKIP_COMPRESS_BELOW) return img;

  return new Promise<ImageInput>((resolve) => {
    const image = new Image();
    image.src = `data:image/jpeg;base64,${img.base64}`;
    image.onload = () => {
      let w = image.width;
      let h = image.height;

      if (w > VISION_MAX_DIM || h > VISION_MAX_DIM) {
        if (w > h) {
          h = Math.round((h / w) * VISION_MAX_DIM);
          w = VISION_MAX_DIM;
        } else {
          w = Math.round((w / h) * VISION_MAX_DIM);
          h = VISION_MAX_DIM;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0, w, h);

      const compressedBase64 = canvas
        .toDataURL('image/jpeg', VISION_JPEG_QUALITY)
        .split(',')[1];
      resolve({ base64: compressedBase64, pageNumber: img.pageNumber });
    };
    image.onerror = () => resolve(img);
  });
}

/**
 * Compress all Vision AI page images before posting to the worker.
 * Exported for unit tests.
 */
export async function compressVisionImages(images: ImageInput[]): Promise<ImageInput[]> {
  const compressedImages = await Promise.all(images.map(compressVisionImage));
  console.log(
    `[VisionAI] Compressed ${images.length} images. Original sizes: ${images.map(i => i.base64.length).join(', ')}. Compressed sizes: ${compressedImages.map(i => i.base64.length).join(', ')}`
  );
  return compressedImages;
}

async function getAiHeaders(): Promise<Record<string, string>> {
  if (isInternalDesktopDistribution) {
    return getInternalAiHeaders();
  }

  const token = await getAuthToken();
  if (!token) {
    throw new Error('Sign in required for premium AI extraction.');
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

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
      throw new Error(
        'No images extracted from PDF. All pages appear to be blank or have unsupported compression.'
      );
    }

    // Compress images to prevent 502 Payload Too Large errors from AI providers
    const compressedImages = await compressVisionImages(images);

    // Filter out blank images before sending to AI
    const nonBlankImages: ImageInput[] = [];
    for (const img of compressedImages) {
      const blank = await isImageBlank(img.base64);
      if (!blank) {
        nonBlankImages.push(img);
      } else {
        console.warn(`[VisionAI] Skipping blank page ${img.pageNumber}`);
      }
    }

    if (nonBlankImages.length === 0) {
      throw new Error(
        'All pages appear to be blank. Vision AI cannot process blank images. Please try a different PDF file.'
      );
    }

    // Get document-type-specific prompt
    const prompt = getExtractionPrompt(docType);

    // Call AI through worker proxy with non-blank images only
    const response = await fetch(`${WORKER_BASE_URL}/api/ai`, {
      method: 'POST',
      headers: await getAiHeaders(),
      body: JSON.stringify({
        toolId: 'pdf-to-excel', // Use pdf-to-excel endpoint for structured extraction
        messages: [
          {
            role: 'system',
            content: prompt,
          },
          {
            role: 'user',
            content: nonBlankImages.slice(0, MAX_IMAGES_PER_REQUEST).map(img => ({
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
      console.error('[VisionAI] Worker returned error:', errData);

      if (response.status === 502) {
        throw new Error(
          'Vision AI service is temporarily unavailable. The PDF may have unsupported compression or the AI service is down. Please try again later or try a different PDF file.'
        );
      }
      if (response.status === 413) {
        throw new Error(
          'PDF file is too large for AI processing. Please try a smaller file or split it into smaller parts.'
        );
      }
      if (response.status === 429) {
        throw new Error(
          'AI service rate limit exceeded. Please wait a moment and try again.'
        );
      }

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
