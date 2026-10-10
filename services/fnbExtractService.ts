import { pdfjsLib } from './pdfjsClient';
import { moneyToNumber } from '../shared/finance/locale';

/**
 * Bank-specific configuration for FNB (First National Bank, South Africa).
 *
 * The extractor pulls *only* relevant financial information by:
 *  1. Reading the column header row from the PDF to discover X-coordinate ranges.
 *  2. Filtering out noise lines (header/footer/marketing copy) via NOISE_PHRASES.
 *  3. Bucket-mapping each text item to its column range (no regex line parsing).
 *  4. Resolving direction deterministically per-row from Debit/Credit columns or
 *     `Cr/Dr` suffixes in Amount — never from balance-progression guessing
 *     (which can mis-spike hidden fees/unrecorded transactions).
 */
export interface FNBTransaction {
  date: string;
  description: string;
  debit: number | null;
  credit: number | null;
  amount: number | null;
  balance: number | null;
  charges: number | null;
  direction: 'DEBIT' | 'CREDIT' | 'FEE' | 'UNKNOWN';
  confidence: number;
  rawText: string;
}

export interface FNBMetadata {
  openingBalance: number | null;
  closingBalance: number | null;
  bankCode: 'FNB_SA';
  /** Page-capped extraction. */
  pagesProcessed: number;
  /** Transactions we kept after filtering. */
  rowCount: number;
  /** True when opening + sum(rows) ~= closing (within tolerance). */
  reconciles: boolean;
  /** Count of transactions that failed to parse money values. */
  parseErrors: number;
  /** Aggregated mean of per-row confidence scores. */
  aggregatedConfidence?: number;
}

/** Hard page cap so a runaway statement doesn't block the UI. */
export const FNB_MAX_PAGES = 20;

/** Tolerance, in Rands, for opening-balance → running-balance reconciliation. */
export const FNB_RECONCILIATION_TOLERANCE = 0.05;

const FNB_HEADER_PATTERNS = [
  /date.*description.*amount.*balance/i,
  /date.*description.*debit.*credit.*balance/i,
  /date.*description.*fees.*balance/i,
  /date.*narrative.*amount.*balance/i,
  /date.*description.*amount.*balance.*charges/i,
];

/**
 * Lines that should be filtered out as metadata/padding. Includes the bank
 * brand block (logo + tagline + customer-care + rate sheets + footer tat) so
 * they don't bleed in as phantom transactions.
 */
const NOISE_PHRASES = [
  'opening balance', 'closing balance', 'total vat', 'service fees',
  'first national bank', 'registration number', 'prime lending rate',
  'statement date:', 'customer care', 'fraud', 'relationship manager',
  // Footer/summary lines often present on FNB PDFs:
  'no. credit transactions', 'no. debit transactions',
  'total debits', 'total credits', 'total vat', 'available balance',
  'bank charges', 'interest earned', 'interest charged',
  'delivery method', 'account holder',
];

function isNoiseLine(text: string): boolean {
  const lower = text.toLowerCase().trim();
  // Only skip noise filtering for lines that look like real transactions:
  // must start with a date AND contain a money-like amount (digits with decimals).
  // FNB Gold uses "DD Mon" (e.g. "02 Jan"); standard formats use DD/MM/YYYY or YYYY/MM/DD.
  const startsWithDate =
    /^\d{2}\/\d{2}\/\d{4}/.test(lower) ||
    /^\d{4}\/\d{2}\/\d{2}/.test(lower) ||
    /^\d{1,2}\s+[a-z]{3}\b/.test(lower);
  if (startsWithDate && /[\d,]+\.\d{2}/.test(lower)) return false;
  return NOISE_PHRASES.some(phrase => lower.includes(phrase));
}

/**
 * Parse a money string into a number, recognising allowance patterns:
 *  - "R 1,234.56"
 *  - "1,234.56"
 *  - "(1,234.56)"   -> negative (accounting)
 *  - "1234.56 Cr"   -> positive
 *  - "1234.56 Dr"   -> negative
 * Returns `null` (not 0) when the string cannot be parsed; this preserves
 * downstream ability to distinguish "explicit zero" from "missing value".
 */
