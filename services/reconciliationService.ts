/**
 * Universal Reconciliation Service
 * Validates and normalizes extracted data across all document types
 */

import { toCents } from '@/shared/finance/locale';

export interface ReconciledRow {
  [key: string]: any;
  _math_reconciled?: boolean;
  _math_error?: string;
}

export interface ReconciliationResult {
  rows: ReconciledRow[];
  isValid: boolean;
  errorCount: number;
  warnings: string[];
}

/**
 * Parse money strings to numbers
 */
export function parseMoney(str: any): number {
  if (typeof str === 'number') return str;
  if (!str || typeof str !== 'string') return 0;
  let clean = str.replace(/[R$£€\s,\*]/g, '').replace(/\s/g, '');
  if (clean.startsWith('(') && clean.endsWith(')')) {
    clean = '-' + clean.substring(1, clean.length - 1);
  }
  let isNegative = false;
  // In South African bank-statement convention:
  //   Dr (Debit) = money OUT → negative impact on balance
  //   Cr (Credit) = money IN → positive impact on balance
  const lower = clean.toLowerCase();
  if (lower.endsWith('dr')) { isNegative = true; clean = clean.slice(0, -2); }
  else if (lower.endsWith('cr')) { isNegative = false; clean = clean.slice(0, -2); }
  else if (lower.startsWith('-')) { isNegative = true; clean = clean.slice(1); }
  else if (lower.endsWith('-')) { isNegative = true; clean = clean.slice(0, -1); }
  const num = parseFloat(clean);
  if (!Number.isFinite(num)) return 0;
  return isNegative ? -Math.abs(num) : Math.abs(num);
}

function normKey(k: string) {
  return k.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z]/g, '');
}

function findKey(keys: string[], targets: string[]) {
  return keys.find(k => targets.includes(normKey(k))) || '';
}

function nearly(a: number, b: number, tol = 0.02) {
  return Math.abs(a - b) < tol;
}

