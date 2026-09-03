import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { processDocumentExcel } from '../services/documentService';

vi.mock('../services/ocrService', () => ({
  ocrPdfToTextItems: vi.fn(),
}));

const CORPUS_DIR = path.resolve(__dirname, 'fixtures/statements');
const UNIQUE_FIXTURES = [
  {
    filename: '14. 15 Jun - 15 Jul 2026 R1250.pdf',
    bankCode: 'ABSA_SA',
    rows: 288,
    openingBalance: 829256.88,
    closingBalance: 586834.19,
    source: 'absa-native-extraction',
  },
  {
    filename: 'Bank statement Use and upload SBSA_Statement_2026-08-05_3months._pdf.pdf',
    bankCode: 'STANDARD_BANK_SA',
    rows: 277,
    openingBalance: 205365.72,
    closingBalance: 66616.24,
    source: 'standard-bank-native-extraction',
  },
  {
    filename: 'July 2026.pdf',
    bankCode: 'NEDBANK_SA',
    rows: 32,
    openingBalance: -62.32,
    closingBalance: -90.66,
    source: 'nedbank-multiline-extraction',
  },
  {
    filename: 'Robbie_Accountants_2026-01.pdf',
    bankCode: 'FNB_SA',
    rows: 92,
    openingBalance: 44917.42,
    closingBalance: 12732.05,
    source: 'fnb-position-extraction',
  },
  {
    filename: 'SBSA_Statement_2026-08-04_3months.pdf',
    bankCode: 'STANDARD_BANK_SA',
    rows: 125,
    openingBalance: -59481.55,
    closingBalance: -75720.14,
    source: 'standard-bank-native-extraction',
  },
  {
    filename: 'Test.pdf',
    bankCode: 'FNB_SA',
    rows: 151,
    openingBalance: 181952.62,
    closingBalance: 184407.90,
    source: 'fnb-position-extraction',
  },
];

