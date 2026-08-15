import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractFNBStatement,
  parseMoney,
  computeRowConfidence,
  reconciles,
  convertToExcelRows,
  FNB_MAX_PAGES,
  FNB_RECONCILIATION_TOLERANCE,
} from '../services/fnbExtractService';
import type { FNBTransaction } from '../services/fnbExtractService';

// Mock pdfjs-dist
vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: {},
}));
import * as pdfjsLib from 'pdfjs-dist';

/** Helper to create a mock PDF with the given items for `numPages` pages. */
function mockPdf(numPages: number, items: any[]) {
  return {
    promise: Promise.resolve({
      numPages,
      getPage: vi.fn().mockResolvedValue({
        getTextContent: vi.fn().mockResolvedValue({ items }),
      }),
    }),
  };
}

describe('fnbExtractService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads fresh PDF bytes through the configured worker for native text extraction', async () => {
    (pdfjsLib.getDocument as any).mockReturnValue(mockPdf(1, []));
    const file = new File([new Uint8Array([1, 2, 3])], 'test.pdf');

    await extractFNBStatement(file, 'secret');

    expect(pdfjsLib.getDocument).toHaveBeenCalledWith({
      data: expect.any(Uint8Array),
      password: 'secret',
    });
    const [{ data }] = (pdfjsLib.getDocument as any).mock.calls[0];
    expect(data).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('should use deterministic column mapping and NOT flip directions on balance mismatch', async () => {
    const mockItems = [
      { str: 'Date', transform: [1, 0, 0, 1, 20, 700] },
      { str: 'Description', transform: [1, 0, 0, 1, 60, 700] },
      { str: 'Debit', transform: [1, 0, 0, 1, 300, 700] },
      { str: 'Credit', transform: [1, 0, 0, 1, 360, 700] },
      { str: 'Balance', transform: [1, 0, 0, 1, 420, 700] },
      { str: '2023/10/01', transform: [1, 0, 0, 1, 20, 650] },
      { str: 'POS PURCHASE', transform: [1, 0, 0, 1, 60, 650] },
      { str: '150.00', transform: [1, 0, 0, 1, 300, 650] },
      { str: '', transform: [1, 0, 0, 1, 360, 650] },
      { str: '1850.00', transform: [1, 0, 0, 1, 420, 650] },
      { str: '2023/10/02', transform: [1, 0, 0, 1, 20, 600] },
      { str: 'EFT PAYMENT', transform: [1, 0, 0, 1, 60, 600] },
      { str: '200.00', transform: [1, 0, 0, 1, 300, 600] },
      { str: '', transform: [1, 0, 0, 1, 360, 600] },
      { str: '1600.00', transform: [1, 0, 0, 1, 420, 600] },
    ];

    (pdfjsLib.getDocument as any).mockReturnValue(mockPdf(1, mockItems));

    const result = await extractFNBStatement(new File([], 'test.pdf'));
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].direction).toBe('DEBIT');
    expect(result.transactions[0].debit).toBe(150);
    // Row 2 MUST remain DEBIT despite the balance mismatch (no heuristic flipping)
    expect(result.transactions[1].direction).toBe('DEBIT');
    expect(result.transactions[1].debit).toBe(200);
    expect(result.transactions[1].confidence).toBeGreaterThan(0.9);
  });

  it('should parse Cr/Dr suffixes deterministically', async () => {
    const mockItems = [
      { str: 'Date', transform: [1, 0, 0, 1, 20, 700] },
      { str: 'Description', transform: [1, 0, 0, 1, 60, 700] },
      { str: 'Amount', transform: [1, 0, 0, 1, 300, 700] },
      { str: 'Balance', transform: [1, 0, 0, 1, 400, 700] },
      { str: '2023/10/01', transform: [1, 0, 0, 1, 20, 650] },
      { str: 'SALARY', transform: [1, 0, 0, 1, 60, 650] },
      { str: '5000.00 CR', transform: [1, 0, 0, 1, 300, 650] },
      { str: '5000.00', transform: [1, 0, 0, 1, 400, 650] },
    ];

    (pdfjsLib.getDocument as any).mockReturnValue(mockPdf(1, mockItems));
    const result = await extractFNBStatement(new File([], 'test.pdf'));
    expect(result.transactions[0].direction).toBe('CREDIT');
    expect(result.transactions[0].credit).toBe(5000);
  });

  it('should parse Dr suffix as DEBIT with negative amount', async () => {
    const mockItems = [
      { str: 'Date', transform: [1, 0, 0, 1, 20, 700] },
      { str: 'Description', transform: [1, 0, 0, 1, 60, 700] },
      { str: 'Amount', transform: [1, 0, 0, 1, 300, 700] },
      { str: 'Balance', transform: [1, 0, 0, 1, 400, 700] },
      { str: '2023/10/05', transform: [1, 0, 0, 1, 20, 650] },
      { str: 'DEBIT ORDER', transform: [1, 0, 0, 1, 60, 650] },
      { str: '350.00 Dr', transform: [1, 0, 0, 1, 300, 650] },
      { str: '1650.00', transform: [1, 0, 0, 1, 400, 650] },
    ];

    (pdfjsLib.getDocument as any).mockReturnValue(mockPdf(1, mockItems));
    const result = await extractFNBStatement(new File([], 'test.pdf'));
    expect(result.transactions[0].direction).toBe('DEBIT');
    expect(result.transactions[0].debit).toBe(350);
  });

  it('should handle R-prefix money strings', async () => {
    const mockItems = [
      { str: 'Date', transform: [1, 0, 0, 1, 20, 700] },
      { str: 'Description', transform: [1, 0, 0, 1, 60, 700] },
      { str: 'Amount', transform: [1, 0, 0, 1, 300, 700] },
      { str: 'Balance', transform: [1, 0, 0, 1, 400, 700] },
      { str: '2023/10/01', transform: [1, 0, 0, 1, 20, 650] },
      { str: 'TRANSFER', transform: [1, 0, 0, 1, 60, 650] },
      { str: 'R 1,234.56 CR', transform: [1, 0, 0, 1, 300, 650] },
      { str: 'R 1,234.56', transform: [1, 0, 0, 1, 400, 650] },
    ];

    (pdfjsLib.getDocument as any).mockReturnValue(mockPdf(1, mockItems));
    const result = await extractFNBStatement(new File([], 'test.pdf'));
    expect(result.transactions[0].credit).toBe(1234.56);
    expect(result.transactions[0].direction).toBe('CREDIT');
  });

  it('should handle accounting negative format (1234.56)', async () => {
    const mockItems = [
      { str: 'Date', transform: [1, 0, 0, 1, 20, 700] },
      { str: 'Description', transform: [1, 0, 0, 1, 60, 700] },
      { str: 'Amount', transform: [1, 0, 0, 1, 300, 700] },
      { str: 'Balance', transform: [1, 0, 0, 1, 400, 700] },
      { str: '2023/10/01', transform: [1, 0, 0, 1, 20, 650] },
      { str: 'FEE', transform: [1, 0, 0, 1, 60, 650] },
      { str: '(25.00)', transform: [1, 0, 0, 1, 300, 650] },
      { str: '975.00', transform: [1, 0, 0, 1, 400, 650] },
    ];

    (pdfjsLib.getDocument as any).mockReturnValue(mockPdf(1, mockItems));
    const result = await extractFNBStatement(new File([], 'test.pdf'));
    expect(result.transactions[0].amount).toBe(-25);
  });

  it('should filter noise lines like "No. Debit Transactions"', async () => {
    const mockItems = [
      { str: 'Date', transform: [1, 0, 0, 1, 20, 700] },
      { str: 'Description', transform: [1, 0, 0, 1, 60, 700] },
      { str: 'Amount', transform: [1, 0, 0, 1, 300, 700] },
      { str: 'Balance', transform: [1, 0, 0, 1, 400, 700] },
      // Noise line that should NOT appear as a transaction
      { str: 'No. Debit Transactions: 12', transform: [1, 0, 0, 1, 20, 600] },
      { str: 'Total Debits: R 5,000.00', transform: [1, 0, 0, 1, 60, 550] },
      { str: 'Available Balance: R 10,000.00', transform: [1, 0, 0, 1, 20, 500] },
      // Actual data row
      { str: '2023/10/01', transform: [1, 0, 0, 1, 20, 450] },
      { str: 'GROCERY', transform: [1, 0, 0, 1, 60, 450] },
      { str: '200.00', transform: [1, 0, 0, 1, 300, 450] },
      { str: '800.00', transform: [1, 0, 0, 1, 400, 450] },
    ];

    (pdfjsLib.getDocument as any).mockReturnValue(mockPdf(1, mockItems));
    const result = await extractFNBStatement(new File([], 'test.pdf'));
    // Only the real transaction row should be extracted, not the footer lines
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].description).toBe('GROCERY');
  });

  it('should return null for unparseable money values instead of silently returning 0', () => {
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('   ')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('not-a-number')).toBeNull();
  });

  it('should parse valid money strings correctly', () => {
    expect(parseMoney('1234.56')).toBe(1234.56);
    expect(parseMoney('R 1,234.56')).toBe(1234.56);
    expect(parseMoney('(100.00)')).toBe(-100);
    expect(parseMoney('500.00 CR')).toBe(500);
    expect(parseMoney('500.00 DR')).toBe(-500);
    expect(parseMoney('0.00')).toBe(0);
    expect(parseMoney('R 0.00')).toBe(0);
    expect(parseMoney('**1,234.56**')).toBe(1234.56);
  });

  it('computeRowConfidence should return higher scores for complete rows', () => {
    const fullRow = computeRowConfidence({
      hasDate: true, hasDescription: true, hasAmount: true,
      hasBalance: true, amountParsed: true, balanceParsed: true,
      directionResolved: true,
    });
    expect(fullRow).toBe(1.0);

    const emptyRow = computeRowConfidence({
      hasDate: false, hasDescription: false, hasAmount: false,
      hasBalance: false, amountParsed: false, balanceParsed: false,
      directionResolved: false,
    });
    expect(emptyRow).toBe(0.5);
  });

  it('reconciles should return true when running balance closes within tolerance', () => {
    const rows: FNBTransaction[] = [
      { date: '2023/10/01', description: 'DEBIT', debit: 100, credit: null, amount: -100, balance: 900, charges: null, direction: 'DEBIT', confidence: 1, rawText: '' },
      { date: '2023/10/02', description: 'CREDIT', debit: null, credit: 200, amount: 200, balance: 1100, charges: null, direction: 'CREDIT', confidence: 1, rawText: '' },
    ];
    // 1000 + (-100 + 200) = 1100 ✓
    expect(reconciles(1000, rows, 1100)).toBe(true);
    // 1000 + (-100 + 200) ≠ 1105 (exceeds 0.05 tolerance)
    expect(reconciles(1000, rows, 1105)).toBe(false);
    // Zero-tolerance check
    expect(reconciles(1000, rows, 1100, 0)).toBe(true);
  });

  it('should cap extraction to FNB_MAX_PAGES and report pagesProcessed', async () => {
    const makePage = () => ({
      str: '2023/10/01', transform: [1, 0, 0, 1, 20, 650],
    });

    (pdfjsLib.getDocument as any).mockReturnValue({
      promise: Promise.resolve({
        numPages: 50,
        getPage: vi.fn().mockResolvedValue({
          getTextContent: vi.fn().mockResolvedValue({ items: [makePage()] }),
        }),
      }),
    });

    const result = await extractFNBStatement(new File([], 'test.pdf'), undefined, 2);
    // Caller page budgets cap work without re-saving the source PDF.
    expect(result.metadata.pagesProcessed).toBe(2);
  });

  it('should include validation metadata in the return', async () => {
    const mockItems = [
      { str: 'Date', transform: [1, 0, 0, 1, 20, 700] },
      { str: 'Description', transform: [1, 0, 0, 1, 60, 700] },
      { str: 'Amount', transform: [1, 0, 0, 1, 300, 700] },
      { str: 'Balance', transform: [1, 0, 0, 1, 400, 700] },
      { str: '2023/10/01', transform: [1, 0, 0, 1, 20, 650] },
      { str: 'COFFEE', transform: [1, 0, 0, 1, 60, 650] },
      { str: '45.00', transform: [1, 0, 0, 1, 300, 650] },
      { str: '1000.00', transform: [1, 0, 0, 1, 400, 650] },
    ];

    (pdfjsLib.getDocument as any).mockReturnValue(mockPdf(1, mockItems));
    const result = await extractFNBStatement(new File([], 'test.pdf'));
    expect(result.metadata.pagesProcessed).toBe(1);
    expect(result.metadata.rowCount).toBe(1);
    expect(typeof result.metadata.reconciles).toBe('boolean');
    expect(typeof result.metadata.parseErrors).toBe('number');
    expect(result.metadata.bankCode).toBe('FNB_SA');
  });

  it('convertToExcelRows should map FNB transactions to Excel-friendly objects', () => {
    const txns: FNBTransaction[] = [{
      date: '2023/10/01', description: 'TEST', debit: 100, credit: null,
      amount: -100, balance: 900, charges: null, direction: 'DEBIT',
      confidence: 1, rawText: '',
    }];
    const rows = convertToExcelRows(txns);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      Date: '2023/10/01', Description: 'TEST', Debit: 100, Credit: null,
      Amount: -100, Balance: 900, Charges: null, Direction: 'DEBIT',
    });
  });

  it('should process multi-page PDFs correctly', async () => {
    const page1Items = [
      { str: 'Date', transform: [1, 0, 0, 1, 20, 700] },
      { str: 'Description', transform: [1, 0, 0, 1, 60, 700] },
      { str: 'Amount', transform: [1, 0, 0, 1, 300, 700] },
      { str: 'Balance', transform: [1, 0, 0, 1, 400, 700] },
      { str: '2023/10/01', transform: [1, 0, 0, 1, 20, 650] },
      { str: 'COFFEE', transform: [1, 0, 0, 1, 60, 650] },
      { str: '45.00', transform: [1, 0, 0, 1, 300, 650] },
      { str: '955.00', transform: [1, 0, 0, 1, 400, 650] },
    ];
    const page2Items = [
      { str: 'Date', transform: [1, 0, 0, 1, 20, 700] },
      { str: 'Description', transform: [1, 0, 0, 1, 60, 700] },
      { str: 'Amount', transform: [1, 0, 0, 1, 300, 700] },
      { str: 'Balance', transform: [1, 0, 0, 1, 400, 700] },
      { str: '2023/10/02', transform: [1, 0, 0, 1, 20, 650] },
      { str: 'FUEL', transform: [1, 0, 0, 1, 60, 650] },
      { str: '500.00', transform: [1, 0, 0, 1, 300, 650] },
      { str: '455.00', transform: [1, 0, 0, 1, 400, 650] },
    ];

    // getPage(1) is called twice: once for header opening/closing scan, once for extraction.
    const getPage = vi.fn(async (pageNum: number) => {
      const items = pageNum === 1 ? page1Items : page2Items;
      return { getTextContent: vi.fn().mockResolvedValue({ items }) };
    });

    (pdfjsLib.getDocument as any).mockReturnValue({
      promise: Promise.resolve({ numPages: 2, getPage }),
    });

    const result = await extractFNBStatement(new File([], 'test.pdf'));
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].description).toBe('COFFEE');
    expect(result.transactions[1].description).toBe('FUEL');
    expect(result.metadata.rowCount).toBe(2);
  });
});