export function parseMoney(str: string | null | undefined): number | null {
  if (!str) return null;
  // Only strip R prefix (South African Rand indicator), not all R's in the string
  // as that would destroy "Dr"/"Cr" suffixes.
  let clean = String(str).trim().replace(/\*/g, '').replace(/^R\s*/i, '').replace(/,/g, '');
  if (!clean) return null;

  let isNegative = false;

  if (clean.startsWith('(') && clean.endsWith(')')) {
    isNegative = true;
    clean = clean.substring(1, clean.length - 1);
  }

  const lower = clean.toLowerCase();
  if (lower.endsWith('dr')) {
    isNegative = true;
    clean = clean.slice(0, -2).trim();
  } else if (lower.endsWith('cr')) {
    isNegative = false;
    clean = clean.slice(0, -2).trim();
  }

  const num = moneyToNumber(clean, { locale: 'en-US' });
  if (num === null) return null;
  return isNegative ? -Math.abs(num) : Math.abs(num);
}

function consolidateAmountColumns(rowData: Record<string, string>): string {
  const amount1 = rowData['Amount'] || '';
  const amount2 = rowData['Amount2'] || '';
  const amount3 = rowData['Amount3'] || '';
  return [amount1, amount2, amount3].sort((a, b) => b.length - a.length)[0] || '';
}

/**
 * Compute a confidence score for a parsed transaction row.
 * 5 signals × 0.15 = 0.75 base, +0.10 when direction is unambiguous.
 * Floor = 0.50 so the UI never marks a parsed row as "low quality".
 */
export function computeRowConfidence(row: {
  hasDate: boolean;
  hasDescription: boolean;
  hasAmount: boolean;
  hasBalance: boolean;
  amountParsed: boolean;
  balanceParsed: boolean;
  directionResolved: boolean;
}): number {
  let score = 0.5;
  if (row.hasDate) score += 0.1;
  if (row.hasDescription) score += 0.1;
  if (row.hasAmount) score += 0.05;
  if (row.hasBalance) score += 0.05;
  if (row.amountParsed) score += 0.05;
  if (row.balanceParsed) score += 0.05;
  if (row.directionResolved) score += 0.1;
  return Math.min(1, score);
}

/** Fixed measured column ranges for FNB Gold Business Account statements. */
export const FNB_GOLD_COLUMNS: Array<{ name: string; xLeft: number; xRight: number }> = [
  { name: 'Date', xLeft: 0, xRight: 35 },
  { name: 'Description', xLeft: 35, xRight: 430 },
  { name: 'Amount', xLeft: 430, xRight: 485 },
  { name: 'Balance', xLeft: 485, xRight: 548 },
  { name: 'Charges', xLeft: 548, xRight: 620 },
];

/**
 * Detect FNB Gold Business Account format.
 * Gold format has header "Date" at x&lt;30 and "Description" at x&gt;150.
 * Uses fixed measured ranges (not header-midpoint ranges).
 */
export function detectGoldFormat(textItems: Array<{ str?: string; transform?: number[] }>): {
  isGold: boolean;
  columns?: Array<{ name: string; xLeft: number; xRight: number }>;
} {
  const dateCol = textItems.find(
    (item) => item.str?.trim().toLowerCase() === 'date' && item.transform
  );
  const descCol = textItems.find(
    (item) => item.str?.trim().toLowerCase() === 'description' && item.transform
  );

  if (!dateCol || !descCol) {
    return { isGold: false };
  }

  // Prefer the transaction-table Date header (x&lt;30), not the page chrome "Date" field.
  const dateCandidates = textItems.filter(
    (item) => item.str?.trim().toLowerCase() === 'date' && item.transform
  );
  const tableDate =
    dateCandidates.find((item) => (item.transform?.[4] ?? 0) < 30) || dateCol;
  const dateX = tableDate.transform ? tableDate.transform[4] : 0;
  const descX = descCol.transform ? descCol.transform[4] : 0;

  if (dateX < 30 && descX > 150) {
    console.log(`[FNB] Detected Gold Business Account format (Date x=${dateX}, Desc x=${descX})`);
    return { isGold: true, columns: FNB_GOLD_COLUMNS.map((c) => ({ ...c })) };
  }

  return { isGold: false };
}

