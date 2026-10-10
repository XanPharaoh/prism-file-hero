/**
 * Batch 04 — Authoritative server-side plan catalog + entitlement resolution.
 *
 * Rules the guide demands:
 *   • Entitlement comes from the SERVER's plan record ONLY. A plan/featureType sent by
 *     the client is never trusted (defends BUG: client-supplied plan granting access).
 *   • FREE is a finite starter credit, not zero and not unlimited. Local tools are free
 *     and unmetered; cloud/AI is metered against a finite monthly credit.
 *   • No shared "zero-AI / paid-daily" blanket limits — each plan has explicit credits.
 */

export type Plan = 'free' | 'pro' | 'business';

export interface PlanDefinition {
  /** Monthly AI/cloud page credits. -1 means unlimited (business only). */
  aiCreditsPerMonth: number;
  /** Max single-file size in MB. */
  maxFileSizeMb: number;
  /** Local (on-device) tools are always free + unmetered; this flags cloud priority. */
  priorityProcessing: boolean;
  aiTools: boolean;
  priceLabel: string;
}

export const PLAN_CATALOG: Record<Plan, PlanDefinition> = {
  free:     { aiCreditsPerMonth: 50,  maxFileSizeMb: 10,  priorityProcessing: false, aiTools: true,  priceLabel: 'Free' },
  pro:      { aiCreditsPerMonth: 1000, maxFileSizeMb: 50, priorityProcessing: true,  aiTools: true,  priceLabel: '$15 / month' },
  business: { aiCreditsPerMonth: -1,   maxFileSizeMb: 100, priorityProcessing: true, aiTools: true, priceLabel: '$39 / month' },
};

export const PLAN_IDS: Plan[] = ['free', 'pro', 'business'];

export function isLocalToolUnmetered(_plan: Plan): boolean {
  // Local/on-device tools never consume cloud credit, on any plan.
  return true;
}

/**
 * Resolve a plan from a TRUSTED source (server record / verified JWT claim). Anything
 * unrecognized collapses to 'free' — a client cannot mint a higher tier by sending one.
 */
export function resolveTrustedPlan(input: unknown): Plan {
  return typeof input === 'string' && (PLAN_IDS as string[]).includes(input)
    ? (input as Plan)
    : 'free';
}

/** Credit check against the authoritative plan (unlimited = always allowed). */
export function hasCredit(plan: Plan, usedThisMonth: number, requested: number): boolean {
  const limit = PLAN_CATALOG[plan].aiCreditsPerMonth;
  if (limit === -1) return true;
  return usedThisMonth + requested <= limit;
}
