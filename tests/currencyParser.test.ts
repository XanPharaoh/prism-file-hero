/**
 * Currency Parser Tests
 * 
 * Tests for:
 * - Parsing different currency symbols
 * - Handling different number formats (1,000 vs 1.000)
 * - Cr/Dr indicator parsing
 * - Negative number detection
 * - Signed amount values
 */

import { describe, it, expect } from 'vitest';
import { parseAmount, parseAmountSigned, formatAmount, detectCurrency } from '../services/currencyParser';
import { testAssertions } from './setup';

describe('Currency Parser', () => {
  describe('parseAmount()', () => {
    it('should parse US format with comma grouping', () => {
      const result = parseAmount('R 1,234.56');

      expect(result.value).toBe(1234.56);
      expect(result.currency).toBe('ZAR');
      expect(result.format).toBe('NUMERIC');
      testAssertions.assertValidParsedAmount(result);
    });

    it('should parse European format with dot grouping', () => {
      const result = parseAmount('R 1.234,56');

      expect(result.value).toBe(1234.56);
      expect(result.currency).toBe('ZAR');
    });

    it('should handle Cr (Credit) indicator', () => {
      const result = parseAmount('1,000.00 Cr');

      expect(result.value).toBe(1000.0);
      expect(result.isCr).toBe(true);
      expect(result.isDr).toBe(false);
    });

    it('should handle Dr (Debit) indicator', () => {
      const result = parseAmount('500.00 Dr');

      expect(result.value).toBe(500.0);
      expect(result.isDr).toBe(true);
      expect(result.isCr).toBe(false);
    });

    it('should detect negative numbers', () => {
      const result = parseAmount('-1,000.00');

      expect(result.value).toBe(1000.0);
      expect(result.isNegative).toBe(true);
    });

    it('should handle parentheses for negative amounts', () => {
      const result = parseAmount('(500.00)');

      expect(result.isNegative).toBe(true);
    });

    it('should handle USD currency', () => {
      const result = parseAmount('$ 1,000.00');

      expect(result.currency).toBe('USD');
      expect(result.value).toBe(1000.0);
    });

    it('should handle EUR currency', () => {
      const result = parseAmount('€ 1.000,00');

      expect(result.currency).toBe('EUR');
    });

    it('should handle GBP currency', () => {
      const result = parseAmount('£ 1,000.00');

      expect(result.currency).toBe('GBP');
    });

    it('should handle INR currency', () => {
      const result = parseAmount('₹ 1,00,000.00');

      expect(result.currency).toBe('INR');
    });

    it('should handle empty input', () => {
      const result = parseAmount('');

      expect(result.value).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it('should handle invalid numeric input', () => {
      const result = parseAmount('not a number');

      expect(result.value).toBeNull();
      expect(result.format).toBe('INVALID');
    });
  });

  describe('parseAmountSigned()', () => {
    it('should return positive value for Credit', () => {
      const signed = parseAmountSigned('1,000.00 Cr');

      expect(signed).toBe(1000.0);
      expect(signed).toBeGreaterThan(0);
    });

    it('should return negative value for Debit', () => {
      const signed = parseAmountSigned('500.00 Dr');

      expect(signed).toBe(-500.0);
      expect(signed).toBeLessThan(0);
    });

    it('should handle negative indicator', () => {
      const signed = parseAmountSigned('-1,000.00');

      expect(signed).toBe(-1000.0);
    });

    it('should return null for invalid input', () => {
      const signed = parseAmountSigned('invalid');

      expect(signed).toBeNull();
    });
  });

  describe('formatAmount()', () => {
    it('should format to readable string', () => {
      const formatted = formatAmount(1234.56, 'ZAR');

      expect(formatted).toContain('1234.56');
    });

    it('should handle negative values', () => {
      const formatted = formatAmount(-1000.0, 'USD');

      expect(formatted).toContain('-');
      expect(formatted).toContain('1000.00');
    });

    it('should respect decimal places', () => {
      const formatted = formatAmount(1000, 'EUR', 3);

      expect(formatted).toContain('1000.000');
    });
  });

  describe('detectCurrency()', () => {
    it('should detect ZAR from R symbol', () => {
      const currency = detectCurrency('R 1000');

      expect(currency).toBe('ZAR');
    });

    it('should detect USD from $ symbol', () => {
      const currency = detectCurrency('$ 1000');

      expect(currency).toBe('USD');
    });

    it('should detect EUR from € symbol', () => {
      const currency = detectCurrency('€ 1000');

      expect(currency).toBe('EUR');
    });

    it('should default to ZAR for unknown', () => {
      const currency = detectCurrency('1000');

      expect(currency).toBe('ZAR');
    });
  });
});