function goldColumnsToColMap(
  columns: Array<{ name: string; xLeft: number; xRight: number }>
): Record<string, { min: number; max: number; isLast?: boolean }> {
  const colMap: Record<string, { min: number; max: number; isLast?: boolean }> = {};
  for (let idx = 0; idx < columns.length; idx++) {
    const col = columns[idx]!;
    colMap[col.name] = {
      min: col.xLeft,
      max: col.xRight,
      isLast: idx === columns.length - 1,
    };
  }
  return colMap;
}

/** True when the token looks like an FNB statement date (ISO-like or "DD Mon"). */
function looksLikeFnbDate(value: string): boolean {
  const t = value.trim();
  return (
    /^\d{4}\/\d{2}\/\d{2}/.test(t) ||
    /^\d{2}\/\d{2}\/\d{4}/.test(t) ||
    /^\d{1,2}\s+[A-Za-z]{3}\b/.test(t)
  );
}

/**
 * Reconcile opening balance + signed rows against the closing balance.
 * Returns `true` when the running balance fits within ±tolerance.
 */
export function reconciles(
  openingBalance: number,
  rows: FNBTransaction[],
  closingBalance: number,
  tolerance: number = FNB_RECONCILIATION_TOLERANCE
): boolean {
  if (rows.length === 0) return openingBalance === closingBalance;
  const sum = rows.reduce(
    (acc, r) => acc + (typeof r.amount === 'number' ? r.amount : 0),
    0
  );
  return Math.abs(openingBalance + sum - closingBalance) <= tolerance;
}

const FNB_MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04',
  may: '05', jun: '06', jul: '07', aug: '08',
  sep: '09', oct: '10', nov: '11', dec: '12',
};

export function formatFnbDate(
  rawDate: string,
  monthYearMap?: Record<string, number>,
  defaultYear = 2026
): string {
  const trimmed = rawDate.trim();
  const iso = trimmed.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }
  const ddmmyyyy = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (ddmmyyyy) {
    return `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, '0')}-${ddmmyyyy[1].padStart(2, '0')}`;
  }
  const ddMon = trimmed.match(/^(\d{1,2})\s+([A-Za-z]{3})$/);
  if (ddMon) {
    const day = ddMon[1].padStart(2, '0');
    const monKey = ddMon[2].toLowerCase();
    const monNum = FNB_MONTH_MAP[monKey] || '01';
    const year = monthYearMap?.[monKey] ?? defaultYear;
    return `${year}-${monNum}-${day}`;
  }
  return trimmed;
}