function hasExplicitSign(raw: any) {
  const s = String(raw ?? '');
  return /[-(]|\bdr\b|\bcr\b/i.test(s);
}

/**
 * Main reconciliation function - dispatches to document-type-specific handlers
 */
export function reconcileRows(
  rows: any[],
  openingBalanceStr: string,
  docType?: string
): ReconciliationResult {
  if (rows.length === 0) {
    return {
      rows: [],
      isValid: true,
      errorCount: 0,
      warnings: ['No rows to reconcile']
    };
  }

  const warnings: string[] = [];
  let reconciled: ReconciledRow[] = [];

  try {
    switch (docType) {
      case 'bank-statement':
        reconciled = reconcileBankStatement(rows, openingBalanceStr);
        break;
      case 'invoice':
        reconciled = reconcileInvoice(rows);
        break;
      case 'financial-report':
        reconciled = reconcileFinancialReport(rows);
        break;
      case 'receipt':
        reconciled = reconcileReceipt(rows);
        break;
      case 'inventory':
        reconciled = reconcileInventory(rows);
        break;
      default:
        // Generic reconciliation - just validate and clean
        reconciled = reconcileGeneric(rows);
        warnings.push(`Unknown document type: ${docType}. Applied generic reconciliation.`);
    }
  } catch (error) {
    console.error('Reconciliation error:', error);
    warnings.push(`Reconciliation failed: ${error}`);
    // Return original rows if reconciliation fails
    reconciled = rows.map(row => ({ ...row, _math_reconciled: false, _math_error: 'Reconciliation failed' }));
  }

  const errorCount = reconciled.filter(r => r._math_error).length;
  const isValid = errorCount === 0 && warnings.length === 0;

  return {
    rows: reconciled,
    isValid,
    errorCount,
    warnings
  };
}

/**
 * Bank statement reconciliation - validates running balance
 */
// Integer-cent accessor for reconciliation math. Uses the strict, drift-free parser with the
// ZA profile (statement convention: R symbol, Dr/Cr suffixes, '.'-decimal). Returns 0 only for
// genuinely empty/absent cells; a value that fails to parse is treated as 0 here, while the
// review gate flags it separately (so we never mis-sum, and never silently pass on bad data).
function centsIn(row: any, key: string): number {
  const v = key ? row?.[key] : undefined;
  if (v === undefined || v === null || `${v}`.trim() === '') return 0;
  // Statements footnote amounts (e.g. "15.60*"). The marker is not part of the value, and treating
  // the whole cell as unparseable left the fee out of the identity, which is what forced the old
  // circular derivation to rescue legitimate rows.
  const normalised = `${v}`.replace(/\*/g, '');
  return toCents(normalised, { locale: 'en-ZA' }) ?? 0;
}
function nearlyCents(a: number, b: number, tol = 1): boolean {
  return Math.abs(a - b) <= tol; // 1-cent tolerance absorbs prior HALF-UP rounding, no float drift
}

function reconcileBankStatement(rows: any[], openingBalanceStr: string): ReconciledRow[] {
  let runningC = toCents(openingBalanceStr, { locale: 'en-ZA' }) ?? 0;
  const keys = Object.keys(rows[0]);

  const debitKey = findKey(keys, ['debit', 'debits', 'debiet', 'uit', 'withdrawals', 'withdrawal']);
  const creditKey = findKey(keys, ['credit', 'credits', 'krediet', 'deposit', 'deposits']);
  const feeKey = findKey(keys, ['fee', 'fees', 'charge', 'charges']);
  const amountKey = findKey(keys, ['amount', 'geld', 'money', 'bedrag']);
  const balanceKey = findKey(keys, ['balance', 'saldo']) || 'Balance';

  return rows.map((row) => {
    const reconciled: ReconciledRow = { ...row };
    const statedC = centsIn(row, balanceKey);

    // --- OPENING / CLOSING / INFO: no monetary movement ---
    if (isOpeningRow(row) || isClosingRow(row) || isInfoRow(row)) {
      reconciled.Amount = 0;
      reconciled._math_reconciled = true;
      reconciled['Direction'] = '';
      if (statedC !== 0) runningC = statedC;
      return reconciled;
    }

    // --- TRANSACTIONAL ROWS (all amounts in integer cents) ---
    const debitC = centsIn(row, debitKey);
    const creditC = centsIn(row, creditKey);
    const feeC = centsIn(row, feeKey);

    let netC: number | null = null;
    let isReconciled = false;

    if (debitKey || creditKey) {
      const attempt1 = creditC - debitC - feeC;
      if (nearlyCents(runningC + attempt1, statedC)) { netC = attempt1; isReconciled = true; }

      if (!isReconciled) {
        const attempt2 = creditC - debitC;
        if (nearlyCents(runningC + attempt2, statedC)) { netC = attempt2; isReconciled = true; }
      }

      if (!isReconciled && feeC > 0 && debitC === 0 && creditC === 0) {
        const attempt3 = -Math.abs(feeC);
        if (nearlyCents(runningC + attempt3, statedC)) { netC = attempt3; isReconciled = true; }
      }
    }

    if (!isReconciled && amountKey) {
      const amountRaw = row[amountKey];
      const amountSigned = hasExplicitSign(amountRaw);
      const amountC = centsIn(row, amountKey);
      const amountAbs = Math.abs(amountC);
      const feeAbs = Math.abs(feeC);

      if (amountSigned) {
        netC = amountC - feeAbs;
      } else {
        const sign = chooseSignByBalance(runningC / 100, statedC / 100, amountAbs / 100, feeAbs / 100);
        netC = sign * amountAbs - feeAbs;
      }
      if (netC !== null && nearlyCents(runningC + netC, statedC)) isReconciled = true;
    }

    // Strategy 2: the balance movement can still describe the row, but deriving the amount FROM that
    // movement makes the check circular: the row becomes "reconciled" by definition, which is how a
    // tampered amount disappeared. The derived value is kept for display only and never counts as
    // reconciliation.
    if (!isReconciled || netC === null) {
      netC = statedC - runningC;
      isReconciled = false;
      const derivedDollars = netC / 100;
      reconciled._math_error =
        `Amount not independently reconciled: derived ${derivedDollars.toFixed(2)} from the balance ` +
        'movement instead of matching a stated amount.';
      if (debitC > 0 && creditC === 0 && derivedDollars > 0) {
        reconciled._math_error = `Debit row but balance increased by ${derivedDollars.toFixed(2)}`;
      }
      if (creditC > 0 && debitC === 0 && derivedDollars < 0) {
        reconciled._math_error = `Credit row but balance decreased by ${derivedDollars.toFixed(2)}`;
      }
    }

    reconciled.Amount = Number((netC / 100).toFixed(2));
    reconciled._math_reconciled = isReconciled;
    reconciled['Direction'] = netC >= 0 ? 'In' : 'Out';

    runningC = statedC;
    return reconciled;
  });
}

/**
 * Invoice reconciliation - validates line item totals
 */
function reconcileInvoice(rows: any[]): ReconciledRow[] {
  return rows.map((row) => {
    const reconciled: ReconciledRow = { ...row };
    
    const quantity = parseFloat(row.Quantity || row.quantity || 0);
    const unitPrice = parseMoney(row.UnitPrice || row.Price || row.unitPrice || 0);
    const statedTotal = parseMoney(row.Total || row.TotalAmount || 0);
    const calculatedTotal = Number((quantity * unitPrice).toFixed(2));
    
    const isReconciled = nearly(calculatedTotal, statedTotal);
    
    reconciled.Amount = statedTotal;
    reconciled._math_reconciled = isReconciled;
    reconciled._calculated_total = calculatedTotal;
    
    if (!isReconciled) {
      reconciled._math_error = `Line total mismatch: calculated ${calculatedTotal}, stated ${statedTotal}`;
    }
    
    return reconciled;
  });
}

/**
 * Financial report reconciliation - validates subtotals and totals
 */
function reconcileFinancialReport(rows: any[]): ReconciledRow[] {
  return rows.map((row) => {
    const reconciled: ReconciledRow = { ...row };
    
    // For financial reports, we mainly validate that numeric values are present
    const hasAmount = row.Amount || row.amount || row.Current || row.Prior;
    
    reconciled._math_reconciled = hasAmount !== undefined;
    
    // Convert amount to standard field
    reconciled.Amount = parseMoney(hasAmount);
    
    if (!hasAmount) {
      reconciled._math_error = 'Missing amount value';
    }
    
    return reconciled;
  });
}

/**
 * Receipt reconciliation - validates item totals
 */
function reconcileReceipt(rows: any[]): ReconciledRow[] {
  return rows.map((row) => {
    const reconciled: ReconciledRow = { ...row };
    
    const quantity = parseFloat(row.Quantity || row.Qty || 1);
    const unitPrice = parseMoney(row.UnitPrice || row.Price || 0);
    const statedTotal = parseMoney(row.Total || 0);
    const calculatedTotal = Number((quantity * unitPrice).toFixed(2));
    
    const isReconciled = nearly(calculatedTotal, statedTotal);
    
    reconciled.Amount = statedTotal;
    reconciled._math_reconciled = isReconciled;
    
    if (!isReconciled && statedTotal > 0) {
      reconciled._math_error = `Receipt item total mismatch: calculated ${calculatedTotal}, stated ${statedTotal}`;
    }
    
    return reconciled;
  });
}

/**
 * Inventory reconciliation - validates quantity × unit price = total value
 */
function reconcileInventory(rows: any[]): ReconciledRow[] {
  return rows.map((row) => {
    const reconciled: ReconciledRow = { ...row };
    
    const quantity = parseFloat(row.Quantity || row.Qty || 0);
    const unitPrice = parseMoney(row.UnitPrice || row.Price || 0);
    const statedTotal = parseMoney(row.TotalValue || row.Total || 0);
    const calculatedTotal = Number((quantity * unitPrice).toFixed(2));
    
    const isReconciled = nearly(calculatedTotal, statedTotal);
    
    reconciled.Amount = statedTotal;
    reconciled._math_reconciled = isReconciled;
    
    if (!isReconciled && statedTotal > 0) {
      reconciled._math_error = `Inventory value mismatch: calculated ${calculatedTotal}, stated ${statedTotal}`;
    }
    
    return reconciled;
  });
}

/**
 * Generic reconciliation for unknown document types
 */
function reconcileGeneric(rows: any[]): ReconciledRow[] {
  return rows.map((row) => {
    const reconciled: ReconciledRow = { ...row };
    
    // Just validate that row has some content
    const hasContent = Object.values(row).some(v => 
      v !== null && v !== undefined && String(v).trim().length > 0
    );
    
    reconciled._math_reconciled = hasContent;
    
    if (!hasContent) {
      reconciled._math_error = 'Empty row';
    }
    
    return reconciled;
  });
}

// Helper functions
function isOpeningRow(row: any): boolean {
  const text = JSON.stringify(row).toLowerCase();
  return text.includes('opening') || text.includes('balance brought forward');
}

function isClosingRow(row: any): boolean {
  const text = JSON.stringify(row).toLowerCase();
  return text.includes('closing') || text.includes('balance carried forward');
}

function isInfoRow(row: any): boolean {
  const text = JSON.stringify(row).toLowerCase();
  return text.includes('info') || text.includes('summary') || text.includes('total charges');
}

function chooseSignByBalance(prev: number, stated: number, amountAbs: number, feeAbs: number) {
  const expPos = prev + amountAbs - feeAbs;
  const expNeg = prev - amountAbs - feeAbs;
  return Math.abs(expPos - stated) <= Math.abs(expNeg - stated) ? +1 : -1;
}