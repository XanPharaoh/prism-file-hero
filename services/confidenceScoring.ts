/**
 * Confidence Scoring Service
 * Calculates quality metrics for extracted data
 */

import type { ExtractionResult } from './extractionPipeline';

export interface ConfidenceMetrics {
  overall: number;
  textExtraction: number;
  tableDetection: number;
  dataValidation: number;
  reconciliation: number;
}

/**
 * Calculate comprehensive confidence metrics for an extraction result
 */
export function calculateConfidence(result: ExtractionResult): ConfidenceMetrics {
  const metrics: ConfidenceMetrics = {
    overall: 0,
    textExtraction: 0,
    tableDetection: 0,
    dataValidation: 0,
    reconciliation: 0,
  };

  // Text extraction confidence
  if (result.rawText) {
    const textLength = result.rawText.length;
    metrics.textExtraction = Math.min(1, textLength / 1000);
  } else if (result.rows.length > 0) {
    metrics.textExtraction = 0.7; // Good extraction if we have rows without raw text
  }

  // Table detection confidence
  if (result.tables && result.tables.length > 0) {
    const avgTableConfidence = result.tables.reduce((sum, t) => sum + t.confidence, 0) / result.tables.length;
    metrics.tableDetection = avgTableConfidence;
  } else if (result.rows.length > 0) {
    metrics.tableDetection = 0.6; // Assume decent table detection if we have rows
  }

  // Data validation confidence
  if (result.rows && result.rows.length > 0) {
    const validRows = result.rows.filter(row => {
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
  metrics.overall = Math.min(1, (
    metrics.textExtraction * 0.2 +
    metrics.tableDetection * 0.3 +
    metrics.dataValidation * 0.3 +
    metrics.reconciliation * 0.2
  ));

  return metrics;
}

/**
 * Validate a row has required fields for its document type
 */
function validateRowForDocumentType(row: Record<string, unknown>, docType: string): boolean {
  const rowKeys = Object.keys(row).map(k => k.toLowerCase());

  switch (docType) {
    case 'bank-statement':
      return rowKeys.some(k => k.includes('date')) &&
             rowKeys.some(k => k.includes('description') || k.includes('narrative')) &&
             rowKeys.some(k => k.includes('amount') || k.includes('balance'));

    case 'invoice':
      return rowKeys.some(k => k.includes('description')) &&
             rowKeys.some(k => k.includes('quantity') || k.includes('qty')) &&
             rowKeys.some(k => k.includes('price') || k.includes('amount'));

    case 'financial-report':
      return rowKeys.some(k => k.includes('account') || k.includes('category')) &&
             rowKeys.some(k => k.includes('amount'));

    case 'receipt':
      return rowKeys.some(k => k.includes('item') || k.includes('description')) &&
             rowKeys.some(k => k.includes('total') || k.includes('amount'));

    case 'inventory':
      return rowKeys.some(k => k.includes('item') || k.includes('description')) &&
             rowKeys.some(k => k.includes('quantity') || k.includes('qty'));

    case 'tax-document':
      return rowKeys.some(k => k.includes('year') || k.includes('tax'));

    case 'contract':
      return rowKeys.some(k => k.includes('milestone') || k.includes('payment'));

    default:
      // For unknown types, just check if row has some content
      return Object.values(row).some(v =>
        v !== null && v !== undefined && String(v).trim().length > 0
      );
  }
}

/**
 * Get quality rating label based on confidence score
 */
export function getQualityRating(confidence: number): string {
  if (confidence >= 0.9) return 'Excellent';
  if (confidence >= 0.8) return 'Good';
  if (confidence >= 0.7) return 'Fair';
  if (confidence >= 0.6) return 'Acceptable';
  if (confidence >= 0.5) return 'Poor';
  return 'Very Poor';
}

/**
 * Get quality color based on confidence score
 */
export function getQualityColor(confidence: number): string {
  if (confidence >= 0.9) return 'text-green-600';
  if (confidence >= 0.8) return 'text-emerald-600';
  if (confidence >= 0.7) return 'text-amber-600';
  if (confidence >= 0.6) return 'text-yellow-600';
  if (confidence >= 0.5) return 'text-orange-600';
  return 'text-red-600';
}

/**
 * Generate a summary report of extraction quality
 */
export function generateQualityReport(result: ExtractionResult): string {
  const metrics = calculateConfidence(result);

  const lines = [
    `Document Type: ${result.metadata.documentType}`,
    `Extraction Method: ${result.metadata.extractionMethod}`,
    `Overall Confidence: ${(metrics.overall * 100).toFixed(1)}% (${getQualityRating(metrics.overall)})`,
    ``,
    `Detailed Metrics:`,
    `  - Text Extraction: ${(metrics.textExtraction * 100).toFixed(1)}%`,
    `  - Table Detection: ${(metrics.tableDetection * 100).toFixed(1)}%`,
    `  - Data Validation: ${(metrics.dataValidation * 100).toFixed(1)}%`,
    `  - Reconciliation: ${(metrics.reconciliation * 100).toFixed(1)}%`,
    ``,
    `Summary:`,
    `  - Pages Processed: ${result.metadata.pagesProcessed}`,
    `  - Tables Detected: ${result.metadata.tablesDetected}`,
    `  - Rows Extracted: ${result.rows.length}`,
  ];

  return lines.join('\n');
}