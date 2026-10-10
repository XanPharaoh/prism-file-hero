import { pdfjsLib } from './pdfjsClient';
import { moneyToNumber } from '../shared/finance/locale';

/**
 * Standard Bank South Africa Statement Extractor
 * 
 * Layout & Characteristics:
 * - Date format: DD Mon YYYY (e.g. "07 May 2026", "23 Apr 2026") or DD/MM/YYYY
 * - Columns: Date | Description (narrative) | Payments/Debits | Deposits/Credits | Balance
 * - Multi-line transaction narratives: continuations follow transaction rows
 * - Metadata: Account number, branch name/code, statement period, opening & closing balances
 */

export interface StandardBankTransaction {
  Date: string;
  Description: string;
  Debit: number | null;
  Credit: number | null;
  Amount?: number | null;
  Balance: number | null;
  BankFee?: number | null;
  Direction: 'DEBIT' | 'CREDIT' | 'UNKNOWN';
  Confidence?: number;
  _raw?: string;
  _page?: number;
}

export interface StandardBankMetadata {
  bankCode: 'STANDARD_BANK_SA';
  bankName: string;
  accountNumber: string | null;
  branchCode: string | null;
  branchName: string | null;
  statementPeriod: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  pagesProcessed: number;
  rowCount: number;
  reconciles: boolean;
  parseErrors: number;
  method: string;
}

export interface StandardBankExtractResult {
  transactions: StandardBankTransaction[];
  openingBalance: number | null;
  closingBalance: number | null;
  rows: Record<string, any>[];
  metadata: StandardBankMetadata;
}

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04',
  may: '05', jun: '06', jul: '07', aug: '08',
  sep: '09', oct: '10', nov: '11', dec: '12',
};

const SBSA_DATE_RE = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2,4})\s+(.+)$/i;
const SBSA_NUMERIC_DATE_RE = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\s+(.+)$/;

const NOISE_PATTERNS = [
  /^standard\s+bank/i,
  /^sbsa/i,
  /^tax\s+invoice/i,
  /^vat\s+reg/i,
  /^customer\s+care/i,
  /^lost\s+or\s+stolen/i,
  /^statement\s+number/i,
  /^statement\s+frequency/i,
  /^statement\s+opening\s+balance/i,
  /^statement\s+closing\s+balance/i,
  /^opening\s+balance/i,
  /^closing\s+balance/i,
  /^available\s+balance/i,
  /^total\s+payments/i,
  /^total\s+deposits/i,
  /^total\s+charges/i,
  /^total\s+debits/i,
  /^total\s+credits/i,
  /^page\s+\d+/i,
  /^pg\s+\d+/i,
  /^from\s*:\s*\d+/i,
  /^to\s*:\s*\d+/i,
  /^transaction\s+details/i,
  /^date\s+description/i,
  /^payments\s+deposits\s+balance/i,
  /^standard\s+bank\s+is\s+a\s+licensed/i,
  /^authorised\s+financial\s+services/i,
  /^registered\s+credit\s+provider/i,
  /^please\s+verify/i,
  /^statement\s+summary/i,
  /^payments\s+-?r/i,
  /^deposits\s+r/i,
  /^today'?s\s+debits/i,
  /^the\s+standard\s+bank/i,
  /^we\s+subscribe/i,
  /ombudsman/i,
  /code\s+of\s+banking/i,
  /authorised\s+financial\s+service\s+provider/i,
  /vat\s+reg\s+no/i,
];

function isNoiseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 2) return true;
  if (NOISE_PATTERNS.some((p) => p.test(trimmed))) return true;
  if (/please verify all transactions|statement summary|today's debits have not yet been paid|ombudsman for banking services/i.test(trimmed)) {
    return true;
  }
  return false;
}

