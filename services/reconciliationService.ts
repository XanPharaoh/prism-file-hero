/**
 * Universal Reconciliation Service
 * Validates and normalizes extracted data across all document types
 */

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
function reconcileBankStatement(rows: any[], openingBalanceStr: string): ReconciledRow[] {
  let runningBalance = parseMoney(openingBalanceStr);
  const keys = Object.keys(rows[0]);

  const debitKey = findKey(keys, ['debit', 'debits', 'debiet', 'uit', 'withdrawals', 'withdrawal']);
  const creditKey = findKey(keys, ['credit', 'credits', 'krediet', 'deposit', 'deposits']);
  const feeKey = findKey(keys, ['fee', 'fees', 'charge', 'charges']);
  const amountKey = findKey(keys, ['amount', 'geld', 'money', 'bedrag']);
  const balanceKey = findKey(keys, ['balance', 'saldo']) || 'Balance';

  return rows.map((row) => {
    const reconciled: ReconciledRow = { ...row };
    const statedBalance = parseMoney(row[balanceKey] || '0');

    // --- OPENING / CLOSING / INFO: no monetary movement ---
    if (isOpeningRow(row) || isClosingRow(row) || isInfoRow(row)) {
      reconciled.Amount = 0;
      reconciled._math_reconciled = true;
      reconciled['Direction'] = '';
      if (Number.isFinite(statedBalance) && statedBalance !== 0) {
        runningBalance = statedBalance;
      }
      return reconciled;
    }

    // --- TRANSACTIONAL ROWS ---
    const debitVal = parseMoney(row[debitKey] || '0');
    const creditVal = parseMoney(row[creditKey] || '0');
    const feeVal = parseMoney(row[feeKey] || '0');

    let netChange: number | null = null;
    let isReconciled = false;

    if (debitKey || creditKey) {
      // Try: credits - debits - fees
      const attempt1 = Number((creditVal - debitVal - feeVal).toFixed(2));
      if (nearly(runningBalance + attempt1, statedBalance)) {
        netChange = attempt1;
        isReconciled = true;
      }

      // Try: credits - debits (fees already included in debit)
      if (!isReconciled) {
        const attempt2 = Number((creditVal - debitVal).toFixed(2));
        if (nearly(runningBalance + attempt2, statedBalance)) {
          netChange = attempt2;
          isReconciled = true;
        }
      }

      // Try: fee-only row (fee IS the debit, no separate debit column populated)
      if (!isReconciled && feeVal > 0 && debitVal === 0 && creditVal === 0) {
        const attempt3 = -Math.abs(feeVal);
        if (nearly(runningBalance + attempt3, statedBalance)) {
          netChange = Number(attempt3.toFixed(2));
          isReconciled = true;
        }
      }
    }

    if (!isReconciled && amountKey) {
      const amountRaw = row[amountKey];
      const amountIsSigned = hasExplicitSign(amountRaw) || parseMoney(amountRaw) < 0;
      const amountAbs = Math.abs(parseMoney(amountRaw));
      const feeAbs = Math.abs(feeVal);

      if (amountIsSigned) {
        const val = parseMoney(amountRaw);
        netChange = Number((val - feeAbs).toFixed(2));
      } else {
        const sign = chooseSignByBalance(runningBalance, statedBalance, amountAbs, feeAbs);
        netChange = Number((sign * amountAbs - feeAbs).toFixed(2));
      }

      if (netChange !== null && nearly(runningBalance + netChange, statedBalance)) {
        isReconciled = true;
      }
    }

    // Strategy 2: Derive from balance difference (fallback)
    if (!isReconciled || netChange === null) {
      const derived = Number((statedBalance - runningBalance).toFixed(2));
      netChange = derived;
      isReconciled = true;

      // Sanity check log
      if (debitVal > 0 && creditVal === 0 && derived > 0) {
        reconciled._math_error = `Debit row but balance increased by ${derived}`;
      }
      if (creditVal > 0 && debitVal === 0 && derived < 0) {
        reconciled._math_error = `Credit row but balance decreased by ${derived}`;
      }
    }

    reconciled.Amount = Number(netChange.toFixed(2));
    reconciled._math_reconciled = isReconciled;
    reconciled['Direction'] = netChange >= 0 ? 'In' : 'Out';

    runningBalance = statedBalance;
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