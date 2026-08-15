import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { processDocumentExcel } from '../services/documentService';

vi.mock('../services/ocrService', () => ({
  ocrPdfToTextItems: vi.fn(),
}));

const CORPUS_DIR = path.resolve(__dirname, 'fixtures/statements');
const UNIQUE_FIXTURES = [
  { filename: '14. 15 Jun - 15 Jul 2026 R1250.pdf', bankCode: 'ABSA_SA', rows: 288 },
  { filename: 'Bank statement Use and upload SBSA_Statement_2026-08-05_3months._pdf.pdf', bankCode: 'STANDARD_BANK_SA', rows: 277 },
  { filename: 'July 2026.pdf', bankCode: 'NEDBANK_SA', rows: 32 },
  { filename: 'Robbie_Accountants_2026-01.pdf', bankCode: 'FNB_SA', rows: 92 },
  { filename: 'SBSA_Statement_2026-08-04_3months.pdf', bankCode: 'STANDARD_BANK_SA', rows: 125 },
  { filename: 'Test.pdf', bankCode: 'FNB_SA', rows: 151 },
];

describe('statement corpus integration', () => {
  it.each(UNIQUE_FIXTURES)('processes $filename through the production pipeline', async ({ filename, bankCode, rows }) => {
    const filePath = path.join(CORPUS_DIR, filename);
    expect(fs.existsSync(filePath), `missing fixture: ${filePath}`).toBe(true);

    const file = new File([fs.readFileSync(filePath)], filename, { type: 'application/pdf' });
    const result = await processDocumentExcel(file, {});

    console.info('[Statement corpus]', {
      filename,
      bankCode: result.metadata.bankCode,
      source: result.metadata.source,
      rows: result.rows.length,
      confidence: result.metadata.confidence,
    });
    expect(result.metadata.bankCode).toBe(bankCode);
    expect(result.rows).toHaveLength(rows);
    if (bankCode === 'ABSA_SA') {
      expect(result.metadata.source).toBe('absa-native-extraction');
      expect(result.metadata.openingBalance).toBe(829256.88);
      expect(result.metadata.closingBalance).toBe(586834.19);
      expect(result.rows[0]).toMatchObject({ Date: '2026-06-15', Credit: 8620, Balance: 837876.88, Direction: 'CREDIT' });
      expect(result.rows.some((row) => row.Date === '2026-08-06')).toBe(false);
    }
    if (bankCode === 'STANDARD_BANK_SA') {
      expect(result.metadata.source).toBe('standard-bank-native-extraction');
      expect(result.rows.every((row) => row.Date && row.Description && row.Direction)).toBe(true);
      if (filename === 'SBSA_Statement_2026-08-04_3months.pdf') {
        expect(result.rows[0]).toMatchObject({ Date: '2026-05-07', Debit: 901.09, Balance: -60382.64, Direction: 'DEBIT' });
        expect(String(result.rows[0].Description)).toContain('ACCOUNT PAYMENT');
      }
    }
  }, 60_000);
});
