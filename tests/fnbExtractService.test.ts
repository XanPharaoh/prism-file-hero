import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractFNBStatement } from '../services/fnbExtractService';

// Mock pdfjs-dist
vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
}));
import * as pdfjsLib from 'pdfjs-dist';

describe('fnbExtractService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use deterministic column mapping and NOT flip directions on balance mismatch', async () => {
    const mockItems = [
      // Header
      { str: 'Date', transform: [1, 0, 0, 1, 20, 700] },
      { str: 'Description', transform: [1, 0, 0, 1, 60, 700] },
      { str: 'Debit', transform: [1, 0, 0, 1, 300, 700] },
      { str: 'Credit', transform: [1, 0, 0, 1, 360, 700] },
      { str: 'Balance', transform: [1, 0, 0, 1, 420, 700] },
      // Row 1: Normal Debit
      { str: '2023/10/01', transform: [1, 0, 0, 1, 20, 650] },
      { str: 'POS PURCHASE', transform: [1, 0, 0, 1, 60, 650] },
      { str: '150.00', transform: [1, 0, 0, 1, 300, 650] },
      { str: '', transform: [1, 0, 0, 1, 360, 650] },
      { str: '1850.00', transform: [1, 0, 0, 1, 420, 650] },
      // Row 2: Unrecorded fee causes balance to drop MORE than the debit (simulating mismatch)
      // Old logic would flip subsequent directions. New logic MUST keep it deterministic.
      { str: '2023/10/02', transform: [1, 0, 0, 1, 20, 600] },
      { str: 'EFT PAYMENT', transform: [1, 0, 0, 1, 60, 600] },
      { str: '200.00', transform: [1, 0, 0, 1, 300, 600] },
      { str: '', transform: [1, 0, 0, 1, 360, 600] },
      { str: '1600.00', transform: [1, 0, 0, 1, 420, 600] },
    ];

    (pdfjsLib.getDocument as any).mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue({
          getTextContent: vi.fn().mockResolvedValue({ items: mockItems }),
        }),
      }),
    });

    const result = await extractFNBStatement(new File([], 'test.pdf'));

    expect(result.transactions).toHaveLength(2);

    // Row 1 should be DEBIT
    expect(result.transactions[0].direction).toBe('DEBIT');
    expect(result.transactions[0].debit).toBe(150);

    // Row 2 MUST remain DEBIT despite the balance mismatch (no heuristic flipping)
    expect(result.transactions[1].direction).toBe('DEBIT');
    expect(result.transactions[1].debit).toBe(200);
    expect(result.transactions[1].confidence).toBe(0.85);
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

    (pdfjsLib.getDocument as any).mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue({
          getTextContent: vi.fn().mockResolvedValue({ items: mockItems }),
        }),
      }),
    });

    const result = await extractFNBStatement(new File([], 'test.pdf'));
    expect(result.transactions[0].direction).toBe('CREDIT');
    expect(result.transactions[0].credit).toBe(5000);
  });
});