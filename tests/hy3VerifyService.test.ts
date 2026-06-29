import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyStatementMath, computeLocalMathOnly } from '../services/hy3VerifyService';

global.fetch = vi.fn();

describe('hy3VerifyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call verifier endpoint and return parsed result', async () => {
    const mockPayload = {
      rows: [{ date: '2023-01-01', description: 'Test', debit: 100, credit: null, balance: 900, charges: 0 }],
      opening_balance: 1000,
      closing_balance: 900,
    };

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        local_math: { debit_sum: 100, credit_sum: 0, charges_sum: 0, expected_closing: 900, actual_closing: 900, flow_ok: true, row_count: 1 },
        ai_audit: { anomalies: [], explanation: 'Flow is conserved.', flow_ok: true }
      }),
    });

    const result = await verifyStatementMath(mockPayload);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/verify'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify(mockPayload) })
    );
    expect(result.local_math.flow_ok).toBe(true);
    expect(result.ai_audit.anomalies).toHaveLength(0);
  });

  it('computeLocalMathOnly should correctly calculate expected closing', () => {
    const payload = {
      rows: [
        { date: '2023-01-01', description: 'Test', debit: 100, credit: 50, balance: 0, charges: 10 },
      ],
      opening_balance: 1000,
      closing_balance: 940, // 1000 + 50 - 100 - 10 = 940
    };

    const result = computeLocalMathOnly(payload);
    expect(result.local_math.expected_closing).toBe(940);
    expect(result.local_math.flow_ok).toBe(true);
  });

  it('computeLocalMathOnly should detect flow mismatch', () => {
    const payload = {
      rows: [
        { date: '2023-01-01', description: 'Test', debit: 100, credit: 0, balance: 0, charges: 0 },
      ],
      opening_balance: 1000,
      closing_balance: 950, // 1000 + 0 - 100 - 0 = 900, not 950
    };

    const result = computeLocalMathOnly(payload);
    expect(result.local_math.flow_ok).toBe(false);
  });

  it('should handle empty rows gracefully', () => {
    const payload = {
      rows: [],
      opening_balance: 1000,
      closing_balance: 1000,
    };

    const result = computeLocalMathOnly(payload);
    expect(result.local_math.row_count).toBe(0);
    expect(result.local_math.flow_ok).toBe(true);
    expect(result.local_math.debit_sum).toBe(0);
    expect(result.local_math.credit_sum).toBe(0);
  });
});