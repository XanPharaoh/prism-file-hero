/**
 * Batch 04 — credit accounting invariants, tested in-memory (no live DB). The Postgres
 * reserve/settle RPCs enforce the same rules with row locks; these tests prove the money
 * logic: never oversell under concurrency, idempotent by request id, refund on failure,
 * and an unrecognized (client-forged) plan collapses to free.
 */
import { describe, it, expect } from 'vitest';
import { CreditLedger, newAccount, computeReserve, settle } from '../worker/src/creditLedger';
import { resolveTrustedPlan, hasCredit, PLAN_CATALOG } from '../worker/src/planCatalog';

describe('plan catalog + trusted-plan funnel', () => {
  it('free is finite (not zero, not unlimited); business is unlimited', () => {
    expect(PLAN_CATALOG.free.aiCreditsPerMonth).toBeGreaterThan(0);
    expect(PLAN_CATALOG.business.aiCreditsPerMonth).toBe(-1);
    expect(hasCredit('business', 999999, 1)).toBe(true);
  });
  it('an unrecognized / client-forged plan collapses to free (never a higher tier)', () => {
    expect(resolveTrustedPlan('enterprise-superuser')).toBe('free');
    expect(resolveTrustedPlan(undefined)).toBe('free');
    expect(resolveTrustedPlan('pro')).toBe('pro');
  });
});

describe('reserve/settle reducer', () => {
  it('denies when insufficient credits and records the decision', () => {
    const a = newAccount('free'); // 50 credits
    const r = computeReserve(a, 'r1', 60);
    expect(r.granted).toBe(false);
    expect(r.reason).toMatch(/insufficient/i);
  });
  it('rejects non-positive / non-integer cost', () => {
    const a = newAccount('free');
    expect(computeReserve(a, 'x', 0).granted).toBe(false);
    expect(computeReserve(a, 'y', 1.5).granted).toBe(false);
  });
  it('SUCCESS converts the hold to used; ERROR refunds it', () => {
    const a = newAccount('free');
    computeReserve(a, 'ok', 10);
    computeReserve(a, 'bad', 10);
    expect(settle(a, 'ok', 'SUCCESS').refunded).toBe(0);
    expect(a.used).toBe(10);
    expect(settle(a, 'bad', 'ERROR').refunded).toBe(10);
    expect(a.used).toBe(10); // refund does not add to used
    // remaining restored: 50 - 10(used) = 40, the refunded 10 is available again
    const replay = computeReserve(a, 'bad', 10); // same id, already decided granted
    expect(replay.granted).toBe(true);
  });
  it('re-settling an already-terminal request is a no-op (no double refund)', () => {
    const a = newAccount('free');
    computeReserve(a, 'r', 10);
    settle(a, 'r', 'ERROR');
    expect(settle(a, 'r', 'ERROR').refunded).toBe(0);
  });
});

describe('concurrency + idempotency (serialized ledger)', () => {
  it('concurrent reserves never oversell a free 50-credit account', async () => {
    const ledger = new CreditLedger('free');
    // Fire 20 concurrent 4-credit reserves = 80 requested > 50 available.
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => ledger.reserve(`req-${i}`, 4))
    );
    const granted = results.filter(r => r.granted).length;
    expect(granted).toBe(12);        // floor(50/4) = 12 grants, 48 credits held
    expect(ledger.snapshot().remaining).toBeGreaterThanOrEqual(0);
    expect(results.find(r => !r.granted)?.reason).toMatch(/insufficient/i);
  });

  it('duplicate request ids are idempotent — replay returns the same grant, no extra charge', async () => {
    const ledger = new CreditLedger('free');
    const first = await ledger.reserve('same', 30);
    const replay = await ledger.reserve('same', 30);
    expect(first.granted).toBe(true);
    expect(replay.granted).toBe(true);
    // Only one 30-credit hold, not two:
    expect(ledger.snapshot().remaining).toBe(20);
  });

  it('provider failure refunds, freeing credit for a later request', async () => {
    const ledger = new CreditLedger('free');
    const a = await ledger.reserve('a', 40);
    expect(a.granted).toBe(true);
    expect((await ledger.reserve('b', 20)).granted).toBe(false); // only 10 left; 'b' now decided-denied
    await ledger.settle('a', 'ERROR');                            // refund 40
    // A FRESH request id succeeds now that the credit is back (a replay of 'b' would
    // correctly return its prior denial — idempotency).
    expect((await ledger.reserve('c', 20)).granted).toBe(true);
  });

  it('business plan is never rate-limited by credits', async () => {
    const ledger = new CreditLedger('business');
    for (let i = 0; i < 100; i++) {
      expect((await ledger.reserve(`big-${i}`, 1000)).granted).toBe(true);
    }
  });
});
