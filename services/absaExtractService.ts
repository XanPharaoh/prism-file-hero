import { pdfjsLib } from './pdfjsClient';
import { moneyToNumber } from '../shared/finance/locale';

/**
 * ABSA Bank South Africa Statement Extractor
 * 
 * Layout & Characteristics:
 * - Date format: DD/MM/YYYY (e.g. "15/06/2026", "23/06/2026")
 * - Columns: Date | Narrative / Description | Charges | Debit | Credit | Balance
 * - Multi-line transaction narratives: continuations follow transaction rows
 * - Charge indicators: Fee markers (e.g. "A" / "T" / fee columns)
 * - Metadata: Account number, branch code, statement period, opening/closing balance
 */

export interface AbsaTransaction {
  Date: string; // ISO 'YYYY-MM-DD' or formatted
  Description: string;
  Charge: number | null;
  Debit: number | null;
  Credit: number | null;
  Amount: number | null;
  Balance: number | null;
  Direction: 'DEBIT' | 'CREDIT' | 'FEE' | 'UNKNOWN';
  Confidence?: number;
  _raw?: string;
  _page?: number;
}

export interface AbsaMetadata {
  bankCode: 'ABSA_SA';
  bankName: string;
  accountNumber: string | null;
  branchCode: string | null;
  statementPeriod: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  pagesProcessed: number;
  rowCount: number;
  reconciles: boolean;
  parseErrors: number;
  method: string;
}

export interface AbsaExtractResult {
  transactions: AbsaTransaction[];
  openingBalance: number | null;
  closingBalance: number | null;
  rows: Record<string, any>[];
  metadata: AbsaMetadata;
}

const ABSA_DATE_RE = /^(\d{1,2}\/\d{2}\/\d{4})\s+(.+)$/;
const ABSA_ALT_DATE_RE = /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(.+)$/;

const ABSA_NOISE_RE = /\s*(?:eStamp|General Enquiries|Return address:.*?|Our Privacy Notice[^.]*\.|CSP\d+\S+|DGROCER\d+|\d{6,}\s+\d{4}\s+\d{2}\/\d{2}\/\d{4}\s*|\(Effective\s+\d{2}\/\d{2}\/\d{4}\)|YOUR PRICING PLAN[^.]*|CREDIT INTEREST RATE[^.]*|\*\s*=\s*VAT[^.]*(?:INCLUDED)?|CHARGE:\s+[A-Z][^.]*|Absa Bank Ltd[^.]*|Private Bag[^.]*|Cheque Account Number[^.]*|Authorised Financial[^.]*)\s*/gi;

const NOISE_LINE_PATTERNS = [
  /^(?:date|cheque account|your transactions|page \d|absa bank|authorised|registration|tax invoice|effective|estamp|general enquiries|return address|your pricing|credit interest|vat r|charge:|our privacy|private|oxford house|sedghill|ottery|cape town|p o box|daily grocer)/i,
  /^\(effective\b/i,
  /^[\d\s.,-]+$/,
  /^total\s+(?:debits|credits|charges)/i,
  /^statement\s+(?:period|date|number)/i,
];

function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 2) return true;
  return NOISE_LINE_PATTERNS.some((p) => p.test(trimmed));
}

function cleanDescription(desc: string): string {
  return desc.replace(ABSA_NOISE_RE, ' ').replace(/\s+/g, ' ').trim();
}

function extractMoneyTokens(text: string): number[] {
  return [...text.matchAll(/\d[\d ]*\.\d{2}/g)]
    .map((m) => moneyToNumber(m[0].replace(/ /g, ''), { locale: 'en-ZA' }))
    .filter((v): v is number => v !== null);
}

function extractMetadataFromText(text: string): {
  accountNumber: string | null;
  branchCode: string | null;
  statementPeriod: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
} {
  let accountNumber: string | null = null;
  let branchCode: string | null = null;
  let statementPeriod: string | null = null;
  let openingBalance: number | null = null;
  let closingBalance: number | null = null;

  const accMatch = text.match(/(?:cheque\s+account\s+number|account\s*(?:number|no\.?))[:\s]+([0-9\s-]{6,20})/i);
  if (accMatch) accountNumber = accMatch[1].replace(/[\s-]/g, '');

  const branchMatch = text.match(/branch\s*(?:code)?[:\s]+(\d{4,8})/i);
  if (branchMatch) branchCode = branchMatch[1].trim();

  const periodMatch = text.match(/(?:period|statement\s+from)[:\s]+(\d{1,2}\/\d{2}\/\d{4}(?:\s+to\s+\d{1,2}\/\d{2}\/\d{4})?)/i);
  if (periodMatch) statementPeriod = periodMatch[1].trim();

  const openMatch = text.match(/(?:bal\s+brought\s+forward|opening\s+balance)[:\s]*R?\s*([\d\s]+\.\d{2})/i);
  if (openMatch) openingBalance = moneyToNumber(openMatch[1].replace(/\s/g, ''), { locale: 'en-ZA' });

  const closeMatch = text.match(/(?:closing\s+balance)[:\s]*R?\s*([\d\s]+\.\d{2})/i);
  if (closeMatch) closingBalance = moneyToNumber(closeMatch[1].replace(/\s/g, ''), { locale: 'en-ZA' });

  return {
    accountNumber,
    branchCode,
    statementPeriod,
    openingBalance,
    closingBalance,
  };
}