export function cleanStandardBankDescription(desc: string): string {
  return desc
    .replace(/Please verify all transactions reflected on this statement[\s\S]*/i, '')
    .replace(/Statement Summary[\s\S]*/i, '')
    .replace(/Today's debits have not yet been paid[\s\S]*/i, '')
    .replace(/The Standard Bank of South Africa Limited[\s\S]*/i, '')
    .replace(/Pg \d+ of \d+[\s\S]*/i, '')
    .replace(/We subscribe to the Code of Banking Association[\s\S]*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseStandardBankDate(dayStr: string, monthStr: string, yearStr: string): string {
  const day = dayStr.padStart(2, '0');
  const month = MONTH_MAP[monthStr.toLowerCase()] || '01';
  const year = yearStr.length === 2 ? `20${yearStr}` : yearStr;
  return `${year}-${month}-${day}`;
}

export function parseStandardBankMoney(str: string | null | undefined): number | null {
  if (!str) return null;
  const clean = str.replace(/[R\s,]/gi, '');
  return moneyToNumber(clean, { locale: 'en-ZA', allowForeignCurrency: true });
}

function extractMetadataFromText(text: string): {
  accountNumber: string | null;
  branchCode: string | null;
  branchName: string | null;
  statementPeriod: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
} {
  let accountNumber: string | null = null;
  let branchCode: string | null = null;
  let branchName: string | null = null;
  let statementPeriod: string | null = null;
  let openingBalance: number | null = null;
  let closingBalance: number | null = null;

  const accMatch = text.match(/account\s*(?:number|no\.?)[:\s]+([0-9\s]{6,16})/i);
  if (accMatch) accountNumber = accMatch[1].replace(/\s+/g, '');

  const branchMatch = text.match(/branch\s*(?:code|no\.?)[:\s]+(\d{4,8})/i) || text.match(/branch[:\s]+(\d{4,8})/i);
  if (branchMatch) branchCode = branchMatch[1].trim();

  const branchNameMatch = text.match(/branch\s+name[:\s]+([A-Za-z\s]{3,30})(?:\n|\r|\s{2,}|$)/i) ||
    text.match(/branch[:\s]+(?!(?:code|no|number)\b)([A-Za-z\s]{3,30})(?:\n|\r|\s{2,}|$)/i);
  if (branchNameMatch) {
    const candidate = branchNameMatch[1].trim();
    if (!/^\d+$/.test(candidate) && !/^(?:code|number|no)/i.test(candidate)) {
      branchName = candidate;
    }
  }

  const periodMatch = text.match(/statement\s*(?:period|from)[:\s]+([^.\n\r]+?)(?:\s+to\s+([^.\n\r]+))?(?:\n|\r|$)/i);
  if (periodMatch) statementPeriod = periodMatch[0].trim();

  const openMatch = text.match(/(?:statement\s+opening\s+balance|balance\s+brought\s+forward|opening\s+balance)[:\s]*R?\s*(-?[\d\s,]+\.\d{2})/i);
  if (openMatch) openingBalance = parseStandardBankMoney(openMatch[1]);

  const closeMatch = text.match(/(?:statement\s+closing\s+balance|closing\s+balance)[:\s]*R?\s*(-?[\d\s,]+\.\d{2})/i);
  if (closeMatch) closingBalance = parseStandardBankMoney(closeMatch[1]);

  return {
    accountNumber,
    branchCode,
    branchName,
    statementPeriod,
    openingBalance,
    closingBalance,
  };
}

/**
 * Extract Standard Bank statement transactions from raw text.
 */
export function extractStandardBankStatementFromText(
  fullText: string,
  pageCount = 1
): StandardBankExtractResult {
  const meta = extractMetadataFromText(fullText);
  const lines = fullText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const transactions: StandardBankTransaction[] = [];
  let pending: StandardBankTransaction | null = null;

  for (const line of lines) {
    const textMatch = line.match(SBSA_DATE_RE);
    const numDateMatch = !textMatch ? line.match(SBSA_NUMERIC_DATE_RE) : null;

    if (textMatch || numDateMatch) {
      // Extract numbers matching currency patterns
      const moneyMatches = [...line.matchAll(/-?[\d,]+\.\d{2}/g)].map((v) =>
        Number(v[0].replace(/,/g, ''))
      );

      if (moneyMatches.length >= 2) {
        let isoDate = '';
        let descriptionWithMoney = '';

        if (textMatch) {
          const [, day, month, year, rest] = textMatch;
          isoDate = parseStandardBankDate(day, month, year);
          descriptionWithMoney = rest;
        } else if (numDateMatch) {
          const [, day, mo, yr, rest] = numDateMatch;
          const year = yr.length === 2 ? `20${yr}` : yr;
          isoDate = `${year}-${mo.padStart(2, '0')}-${day.padStart(2, '0')}`;
          descriptionWithMoney = rest;
        }

        const description = descriptionWithMoney.replace(/-?[\d,]+\.\d{2}/g, '').trim();
        const amount = moneyMatches[moneyMatches.length - 2];
        const balance = moneyMatches[moneyMatches.length - 1];

        pending = {
          Date: isoDate,
          Description: description,
          Debit: amount < 0 ? Math.abs(amount) : null,
          Credit: amount >= 0 ? amount : null,
          Amount: amount,
          Balance: balance,
          Direction: amount < 0 ? 'DEBIT' : 'CREDIT',
          Confidence: 0.95,
          _raw: line,
          _page: 1,
        };
        transactions.push(pending);
        continue;
      }
    }

    // Append multi-line narratives to pending transaction if not noise/header
    if (pending && !isNoiseLine(line) && !/^-?[\d,]+\.\d{2}$/.test(line)) {
      pending.Description = `${pending.Description} ${line}`.trim();
    }
  }

  for (const tx of transactions) {
    tx.Description = cleanStandardBankDescription(tx.Description);
  }

  const firstBal = transactions[0]?.Balance ?? null;
  const lastBal = transactions[transactions.length - 1]?.Balance ?? null;
  const openingBalance = meta.openingBalance ?? firstBal;
  const closingBalance = meta.closingBalance ?? lastBal;

  const totalDebits = transactions.reduce((acc, t) => acc + (t.Debit || 0), 0);
  const totalCredits = transactions.reduce((acc, t) => acc + (t.Credit || 0), 0);
  const doesReconcile = openingBalance !== null && closingBalance !== null
    ? Math.abs(openingBalance + totalCredits - totalDebits - closingBalance) <= 0.05
    : true;

  const rows = convertStandardBankToExcelRows(transactions);

  return {
    transactions,
    openingBalance,
    closingBalance,
    rows,
    metadata: {
      bankCode: 'STANDARD_BANK_SA',
      bankName: 'Standard Bank South Africa',
      accountNumber: meta.accountNumber,
      branchCode: meta.branchCode,
      branchName: meta.branchName,
      statementPeriod: meta.statementPeriod,
      openingBalance,
      closingBalance,
      pagesProcessed: pageCount,
      rowCount: transactions.length,
      reconciles: doesReconcile,
      parseErrors: 0,
      method: 'standard-bank-native-extraction',
    },
  };
}

/**
 * Extract Standard Bank statement from PDF File or ArrayBuffer.
 */
export async function extractStandardBankStatement(
  file: File | ArrayBuffer | Uint8Array,
  options?: any
): Promise<StandardBankExtractResult> {
  const bytes = file instanceof Uint8Array
    ? file
    : file instanceof ArrayBuffer
    ? new Uint8Array(file)
    : new Uint8Array(await file.arrayBuffer());

  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pageCount = pdf.numPages;

  const transactions: StandardBankTransaction[] = [];
  let pending: StandardBankTransaction | null = null;
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
      const match = line.match(SBSA_DATE_RE);
      if (match) {
        const money = [...line.matchAll(/-?[\d,]+\.\d{2}/g)].map((value) =>
          Number(value[0].replace(/,/g, ''))
        );
        if (money.length < 2) continue;

        const [, day, month, year, descriptionWithMoney] = match;
        const description = descriptionWithMoney.replace(/-?[\d,]+\.\d{2}/g, '').trim();
        const amount = money[money.length - 2];
        const balance = money[money.length - 1];

        const isoDate = parseStandardBankDate(day, month, year);

        pending = {
          Date: isoDate,
          Description: description,
          Debit: amount < 0 ? Math.abs(amount) : null,
          Credit: amount >= 0 ? amount : null,
          Amount: amount,
          Balance: balance,
          Direction: amount < 0 ? 'DEBIT' : 'CREDIT',
          Confidence: 0.95,
          _raw: line,
          _page: pageNumber,
        };
        transactions.push(pending);
      } else if (
        pending &&
        !isNoiseLine(line) &&
        !/^-?[\d,]+\.\d{2}$/.test(line)
      ) {
        pending.Description = `${pending.Description} ${line}`.trim();
      }
    }
  }

  for (const tx of transactions) {
    tx.Description = cleanStandardBankDescription(tx.Description);
  }

  const fullText = extractedTextParts.join('\n');
  const meta = extractMetadataFromText(fullText);

  const firstBal = transactions[0]?.Balance ?? null;
  const lastBal = transactions[transactions.length - 1]?.Balance ?? null;
  const openingBalance = meta.openingBalance ?? firstBal;
  const closingBalance = meta.closingBalance ?? lastBal;

  const totalDebits = transactions.reduce((acc, t) => acc + (t.Debit || 0), 0);
  const totalCredits = transactions.reduce((acc, t) => acc + (t.Credit || 0), 0);
  const doesReconcile = openingBalance !== null && closingBalance !== null
    ? Math.abs(openingBalance + totalCredits - totalDebits - closingBalance) <= 0.05
    : true;

  const rows = convertStandardBankToExcelRows(transactions);

  return {
    transactions,
    openingBalance,
    closingBalance,
    rows,
    metadata: {
      bankCode: 'STANDARD_BANK_SA',
      bankName: 'Standard Bank South Africa',
      accountNumber: meta.accountNumber,
      branchCode: meta.branchCode,
      branchName: meta.branchName,
      statementPeriod: meta.statementPeriod,
      openingBalance,
      closingBalance,
      pagesProcessed: pageCount,
      rowCount: transactions.length,
      reconciles: doesReconcile,
      parseErrors: 0,
      method: 'standard-bank-native-extraction',
    },
  };
}

/**
 * Convert Standard Bank transactions to normalized Excel row records
 */
export function convertStandardBankToExcelRows(
  transactions: StandardBankTransaction[]
): Record<string, any>[] {
  return transactions.map((tx) => ({
    Date: tx.Date,
    Description: tx.Description,
    Debit: tx.Debit,
    Credit: tx.Credit,
    Balance: tx.Balance,
    Direction: tx.Direction,
    ...(tx.BankFee != null ? { 'Bank Fee': tx.BankFee } : {}),
  }));
}

/**
 * Detect if a PDF or text is from Standard Bank
 */
export async function isStandardBankStatement(file: File | string): Promise<boolean> {
  try {
    if (typeof file === 'string') {
      return /standard\s+bank|\bsbsa\b/i.test(file);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map((i: any) => i.str).join(' ').toLowerCase();
    return text.includes('standard bank') || text.includes('sbsa');
  } catch {
    return false;
  }
}
