import { CanonicalTransaction } from '../types';

export interface ReconciliationResult {
  /** Map of row index → error description for rows that failed reconciliation */
  errors: Map<number, string>;
  /** Number of rows that could be checked (had both balance and a preceding balance) */
  checked: number;
  /** Number of rows that passed */
  passed: number;
}

const TOLERANCE = 0.02; // Allow 2 cent rounding tolerance

/**
 * Runs a balance reconciliation pass over canonical transactions.
 * For each row where both current and previous balance exist,
 * checks: previous_balance + amount ≈ current_balance
 */
export function reconcileCanonical(transactions: CanonicalTransaction[]): ReconciliationResult {
  const errors = new Map<number, string>();
  let checked = 0;
  let passed = 0;

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const currBalance = tx.balance;

    // Skip rows without a balance
    if (currBalance == null || !Number.isFinite(currBalance)) continue;

    // Find the previous row that has a balance
    let prevBalance: number | undefined;
    for (let j = i - 1; j >= 0; j--) {
      if (transactions[j].balance != null && Number.isFinite(transactions[j].balance!)) {
        prevBalance = transactions[j].balance!;
        break;
      }
    }

    // Can't reconcile the first balanced row (no predecessor)
    if (prevBalance == null) continue;

    checked++;

    const amount = tx.amount ?? 0;
    const charges = tx.charges ?? 0;
    const expected = prevBalance + amount - charges;
    const diff = Math.abs(expected - currBalance);

    if (diff <= TOLERANCE) {
      passed++;
    } else {
      const sign = expected > currBalance ? '+' : '';
      errors.set(i, `Expected ${expected.toFixed(2)}, got ${currBalance.toFixed(2)} (off by ${sign}${(expected - currBalance).toFixed(2)})`);
    }
  }

  return { errors, checked, passed };
}