/**
 * Extract ABSA statement transactions from raw text.
 */
export function extractAbsaStatementFromText(
  fullText: string,
  pageCount = 1
): AbsaExtractResult {
  const meta = extractMetadataFromText(fullText);
  const lines = fullText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const transactions: AbsaTransaction[] = [];
  let pending: AbsaTransaction | null = null;
  let openingBalance: number | null = meta.openingBalance;
  let previousBalance: number | null = openingBalance;

  for (const line of lines) {
    const match = line.match(ABSA_DATE_RE) || line.match(ABSA_ALT_DATE_RE);
    if (match) {
      const values = extractMoneyTokens(line);
      if (!values.length) continue;

      const [, dateStr, description] = match;
      const balance = values.at(-1)!;

      if (/^bal brought forward/i.test(description)) {
        if (openingBalance === null) {
          openingBalance = balance;
        }
        previousBalance = balance;
        pending = null;
        continue;
      }

      const delta = previousBalance === null ? 0 : Number((balance - previousBalance).toFixed(2));
      const charge = values.length >= 3
        ? values[values.length - 3]
        : (values.length === 2 && /\b[AT]\b/.test(line) && Math.abs(Math.abs(delta) - values[0]) <= 0.05 ? values[0] : null);
      const amount = Math.abs(delta);
      const direction: AbsaTransaction['Direction'] = delta < 0 ? 'DEBIT' : 'CREDIT';

      // Convert DD/MM/YYYY to YYYY-MM-DD
      const dateParts = dateStr.split(/[\/\-]/);
      const isoDate = dateParts.length === 3 && dateParts[2].length === 4
        ? `${dateParts[2]}-${dateParts[1].padStart(2, '0')}-${dateParts[0].padStart(2, '0')}`
        : dateStr;

      pending = {
        Date: isoDate,
        Description: description.replace(/\d[\d ]*\.\d{2}/g, '').replace(/\b[AT]\b/g, '').trim(),
        Charge: charge,
        Debit: delta < 0 ? amount : null,
        Credit: delta > 0 ? amount : null,
        Amount: amount,
        Balance: balance,
        Direction: direction,
        Confidence: 0.9,
        _raw: line,
        _page: 1,
      };
      transactions.push(pending);
      previousBalance = balance;
    } else if (pending && !isNoiseLine(line)) {
      pending.Description = `${pending.Description} ${line}`.trim();
    }
  }

  // Clean descriptions from known noise phrases
  for (const tx of transactions) {
    tx.Description = cleanDescription(tx.Description);
  }

  const rows = convertAbsaToExcelRows(transactions);
  const openBal = openingBalance ?? meta.openingBalance;
  const closeBal = previousBalance ?? meta.closingBalance;
  const totalCredits = transactions.reduce((sum, t) => sum + (t.Credit ?? 0), 0);
  const totalDebits = transactions.reduce((sum, t) => sum + (t.Debit ?? 0), 0);
  const reconciles = openBal !== null && closeBal !== null
    ? Math.abs(openBal + totalCredits - totalDebits - closeBal) <= 0.05
    : true;

  return {
    transactions,
    openingBalance: openBal,
    closingBalance: closeBal,
    rows,
    metadata: {
      bankCode: 'ABSA_SA',
      bankName: 'ABSA South Africa',
      accountNumber: meta.accountNumber,
      branchCode: meta.branchCode,
      statementPeriod: meta.statementPeriod,
      openingBalance: openBal,
      closingBalance: closeBal,
      pagesProcessed: pageCount,
      rowCount: transactions.length,
      reconciles,
      parseErrors: 0,
      method: 'absa-native-extraction',
    },
  };
}

/**
 * Extract ABSA statement from PDF File or ArrayBuffer.
 */
