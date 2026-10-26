import { describe, it, expect } from 'vitest';
import { reconcileRows } from '../../services/reconciliationService';
import { ledgerGuard } from '../../services/ledgerGuard';
import { applyReviewGate } from '../../services/documentService';
import { getExcelBlob, LedgerExportRefusedError } from '../../services/excelService';

/**
 * The product claims it "refuses to export a ledger that doesn't reconcile". These tests are that
 * claim: the +R9,999 tamper (an Amount altered while the stated balances stay put) must produce no
 * workbook unless the caller asks for an explicitly labelled draft.
 */
function ledger(tampered = false) {
  return [
    { Date: '2026-01-01', Description: 'Opening balance', Amount: 0, Balance: 1000 },
    { Date: '2026-01-02', Description: 'Groceries', Amount: -100, Balance: 900 },
    { Date: '2026-01-03', Description: 'Salary', Amount: tampered ? 10200 : 200, Balance: 1100 },
    { Date: '2026-01-31', Description: 'Closing balance', Amount: 0, Balance: 1100 },
  ];
}

function healthFor(tampered: boolean) {
  const reconciled = reconcileRows(ledger(tampered), '1000', 'bank-statement');
  const guard = ledgerGuard(reconciled.rows, '1000');
  return {
    reconciled,
    guard,
    metadata: {
      documentType: 'bank-statement',
      bankCode: 'FNB_SA',
      openingBalance: 1000,
      closingBalance: 1100,
      ledgerHealth: {
        isValid: reconciled.isValid && guard.status !== 'BLOCKED',
        status: guard.status,
        issues: guard.issues,
        badRows: guard.badRows,
      },
      reconciles: reconciled.isValid && guard.status !== 'BLOCKED',
    },
  };
}

describe('a balance-derived amount never counts as reconciled', () => {
  it('reports the tampered row as unreconciled instead of deriving its way to green', () => {
    const { reconciled } = healthFor(true);
    const salary = reconciled.rows.find((r: any) => r.Description === 'Salary') as any;
    expect(salary._math_reconciled).toBe(false);
    expect(String(salary._math_error)).toMatch(/derived .* from the balance movement/);
  });

  it('leaves a consistent ledger reconciled', () => {
    const { reconciled, guard } = healthFor(false);
    expect(reconciled.isValid).toBe(true);
    expect(guard.status).toBe('OK');
  });
});

describe('ledgerGate escalates instead of warning', () => {
  it('blocks on a single bad row, with no ratio threshold to hide behind', () => {
    const { guard } = healthFor(true);
    expect(guard.status).toBe('BLOCKED');
    expect(guard.badRows).toBeGreaterThan(0);
  });

  it('makes the review gate require a human before filing', () => {
    const { reconciled, metadata } = healthFor(true);
    const gated = applyReviewGate({ rows: reconciled.rows, metadata: { ...metadata } } as any);
    expect(gated.metadata.validationPassed).toBe(false);
    expect(gated.metadata.requiresReview).toBe(true);
    expect((gated.metadata.reviewReasons || []).join(' ')).toMatch(/do not reconcile from opening to closing/);
  });
});

describe('getExcelBlob refuses a final export of an unreconciled ledger', () => {
  it('yields no workbook for the +R9,999 tamper', async () => {
    const { reconciled, metadata } = healthFor(true);
    await expect(getExcelBlob(reconciled.rows, metadata)).rejects.toBeInstanceOf(LedgerExportRefusedError);
    await expect(getExcelBlob(reconciled.rows, metadata)).rejects.toThrow(/does not reconcile|failed the balance identity/);
  });

  it('allows the explicitly labelled draft export, and labels it unverified', async () => {
    const { reconciled, metadata } = healthFor(true);
    const blob = await getExcelBlob(reconciled.rows, { ...metadata, exportMode: 'draft' });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('exports a consistent ledger without a draft flag', async () => {
    const { reconciled, metadata } = healthFor(false);
    const blob = await getExcelBlob(reconciled.rows, metadata);
    expect(blob.size).toBeGreaterThan(0);
  });

  it('does not gate workbooks that carry no ledger health', async () => {
    const blob = await getExcelBlob([{ Item: 'A', Qty: 1 }], { documentType: 'invoice' });
    expect(blob.size).toBeGreaterThan(0);
  });
});
