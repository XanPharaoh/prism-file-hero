import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useExtractionVerification } from '../src/hooks/useExtractionVerification';
import * as hy3Service from '../services/hy3VerifyService';

describe('useExtractionVerification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should gracefully degrade to local math if Hy3 service throws', async () => {
    vi.spyOn(hy3Service, 'verifyStatementMath').mockRejectedValue(new Error('Network error'));
    const computeLocalSpy = vi.spyOn(hy3Service, 'computeLocalMathOnly').mockReturnValue({
      local_math: { debit_sum: 0, credit_sum: 0, charges_sum: 0, expected_closing: 100, actual_closing: 100, flow_ok: true, row_count: 1 },
      ai_audit: { anomalies: ['AI verification service unavailable'], explanation: 'Relying on local deterministic math only.', flow_ok: true }
    });

    const { result } = renderHook(() => useExtractionVerification());

    result.current.runVerification(
      [{ date: '2023-01-01', description: 'Test', amount: 0, direction: 'CREDIT' as const, confidence: 100, bankCode: 'TEST' }],
      100,
      100
    );

    await waitFor(() => {
      expect(result.current.isVerifying).toBe(false);
    });

    expect(result.current.verificationError).toBe('Network error');
    expect(result.current.verificationResult?.ai_audit.anomalies).toContain('AI verification service unavailable');
    expect(computeLocalSpy).toHaveBeenCalled();
  });

  it('should call verifyStatementMath on successful verification', async () => {
    const verifySpy = vi.spyOn(hy3Service, 'verifyStatementMath').mockResolvedValue({
      local_math: { debit_sum: 50, credit_sum: 0, charges_sum: 0, expected_closing: 950, actual_closing: 950, flow_ok: true, row_count: 1 },
      ai_audit: { anomalies: [], explanation: 'Flow is conserved.', flow_ok: true }
    });

    const { result } = renderHook(() => useExtractionVerification());

    result.current.runVerification(
      [{ date: '2023-01-01', description: 'Test', amount: 50, direction: 'DEBIT' as const, confidence: 100, bankCode: 'TEST', balance: 950 }],
      1000,
      950
    );

    await waitFor(() => {
      expect(result.current.isVerifying).toBe(false);
    });

    expect(result.current.verificationError).toBeNull();
    expect(result.current.verificationResult?.local_math.flow_ok).toBe(true);
    expect(verifySpy).toHaveBeenCalled();
  });
});