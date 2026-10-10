/**
 * Batch 04 — Atomic credit accounting (pure, provider-agnostic core).
 *
 * The deployed Worker does this in Postgres via reserve_usage/settle_usage RPCs (row locks
 * give atomicity). This module models the SAME semantics as a small, testable state machine
 * so the money-critical invariants — never oversell under concurrency, idempotent by request
 * id, refund on failure, and never charge for a request that wasn't granted — can be proven
 * in CI without a live database. The Postgres migration mirrors these rules.
 *
 * Lifecycle: reserve(id, cost) -> {granted, remaining} ; settle(id,'SUCCESS'|'ERROR').
 *   - A PENDING reservation holds cost against the balance.
 *   - SUCCESS converts the hold to permanent usage (still counted).
 *   - ERROR releases the hold (refund) — the pages become available again.
 *   - Re-issuing the same id returns the original decision (idempotent), never a double charge.
 */

import { Plan, hasCredit, resolveTrustedPlan, PLAN_CATALOG } from './planCatalog';

export interface Account {
  plan: Plan;
  used: number;          // permanently consumed (settled SUCCESS)
  held: Map<string, number>;   // requestId -> cost, currently reserved
  settled: Map<string, 'SUCCESS' | 'ERROR'>; // terminal outcomes by requestId
  decided: Map<string, boolean>;  // requestId -> granted? (for idempotency)
}

export interface ReserveResult {
  requestId: string;
  granted: boolean;
  remaining: number;
  reason?: string;
}

export function newAccount(rawPlan: unknown): Account {
  return {
    plan: resolveTrustedPlan(rawPlan),
    used: 0,
    held: new Map(),
    settled: new Map(),
    decided: new Map(),
  };
}

export function remainingCredits(a: Account): number {
  const limit = PLAN_CATALOG[a.plan].aiCreditsPerMonth;
  if (limit === -1) return Infinity;
  const held = [...a.held.values()].reduce((s, n) => s + n, 0);
  return Math.max(0, limit - a.used - held);
}

/** Pure reserve decision (no side effects) used by reserveAtomic and unit tests. */
export function computeReserve(a: Account, requestId: string, cost: number): ReserveResult {
  if (cost <= 0 || !Number.isInteger(cost)) {
    return { requestId, granted: false, remaining: remainingCredits(a), reason: 'cost must be a positive integer' };
  }
  // Idempotent replay: same requestId returns its prior decision, never double-charges.
  if (a.decided.has(requestId)) {
    const granted = a.decided.get(requestId)!;
    return { requestId, granted, remaining: remainingCredits(a), reason: granted ? undefined : 'duplicate (previously denied)' };
  }
  if (!hasCredit(a.plan, a.used + heldSum(a), cost)) {
    a.decided.set(requestId, false);
    return { requestId, granted: false, remaining: remainingCredits(a), reason: 'insufficient credits' };
  }
  a.held.set(requestId, cost);
  a.decided.set(requestId, true);
  return { requestId, granted: true, remaining: remainingCredits(a) };
}

function heldSum(a: Account): number {
  let s = 0; for (const n of a.held.values()) s += n; return s;
}

/** Settle a reservation. Returns the pages refunded (0 unless ERROR). */
export function settle(a: Account, requestId: string, status: 'SUCCESS' | 'ERROR'): { refunded: number } {
  if (a.settled.has(requestId)) return { refunded: 0 }; // already terminal
  const held = a.held.get(requestId);
  if (held === undefined) return { refunded: 0 };       // never granted → nothing to settle
  a.settled.set(requestId, status);
  a.held.delete(requestId);
  if (status === 'SUCCESS') {
    a.used += held;
    return { refunded: 0 };
  }
  return { refunded: held }; // ERROR → release the hold (refund); used unchanged
}

/**
 * Serialized async facade that mimics a row-lock critical section, so concurrent
 * reserve/settle calls are applied one-at-a-time against shared state.
 */
export class CreditLedger {
  private account: Account;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(rawPlan: unknown) { this.account = newAccount(rawPlan); }

  private run<T>(fn: () => T): Promise<T> {
    const next = this.chain.then(() => fn());
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }

  reserve(requestId: string, cost: number): Promise<ReserveResult> {
    return this.run(() => computeReserve(this.account, requestId, cost));
  }
  settle(requestId: string, status: 'SUCCESS' | 'ERROR'): Promise<{ refunded: number }> {
    return this.run(() => settle(this.account, requestId, status));
  }
  snapshot(): { plan: Plan; used: number; remaining: number } {
    return { plan: this.account.plan, used: this.account.used, remaining: remainingCredits(this.account) };
  }
}
