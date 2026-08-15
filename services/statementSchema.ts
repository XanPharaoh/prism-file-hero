/**
 * Canonical bank statement schema — the ONE internal contract.
 * All specialized extractors AND the generic path normalize to this shape.
 * Excel export maps these to friendly headers; internal pipeline uses these fields.
 */

export type Direction = 'DEBIT' | 'CREDIT' | 'FEE' | 'UNKNOWN';

export type LayoutProfile =
  | 'DEBIT_CREDIT_BALANCE'   // e.g. Chase, HSBC, FNB: separate Debit/Credit columns + Balance
  | 'MONEY_IN_OUT_FEES'      // e.g. TymeBank: Money In / Money Out / Fees / Balance
  | 'SINGLE_SIGNED_AMOUNT'   // e.g. Capitec, generic: one Amount column + Balance (sign or delta → direction)
  | 'POSITIONAL'             // weak headers, fixed x-clusters (use spatial extractor)
  | 'UNKNOWN';               // weak structure → OCR/Vision + low confidence

export interface CanonicalTransaction {
  date: string | null;           // ISO 'YYYY-MM-DD' preferred; null if unparseable
  description: string;
  debit: number | null;
  credit: number | null;
  fees: number | null;
  balance: number | null;
  amount: number | null;         // signed amount for SINGLE_SIGNED_AMOUNT profiles
  direction: Direction;
  currency: string | null;       // e.g. 'ZAR', 'USD', 'EUR'
  raw: string;                   // original line(s) for audit
  page: number;
  confidence: number;            // 0..1, computed per-row
}

export interface CanonicalStatement {
  bankCode: string | null;       // 'TYMEBANK_SA', 'FNB_SA', 'GENERIC', null
  bankName: string | null;
  layoutProfile: LayoutProfile;
  openingBalance: number | null;
  closingBalance: number | null;
  accountNumber: string | null;
  branchCode: string | null;
  statementPeriod: string | null;
  currency: string | null;
  transactions: CanonicalTransaction[];
  reconcile: {
    expected: number | null;     // opening + Σnet
    actual: number | null;       // closing from PDF
    delta: number | null;        // expected - actual
    isValid: boolean;
  };
  computedConfidence: number;    // 0..1, statement-level (formula below)
  pagesProcessed: number;
  rowsWithValidDate: number;
  rowsWithValidMoney: number;
  headerRolesMatched: boolean;
  parseErrors: number;
}

/**
 * Map canonical rows to Excel-friendly columns based on detected layout.
 * This is the ONLY place bank-specific Excel headers live.
 */
export function toExcelRows(
  stmt: CanonicalStatement
): Record<string, unknown>[] {
  const profile = stmt.layoutProfile;

  switch (profile) {
    case 'MONEY_IN_OUT_FEES':
      return stmt.transactions.map(tx => ({
        Date: tx.date,
        Description: tx.description,
        Fees: tx.fees,
        'Money Out': tx.debit,
        'Money In': tx.credit,
        Balance: tx.balance,
        Direction: tx.direction,
        Confidence: tx.confidence,
      }));

    case 'DEBIT_CREDIT_BALANCE':
      return stmt.transactions.map(tx => ({
        Date: tx.date,
        Description: tx.description,
        Debit: tx.debit,
        Credit: tx.credit,
        Balance: tx.balance,
        Direction: tx.direction,
        Confidence: tx.confidence,
      }));

    case 'SINGLE_SIGNED_AMOUNT':
    default:
      return stmt.transactions.map(tx => ({
        Date: tx.date,
        Description: tx.description,
        Amount: tx.amount,
        Balance: tx.balance,
        Direction: tx.direction,
        Confidence: tx.confidence,
      }));
  }
}
