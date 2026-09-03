/**
 * Integration suite for the real Robbie Accountants FNB Gold Business Account PDF.
 * On failure, collects every distinct reason so debugging is not a single opaque assert.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractFNBStatement, detectGoldFormat } from '../services/fnbExtractService';
import { normalizePdf } from '../services/pdfNormalizer';
import { processDocumentExcel } from '../services/documentService';
import { getToolById } from '../src/registry/toolRegistry';
import { Workbook } from 'exceljs';

vi.mock('../services/ocrService', () => ({
  ocrPdfToTextItems: vi.fn(),
}));
import { ocrPdfToTextItems } from '../services/ocrService';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures/statements/Robbie_Accountants_2026-01.pdf');
const ROOT_PDF = path.join(__dirname, 'fixtures/statements/Robbie_Accountants_2026-01.pdf');
const ROOT_TEST_PDF = path.join(__dirname, 'fixtures/statements/Test.pdf');

function loadRobbieFile(): File {
  const pdfPath = fs.existsSync(FIXTURE) ? FIXTURE : ROOT_PDF;
  if (!fs.existsSync(pdfPath)) {
    throw new Error(
      [
        'Robbie Accountants PDF missing.',
        `Checked fixture: ${FIXTURE}`,
        `Checked project root: ${ROOT_PDF}`,
        'Copy the statement to tests/fixtures/statements/Robbie_Accountants_2026-01.pdf',
      ].join('\n')
    );
  }
  const buf = fs.readFileSync(pdfPath);
  return new File([buf], 'Robbie_Accountants_2026-01.pdf', { type: 'application/pdf' });
}

describe('Robbie Accountants FNB Gold PDF (real fixture)', () => {
  let file: File;
  let normalizedFile: File;
  let wasNormalized: boolean;
  let result: Awaited<ReturnType<typeof extractFNBStatement>>;
  let failures: string[] = [];

  beforeAll(async () => {
    failures = [];
    try {
      file = loadRobbieFile();
    } catch (e: any) {
      failures.push(`FILE_MISSING: ${e.message}`);
      throw e;
    }

    try {
      const norm = await normalizePdf(file);
      wasNormalized = norm.wasNormalized;
      normalizedFile = norm.file;
    } catch (e: any) {
      failures.push(`NORMALIZE_THREW: ${e?.message || String(e)}`);
      normalizedFile = file;
      wasNormalized = false;
    }

    try {
      result = await extractFNBStatement(normalizedFile);
    } catch (e: any) {
      // Fallback: try original bytes if normalized path fails (pdf.js / flate issues)
      failures.push(`EXTRACT_NORMALIZED_THREW: ${e?.message || String(e)}`);
      try {
        result = await extractFNBStatement(file);
        failures.push('EXTRACT_FALLBACK_ORIGINAL: succeeded on original file after normalized failed');
      } catch (e2: any) {
        failures.push(`EXTRACT_ORIGINAL_THREW: ${e2?.message || String(e2)}`);
        throw new Error(
          `Robbie extraction failed completely.\nReasons:\n- ${failures.join('\n- ')}`
        );
      }
    }
  }, 60_000);

  it('extracts without throwing and returns FNB metadata', () => {
    const reasons: string[] = [...failures];
    if (!result) reasons.push('RESULT_UNDEFINED: extractFNBStatement returned nothing');
    if (!result?.metadata) reasons.push('METADATA_MISSING: no metadata object on result');
    if (result?.metadata?.bankCode !== 'FNB_SA') {
      reasons.push(`BANK_CODE: expected FNB_SA, got ${result?.metadata?.bankCode}`);
    }
    if (typeof result?.metadata?.pagesProcessed !== 'number') {
      reasons.push('PAGES_PROCESSED_MISSING');
    }
    if (reasons.length) {
      expect.fail(`Robbie metadata checks failed:\n- ${reasons.join('\n- ')}`);
    }
    expect(result.metadata.bankCode).toBe('FNB_SA');
    expect(result.metadata.pagesProcessed).toBeGreaterThanOrEqual(1);
  });

  it('detects Gold geometry on page-1-like headers (unit check)', () => {
    // Geometry measured from the real PDF (table Date x≈16, Description x≈209)
    const gold = detectGoldFormat([
      { str: 'Date', transform: [1, 0, 0, 1, 244.6, 44.6] },
      { str: 'Date', transform: [1, 0, 0, 1, 16.1, 433.9] },
      { str: 'Description', transform: [1, 0, 0, 1, 208.6, 433.4] },
      { str: 'Amount', transform: [1, 0, 0, 1, 436.8, 433.4] },
      { str: 'Balance', transform: [1, 0, 0, 1, 498.7, 433.4] },
      { str: 'Charges', transform: [1, 0, 0, 1, 548.2, 425] },
    ]);
    if (!gold.isGold) {
      expect.fail(
        'Gold detection failed for Robbie header geometry (Date x=16.1, Desc x=208.6). ' +
          'detectGoldFormat must prefer table Date (x<30) over page-chrome Date (x≈245).'
      );
    }
    expect(gold.isGold).toBe(true);
  });

  it('extracts multiple transactions with correct columns', () => {
    const reasons: string[] = [];
    const txs = result?.transactions ?? [];

    if (txs.length === 0) {
      reasons.push('ZERO_TRANSACTIONS: no rows extracted from Gold Business Account statement');
      reasons.push(
        'HINT: check column ranges Date[0,35) Desc[35,430) Amount[430,485) Balance[485,548) Charges[548,620)'
      );
      reasons.push('HINT: check isNoiseLine allows "DD Mon" dates and header detection finds Date/Description/Amount/Balance');
    }

    if (txs.length < 10) {
      reasons.push(`LOW_ROW_COUNT: expected ≥10 transactions for a 3-page Gold statement, got ${txs.length}`);
    }

    const missingDate = txs.filter((t) => !t.date);
    if (missingDate.length) {
      reasons.push(`MISSING_DATE: ${missingDate.length} rows lack date`);
    }

    const missingDesc = txs.filter((t) => !t.description || t.description.trim().length < 2);
    if (missingDesc.length) {
      reasons.push(`MISSING_DESCRIPTION: ${missingDesc.length} rows lack description`);
    }

    const nullBalance = txs.filter((t) => t.balance === null);
    if (nullBalance.length > txs.length * 0.5) {
      reasons.push(
        `BALANCE_PARSE_FAILURE: ${nullBalance.length}/${txs.length} rows have null balance (column assignment may be wrong)`
      );
    }

    const nullAmount = txs.filter((t) => t.amount === null);
    if (nullAmount.length > txs.length * 0.5) {
      reasons.push(
        `AMOUNT_PARSE_FAILURE: ${nullAmount.length}/${txs.length} rows have null amount`
      );
    }

    // Sample known-style rows from Robbie geometry probe
    const hasPos = txs.some((t) => /pos purchase/i.test(t.description));
    if (txs.length > 0 && !hasPos) {
      reasons.push(
        'NO_POS_ROWS: expected at least one "POS Purchase" description on this statement; column/description mapping may be broken'
      );
    }

    const first = txs[0];
    if (first) {
      if (!/^\d{1,2}\s+[A-Za-z]{3}/.test(first.date) && !/\d{4}[-\/]\d{2}/.test(first.date)) {
        reasons.push(`DATE_FORMAT: unexpected first date "${first.date}" (expected "DD Mon" or ISO-like)`);
      }
    }

    if (reasons.length) {
      const sample = txs.slice(0, 5).map((t) => ({
        date: t.date,
        description: t.description?.slice(0, 50),
        amount: t.amount,
        balance: t.balance,
        charges: t.charges,
        direction: t.direction,
      }));
      expect.fail(
        [
          'Robbie extraction quality checks failed:',
          ...reasons.map((r) => `- ${r}`),
          `metadata: ${JSON.stringify(result?.metadata)}`,
          `normalize: wasNormalized=${wasNormalized}`,
          `sample rows: ${JSON.stringify(sample, null, 2)}`,
        ].join('\n')
      );
    }

    expect(txs.length).toBeGreaterThanOrEqual(10);
    expect(hasPos).toBe(true);
  });

  it('parses opening/closing style balances and reports reconciliation fields', () => {
    const reasons: string[] = [];
    const meta = result.metadata;
    const txs = result.transactions;

    if (typeof meta.reconciles !== 'boolean') {
      reasons.push('RECONCILES_TYPE: metadata.reconciles must be boolean');
    }
    if (typeof meta.parseErrors !== 'number') {
      reasons.push('PARSE_ERRORS_TYPE: metadata.parseErrors must be number');
    }
    if (meta.rowCount !== txs.length) {
      reasons.push(`ROW_COUNT_MISMATCH: metadata.rowCount=${meta.rowCount} vs transactions.length=${txs.length}`);
    }

    // Statement header reports Opening 44,917.42 Cr / Closing 12,732.05 Cr.
    if (meta.openingBalance == null || Math.abs(meta.openingBalance - 44917.42) > 1) {
      reasons.push(
        `OPENING_BALANCE: expected ~44917.42 from header, got ${meta.openingBalance}`
      );
    }
    if (meta.closingBalance == null || Math.abs(meta.closingBalance - 12732.05) > 1) {
      reasons.push(
        `CLOSING_BALANCE: expected ~12732.05 from header, got ${meta.closingBalance}`
      );
    }
    const lastBal = txs[txs.length - 1]?.balance;
    if (lastBal != null && Math.abs(lastBal - 12732.05) > 1) {
      reasons.push(
        `LAST_ROW_BALANCE: last row balance ${lastBal} is not near statement closing 12732.05 (fee-only rows may be missing)`
      );
    }

    // Charges column should populate for many Gold POS rows
    const withCharges = txs.filter((t) => t.charges != null && t.charges > 0).length;
    if (txs.length >= 10 && withCharges === 0) {
      reasons.push(
        'CHARGES_NEVER_SET: no row has charges>0; Gold Charges range [548,620) may not be applied'
      );
    }

    if (reasons.length) {
      expect.fail(
        [
          'Robbie balance/reconciliation checks failed:',
          ...reasons.map((r) => `- ${r}`),
          `openingBalance=${meta.openingBalance}, closingBalance=${meta.closingBalance}`,
          `reconciles=${meta.reconciles}, parseErrors=${meta.parseErrors}`,
          `charges populated on ${withCharges}/${txs.length} rows`,
        ].join('\n')
      );
    }

    expect(meta.rowCount).toBe(txs.length);
    expect(typeof meta.reconciles).toBe('boolean');
  });

  it('exports the real Robbie statement without spatial fallback data loss', async () => {
    const tool = getToolById('pdf-to-excel');
    if (!tool) throw new Error('pdf-to-excel tool missing');

    const output = await tool.handler({ files: [loadRobbieFile()], options: {}, onProgress: vi.fn() });
    const reviewRows = (output.data as { rows: Record<string, unknown>[] }).rows;

    expect(reviewRows).toHaveLength(92);
    expect(reviewRows.every((row) => String(row.date ?? '').trim() && String(row.description ?? '').trim())).toBe(true);
    expect(reviewRows.every((row) => row.bankCode === 'FNB_SA')).toBe(true);
    expect(reviewRows.some((row) => Number(row.amount) < 0 && row.direction === 'DEBIT')).toBe(true);

    const workbook = new Workbook();
    await workbook.xlsx.load(await output.blob!.arrayBuffer());
    const sheet = workbook.getWorksheet('Transactions');
    expect(sheet?.rowCount).toBe(93);
    expect(sheet?.getRow(1).values).toEqual([
      , 'Date', 'Description', 'Debit', 'Credit', 'Amount', 'Balance', 'Charges', 'Direction',
    ]);
  }, 60_000);
});

describe('root Test.pdf FNB native text regression', () => {
  it('extracts native-text FNB transactions without canvas rendering', async () => {
    if (!fs.existsSync(ROOT_TEST_PDF)) {
      throw new Error(`Test.pdf missing at ${ROOT_TEST_PDF}`);
    }

    const file = new File([fs.readFileSync(ROOT_TEST_PDF)], 'Test.pdf', { type: 'application/pdf' });
    const result = await extractFNBStatement(file);

    expect(result.metadata.bankCode).toBe('FNB_SA');
    expect(result.metadata.pagesProcessed).toBeGreaterThanOrEqual(1);
    expect(result.transactions.length).toBeGreaterThan(0);
    expect(result.transactions.some((transaction) => /FNB App/i.test(transaction.description))).toBe(true);
  }, 60_000);

  it('routes through document orchestration without OCR or canvas rendering', async () => {
    if (!fs.existsSync(ROOT_TEST_PDF)) {
      throw new Error(`Test.pdf missing at ${ROOT_TEST_PDF}`);
    }

    vi.mocked(ocrPdfToTextItems).mockClear();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    getContext.mockClear();

    const file = new File([fs.readFileSync(ROOT_TEST_PDF)], 'Test.pdf', { type: 'application/pdf' });
    const result = await processDocumentExcel(file, {});

    expect(result.metadata.bankCode).toBe('FNB_SA');
    expect(result.rows.length).toBeGreaterThan(0);
    expect(ocrPdfToTextItems).not.toHaveBeenCalled();
    expect(getContext).not.toHaveBeenCalled();
  }, 60_000);

  it('keeps canonical review data and FNB fidelity in the Excel export', async () => {
    if (!fs.existsSync(ROOT_TEST_PDF)) {
      throw new Error(`Test.pdf missing at ${ROOT_TEST_PDF}`);
    }

    const tool = getToolById('pdf-to-excel');
    if (!tool) throw new Error('pdf-to-excel tool missing');

    const file = new File([fs.readFileSync(ROOT_TEST_PDF)], 'Test.pdf', { type: 'application/pdf' });
    const output = await tool.handler({ files: [file], options: {}, onProgress: vi.fn() });
    const rows = (output.data as { rows: Record<string, unknown>[] }).rows;

    expect(rows).toHaveLength(151);
    expect(Object.keys(rows[0])).toEqual([
      'date', 'description', 'amount', 'balance', 'charges', 'direction', 'bankCode', 'confidence', 'metadata',
    ]);
    expect(rows.every((row) => String(row.date ?? '').trim() && String(row.description ?? '').trim())).toBe(true);
    expect(rows.some((row) => Number(row.amount) < 0 && row.direction === 'DEBIT')).toBe(true);
    expect(rows.some((row) => row.direction === 'CREDIT')).toBe(true);
    expect(rows.every((row) => row.direction === 'DEBIT' || row.direction === 'CREDIT' || row.direction === 'UNKNOWN')).toBe(true);

    const workbook = new Workbook();
    await workbook.xlsx.load(await output.blob!.arrayBuffer());
    const sheet = workbook.getWorksheet('Transactions');
    expect(sheet?.getRow(1).values).toEqual([
      , 'Date', 'Description', 'Debit', 'Credit', 'Amount', 'Balance', 'Charges', 'Direction',
    ]);
  }, 60_000);
});
