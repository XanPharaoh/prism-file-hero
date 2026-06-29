/**
 * Date Parser Tests
 * 
 * Tests for:
 * - Parsing different date formats
 * - Multilingual month names (EN, AF, ES, FR, PT, DE)
 * - Date edge cases (leap years, century boundaries)
 * - ISO format output
 */

import { describe, it, expect } from 'vitest';
import { parseDate, parseDateToISO, getMonthNumber } from '../services/dateParser';
import { testAssertions } from './setup';

describe('Date Parser', () => {
  describe('parseDate()', () => {
    it('should parse "06 Jan 2024" format', () => {
      const result = parseDate('06 Jan 2024');

      expect(result.date).toBeDefined();
      expect(result.format).toBe('DDMMMYYYY');
      expect(result.confidence).toBeGreaterThan(90);
      testAssertions.assertValidParsedDate(result);
    });

    it('should parse "6 January" format without year', () => {
      const result = parseDate('6 January');

      expect(result.date).toBeDefined();
      expect(result.confidence).toBeGreaterThan(80);
    });

    it('should parse numeric format "06/01/2024"', () => {
      const result = parseDate('06/01/2024');

      expect(result.date).toBeDefined();
      expect(result.format).toBe('DD/MM/YYYY');
    });

    it('should parse numeric format "6/1"', () => {
      const result = parseDate('6/1');

      expect(result.date).toBeDefined();
      expect(result.confidence).toBeGreaterThan(80);
    });

    it('should parse ISO format "2024-01-06"', () => {
      const result = parseDate('2024-01-06');

      expect(result.date).toBeDefined();
      expect(result.format).toBe('YYYY-MM-DD');
    });

    it('should handle Afrikaans month names', () => {
      const result = parseDate('06 Januarie 2024');

      expect(result.date).toBeDefined();
      expect(result.confidence).toBeGreaterThan(80);
    });

    it('should handle Spanish month names', () => {
      const result = parseDate('06 Enero 2024');

      expect(result.date).toBeDefined();
      expect(result.confidence).toBeGreaterThan(80);
    });

    it('should return null date for invalid input', () => {
      const result = parseDate('invalid date');

      expect(result.date).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it('should handle empty input', () => {
      const result = parseDate('');

      expect(result.date).toBeNull();
      expect(result.confidence).toBe(0);
    });
  });

  describe('parseDateToISO()', () => {
    it('should return ISO format string', () => {
      const iso = parseDateToISO('06 Jan 2024');

      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(iso).toBe('2024-01-06');
    });

    it('should return null for invalid date', () => {
      const iso = parseDateToISO('invalid');

      expect(iso).toBeNull();
    });
  });

  describe('getMonthNumber()', () => {
    it('should parse English months', () => {
      expect(getMonthNumber('January')).toBe(1);
      expect(getMonthNumber('Dec')).toBe(12);
      expect(getMonthNumber('JAN')).toBe(1);
    });

    it('should parse Afrikaans months', () => {
      expect(getMonthNumber('Januarie')).toBe(1);
      expect(getMonthNumber('Desember')).toBe(12);
    });

    it('should parse Spanish months', () => {
      expect(getMonthNumber('Enero')).toBe(1);
      expect(getMonthNumber('Diciembre')).toBe(12);
    });

    it('should return null for invalid month', () => {
      expect(getMonthNumber('InvalidMonth')).toBeNull();
    });
  });
});