describe('statement corpus deep-parser audit', () => {
  it.each(UNIQUE_FIXTURES)(
    'processes $filename with full reconciliation, clean descriptions, ISO dates, and proper directions',
    async ({ filename, bankCode, rows, openingBalance, closingBalance, source }) => {
      const filePath = path.join(CORPUS_DIR, filename);
      expect(fs.existsSync(filePath), `missing fixture: ${filePath}`).toBe(true);

      const file = new File([fs.readFileSync(filePath)], filename, { type: 'application/pdf' });
      const result = await processDocumentExcel(file, {});

      console.info('[Statement corpus audit]', {
        filename,
        bankCode: result.metadata.bankCode,
        source: result.metadata.source,
        rows: result.rows.length,
        reconciles: result.metadata.reconciles,
        confidence: result.metadata.confidence,
      });

      // 1. Basic Metadata
      expect(result.metadata.bankCode).toBe(bankCode);
      expect(result.metadata.source).toBe(source);
      expect(result.rows).toHaveLength(rows);

      // 2. Balances and Reconciliation
      expect(result.metadata.reconciles).toBe(true);
      expect(Number(result.metadata.openingBalance)).toBeCloseTo(openingBalance, 2);
      expect(Number(result.metadata.closingBalance)).toBeCloseTo(closingBalance, 2);

      // 3. Mathematical Balance Reconciliation: Opening + Sum(Credits) - Sum(Debits) == Closing
      let totalDebits = 0;
      let totalCredits = 0;
      for (const row of result.rows) {
        const debitVal = typeof row.Debit === 'number'
          ? row.Debit
          : (typeof row.debit === 'number'
            ? row.debit
            : ((row.Direction === 'DEBIT' || row.Direction === 'FEE') && typeof row.Amount === 'number'
              ? Math.abs(row.Amount)
              : 0));
        const creditVal = typeof row.Credit === 'number'
          ? row.Credit
          : (typeof row.credit === 'number'
            ? row.credit
            : (row.Direction === 'CREDIT' && typeof row.Amount === 'number'
              ? Math.abs(row.Amount)
              : 0));
        totalDebits += debitVal;
        totalCredits += creditVal;
      }
      const calculatedClosing = openingBalance + totalCredits - totalDebits;
      expect(calculatedClosing).toBeCloseTo(closingBalance, 1);

      // 4. ISO Date Formatting: every row must be YYYY-MM-DD
      const invalidDates = result.rows.filter(
        (r) => !/^\d{4}-\d{2}-\d{2}$/.test(String(r.Date || r.date || ''))
      );
      expect(invalidDates).toHaveLength(0);

      // 5. Clean Descriptions: no noise or footer artifacts
      const emptyDescs = result.rows.filter(
        (r) => !String(r.Description || r.description || '').trim()
      );
      expect(emptyDescs).toHaveLength(0);

      const noisyRows = result.rows.filter((r) => {
        const desc = String(r.Description || r.description || '');
        return /please verify all transactions|statement summary|today's debits have not yet been paid|the standard bank of south africa limited|ombudsman for banking services/i.test(desc);
      });
      expect(noisyRows).toHaveLength(0);

      // 6. Proper Directions: every row must be DEBIT, CREDIT, or FEE
      const invalidDirections = result.rows.filter(
        (r) => !['DEBIT', 'CREDIT', 'FEE'].includes(String(r.Direction || r.direction || ''))
      );
      expect(invalidDirections).toHaveLength(0);

      // 7. Bank-specific spot checks
      if (bankCode === 'ABSA_SA') {
        expect(result.rows[0]).toMatchObject({
          Date: '2026-06-15',
          Credit: 8620,
          Balance: 837876.88,
          Direction: 'CREDIT',
        });
        expect(result.rows[result.rows.length - 1]).toMatchObject({
          Date: '2026-07-14',
          Debit: 6364.36,
          Balance: 586834.19,
          Direction: 'DEBIT',
        });
      }

      if (filename === 'SBSA_Statement_2026-08-04_3months.pdf') {
        expect(result.rows[0]).toMatchObject({
          Date: '2026-05-07',
          Debit: 901.09,
          Balance: -60382.64,
          Direction: 'DEBIT',
        });
        expect(String(result.rows[0].Description)).toContain('ACCOUNT PAYMENT');
        expect(result.rows[result.rows.length - 1]).toMatchObject({
          Date: '2026-08-04',
          Debit: 260.07,
          Balance: -75720.14,
          Direction: 'DEBIT',
        });
      }

      if (filename === 'Bank statement Use and upload SBSA_Statement_2026-08-05_3months._pdf.pdf') {
        expect(result.rows[0]).toMatchObject({
          Date: '2026-05-08',
          Debit: 500,
          Balance: 204865.72,
          Direction: 'DEBIT',
        });
        expect(result.rows[result.rows.length - 1]).toMatchObject({
          Date: '2026-08-05',
          Debit: 607,
          Balance: 66616.24,
          Direction: 'DEBIT',
        });
      }

      if (bankCode === 'NEDBANK_SA') {
        expect(result.rows[0]).toMatchObject({
          Date: '2026-06-26',
          Balance: -62.32,
          Direction: 'CREDIT',
        });
        expect(result.rows[result.rows.length - 1]).toMatchObject({
          Date: '2026-07-08',
          Debit: 12,
          Balance: -90.66,
          Direction: 'FEE',
        });
      }

      if (filename === 'Robbie_Accountants_2026-01.pdf') {
        expect(result.rows[0]).toMatchObject({
          Date: '2026-01-02',
          Debit: 140,
          Balance: 44777.42,
          Charges: 7.24,
          Direction: 'DEBIT',
        });
        expect(result.rows[result.rows.length - 1]).toMatchObject({
          Date: '2026-01-31',
          Debit: 300.52,
          Balance: 12732.05,
          Direction: 'DEBIT',
        });
      }

      if (filename === 'Test.pdf') {
        expect(result.rows[0]).toMatchObject({
          Date: '2026-07-02',
          Debit: 159,
          Balance: 181793.62,
          Direction: 'DEBIT',
        });
        expect(result.rows[result.rows.length - 1]).toMatchObject({
          Date: '2026-08-01',
          Debit: 15.28,
          Balance: 184407.90,
          Direction: 'DEBIT',
        });
      }
    },
    60_000
  );
});

