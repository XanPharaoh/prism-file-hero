export interface VerificationRow {
  date: string;
  description: string;
  debit: number | null;
  credit: number | null;
  balance: number;
  charges: number;
}

export interface VerificationPayload {
  rows: VerificationRow[];
  opening_balance: number;
  closing_balance: number;
}

export interface LocalMathResult {
  debit_sum: number;
  credit_sum: number;
  charges_sum: number;
  expected_closing: number;
  actual_closing: number;
  flow_ok: boolean;
  row_count: number;
}

export interface AiAuditResult {
  anomalies: string[];
  explanation: string;
  flow_ok: boolean;
}

export interface VerificationResult {
  local_math: LocalMathResult;
  ai_audit: AiAuditResult;
}

export async function verifyStatementMath(
  payload: VerificationPayload
): Promise<VerificationResult> {
  const verifierUrl = import.meta.env.VITE_HY3_VERIFIER_URL || 'http://localhost:8000';

  const response = await fetch(`${verifierUrl}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(`Verification failed: ${(err as Record<string, unknown>).detail || response.statusText}`);
  }

  return await response.json();
}

export function computeLocalMathOnly(payload: VerificationPayload): VerificationResult {
  const debitSum = payload.rows.reduce((sum, r) => sum + (r.debit || 0), 0);
  const creditSum = payload.rows.reduce((sum, r) => sum + (r.credit || 0), 0);
  const chargesSum = payload.rows.reduce((sum, r) => sum + (r.charges || 0), 0);
  const expectedClosing = payload.opening_balance + creditSum - debitSum - chargesSum;
  const flowOk = Math.abs(expectedClosing - payload.closing_balance) < 0.01;

  return {
    local_math: {
      debit_sum: Number(debitSum.toFixed(2)),
      credit_sum: Number(creditSum.toFixed(2)),
      charges_sum: Number(chargesSum.toFixed(2)),
      expected_closing: Number(expectedClosing.toFixed(2)),
      actual_closing: payload.closing_balance,
      flow_ok: flowOk,
      row_count: payload.rows.length,
    },
    ai_audit: {
      anomalies: ['AI verification service unavailable'],
      explanation: 'Relying on local deterministic math only.',
      flow_ok: flowOk,
    },
  };
}