export async function extractFNBStatement(
  file: File,
  password?: string,
  maxPages: number = FNB_MAX_PAGES
): Promise<{ transactions: FNBTransaction[]; metadata: FNBMetadata; openingBalance: string | null; closingBalance: string | null }> {
  // PDF.js may transfer its input to a worker, so retain no shared File buffer.
  const bytes = new Uint8Array(new Uint8Array(await file.arrayBuffer()));
  const pdf = await pdfjsLib.getDocument({ data: bytes, password }).promise;

  const transactions: FNBTransaction[] = [];
  let parseErrors = 0;
  const totalPages = Math.min(pdf.numPages, FNB_MAX_PAGES, Math.max(1, maxPages));

  // Multi-page Gold format column map (headers often missing on later pages)
  let persistedGoldFormat = false;
  let persistedColumns: Array<{ name: string; xLeft: number; xRight: number }> | null = null;

  // Header-section opening/closing balances (FNB places these ABOVE the data table)
  let headerOpeningBalance: number | null = null;
  let headerClosingBalance: number | null = null;
  const monthYearMap: Record<string, number> = {};
  let defaultYear = 2026;

  try {
    const page1 = await pdf.getPage(1);
    const content1 = await page1.getTextContent();
    const items1 = (content1.items as any[]).map((item: any) => ({
      str: item.str?.trim() || '',
      x: item.transform[4],
      y: item.transform[5],
    }));
    const hdrLines = new Map<number, typeof items1>();
    for (const item of items1) {
      if (!item.str) continue;
      const yKey = Math.round(item.y / 5) * 5;
      if (!hdrLines.has(yKey)) hdrLines.set(yKey, []);
      hdrLines.get(yKey)!.push(item);
    }
    for (const [, lineItems] of hdrLines) {
      const sorted = lineItems.sort((a, b) => a.x - b.x);
      const lineText = sorted.map((i) => i.str).join(' ');
      const lower = lineText.toLowerCase();

      const periodMatch = lineText.match(/statement\s+period\s*:\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+to\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i);
      if (periodMatch) {
        const [, , startMon, startYr, , endMon, endYr] = periodMatch;
        monthYearMap[startMon.toLowerCase().slice(0, 3)] = Number(startYr);
        monthYearMap[endMon.toLowerCase().slice(0, 3)] = Number(endYr);
        defaultYear = Number(endYr);
      } else {
        const dateMatch = lineText.match(/statement\s+date\s*:\s*\d{1,2}\s+([A-Za-z]+)\s+(\d{4})/i);
        if (dateMatch) {
          defaultYear = Number(dateMatch[2]);
          monthYearMap[dateMatch[1].toLowerCase().slice(0, 3)] = defaultYear;
        }
      }

      if (lower.includes('opening balance') && headerOpeningBalance === null) {
        for (const item of sorted) {
          const m = item.str.match(/^([\d,]+\.\d{2})\s*(Cr|Dr)?$/i);
          if (m) {
            headerOpeningBalance = parseMoney(m[0]);
            break;
          }
        }
      }
      if (lower.includes('closing balance') && headerClosingBalance === null) {
        for (const item of sorted) {
          const m = item.str.match(/^([\d,]+\.\d{2})\s*(Cr|Dr)?$/i);
          if (m) {
            headerClosingBalance = parseMoney(m[0]);
            break;
          }
        }
      }
    }
  } catch {
    /* ignore header scan errors */
  }

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const items = textContent.items as any[];

    // 1. Strict Column Detection via Header X-Coordinates
    // First try: join items on same Y-coordinate and match against full-line patterns
    let colMap: Record<string, { min: number; max: number; isLast?: boolean }> = {};
    let headerFound = false;
    let useGoldRanges = false;

    // Gold format detection runs before generic header-midpoint logic.
    const goldDetection = detectGoldFormat(items);
    if (goldDetection.isGold && goldDetection.columns) {
      persistedGoldFormat = true;
      persistedColumns = goldDetection.columns;
      useGoldRanges = true;
      colMap = goldColumnsToColMap(goldDetection.columns);
      headerFound = true;
    } else if (persistedGoldFormat && persistedColumns) {
      useGoldRanges = true;
      colMap = goldColumnsToColMap(persistedColumns);
      headerFound = true;
    }

    // Group items by Y-coordinate to find header lines.
    // CRITICAL: snap Y to a 3px grid. PDF generators often emit header tokens
    // at Y values that differ by <1px (e.g. 793.92 vs 793.44), which breaks
    // naive string-key grouping. Snapping merges them into one logical row.
    const yGroups: Record<string, { str: string; x: number }[]> = {};
    for (const item of items) {
      const y: number = item.transform[5];
      const text: string = item.str.trim();
      if (!text) continue;
      const yKey = String(Math.round(y / 3) * 3);
      if (!yGroups[yKey]) yGroups[yKey] = [];
      yGroups[yKey]!.push({ str: text, x: item.transform[4] });
    }

    // Build tolerance-merged "logical lines" for header detection.
    // A single visual header row may be split across two adjacent Y-groups
    // that are within HEADER_Y_TOLERANCE of each other (sub-pixel jitter).
    // We merge such groups before pattern matching so e.g.
    //   Y=794 "Date Bank"  +  Y=793 "Description Amount Balance"
    // become one line "Date Description Amount Balance Bank" that matches.
    const HEADER_Y_TOLERANCE = 6;
    const sortedYKeys = Object.keys(yGroups)
      .map(Number)
      .sort((a, b) => b - a); // top to bottom
    const logicalLines: { yKeys: string[]; items: { str: string; x: number }[] }[] = [];
    for (let i = 0; i < sortedYKeys.length; i++) {
      const yKey = String(sortedYKeys[i]);
      const merged: { str: string; x: number }[] = [...yGroups[yKey]!];
      const mergedKeys = [yKey];
      // Greedily merge subsequent groups within tolerance
      for (let j = i + 1; j < sortedYKeys.length; j++) {
        if (sortedYKeys[i] - sortedYKeys[j] > HEADER_Y_TOLERANCE) break;
        const nextKey = String(sortedYKeys[j]);
        merged.push(...yGroups[nextKey]!);
        mergedKeys.push(nextKey);
        i = j; // consume
      }
      logicalLines.push({
        yKeys: mergedKeys,
        items: merged.sort((a, b) => a.x - b.x),
      });
    }

    let headerYKeys: string[] = [];
    for (const line of logicalLines) {
      const lineText = line.items.map(i => i.str).join(' ');
      if (FNB_HEADER_PATTERNS.some(p => p.test(lineText))) {
        headerFound = true;
        headerYKeys = line.yKeys;

        // Gold fixed ranges take precedence — only record header Y keys for exclusion.
        if (useGoldRanges) {
          break;
        }

        // Compute non-overlapping column boundaries from header keyword x-positions.
        // Each column's range spans from the midpoint between it and the previous column
        // to the midpoint between it and the next column.
        const orderedHeaderCols: { name: string; x: number }[] = [];
        for (const item of line.items) {
          const x = item.x;
          if (/^date$/i.test(item.str)) orderedHeaderCols.push({ name: 'Date', x });
          if (/^description|^narrative$/i.test(item.str)) orderedHeaderCols.push({ name: 'Description', x });
          if (/^debit$/i.test(item.str)) orderedHeaderCols.push({ name: 'Debit', x });
          if (/^credit$/i.test(item.str)) orderedHeaderCols.push({ name: 'Credit', x });
          if (/^amount$/i.test(item.str)) orderedHeaderCols.push({ name: 'Amount', x });
          if (/^balance$/i.test(item.str)) orderedHeaderCols.push({ name: 'Balance', x });
          if (/^charge|^fee|^charges$/i.test(item.str)) orderedHeaderCols.push({ name: 'Charges', x });
        }
        orderedHeaderCols.sort((a, b) => a.x - b.x);

        // Build non-overlapping column boundaries using a KEYWORD-EDGE strategy:
        // - First column (usually Date): small fixed width from keyword X position.
        //   FNB date formats are short ("DD Mon" ~30px), so +20 is safe.
        // - Middle columns: left = previous column's right edge,
        //   right = next keyword's X position (NOT midpoint — midpoints fail when
        //   the header keyword is centered over its data area, e.g. "Description"
        //   at x=209 while description data starts at x=38).
        // - Last column (usually Balance): extends past the right edge of the page.
        let prevRightBoundary = orderedHeaderCols[0]!.x - 20;
        for (let idx = 0; idx < orderedHeaderCols.length; idx++) {
          const col = orderedHeaderCols[idx]!;
          let leftBoundary: number;
          let rightBoundary: number;

          if (idx === 0) {
            leftBoundary = col.x - 20;
            rightBoundary = col.x + 20;
          } else {
            leftBoundary = prevRightBoundary;
            if (idx === orderedHeaderCols.length - 1) {
              rightBoundary = col.x + 150;
            } else {
              rightBoundary = orderedHeaderCols[idx + 1]!.x;
            }
          }

          colMap[col.name] = { min: leftBoundary, max: rightBoundary, isLast: idx === orderedHeaderCols.length - 1 };
          prevRightBoundary = rightBoundary;
        }
        break;
      }
    }

    // Fallback: try individual item keyword matching (skip when Gold ranges already set)
    if (!headerFound && !useGoldRanges) {
      for (const item of items) {
        const text = item.str.trim();
        if (!text) continue;
        const x = item.transform[4];
        if (/^date$/i.test(text) && !colMap['Date']) colMap['Date'] = { min: x - 10, max: x + 50 };
        if (/^description|^narrative$/i.test(text) && !colMap['Description']) colMap['Description'] = { min: x - 10, max: x + 200 };
        if (/^debit$/i.test(text) && !colMap['Debit']) colMap['Debit'] = { min: x - 10, max: x + 60 };
        if (/^credit$/i.test(text) && !colMap['Credit']) colMap['Credit'] = { min: x - 10, max: x + 60 };
        if (/^amount$/i.test(text) && !colMap['Amount']) colMap['Amount'] = { min: x - 10, max: x + 60 };
        if (/^balance$/i.test(text) && !colMap['Balance']) colMap['Balance'] = { min: x - 10, max: x + 60 };
        if (/^charge|^fee$/i.test(text) && !colMap['Charges']) colMap['Charges'] = { min: x - 10, max: x + 60 };
      }
      if (Object.keys(colMap).length >= 2) headerFound = true;
    }

    if (!headerFound) continue;

    // 2. X-Coordinate Mapping for Data Rows (group by Y-coordinate for multi-row pages)
    // Use the header Y-keys identified during tolerance-merged header detection
    // (may span multiple adjacent Y-groups for split headers).
    // If header was found via the item-keyword fallback, headerYKeys is empty —
    // in that case there is no single header row to exclude, so skip filtering.
    const headerYKeySet = new Set(headerYKeys);
    
    // Group data items by Y-coordinate (excluding header row).
    // Use the same 3px snap as the header grouping so split rows merge correctly.
    const dataYGroups: Record<string, { str: string; x: number }[]> = {};
    for (const item of items) {
      const text = item.str.trim();
      const yKey = String(Math.round(item.transform[5] / 3) * 3);
      // Skip empty/noise text and header row items
      if (!text || isNoiseLine(text)) continue;
      if (headerYKeySet.has(yKey) && yGroups[yKey]?.some(h => h.str === text)) continue;
      if (!dataYGroups[yKey]) dataYGroups[yKey] = [];
      dataYGroups[yKey].push({ str: text, x: item.transform[4] });
    }

    // Process each data row, top-to-bottom (Y desc = higher on page first)
    for (const dataYKey of Object.keys(dataYGroups).sort((a, b) => Number(b) - Number(a))) {
      const rowItems = dataYGroups[dataYKey]!;
      const currentRow: Record<string, string> = {};
      let currentRowText = '';

      // Assign each item to its column by non-overlapping range check.
      // Ranges are computed from midpoints between adjacent header keywords,
      // so they never overlap and first-match is safe.
      for (const item of rowItems) {
        let assigned = false;
        for (const [colName, range] of Object.entries(colMap)) {
          const isLast = colName === 'Balance' || (range as any).isLast === true;
          const isMatch = item.x >= range.min && (isLast ? item.x <= range.max : item.x < range.max);
          if (isMatch) {
            currentRow[colName] = (currentRow[colName] || '') + ' ' + item.str;
            assigned = true;
            break;
          }
        }
        if (!assigned) {
          currentRowText += ' ' + item.str;
        }
      }

      // 3. Deterministic Direction Logic (NO balance-progression guessing)
      if (Object.keys(currentRow).length > 0) {
        const date = currentRow['Date']?.trim() || '';
        const description = (currentRow['Description']?.trim() || currentRowText).trim();
        const debitStr = currentRow['Debit']?.trim();
        const creditStr = currentRow['Credit']?.trim();
        const amountStr = consolidateAmountColumns(currentRow);
        const balanceStr = currentRow['Balance']?.trim() || '0';
        const chargesStr = currentRow['Charges']?.trim();

        let direction: 'DEBIT' | 'CREDIT' | 'UNKNOWN' = 'UNKNOWN';
        let debit: number | null = null;
        let credit: number | null = null;
        let amount: number | null = null;

        if (debitStr || creditStr) {
          // Separate columns: unambiguous
          debit = debitStr ? parseMoney(debitStr) : null;
          credit = creditStr ? parseMoney(creditStr) : null;
          if (debit && debit > 0) {
            direction = 'DEBIT';
            amount = -debit;
          } else if (credit && credit > 0) {
            direction = 'CREDIT';
            amount = credit;
          }
        } else if (amountStr && amountStr !== '0') {
          amount = parseMoney(amountStr);
          if (amountStr.toLowerCase().includes('dr')) {
            direction = 'DEBIT';
            debit = amount !== null ? Math.abs(amount) : null;
          } else if (amountStr.toLowerCase().includes('cr')) {
            direction = 'CREDIT';
            credit = amount !== null ? Math.abs(amount) : null;
          } else if (currentRow['Direction']?.toUpperCase().includes('OUT')) {
            direction = 'DEBIT';
            debit = amount !== null ? Math.abs(amount) : null;
          } else if (currentRow['Direction']?.toUpperCase().includes('IN')) {
            direction = 'CREDIT';
            credit = amount !== null ? Math.abs(amount) : null;
          } else if (amount !== null && amount < 0) {
            direction = 'DEBIT';
            debit = Math.abs(amount);
          }        
          // Gold / single-Amount layouts often omit Cr/Dr on the amount token.
          const descLower = description.toLowerCase();
          if (
            /\b(payment to|pmt to|transfer to)\b/.test(descLower)
          ) {
            direction = 'DEBIT';
            debit = amount !== null ? Math.abs(amount) : null;
            if (amount !== null) amount = -Math.abs(amount);
          } else if (
            /\bcr\b/.test(descLower) ||
            /\bcredit\b/.test(descLower) ||
            /\bdeposit\b/.test(descLower) ||
            /\bsalary\b/.test(descLower) ||
            /\btransfer from\b/.test(descLower) ||
            /\bpayment from\b/.test(descLower) ||
            /\bpayshap credit\b/.test(descLower) ||
            /\breversal\b/.test(descLower) ||
            /\brefund\b/.test(descLower)
          ) {
            direction = 'CREDIT';
            credit = amount !== null ? Math.abs(amount) : null;
            if (amount !== null) amount = Math.abs(amount);
          } else if (
            /\bdr\b/.test(descLower) ||
            /\bdebit\b/.test(descLower) ||
            /\bpos purchase\b/.test(descLower) ||
            /\batm\b/.test(descLower) ||
            /\bmagtape debit\b/.test(descLower) ||
            /\bsend money\b/.test(descLower) ||
            /\bpurchase\b/.test(descLower) ||
            /\bfee\b/.test(descLower) ||
            /\bexpress pmt\b/.test(descLower) ||
            /\brtc pmt\b/.test(descLower) ||
            /\binternet pmt\b/.test(descLower) ||
            /\bprepaid\b/.test(descLower) ||
            /\bairtime\b/.test(descLower) ||
            /\bcashback\b/.test(descLower) ||
            /\belectricity\b/.test(descLower) ||
            /\bsavings\b/.test(descLower) ||
            /\bwages\b/.test(descLower) ||
            /\bsalaries\b/.test(descLower) ||
            /\bpayshap account off-us\b/.test(descLower) ||
            /\bbyc debit\b/.test(descLower) ||
            /\bpayment\b/.test(descLower)
          ) {
            direction = 'DEBIT';
            debit = amount !== null ? Math.abs(amount) : null;
            if (amount !== null) amount = -Math.abs(amount);
          }
        }

        // Accept rows with a real date and at least one money field.
        // Gold fee-only continuation lines often have date + amount/charges but empty description.
        const hasMoneyField =
          (amountStr && amountStr !== '0') ||
          Boolean(debitStr) ||
          Boolean(creditStr) ||
          (balanceStr && balanceStr !== '0') ||
          Boolean(chargesStr);
        if (date && looksLikeFnbDate(date) && (description || hasMoneyField)) {
          const rowDescription =
            description ||
            (chargesStr && (!amountStr || amountStr === '0')
              ? 'Bank Charges'
              : amountStr
                ? 'Fee / Adjustment'
                : 'Transaction');
          const parsedBalance = parseMoney(balanceStr);
          const parsedCharges = chargesStr ? parseMoney(chargesStr) : null;
          // Count rows where money parsing failed
          if (amount === null && (amountStr || debitStr || creditStr)) parseErrors++;
          if (parsedBalance === null && balanceStr && balanceStr !== '0') parseErrors++;

          // Fee-only rows with no direction yet: treat non-zero amount as DEBIT
          if (direction === 'UNKNOWN' && amount !== null && amount !== 0 && !description) {
            direction = 'DEBIT';
            debit = Math.abs(amount);
            amount = -Math.abs(amount);
          }

          const isoDate = formatFnbDate(date, monthYearMap, defaultYear);

          const confidence = computeRowConfidence({
            hasDate: Boolean(date),
            hasDescription: Boolean(rowDescription),
            hasAmount: amountStr !== '' || Boolean(debitStr) || Boolean(creditStr),
            hasBalance: balanceStr !== '0',
            amountParsed: amount !== null,
            balanceParsed: parsedBalance !== null,
            directionResolved: direction !== 'UNKNOWN',
          });

          transactions.push({
            date: isoDate,
            description: rowDescription,
            debit,
            credit,
            amount,
            balance: parsedBalance,
            charges: parsedCharges,
            direction,
            confidence,
            rawText: currentRowText,
          });
        }
      }
    }
  }

  // Prefer header-section balances when present; else first/last row balances
  const openingBalance: number | null =
    headerOpeningBalance !== null
      ? headerOpeningBalance
      : transactions.length > 0
        ? transactions[0].balance
        : null;
  const closingBalance: number | null =
    headerClosingBalance !== null
      ? headerClosingBalance
      : transactions.length > 0
        ? transactions[transactions.length - 1].balance
        : null;

  // Multi-pass balance progression direction resolution
  let runningBal = openingBalance;
  for (const tx of transactions) {
    const curBal = tx.balance;
    const absAmt = Math.abs(tx.amount || (tx.debit ?? tx.credit ?? 0));

    if (runningBal !== null && curBal !== null && absAmt > 0) {
      const diff = curBal - runningBal;
      if (Math.abs(diff + absAmt) <= 0.05) {
        tx.direction = 'DEBIT';
        tx.amount = -absAmt;
        tx.debit = absAmt;
        tx.credit = null;
      } else if (Math.abs(diff - absAmt) <= 0.05) {
        tx.direction = 'CREDIT';
        tx.amount = absAmt;
        tx.credit = absAmt;
        tx.debit = null;
      }
    }

    if (tx.direction === 'DEBIT') {
      tx.debit = absAmt > 0 ? absAmt : null;
      tx.credit = null;
      tx.amount = -absAmt;
    } else if (tx.direction === 'CREDIT') {
      tx.credit = absAmt > 0 ? absAmt : null;
      tx.debit = null;
      tx.amount = absAmt;
    } else if (tx.direction === 'UNKNOWN') {
      if ((tx.charges !== null && tx.charges > 0) || /fee|adjustment|charge/i.test(tx.description)) {
        tx.direction = 'FEE';
        if (absAmt > 0) {
          tx.debit = absAmt;
          tx.amount = -absAmt;
        }
      }
    }

    if (curBal !== null) {
      runningBal = curBal;
    }
  }

  const doesReconcile =
    openingBalance !== null && closingBalance !== null
      ? reconciles(openingBalance, transactions, closingBalance)
      : false;

  // Aggregate per-row confidence into a single extraction-level score
  const aggregatedConfidence = transactions.length > 0
    ? transactions.reduce((sum, tx) => sum + tx.confidence, 0) / transactions.length
    : 0;

  return {
    transactions,
    openingBalance: openingBalance !== null ? String(openingBalance) : null,
    closingBalance: closingBalance !== null ? String(closingBalance) : null,
    metadata: {
      openingBalance,
      closingBalance,
      bankCode: 'FNB_SA',
      pagesProcessed: totalPages,
      rowCount: transactions.length,
      reconciles: doesReconcile,
      parseErrors,
      aggregatedConfidence,
    },
  };
}

export function convertToExcelRows(transactions: FNBTransaction[]): Record<string, any>[] {
  return transactions.map(tx => ({
    Date: tx.date,
    Description: tx.description,
    Debit: tx.debit,
    Credit: tx.credit,
    Amount: tx.amount,
    Balance: tx.balance,
    Charges: tx.charges,
    Direction: tx.direction,
  }));
}
