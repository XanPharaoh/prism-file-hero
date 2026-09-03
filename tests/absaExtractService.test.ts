import { describe, it, expect } from 'vitest';
import {
  extractAbsaStatementFromText,
  convertAbsaToExcelRows,
  isAbsaStatement,
} from '../services/absaExtractService';
import { detectBank, getBankPattern } from '../services/bankRegistry';

describe('ABSA Extract Service', () => {
  describe('detectBank integration', () => {
    it('detects ABSA from statement text', () => {
      const text = `ABSA Bank Limited
Cheque Account Statement
Account Number: 40-1234-5678
Branch Code: 632005`;
      const result = detectBank(text);
      expect(result.bankCode).toBe('ABSA_SA');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('retrieves ABSA pattern from registry', () => {
      const pattern = getBankPattern('ABSA_SA');
      expect(pattern).toBeDefined();
      expect(pattern?.name).toBe('ABSA South Africa');
      expect(pattern?.dateFormat).toBe('DD/MM/YYYY');
      expect(pattern?.columnHints).toContain('Narrative');
    });
  });

  describe('extractAbsaStatementFromText', () => {
    const absaSample = `
ABSA Bank Ltd (Reg No 1986/004794/06)
Authorised Financial Services and Registered Credit Provider
Cheque Account Number: 40-8123-4567
Branch Code: 632005
Statement From 15/06/2026 to 15/07/2026

Date Narrative Charges Debit Credit Balance
15/06/2026 Bal brought forward 829 256.88
15/06/2026 INTERNET PAYMENT FROM ABC CLIENT 8 620.00 837 876.88
  INVOICE 1042 SETTLEMENT
18/06/2026 POS PURCHASE PICK N PAY -1 250.00 836 626.88
  STORE 4052 CLAREMONT
20/06/2026 SASWITCH ATM CASH WITHDRAWAL 2 000.00 834 626.88
  A 15.50
25/06/2026 MONTHLY SERVICE FEE 120.00 834 506.88
  T
Closing Balance: 834 506.88
`.trim();

    it('extracts opening and closing balances and metadata', () => {
      const result = extractAbsaStatementFromText(absaSample);
      expect(result.metadata.bankCode).toBe('ABSA_SA');
      expect(result.metadata.accountNumber).toBe('4081234567');
      expect(result.metadata.branchCode).toBe('632005');
      expect(result.openingBalance).toBe(829256.88);
      expect(result.closingBalance).toBe(834506.88);
    });

    it('extracts credit, debit, and fee transactions with multi-line narratives', () => {
      const result = extractAbsaStatementFromText(absaSample);
      expect(result.transactions.length).toBeGreaterThanOrEqual(3);

      const creditTx = result.transactions.find((t) => /INTERNET PAYMENT/i.test(t.Description));
      expect(creditTx).toBeDefined();
      expect(creditTx?.Date).toBe('2026-06-15');
      expect(creditTx?.Credit).toBe(8620.00);
      expect(creditTx?.Debit).toBeNull();
      expect(creditTx?.Balance).toBe(837876.88);
      expect(creditTx?.Direction).toBe('CREDIT');
      expect(creditTx?.Description).toContain('INVOICE 1042');

      const debitTx = result.transactions.find((t) => /PICK N PAY/i.test(t.Description));
      expect(debitTx).toBeDefined();
      expect(debitTx?.Date).toBe('2026-06-18');
      expect(debitTx?.Debit).toBe(1250.00);
      expect(debitTx?.Direction).toBe('DEBIT');
      expect(debitTx?.Description).toContain('STORE 4052');

      const feeTx = result.transactions.find((t) => /SERVICE FEE/i.test(t.Description) || t.Direction === 'FEE');
      expect(feeTx).toBeDefined();
    });

    it('converts to Excel-ready rows', () => {
      const result = extractAbsaStatementFromText(absaSample);
      const rows = convertAbsaToExcelRows(result.transactions);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toHaveProperty('Date');
      expect(rows[0]).toHaveProperty('Description');
      expect(rows[0]).toHaveProperty('Balance');
      expect(rows[0]).toHaveProperty('Direction');
    });

    it('detects ABSA statement with isAbsaStatement', async () => {
      expect(await isAbsaStatement(absaSample)).toBe(true);
      expect(await isAbsaStatement('Unrelated bank content')).toBe(false);
    });
  });
});
