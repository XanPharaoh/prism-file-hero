import { describe, it, expect } from 'vitest';
import {
  extractInvestmentStatementFromText,
  convertInvestmentToExcelRows,
  parseInvestmentMoney,
  isInvestmentStatement,
} from '../services/investmentExtractService';
import { detectBank, getBankPattern } from '../services/bankRegistry';

describe('Investment Extract Service', () => {
  describe('parseInvestmentMoney', () => {
    it('parses formatted ZAR investment values and bracketed negatives', () => {
      expect(parseInvestmentMoney('R 1,234,567.89')).toBe(1234567.89);
      expect(parseInvestmentMoney('(15,200.00)')).toBe(-15200.00);
      expect(parseInvestmentMoney('350.25')).toBe(350.25);
      expect(parseInvestmentMoney(null)).toBeNull();
    });
  });

  describe('detectBank integration for investment portfolios', () => {
    it('detects Old Mutual from statement text', () => {
      const text = `Old Mutual Wealth Portfolio Valuation
Policy Number: 18492041
Investor: J. Doe`;
      const result = detectBank(text);
      expect(result.bankCode).toBe('OLD_MUTUAL_SA');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('detects Sanlam Glacier from statement text', () => {
      const text = `Glacier by Sanlam
Portfolio Statement for Living Annuity
Plan Number: 90281412`;
      const result = detectBank(text);
      expect(result.bankCode).toBe('SANLAM_SA');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('detects generic Investment Portfolio statements', () => {
      const text = `Allan Gray Investment Statement
Unit Trust Portfolio Valuation
Account Number: AG-123456`;
      const result = detectBank(text);
      expect(result.bankCode).toBe('INVESTMENT_PORTFOLIO_SA');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('retrieves registered pattern', () => {
      const pattern = getBankPattern('OLD_MUTUAL_SA');
      expect(pattern).toBeDefined();
      expect(pattern?.name).toBe('Old Mutual South Africa');
      expect(pattern?.columnHints).toContain('Fund Name');
    });
  });

  describe('Old Mutual portfolio extraction', () => {
    const oldMutualSample = `
Old Mutual Max Investments
Portfolio Valuation Statement
Policy Number: 18492041
Investor Name: S. J. Van Der Merwe
Product Type: Retirement Annuity
Financial Advisor: Cape Financial Advisory Services
Valuation Date: 30/06/2026

Portfolio Valuation Summary
Opening Portfolio Value: R 850,000.00
Total Contributions: R 30,000.00
Total Withdrawals: R 0.00
Investment Return: R 45,620.00
Total Fees: R -3,250.00
Closing Portfolio Value: R 922,370.00

Portfolio Holdings
Fund Name Units Unit Price Market Value Portfolio %
Old Mutual Albaraka Equity Fund 1,245.5000 350.25 436,236.38 47.29%
Old Mutual Balanced Fund 2,500.0000 154.45 386,125.00 41.86%
Old Mutual Money Market Fund 1,000.0000 100.00 100,008.62 10.85%

Transaction History
01/05/2026 Monthly Debit Order Premium 10,000.00 860,000.00
01/06/2026 Monthly Debit Order Premium 10,000.00 870,000.00
15/06/2026 Management Fee -1,625.00 868,375.00
`.trim();

    it('extracts metadata and valuation summary', () => {
      const result = extractInvestmentStatementFromText(oldMutualSample);
      expect(result.metadata.institutionCode).toBe('OLD_MUTUAL_SA');
      expect(result.metadata.policyNumber).toBe('18492041');
      expect(result.metadata.investorName).toContain('Van Der Merwe');
      expect(result.metadata.productType).toBe('Retirement Annuity');
      expect(result.metadata.advisorName).toContain('Cape Financial Advisory Services');
      expect(result.summary.openingValue).toBe(850000);
      expect(result.summary.closingValue).toBe(922370);
      expect(result.summary.contributions).toBe(30000);
      expect(result.summary.growth).toBe(45620);
      expect(result.summary.fees).toBe(-3250);
    });

    it('extracts holdings with asset class classification', () => {
      const result = extractInvestmentStatementFromText(oldMutualSample);
      expect(result.holdings).toHaveLength(3);

      const equityFund = result.holdings[0];
      expect(equityFund.fundName).toBe('Old Mutual Albaraka Equity Fund');
      expect(equityFund.assetClass).toBe('Equity');
      expect(equityFund.units).toBe(1245.5);
      expect(equityFund.unitPrice).toBe(350.25);
      expect(equityFund.marketValue).toBe(436236.38);
      expect(equityFund.portfolioPercentage).toBe(47.29);

      const balancedFund = result.holdings[1];
      expect(balancedFund.fundName).toBe('Old Mutual Balanced Fund');
      expect(balancedFund.assetClass).toBe('Multi Asset / Balanced');
      expect(balancedFund.marketValue).toBe(386125.00);

      const mmFund = result.holdings[2];
      expect(mmFund.fundName).toBe('Old Mutual Money Market Fund');
      expect(mmFund.assetClass).toBe('Money Market / Cash');
      expect(mmFund.marketValue).toBe(100008.62);
    });

    it('extracts investment transactions with proper direction', () => {
      const result = extractInvestmentStatementFromText(oldMutualSample);
      expect(result.transactions.length).toBeGreaterThanOrEqual(3);

      const premiumTx = result.transactions[0];
      expect(premiumTx.date).toBe('2026-05-01');
      expect(premiumTx.direction).toBe('INFLOW');
      expect(premiumTx.amount).toBe(10000);

      const feeTx = result.transactions.find((t) => t.direction === 'FEE');
      expect(feeTx).toBeDefined();
      expect(feeTx?.date).toBe('2026-06-15');
      expect(feeTx?.amount).toBe(-1625);
    });

    it('converts holdings and transactions to Excel rows', () => {
      const result = extractInvestmentStatementFromText(oldMutualSample);
      const rows = convertInvestmentToExcelRows(result);
      expect(rows.length).toBeGreaterThanOrEqual(3);
      expect(rows[0]).toHaveProperty('Fund Name');
      expect(rows[0]).toHaveProperty('Market Value');
      expect(rows[0]).toHaveProperty('Portfolio %');
    });

    it('identifies investment statements with isInvestmentStatement', async () => {
      expect(await isInvestmentStatement(oldMutualSample)).toBe(true);
      expect(await isInvestmentStatement('Checking account statement')).toBe(false);
    });
  });

  describe('Sanlam / Glacier portfolio extraction', () => {
    const sanlamSample = `
Glacier by Sanlam
Portfolio Valuation
Plan Number: GL-987654
Client Name: M. A. Peterson
Statement Period: 01 Jan 2026 - 30 Jun 2026
Opening Value: R 1,200,000.00
Closing Value: R 1,280,000.00

Fund Name Units Price per unit Total Value Portfolio %
SIM Balanced Fund 5,000.0000 140.00 700,000.00 54.69%
Sanlam Inflation Linked Fund 3,000.0000 120.00 360,000.00 28.13%
Satrix Top 40 ETF 2,000.0000 110.00 220,000.00 17.18%
`.trim();

    it('extracts Sanlam / Glacier portfolio holdings correctly', () => {
      const result = extractInvestmentStatementFromText(sanlamSample);
      expect(result.metadata.institutionCode).toBe('SANLAM_SA');
      expect(result.metadata.policyNumber).toBe('GL-987654');
      expect(result.metadata.investorName).toContain('Peterson');
      expect(result.summary.openingValue).toBe(1200000);
      expect(result.summary.closingValue).toBe(1280000);
      expect(result.holdings).toHaveLength(3);
      expect(result.holdings[0].fundName).toBe('SIM Balanced Fund');
      expect(result.holdings[0].marketValue).toBe(700000);
    });
  });
});