export async function extractAbsaStatement(
  file: File | ArrayBuffer | Uint8Array,
  options?: any
): Promise<AbsaExtractResult> {
  const bytes = file instanceof Uint8Array
    ? file
    : file instanceof ArrayBuffer
    ? new Uint8Array(file)
    : new Uint8Array(await file.arrayBuffer());

  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pageCount = pdf.numPages;

  const transactions: AbsaTransaction[] = [];
  let pending: AbsaTransaction | null = null;
  let openingBalance: number | null = null;
  let previousBalance: number | null = null;
  let extractedTextParts: string[] = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items as any[];

    // Group items into lines by Y position (3px tolerance snap)
    const linesMap = new Map<number, any[]>();
    for (const item of items) {
      if (item.str?.trim()) {
        const y = Math.round(item.transform[5] / 3) * 3;
        linesMap.set(y, [...(linesMap.get(y) ?? []), item]);
      }
    }

    // Sort lines top-to-bottom, items left-to-right
    const sortedLines = [...linesMap.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, lineItems]) =>
        lineItems
          .sort((a, b) => a.transform[4] - b.transform[4])
          .map((item) => item.str.trim())
          .join(' ')
      );

    extractedTextParts.push(...sortedLines);

    for (const line of sortedLines) {
      const match = line.match(ABSA_DATE_RE) || line.match(ABSA_ALT_DATE_RE);
      if (match) {
        const values = extractMoneyTokens(line);
        if (!values.length) continue;

        const [, dateStr, description] = match;
        const balance = values.at(-1)!;

        if (/^bal brought forward/i.test(description)) {
          if (openingBalance === null) {
            openingBalance = balance;
          }
          previousBalance = balance;
          pending = null;
          continue;
        }

        const delta = previousBalance === null ? 0 : Number((balance - previousBalance).toFixed(2));
        const charge = values.length >= 3
          ? values[values.length - 3]
          : (values.length === 2 && /\b[AT]\b/.test(line) && Math.abs(Math.abs(delta) - values[0]) <= 0.05 ? values[0] : null);
        const amount = Math.abs(delta);
        const direction: AbsaTransaction['Direction'] = delta < 0 ? 'DEBIT' : 'CREDIT';

        // Convert DD/MM/YYYY to YYYY-MM-DD
        const dateParts = dateStr.split(/[\/\-]/);
        const isoDate = dateParts.length === 3 && dateParts[2].length === 4
          ? `${dateParts[2]}-${dateParts[1].padStart(2, '0')}-${dateParts[0].padStart(2, '0')}`
          : dateStr;

        pending = {
          Date: isoDate,
          Description: description.replace(/\d[\d ]*\.\d{2}/g, '').replace(/\b[AT]\b/g, '').trim(),
          Charge: charge,
          Debit: delta < 0 ? amount : null,
          Credit: delta > 0 ? amount : null,
          Amount: amount,
          Balance: balance,
          Direction: direction,
          Confidence: 0.9,
          _raw: line,
          _page: pageNumber,
        };
        transactions.push(pending);
        previousBalance = balance;
      } else if (pending && !isNoiseLine(line)) {
        pending.Description = `${pending.Description} ${line}`.trim();
      }
    }
  }

  // Clean descriptions from noise phrases
  for (const tx of transactions) {
    tx.Description = cleanDescription(tx.Description);
  }

  const fullText = extractedTextParts.join('\n');
  const meta = extractMetadataFromText(fullText);
  const rows = convertAbsaToExcelRows(transactions);
  const openBal = openingBalance ?? meta.openingBalance;
  const closeBal = previousBalance ?? meta.closingBalance;
  const totalCredits = transactions.reduce((sum, t) => sum + (t.Credit ?? 0), 0);
  const totalDebits = transactions.reduce((sum, t) => sum + (t.Debit ?? 0), 0);
  const reconciles = openBal !== null && closeBal !== null
    ? Math.abs(openBal + totalCredits - totalDebits - closeBal) <= 0.05
    : true;

  return {
    transactions,
    openingBalance: openBal,
    closingBalance: closeBal,
    rows,
    metadata: {
      bankCode: 'ABSA_SA',
      bankName: 'ABSA South Africa',
      accountNumber: meta.accountNumber,
      branchCode: meta.branchCode,
      statementPeriod: meta.statementPeriod,
      openingBalance: openBal,
      closingBalance: closeBal,
      pagesProcessed: pageCount,
      rowCount: transactions.length,
      reconciles,
      parseErrors: 0,
      method: 'absa-native-extraction',
    },
  };
}

/**
 * Convert ABSA transactions to Excel rows
 */
export function convertAbsaToExcelRows(
  transactions: AbsaTransaction[]
): Record<string, any>[] {
  return transactions.map((tx) => ({
    Date: tx.Date,
    Description: tx.Description,
    Charge: tx.Charge,
    Debit: tx.Debit,
    Credit: tx.Credit,
    Balance: tx.Balance,
    Direction: tx.Direction,
  }));
}

/**
 * Detect if a PDF or text is from ABSA
 */
export async function isAbsaStatement(file: File | string): Promise<boolean> {
  try {
    if (typeof file === 'string') {
      return /\babsa\b|barclays/i.test(file);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map((i: any) => i.str).join(' ').toLowerCase();
    return text.includes('absa') || text.includes('barclays');
  } catch {
    return false;
  }
}
