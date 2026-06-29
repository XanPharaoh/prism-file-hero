export type Plan = 'free' | 'pro' | 'business';

export interface PlanLimits {
  aiPagesPerMonth: number;
  maxFileSizeMb: number;
  features: {
    freeTools: boolean;
    aiTools: boolean;
    priorityProcessing: boolean;
  };
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    aiPagesPerMonth: 10,
    maxFileSizeMb: 10,
    features: {
      freeTools: true,
      aiTools: true,
      priorityProcessing: false,
    },
  },
  pro: {
    aiPagesPerMonth: 500,
    maxFileSizeMb: 50,
    features: {
      freeTools: true,
      aiTools: true,
      priorityProcessing: true,
    },
  },
  business: {
    aiPagesPerMonth: -1, // unlimited
    maxFileSizeMb: 100,
    features: {
      freeTools: true,
      aiTools: true,
      priorityProcessing: true,
    },
  },
};

export const PLAN_PRICES: Record<Plan, string> = {
  free: 'Free',
  pro: '$15 / month',
  business: '$39 / month',
};

export function isWithinLimit(
  plan: Plan,
  pagesUsed: number,
  pagesRequested: number
): boolean {
  const limit = PLAN_LIMITS[plan].aiPagesPerMonth;
  if (limit === -1) return true; // unlimited
  return pagesUsed + pagesRequested <= limit;
}

export function getPlanDisplayName(plan: Plan): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}