/**
 * Docling PDF Extraction Service Client
 * 
 * Connects to the Python Docling extraction backend for superior PDF parsing.
 * Docling provides advanced table structure extraction, OCR, and layout understanding.
 */

import { CanonicalTransaction } from '../types';
import { parseDateToISO } from './dateParser';
import { parseAmount } from './currencyParser';

const DOCLING_SERVICE_URL = import.meta.env.VITE_DOCLING_URL || 'https://xanpharaoh-prismfilehero-docling.hf.space';

export interface DoclingTable {
  table_index: number;
  page_number: number;
  headers: string[];
  rows: string[][];
  row_count: number;
  column_count: number;
  confidence: number;
}

export interface DoclingExtractionResponse {
  success: boolean;
  metadata: {
    title: string;
    author: string | null;
    page_count: number;
    file_size_bytes: number;
    processing_time_ms: number;
  };
  pages: any[];
  full_text: string;
  tables: DoclingTable[];
  overall_confidence: number;
  error: string | null;
}

export async function extractWithDocling(file: File): Promise<{
  transactions: CanonicalTransaction[];
  tables: DoclingTable[];
  fullText: string;
  confidence: number;
  pageCount: number;
  source: string;
} | null> {
  try {
    const formData = new FormData();
    formData.append('file', file, file.name);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(`${DOCLING_SERVICE_URL}/extract`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`Docling service returned ${response.status}`);
      return null;
    }

    const data: DoclingExtractionResponse = await response.json();

    if (!data.success) {
      console.warn('Docling extraction failed:', data.error);
      return null;
    }

    const transactions = convertDoclingToTransactions(data);

    return {
      transactions,
      tables: data.tables,
      fullText: data.full_text,
      confidence: data.overall_confidence,
      pageCount: data.metadata.page_count,
      source: 'docling-extraction',
    };

  } catch (error: any) {
    console.warn('Docling service unavailable:', error.message);
    return null;
  }
}

export async function isDoclingServiceAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${DOCLING_SERVICE_URL}/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    if (!response.ok) return false;

    const data = await response.json();
    return data.status === 'healthy';

  } catch {
    return false;
  }
}

function convertDoclingToTransactions(data: DoclingExtractionResponse): CanonicalTransaction[] {
  const transactions: CanonicalTransaction[] = [];

  for (const table of data.tables) {
    if (table.row_count === 0) continue;

    const columnMapping = detectColumnMapping(table.headers);

    for (const row of table.rows) {
      if (row.length === 0) continue;

      const transaction = mapRowToTransaction(row, columnMapping, table.page_number);
      if (transaction) {
        transactions.push(transaction);
      }
    }
  }

  if (transactions.length === 0 && data.full_text) {
    const textTransactions = parseFullTextForTransactions(data.full_text);
    transactions.push(...textTransactions);
  }

  return transactions;
}

function detectColumnMapping(headers: string[]): Record<string, number> {
  const mapping: Record<string, number> = {};

  headers.forEach((header, index) => {
    const lower = header.toLowerCase().trim();

    if (lower.includes('date') || lower.includes('datum') || lower === 'posted' || lower === 'value date') {
      if (!mapping.date) mapping.date = index;
    }
    if (lower.includes('description') || lower.includes('memo') || lower.includes('particular') || 
        lower.includes('narration') || lower.includes('details') || lower.includes('reference')) {
      if (!mapping.description) mapping.description = index;
    }
    if (lower.includes('debit') || lower.includes('withdrawal') || lower.includes('dr') || 
        lower.includes('paid') || lower.includes('out') || lower === 'amount') {
      if (!mapping.debit) mapping.debit = index;
    }
    if (lower.includes('credit') || lower.includes('deposit') || lower.includes('cr') || 
        lower.includes('received') || lower.includes('in')) {
      if (!mapping.credit) mapping.credit = index;
    }
    if (lower.includes('balance') || lower.includes('bal') || lower.includes('running')) {
      if (!mapping.balance) mapping.balance = index;
    }
    if (lower.includes('fee') || lower.includes('charge') || lower.includes('cost')) {
      if (!mapping.fees) mapping.fees = index;
    }
  });

  return mapping;
}

function mapRowToTransaction(
  row: string[], 
  mapping: Record<string, number>, 
  pageNumber: number
): CanonicalTransaction | null {
  const dateStr = mapping.date !== undefined ? row[mapping.date] : '';
  const description = mapping.description !== undefined ? row[mapping.description] : '';
  const debitStr = mapping.debit !== undefined ? row[mapping.debit] : '';
  const creditStr = mapping.credit !== undefined ? row[mapping.credit] : '';
  const balanceStr = mapping.balance !== undefined ? row[mapping.balance] : '';
  const feesStr = mapping.fees !== undefined ? row[mapping.fees] : '';

  const dateISO = parseDateToISO(dateStr);
  if (!dateISO) return null;

  const debit = debitStr ? parseAmount(debitStr) : null;
  const credit = creditStr ? parseAmount(creditStr) : null;
  const balance = balanceStr ? parseAmount(balanceStr) : null;
  const fees = feesStr ? parseAmount(feesStr) : null;

  let amount = 0;
  let direction: 'DEBIT' | 'CREDIT' = 'DEBIT';

  if (debit && debit.value !== null) {
    amount = -Math.abs(debit.value);
    direction = 'DEBIT';
  } else if (credit && credit.value !== null) {
    amount = Math.abs(credit.value);
    direction = 'CREDIT';
  }

  let confidence = 100;
  if (!dateISO) confidence -= 20;
  if (!description.trim()) confidence -= 10;
  if (!debit && !credit) confidence -= 30;
  if (!balance) confidence -= 10;

  return {
    date: dateISO,
    description: description.trim() || 'Unknown transaction',
    amount,
    balance: balance?.value ?? null,
    direction,
    bankCode: 'DOCLING',
    confidence: Math.max(0, confidence),
    charges: fees?.value ?? 0,
    raw: row.join(' | '),
    source: 'docling',
  };
}

function parseFullTextForTransactions(text: string): CanonicalTransaction[] {
  const transactions: CanonicalTransaction[] = [];
  const lines = text.split('\n').filter(line => line.trim().length > 0);

  const patterns = [
    /(\d{4}-\d{2}-\d{2})\s+(.+?)\s+([R$€£]?\s*[\d,]+\.?\d*)\s+([R$€£]?\s*[\d,]+\.?\d*)/,
    /(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([R$€£]?\s*[\d,]+\.?\d*)\s+([R$€£]?\s*[\d,]+\.?\d*)/,
    /(\d{1,2}\s+[A-Z][a-z]{2})\s+(.+?)\s+([R$€£]?\s*[\d,]+\.?\d*)\s+([R$€£]?\s*[\d,]+\.?\d*)/,
  ];

  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        const [, dateStr, description, amountStr, balanceStr] = match;
        
        const dateISO = parseDateToISO(dateStr);
        if (!dateISO) continue;

        const amount = parseAmount(amountStr);
        const balance = parseAmount(balanceStr);

        transactions.push({
          date: dateISO,
          description: description.trim(),
          amount: amount?.value ?? 0,
          balance: balance?.value ?? null,
          direction: 'DEBIT',
          bankCode: 'DOCLING',
          confidence: 70,
          source: 'docling-text',
          raw: line,
        });

        break;
      }
    }
  }

  return transactions;
}
