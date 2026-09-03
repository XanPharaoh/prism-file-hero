import { describe, it, expect } from 'vitest';
import {
  extractStandardBankStatementFromText,
  convertStandardBankToExcelRows,
  parseStandardBankMoney,
  isStandardBankStatement,
} from '../services/standardBankExtractService';
import { detectBank, getBankPattern } from '../services/bankRegistry';

describe('Standard Bank Extract Service', () => {
  describe('parseStandardBankMoney', () => {
    it('parses formatted ZAR money amounts', () => {
      expect(parseStandardBankMoney('R 1,234.56')).toBe(1234.56);
      expect(parseStandardBankMoney('-60,382.64')).toBe(-60382.64);
      expect(parseStandardBankMoney('500.00')).toBe(500.00);
      expect(parseStandardBankMoney(null)).toBeNull();
    });
  });

  describe('detectBank integration', () => {
    it('detects Standard Bank from statement header', () => {
      const text = `Standard Bank of South Africa Limited
Account Statement
Account number: 012345678
Branch code: 051001`;
      const result = detectBank(text);
      expect(result.bankCode).toBe('STANDARD_BANK_SA');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('detects SBSA abbreviation', () => {
      const text = `SBSA Statement of Account
Account No: 987654321`;
      const result = detectBank(text);
      expect(result.bankCode).toBe('STANDARD_BANK_SA');
    });

    it('retrieves registered pattern', () => {
      const pattern = getBankPattern('STANDARD_BANK_SA');
      expect(pattern).toBeDefined();
      expect(pattern?.name).toBe('Standard Bank South Africa');
      expect(pattern?.currencySymbol).toBe('R');
      expect(pattern?.columnHints).toContain('Payments');
    });
  });

  describe('extractStandardBankStatementFromText', () => {
    const sbsaSample = `
Standard Bank of South Africa Limited
Account Statement
Account Number: 10123456789
Branch Code: 051001
Branch Name: THIBAULT SQUARE
Statement Period: 01 May 2026 to 31 Jul 2026
Statement Opening Balance: R -59,481.55

Date Description Payments Deposits Balance
07 May 2026 ACCOUNT PAYMENT - THANK YOU -901.09 -60,382.64
  REF: 9876543210 INTERNET TFR
08 May 2026 SALARY DEPOSIT 25,000.00 -35,382.64
  EMPLOYER ABC PTY LTD
15 May 2026 CARD PURCHASE WOOLWORTHS -450.50 -35,833.14
  CARD NO: ************1234
  BRANCH: WATERFRONT CT
Statement Closing Balance: R -35,833.14
Total Payments: -1,351.59
Total Deposits: 25,000.00
`.trim();

    it('extracts metadata correctly', () => {
      const result = extractStandardBankStatementFromText(sbsaSample);
      expect(result.metadata.bankCode).toBe('STANDARD_BANK_SA');
      expect(result.metadata.accountNumber).toBe('10123456789');
      expect(result.metadata.branchCode).toBe('051001');
      expect(result.metadata.branchName).toBe('THIBAULT SQUARE');
      expect(result.openingBalance).toBe(-59481.55);
      expect(result.closingBalance).toBe(-35833.14);
    });

    it('extracts transactions with proper direction and amounts', () => {
      const result = extractStandardBankStatementFromText(sbsaSample);
      expect(result.transactions).toHaveLength(3);

      const debit1 = result.transactions[0];
      expect(debit1.Date).toBe('2026-05-07');
      expect(debit1.Debit).toBe(901.09);
      expect(debit1.Credit).toBeNull();
      expect(debit1.Balance).toBe(-60382.64);
      expect(debit1.Direction).toBe('DEBIT');
      // Multi-line narrative continuation
      expect(debit1.Description).toContain('ACCOUNT PAYMENT');
      expect(debit1.Description).toContain('REF: 9876543210');

      const credit1 = result.transactions[1];
      expect(credit1.Date).toBe('2026-05-08');
      expect(credit1.Debit).toBeNull();
      expect(credit1.Credit).toBe(25000.00);
      expect(credit1.Balance).toBe(-35382.64);
      expect(credit1.Direction).toBe('CREDIT');
      expect(credit1.Description).toContain('SALARY DEPOSIT');
      expect(credit1.Description).toContain('EMPLOYER ABC PTY LTD');

      const debit2 = result.transactions[2];
      expect(debit2.Date).toBe('2026-05-15');
      expect(debit2.Debit).toBe(450.50);
      expect(debit2.Direction).toBe('DEBIT');
      expect(debit2.Description).toContain('CARD PURCHASE WOOLWORTHS');
      expect(debit2.Description).toContain('CARD NO: ************1234');
      expect(debit2.Description).toContain('BRANCH: WATERFRONT CT');
    });

    it('converts to Excel-ready rows', () => {
      const result = extractStandardBankStatementFromText(sbsaSample);
      const rows = convertStandardBankToExcelRows(result.transactions);
      expect(rows).toHaveLength(3);
      expect(rows[0]).toHaveProperty('Date', '2026-05-07');
      expect(rows[0]).toHaveProperty('Debit', 901.09);
      expect(rows[0]).toHaveProperty('Balance', -60382.64);
      expect(rows[0]).toHaveProperty('Direction', 'DEBIT');
    });

    it('detects Standard Bank statement with isStandardBankStatement', async () => {
      expect(await isStandardBankStatement(sbsaSample)).toBe(true);
      expect(await isStandardBankStatement('Some random bank string')).toBe(false);
    });
  });
});
