/**
 * Normalizer Tests
 * 
 * Tests for:
 * - Row normalization to canonical format
 * - Column detection from headers
 * - Context creation
 * - Transaction validation
 * - Fragment merging
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeRow,
  detectColumns,
  createNormalizationContext,
  validateTransaction,
  mergeFragmentedTransactions,
} from '../services/normalizer';
import { testAssertions, testDataGenerator } from './setup';

describe('Normalizer', () => {
  let bankRegistry: any;

  beforeEach(() => {
    // Mock bank registry for testing
    bankRegistry = {
      code: 'FNB_SA',
      name: 'FNB South Africa',
      currencySymbol: 'R',
      decimalSeparator: '.',
      thousandsSeparator: ',',
    };
  });

  describe('detectColumns()', () => {
    it('should detect Date column', () => {
      const headers = ['Date', 'Description', 'Amount', 'Balance'];
      const mapping = detectColumns(headers);

      expect(mapping['date']).toBe(0);
    });

    it('should detect Description column', () => {
      const headers = ['Date', 'Particulars', 'Amount', 'Balance'];
      const mapping = detectColumns(headers);

      expect(mapping['description']).toBe(1);
    });

    it('should detect Debit/Credit columns', () => {
      const headers = ['Date', 'Description', 'Debit', 'Credit', 'Balance'];
      const mapping = detectColumns(headers);

      expect(mapping['debit']).toBe(2);
      expect(mapping['credit']).toBe(3);
    });

    it('should handle alternative column names', () => {
      const headers = ['Datum', 'Memo', 'Withdrawal', 'Deposit', 'Bal'];
      const mapping = detectColumns(headers);

      expect(mapping['date']).toBeDefined();
      expect(mapping['description']).toBeDefined();
    });
  });

  describe('createNormalizationContext()', () => {
    it('should create context for valid bank', () => {
      const headers = ['Date', 'Description', 'Amount', 'Balance'];
      const context = createNormalizationContext('FNB_SA', headers);

      expect(context).toBeDefined();
      expect(context?.bankCode).toBe('FNB_SA');
      expect(context?.extractedColumns).toEqual(headers);
    });

    it('should create column mapping', () => {
      const headers = ['Date', 'Description', 'Debit', 'Credit', 'Balance'];
      const context = createNormalizationContext('FNB_SA', headers);

      expect(context?.columnMapping).toBeDefined();
      expect(Object.keys(context?.columnMapping || {}).length).toBeGreaterThan(0);
    });

    it('should return null for unknown bank', () => {
      const headers = ['Date', 'Description', 'Amount'];
      const context = createNormalizationContext('UNKNOWN_BANK', headers);

      expect(context).toBeNull();
    });
  });

  describe('normalizeRow()', () => {
    it('should normalize FNB row to canonical format', () => {
      const context = {
        bankCode: 'FNB_SA',
        bankPattern: bankRegistry,
        extractedColumns: ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
        columnMapping: { date: 0, description: 1, debit: 2, credit: 3, balance: 4 },
      };

      const row = ['06 Jan 2024', 'Test Payment', '1000.00', '', '10000.00'];
      const normalized = normalizeRow(row, context);

      expect(normalized).toBeDefined();
      testAssertions.assertValidTransaction(normalized!);
      expect(normalized?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should return null for row without valid date', () => {
      const context = {
        bankCode: 'FNB_SA',
        bankPattern: bankRegistry,
        extractedColumns: ['Date', 'Description', 'Amount', 'Balance'],
        columnMapping: { date: 0, description: 1, amount: 2, balance: 3 },
      };

      const row = ['invalid date', 'Test', '1000', '10000'];
      const normalized = normalizeRow(row, context);

      expect(normalized).toBeNull();
    });

    it('should handle missing optional fields', () => {
      const context = {
        bankCode: 'FNB_SA',
        bankPattern: bankRegistry,
        extractedColumns: ['Date', 'Description', 'Amount', 'Balance'],
        columnMapping: { date: 0, description: 1, amount: 2, balance: 3 },
      };

      const row = ['06 Jan 2024', 'Test', '', '10000'];
      const normalized = normalizeRow(row, context);

      expect(normalized?.credit).toBeNull();
    });
  });

  describe('validateTransaction()', () => {
    it('should validate correct transaction', () => {
      const tx = {
        date: '2024-01-06',
        description: 'Test',
        debit: null,
        credit: 1000.0,
        balance: 10000.0,
        currency: 'ZAR',
        source: 'text' as const,
        confidence: 95,
        raw: 'test',
      };

      const validation = validateTransaction(tx);

      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    it('should reject transaction without date', () => {
      const tx = {
        date: '',
        description: 'Test',
        debit: null,
        credit: 1000.0,
        balance: 10000.0,
        currency: 'ZAR',
        source: 'text' as const,
        confidence: 95,
        raw: 'test',
      };

      const validation = validateTransaction(tx);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Missing date');
    });

    it('should reject transaction with low confidence', () => {
      const tx = {
        date: '2024-01-06',
        description: 'Test',
        debit: null,
        credit: 1000.0,
        balance: null,
        currency: 'ZAR',
        source: 'text' as const,
        confidence: 30,
        raw: 'test',
      };

      const validation = validateTransaction(tx);

      expect(validation.valid).toBe(false);
    });
  });

  describe('mergeFragmentedTransactions()', () => {
    it('should merge continuation rows', () => {
      const transactions = [
        {
          date: '2024-01-06',
          description: 'Test Payment',
          debit: null,
          credit: 1000.0,
          balance: 10000.0,
          currency: 'ZAR',
          source: 'text' as const,
          confidence: 95,
          raw: 'line1',
        },
        {
          date: '2024-01-06',
          description: 'to ABC Company',
          debit: null,
          credit: 1000.0,
          balance: 10000.0,
          currency: 'ZAR',
          source: 'text' as const,
          confidence: 95,
          raw: 'line2',
        },
      ];

      const merged = mergeFragmentedTransactions(transactions);

      expect(merged.length).toBe(1);
      expect(merged[0].description).toContain('to ABC Company');
    });

    it('should not merge different transactions', () => {
      const transactions = [
        testDataGenerator.generateCanonicalTransaction(),
        { ...testDataGenerator.generateCanonicalTransaction(), date: '2024-01-07' },
      ];

      const merged = mergeFragmentedTransactions(transactions);

      expect(merged.length).toBe(2);
    });

    it('should handle empty input', () => {
      const merged = mergeFragmentedTransactions([]);

      expect(merged.length).toBe(0);
    });
  });
});
