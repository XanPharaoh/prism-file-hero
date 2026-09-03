import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractFNBStatement,
  detectGoldFormat,
  FNB_GOLD_COLUMNS,
} from '../services/fnbExtractService';

vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
}));
import * as pdfjsLib from 'pdfjs-dist';

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

function mockMultiPage(pages: any[][]) {
  // getPage(1) is also used for header opening/closing balance pre-scan.
  const getPage = vi.fn(async (pageNum: number) => {
    const items = pages[pageNum - 1] || [];
    return { getTextContent: vi.fn().mockResolvedValue({ items }) };
  });
  return {
    promise: Promise.resolve({
      numPages: pages.length,
      getPage,
    }),
  };
}

describe('FNB Gold Business Account Format', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detectGoldFormat returns isGold when Date x<30 and Description x>150', () => {
    const items = [
      { str: 'Date', transform: [1, 0, 0, 1, 20, 700] },
      { str: 'Description', transform: [1, 0, 0, 1, 200, 700] },
      { str: 'Amount', transform: [1, 0, 0, 1, 450, 700] },
    ];
    const result = detectGoldFormat(items);
    expect(result.isGold).toBe(true);
    expect(result.columns).toEqual(FNB_GOLD_COLUMNS);
  });

  it('detectGoldFormat ignores page-chrome Date when table Date is at x<30', () => {
    const items = [
      { str: 'Date', transform: [1, 0, 0, 1, 245, 45] },
      { str: 'Date', transform: [1, 0, 0, 1, 16, 434] },
      { str: 'Description', transform: [1, 0, 0, 1, 209, 433] },
    ];
    expect(detectGoldFormat(items).isGold).toBe(true);
  });

  it('detectGoldFormat returns false for standard FNB header geometry', () => {
    const items = [
      { str: 'Date', transform: [1, 0, 0, 1, 20, 700] },
      { str: 'Description', transform: [1, 0, 0, 1, 60, 700] },
      { str: 'Amount', transform: [1, 0, 0, 1, 300, 700] },
    ];
    expect(detectGoldFormat(items).isGold).toBe(false);
  });

  it('detects Gold format from header geometry (Date x<30, Desc x>150)', async () => {
    const mockItems = [
      { str: 'Date', transform: [1, 0, 0, 1, 20, 700] },
      { str: 'Description', transform: [1, 0, 0, 1, 200, 700] },
      { str: 'Amount', transform: [1, 0, 0, 1, 450, 700] },
      { str: 'Balance', transform: [1, 0, 0, 1, 500, 700] },
      { str: 'Charges', transform: [1, 0, 0, 1, 560, 700] },
      { str: '2026/01/15', transform: [1, 0, 0, 1, 10, 650] },
      { str: 'SALARY PAYMENT', transform: [1, 0, 0, 1, 100, 650] },
      { str: '15000.00', transform: [1, 0, 0, 1, 460, 650] },
      { str: '16250.00', transform: [1, 0, 0, 1, 510, 650] },
      { str: '0.00', transform: [1, 0, 0, 1, 570, 650] },
    ];

    (pdfjsLib.getDocument as any).mockReturnValue(mockPdf(1, mockItems));

    const result = await extractFNBStatement(new File([], 'gold-test.pdf'));

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].date).toBe('2026-01-15');
    expect(result.transactions[0].description).toContain('SALARY');
    expect(result.transactions[0].credit).toBe(15000.0);
    expect(result.transactions[0].balance).toBe(16250.0);
    expect(result.transactions[0].charges).toBe(0.0);
    expect(result.transactions[0].direction).toBe('CREDIT');
  });

  it('persists Gold column map across multi-page statements', async () => {
    const page1Items = [
      { str: 'Date', transform: [1, 0, 0, 1, 16, 700] },
      { str: 'Description', transform: [1, 0, 0, 1, 209, 700] },
      { str: 'Amount', transform: [1, 0, 0, 1, 437, 700] },
      { str: 'Balance', transform: [1, 0, 0, 1, 499, 700] },
      { str: 'Charges', transform: [1, 0, 0, 1, 548, 700] },
      { str: '02 Jan', transform: [1, 0, 0, 1, 12, 650] },
      { str: 'POS Purchase Coffee Shop', transform: [1, 0, 0, 1, 38, 650] },
      { str: '45.00', transform: [1, 0, 0, 1, 453, 650] },
      { str: '955.00', transform: [1, 0, 0, 1, 507, 650] },
      { str: 'Cr', transform: [1, 0, 0, 1, 537, 650] },
      { str: '3.68', transform: [1, 0, 0, 1, 568, 650] },
    ];
    // Page 2: no column headers — must reuse Gold ranges
    const page2Items = [
      { str: '03 Jan', transform: [1, 0, 0, 1, 12, 650] },
      { str: 'POS Purchase Fuel Station', transform: [1, 0, 0, 1, 38, 650] },
      { str: '500.00', transform: [1, 0, 0, 1, 453, 650] },
      { str: '455.00', transform: [1, 0, 0, 1, 507, 650] },
      { str: 'Cr', transform: [1, 0, 0, 1, 537, 650] },
      { str: '3.68', transform: [1, 0, 0, 1, 568, 650] },
    ];

    (pdfjsLib.getDocument as any).mockReturnValue(mockMultiPage([page1Items, page2Items]));

    const result = await extractFNBStatement(new File([], 'gold-multipage.pdf'));

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].description).toContain('Coffee');
    expect(result.transactions[0].amount).toBe(-45);
    expect(result.transactions[0].charges).toBe(3.68);
    expect(result.transactions[1].description).toContain('Fuel');
    expect(result.transactions[1].amount).toBe(-500);
    expect(result.transactions[1].balance).toBe(455);
  });

  it('does not break standard FNB format (non-Gold)', async () => {
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
    ];

    (pdfjsLib.getDocument as any).mockReturnValue(mockPdf(1, mockItems));

    const result = await extractFNBStatement(new File([], 'standard-fnb.pdf'));

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].direction).toBe('DEBIT');
    expect(result.transactions[0].debit).toBe(150);
    expect(result.transactions[0].description).toBe('POS PURCHASE');
  });
});
