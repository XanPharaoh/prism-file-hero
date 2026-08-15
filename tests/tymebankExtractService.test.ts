import { describe, it, expect } from 'vitest';
import {
  convertTymeBankToExcelRows,
  extractTymeBankStatement,
  extractTymeBankStatementFromText,
  parseTymeMoney,
} from '../services/tymebankExtractService';
import { detectBank } from '../services/bankRegistry';

describe('parseTymeMoney', () => {
  it('parses space-separated thousands', () => {
    expect(parseTymeMoney('1 234.56')).toBe(1234.56);
  });

  it('parses R-prefixed and comma thousands', () => {
    expect(parseTymeMoney('R 2,500.00')).toBe(2500);
  });
});

describe('extractTymeBankStatementFromText', () => {
  const sample = `
TymeBank Everyday Account
Account Number: 1234567890
Branch code: 678910
Opening balance: R 1 000.00
Date Description Fees Money Out Money In Balance
01/01/2026 POS Purchase Shoprite  50.00   950.00
  aisle 3 receipt
02/01/2026 Salary Payment    5 000.00  5 950.00
03/01/2026 Service Fee 2.50     5 947.50
Closing balance: R 5 947.50
`.trim();

  /** Matches plan sample layout (business/personal 6-column). */
  const planSample = `
TymeBank Business Account Statement
Account Num. 51045311717
Branch Code 678910
Period 01 Nov 2025 - 30 Nov 2025
Opening Balance 35.13
Date Description Fees Money Out Money In Balance
01 Nov 2025 PayShap - domain money 227.73 262.86
01 Nov 2025 Debit Order - AFRIHOST 297.00 163.76
15 Nov 2025 Fee: Unsuccessful Purchase 3.00 3.00 0.00
Closing Balance 0.00
`.trim();

  it('detects TymeBank from sample text', () => {
    const det = detectBank(sample);
    expect(det.bankCode).toBe('TYMEBANK_SA');
    expect(det.confidence).toBeGreaterThan(0);
  });

  it('extracts 6-column transactions with directions', () => {
    const result = extractTymeBankStatementFromText(sample, 1);
    expect(result.metadata.bankCode).toBe('TYMEBANK_SA');
    expect(result.transactions.length).toBeGreaterThanOrEqual(2);

    const debit = result.transactions.find((t) => /Shoprite/i.test(t.description));
    expect(debit).toBeTruthy();
    expect(debit!.direction).toBe('DEBIT');
    expect(debit!.moneyOut).toBe(50);

    const credit = result.transactions.find((t) => /Salary/i.test(t.description));
    expect(credit).toBeTruthy();
    expect(credit!.direction).toBe('CREDIT');
    expect(credit!.moneyIn).toBe(5000);

    // Multi-line description continuation
    expect(debit!.description.toLowerCase()).toContain('aisle');
  });

  it('parses plan-format statement with PayShap, debit order, and fee rows', async () => {
    const det = detectBank(planSample);
    expect(det.bankCode).toBe('TYMEBANK_SA');

    const result = await extractTymeBankStatement(planSample, 1);
    expect(result.metadata.bankName).toBe('TymeBank');
    expect(result.metadata.accountNumber?.replace(/\s/g, '')).toContain('51045311717');
    expect(result.metadata.branchCode).toBe('678910');
    expect(result.metadata.openingBalance).toBe(35.13);
    expect(result.metadata.closingBalance).toBe(0);
    expect(result.metadata.statementPeriod).toMatch(/01 Nov 2025/i);
    expect(result.transactions.length).toBe(3);

    const credit = result.transactions.find((t) => /PayShap/i.test(t.description));
    expect(credit?.direction).toBe('CREDIT');
    expect(credit?.moneyIn).toBe(227.73);

    const debit = result.transactions.find((t) => /AFRIHOST/i.test(t.description));
    expect(debit?.direction).toBe('DEBIT');
    expect(debit?.moneyOut).toBe(297);

    const fee = result.transactions.find((t) => /Unsuccessful Purchase/i.test(t.description));
    expect(fee?.direction).toBe('FEE');
    expect(fee?.fees).toBe(3);

    const rows = convertTymeBankToExcelRows(result.transactions);
    expect(rows[0]).toHaveProperty('Confidence');
    expect(rows[0]).toHaveProperty('Money Out');
    expect(rows[0]).toHaveProperty('Money In');
  });

  it('converts to excel rows with expected columns', () => {
    const result = extractTymeBankStatementFromText(sample, 1);
    const rows = convertTymeBankToExcelRows(result.transactions);
    expect(rows[0]).toHaveProperty('Date');
    expect(rows[0]).toHaveProperty('Description');
    expect(rows[0]).toHaveProperty('Fees');
    expect(rows[0]).toHaveProperty('Money Out');
    expect(rows[0]).toHaveProperty('Money In');
    expect(rows[0]).toHaveProperty('Balance');
    expect(rows[0]).toHaveProperty('Direction');
    expect(rows[0]).toHaveProperty('Confidence');
  });

  it('captures opening/closing balances', () => {
    const result = extractTymeBankStatementFromText(sample, 1);
    expect(result.metadata.openingBalance).toBe(1000);
    expect(result.metadata.closingBalance).toBe(5947.5);
  });
});
