/**
 * Universal Normalization Pipeline
 * 
 * Purpose:
 * - Define canonical transaction schema
 * - Normalize rows from any bank format to canonical format
 * - Provide bank-specific column mapping
 * - Ensure consistent data structure across all banks
 * 
 * Canonical Schema:
 * - date: ISO date string (YYYY-MM-DD)
 * - description: Normalized description
 * - debit: Amount debited (null if no debit)
 * - credit: Amount credited (null if no credit)
 * - balance: Running balance
 * - currency: Currency code (ZAR, USD, etc.)
 * - source: Which column extraction method (text/ocr/ai)
 */

import { parseDate, formatDate } from './dateParser';
import { parseAmount, parseAmountSigned } from './currencyParser';
import { BankPattern, getBankPattern } from './bankRegistry';

export interface CanonicalTransaction {
  date: string; // ISO 8601 (YYYY-MM-DD)
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  currency: string;
  source: 'text' | 'ocr' | 'ai';
  confidence: number; // 0-100
  raw: string; // Original raw line for audit trail
  /** Net transaction amount derived from debit/credit columns. */
  amount?: number | null;
}

export interface NormalizationContext {
  bankCode: string;
  bankPattern: BankPattern;
  extractedColumns: string[]; // Column names from bank
  columnMapping: Record<string, number>; // Map canonical field to column index
}

/**
 * Auto-detect column positions from headers
 * Looks for common bank column names
 */
export function detectColumns(headers: string[]): Record<string, number> {
  const mapping: Record<string, number> = {};

  const headerPatterns = {
    date: ['date', 'transaction date', 'value date', 'posted date', 'valuta', 'datum', 'post date', 'trans date'],
    description: ['description', 'memo', 'particulars', 'reference', 'details', 'narration', 'description text'],
    debit: ['debit', 'debits', 'withdrawal', 'withdrawn', 'dr', 'out', 'money out'],
    credit: ['credit', 'credits', 'deposit', 'deposited', 'cr', 'in', 'money in'],
    fees: ['fees', 'fee', 'charge', 'charges', 'service fee', 'bank fee'],
    balance: ['balance', 'running balance', 'closing balance', 'bal', 'available balance'],
  };

  headers.forEach((header, index) => {
    const lower = header.toLowerCase().trim();

    for (const [field, patterns] of Object.entries(headerPatterns)) {
      for (const p of patterns) {
        // Match whole words to avoid accidental substring matches (eg. 'out' in unexpected places)
        const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('\\b' + esc + '\\b', 'i');
        if (re.test(lower)) {
          if (mapping[field] === undefined) {
            mapping[field] = index;
          }
          break;
        }
      }
    }
  });

  return mapping;
}

/**
 * Extract value from row by field name or column index
 */
export function getFieldValue(
  row: string[],
  fieldName: string,
  mapping: Record<string, number>,
): string {
  const columnIndex = mapping[fieldName];
  if (columnIndex !== undefined && columnIndex >= 0 && columnIndex < row.length) {
    return row[columnIndex];
  }
  return '';
}

/**
 * Normalize a single row to canonical format
 * @param row Array of column values
 * @param context Normalization context with bank and column mapping
 * @returns Normalized transaction or null if invalid
 */
