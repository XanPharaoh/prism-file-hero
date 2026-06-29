import * as pdfjsLib from 'pdfjs-dist';

export interface FNBTransaction {
  date: string;
  description: string;
  debit: number | null;
  credit: number | null;
  amount: number | null;
  balance: number;
  charges: number | null;
  direction: 'DEBIT' | 'CREDIT' | 'UNKNOWN';
  confidence: number;
  rawText: string;
}

export interface FNBMetadata {
  openingBalance: number;
  closingBalance: number;
  bankCode: 'FNB_SA';
}

const FNB_HEADER_PATTERNS = [
  /date.*description.*amount.*balance/i,
  /date.*description.*debit.*credit.*balance/i,
  /date.*description.*fees.*balance/i,
  /date.*narrative.*amount.*balance/i,
];

const NOISE_PHRASES = [
  'opening balance', 'closing balance', 'total vat', 'service fees',
  'first national bank', 'registration number', 'prime lending rate',
  'statement date:', 'customer care', 'fraud', 'relationship manager',
];

function isNoiseLine(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (/^\d{2}\/\d{2}\/\d{4}/.test(lower)) return false;
  return NOISE_PHRASES.some(phrase => lower.includes(phrase));
}

function parseMoney(str: string): number {
  if (!str) return 0;
  let clean = str.replace(/[R\s,]/g, '').replace(/\*/g, '');
  let isNegative = false;

  if (clean.startsWith('(') && clean.endsWith(')')) {
    isNegative = true;
    clean = clean.substring(1, clean.length - 1);
  }

  const lower = clean.toLowerCase();
  if (lower.endsWith('dr')) {
    isNegative = true;
    clean = clean.slice(0, -2);
  } else if (lower.endsWith('cr')) {
    isNegative = false;
    clean = clean.slice(0, -2);
  }

  const num = parseFloat(clean);
  return isNaN(num) ? 0 : (isNegative ? -Math.abs(num) : Math.abs(num));
}

function consolidateAmountColumns(rowData: Record<string, string>): string {
  const amount1 = rowData['Amount'] || '';
  const amount2 = rowData['Amount2'] || '';
  const amount3 = rowData['Amount3'] || '';
  return [amount1, amount2, amount3].sort((a, b) => b.length - a.length)[0] || '0';
}

export async function extractFNBStatement(
  file: File,
  password?: string
): Promise<{ transactions: FNBTransaction[]; metadata: FNBMetadata }> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, password }).promise;

  const transactions: FNBTransaction[] = [];
  let openingBalance = 0;
  let closingBalance = 0;

  for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const items = textContent.items as any[];

    // 1. Strict Column Detection via Header X-Coordinates
    // First try: join items on same Y-coordinate and match against full-line patterns
    let colMap: Record<string, { min: number; max: number }> = {};
    let headerFound = false;

    // Group items by Y-coordinate to find header lines
    const yGroups: Record<string, { str: string; x: number }[]> = {};
    for (const item of items) {
      const y: number = item.transform[5];
      const text: string = item.str.trim();
      if (!text) continue;
      const yKey = String(y);
      if (!yGroups[yKey]) yGroups[yKey] = [];
      yGroups[yKey]!.push({ str: text, x: item.transform[4] });
    }

    for (const yKey of Object.keys(yGroups)) {
      const lineItems = yGroups[yKey]!;
      const lineText = lineItems.map(i => i.str).join(' ');
      if (FNB_HEADER_PATTERNS.some(p => p.test(lineText))) {
        headerFound = true;
        for (const item of lineItems) {
          const x = item.x;
          if (/^date$/i.test(item.str)) colMap['Date'] = { min: x - 10, max: x + 50 };
          if (/^description|^narrative$/i.test(item.str)) colMap['Description'] = { min: x - 10, max: x + 200 };
          if (/^debit$/i.test(item.str)) colMap['Debit'] = { min: x - 10, max: x + 60 };
          if (/^credit$/i.test(item.str)) colMap['Credit'] = { min: x - 10, max: x + 60 };
          if (/^amount$/i.test(item.str)) colMap['Amount'] = { min: x - 10, max: x + 60 };
          if (/^balance$/i.test(item.str)) colMap['Balance'] = { min: x - 10, max: x + 60 };
          if (/^charge|^fee$/i.test(item.str)) colMap['Charges'] = { min: x - 10, max: x + 60 };
        }
        break;
      }
    }

    // Fallback: try individual item keyword matching
    if (!headerFound) {
      for (const item of items) {
        const text = item.str.trim();
        if (!text) continue;
        const x = item.transform[4];
        const y = item.transform[5];
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
    // Find which Y-key was the header row
    let headerYKey: string | null = null;
    for (const yKey of Object.keys(yGroups)) {
      const lineText = yGroups[yKey]!.map(i => i.str).join(' ');
      if (FNB_HEADER_PATTERNS.some(p => p.test(lineText))) {
        headerYKey = yKey;
        break;
      }
    }
    
    // Group data items by Y-coordinate (excluding header row)
    const dataYGroups: Record<string, { str: string; x: number }[]> = {};
    for (const item of items) {
      const text = item.str.trim();
      const yKey = String(item.transform[5]);
      // Skip empty/noise text and header row items
      if (!text || isNoiseLine(text)) continue;
      if (yKey === headerYKey && yGroups[yKey]?.some(h => h.str === text)) continue;
      if (!dataYGroups[yKey]) dataYGroups[yKey] = [];
      dataYGroups[yKey].push({ str: text, x: item.transform[4] });
    }

    // Process each data row
    for (const dataYKey of Object.keys(dataYGroups)) {
      const rowItems = dataYGroups[dataYKey]!;
      const currentRow: Record<string, string> = {};
      let currentRowText = '';

      for (const item of rowItems) {
        let assigned = false;
        for (const [colName, range] of Object.entries(colMap)) {
          if (item.x >= range.min && item.x <= range.max) {
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
            debit = Math.abs(amount);
          } else if (amountStr.toLowerCase().includes('cr')) {
            direction = 'CREDIT';
            credit = Math.abs(amount);
          } else if (currentRow['Direction']?.toUpperCase().includes('OUT')) {
            direction = 'DEBIT';
            debit = Math.abs(amount);
          } else if (currentRow['Direction']?.toUpperCase().includes('IN')) {
            direction = 'CREDIT';
            credit = Math.abs(amount);
          }
        }

        if (date && description) {
          transactions.push({
            date,
            description,
            debit,
            credit,
            amount,
            balance: parseMoney(balanceStr),
            charges: chargesStr ? parseMoney(chargesStr) : null,
            direction,
            confidence: 0.85,
            rawText: currentRowText,
          });
        }
      }
    }
  }

  // Extract opening/closing balance from first/last valid balance entries
  if (transactions.length > 0) {
    openingBalance = transactions[0].balance;
    closingBalance = transactions[transactions.length - 1].balance;
  }

  return {
    transactions,
    metadata: { openingBalance, closingBalance, bankCode: 'FNB_SA' },
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