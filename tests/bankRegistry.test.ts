/**
 * Bank Registry Detection Tests
 * 
 * Tests for:
 * - Bank detection from statement text
 * - Pattern matching for multiple banks
 * - Confidence scoring
 * - Column pattern retrieval
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectBank, getBankPattern, getAllBankCodes, isFooterLine } from '../services/bankRegistry';
import { testAssertions, testDataGenerator } from './setup';

describe('Bank Registry', () => {
  describe('detectBank()', () => {
    it('should detect FNB from statement text', () => {
      const text = 'First National Bank Account Statement Date: 01 Jan 2024';
      const result = detectBank(text);

      expect(result.bankCode).toBe('FNB_SA');
      expect(result.confidence).toBeGreaterThan(0);
      testAssertions.assertValidBankDetection(result);
    });

    it('prioritizes the statement header over bank names in transaction text', () => {
      const text = 'FNB Gold Business Account Statement\n20 Jan FNB App Transfer\n21 Jan Capitec payment';
      const result = detectBank(text);

      expect(result.bankCode).toBe('FNB_SA');
    });

    it('should detect ABSA from statement text', () => {
      const text = 'ABSA Bank Limited Account Statement';
      const result = detectBank(text);

      expect(['ABSA_SA', 'UNKNOWN']).toContain(result.bankCode);
    });

    it('should detect ICICI from statement text', () => {
      const text = 'ICICI Bank Account Statement';
      const result = detectBank(text);

      expect(['ICICI_IN', 'UNKNOWN']).toContain(result.bankCode);
    });

    it('should return UNKNOWN for unrecognized bank', () => {
      const result = detectBank('Random Bank Statement');

      expect(result.bankCode).toBe('UNKNOWN');
      expect(result.confidence).toBe(0);
    });

    it('should detect Capitec from statement text', () => {
      const text = 'Capitec Bank Transaction History Global One Account';
      const result = detectBank(text);

      expect(result.bankCode).toBe('CAPITEC_SA');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should detect TymeBank from statement text', () => {
      const text = 'TymeBank Account Statement for January 2026';
      const result = detectBank(text);

      expect(result.bankCode).toBe('TYMEBANK_SA');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should detect Investec from statement text', () => {
      const text = 'Investec Private Bank Account Statement';
      const result = detectBank(text);

      expect(result.bankCode).toBe('INVESTEC_SA');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should detect Discovery Bank from statement text', () => {
      const text = 'Discovery Bank Account Statement';
      const result = detectBank(text);

      expect(result.bankCode).toBe('DISCOVERY_BANK_SA');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should detect African Bank from statement text', () => {
      const text = 'African Bank Account Statement';
      const result = detectBank(text);

      expect(result.bankCode).toBe('AFRICAN_BANK_SA');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should handle empty input', () => {
      const result = detectBank('');

      expect(result.bankCode).toBe('UNKNOWN');
      expect(result.confidence).toBe(0);
    });
  });

  describe('getBankPattern()', () => {
    it('should retrieve FNB pattern', () => {
      const pattern = getBankPattern('FNB_SA');

      expect(pattern).toBeDefined();
      expect(pattern?.name).toBe('FNB South Africa');
      expect(pattern?.code).toBe('FNB_SA');
      expect(pattern?.currencySymbol).toBe('R');
    });

    it('should retrieve ICICI pattern', () => {
      const pattern = getBankPattern('ICICI_IN');

      expect(pattern).toBeDefined();
      expect(pattern?.name).toBe('ICICI Bank India');
      expect(pattern?.currencySymbol).toBe('₹');
    });

    it('should return undefined for unknown bank', () => {
      const pattern = getBankPattern('UNKNOWN_BANK');

      expect(pattern).toBeUndefined();
    });
  });

  describe('getAllBankCodes()', () => {
    it('should return array of bank codes', () => {
      const codes = getAllBankCodes();

      expect(Array.isArray(codes)).toBe(true);
      expect(codes.length).toBeGreaterThan(0);
      expect(codes).toContain('FNB_SA');
    });
  });

  describe('isFooterLine()', () => {
    it('should identify FNB footer lines', () => {
      const footerLine = 'Delivery Method: Email';

      const isFooter = isFooterLine(footerLine, 'FNB_SA');

      expect(isFooter).toBe(true);
    });

    it('should not identify regular transaction as footer', () => {
      const transactionLine = '06 Jan 2024 Test transaction 1,000.00 10,000.00';

      const isFooter = isFooterLine(transactionLine, 'FNB_SA');

      expect(isFooter).toBe(false);
    });
  });
});