export function normalizeRow(
  row: string[],
  context: NormalizationContext,
): CanonicalTransaction | null {
  // Extract fields from row using mapping
  const dateStr = getFieldValue(row, 'date', context.columnMapping);
  const description = getFieldValue(row, 'description', context.columnMapping);
  const debitStr = getFieldValue(row, 'debit', context.columnMapping);
  const creditStr = getFieldValue(row, 'credit', context.columnMapping);
  const balanceStr = getFieldValue(row, 'balance', context.columnMapping);
  const debitKey = context.columnMapping['debit'] !== undefined;
  const creditKey = context.columnMapping['credit'] !== undefined;

  // Parse date
  const parsed = parseDate(dateStr);
  if (!parsed.date) {
    return null; // Skip rows without valid dates
  }

  // Format date as ISO using dateParser.formatDate to avoid timezone issues
  const dateISO = formatDate(parsed.date) as string;

  // Parse amounts
  const debitParsed = debitStr ? parseAmountSigned(debitStr) : null;
  const creditParsed = creditStr ? parseAmountSigned(creditStr) : null;
  const balanceParsed = balanceStr ? parseAmountSigned(balanceStr) : null;

  const debit = typeof debitParsed === 'number' && Number.isFinite(debitParsed) ? debitParsed : null;
  const credit = typeof creditParsed === 'number' && Number.isFinite(creditParsed) ? creditParsed : null;
  const balance = typeof balanceParsed === 'number' && Number.isFinite(balanceParsed) ? balanceParsed : null;

  // Normalize description
  const normalizedDesc = description.trim().replace(/\s+/g, ' ');

  // Determine confidence based on parsed fields
  let confidence = 100;
  if (!dateStr) confidence -= 20;
  if (!description) confidence -= 10;
  if (!debitStr && !creditStr) confidence -= 30;
  if (!balanceStr) confidence -= 10;

  return {
    date: dateISO,
    description: normalizedDesc,
    // Debit: positive value representing money OUT.
    // If parsed signed value is negative it's a debit; if column header says debit, use absolute value.
    debit: debit !== null ? (debit < 0 ? Math.abs(debit) : (debitKey ? Math.abs(debit) : null)) : null,
    // Credit: positive value representing money IN.
    // Only populate when we have positive signed value or an explicit credit column header.
    credit: credit !== null ? (credit > 0 ? credit : (creditKey ? Math.abs(credit) : null)) : null,
    balance,
    amount: debit !== null ? Math.abs(debit) : credit,
    currency: context.bankPattern.currencySymbol,
    source: 'text', // Will be determined by extraction method
    confidence: Math.max(0, confidence),
    raw: row.join(' | '),
  };
}

/**
 * Normalize multiple rows
 * @param rows Array of row data
 * @param context Normalization context
 * @returns Array of canonical transactions
 */
export function normalizeRows(
  rows: string[][],
  context: NormalizationContext,
): CanonicalTransaction[] {
  return rows
    .map((row) => normalizeRow(row, context))
    .filter((tx) => tx !== null) as CanonicalTransaction[];
}

/**
 * Create normalization context for a bank
 */
export function createNormalizationContext(
  bankCode: string,
  extractedColumns: string[],
): NormalizationContext | null {
  const bankPattern = getBankPattern(bankCode);
  if (!bankPattern) return null;

  const columnMapping = detectColumns(extractedColumns);

  return {
    bankCode,
    bankPattern,
    extractedColumns,
    columnMapping,
  };
}

/**
 * Validate canonical transaction
 */
export function validateTransaction(tx: CanonicalTransaction): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Required fields
  if (!tx.date) errors.push('Missing date');
  if (!tx.description) errors.push('Missing description');
  if (tx.debit === null && tx.credit === null) {
    errors.push('Missing both debit and credit');
  }

  // Data quality checks
  if (tx.confidence < 50) errors.push('Low confidence score');
  if (tx.debit !== null && tx.debit < 0) errors.push('Debit should be positive');
  if (tx.credit !== null && tx.credit < 0) errors.push('Credit should be positive');

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Merge split transactions (handle fragmented rows)
 * @param transactions Array of transactions
 * @returns Merged transactions
 */
export function mergeFragmentedTransactions(
  transactions: CanonicalTransaction[],
): CanonicalTransaction[] {
  if (transactions.length === 0) return [];

  const merged: CanonicalTransaction[] = [];
  let current = transactions[0];

  for (let i = 1; i < transactions.length; i++) {
    const next = transactions[i];

    // Check if this row is a fragment (same date, amount, but different description continuation)
    if (
      current.date === next.date &&
      current.debit === next.debit &&
      current.credit === next.credit &&
      !next.description.match(/^\d/)
    ) {
      // Likely a continuation of description
      current = {
        ...current,
        description: (current.description + ' ' + next.description).trim(),
      };
    } else {
      // Different transaction
      merged.push(current);
      current = next;
    }
  }

  merged.push(current);
  return merged;
}

export default {
  detectColumns,
  getFieldValue,
  normalizeRow,
  normalizeRows,
  createNormalizationContext,
  validateTransaction,
  mergeFragmentedTransactions,
};
