/**
 * Batch 01 recheck — every finance export path labels honestly. Verifies getExcelBlob
 * stamps an UNVERIFIED DRAFT banner + Summary rows when the ledger is not validated,
 * and does NOT when it is. Parse-back with exceljs (the real writer), no mocks.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { getExcelBlob } from '../services/excelService';

const rows = [
  { Date: '2026-01-01', Description: 'Coffee', Amount: -5, Balance: 95 },
  { Date: '2026-01-02', Description: 'Salary', Amount: 100, Balance: 195 },
];

async function loadWorkbook(blob: Blob) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  return wb;
}

describe('finance export labeling', () => {
  it('unverified ledger is stamped UNVERIFIED DRAFT on the data sheet + Summary', async () => {
    const blob = await getExcelBlob(rows, {
      confidence: 0.4,
      rowCount: 2,
      validationPassed: false,
      requiresReview: true,
      exportMode: 'draft',
      reviewReasons: ['Rows do not reconcile'],
    });
    const wb = await loadWorkbook(blob);
    const tx = wb.getWorksheet('Transactions');
    const firstRowText = (tx.getRow(1).values as any[]).filter(Boolean).join(' ');
    expect(firstRowText).toMatch(/UNVERIFIED DRAFT/i);

    const summary = wb.getWorksheet('Summary');
    const flat = JSON.stringify(summary.getRows(1, summary.rowCount).map(r => r.values));
    expect(flat).toMatch(/UNVERIFIED DRAFT/i);
    expect(flat).toMatch(/Rows do not reconcile/i);
  });

  it('verified ledger is NOT stamped as a draft', async () => {
    const blob = await getExcelBlob(rows, {
      confidence: 0.95,
      rowCount: 2,
      validationPassed: true,
      requiresReview: false,
      exportMode: 'final',
    });
    const wb = await loadWorkbook(blob);
    const tx = wb.getWorksheet('Transactions');
    const firstRowText = (tx.getRow(1).values as any[]).filter(Boolean).join(' ');
    expect(firstRowText).not.toMatch(/UNVERIFIED DRAFT/i);
    // header row is present instead
    expect(firstRowText).toMatch(/Date/i);
    const summary = wb.getWorksheet('Summary');
    const flat = JSON.stringify(summary.getRows(1, summary.rowCount).map(r => r.values));
    expect(flat).toMatch(/Verified/);
  });
});
