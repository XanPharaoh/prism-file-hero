import { WORKER_BASE_URL } from './apiConfig';
import { supabase } from './authService';

export interface UsageData {
  pages_used: number;
  plan: 'free' | 'pro' | 'business';
  pages_limit: number;
  by_tool: Record<string, number>;
}

/**
 * Fetches usage from the Edge Worker — THE single source of truth.
 * Frontend NEVER tracks usage locally.
 */
export async function fetchUsageFromServer(): Promise<UsageData | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return null;

    const response = await fetch(`${WORKER_BASE_URL}/api/usage`, {
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
      },
    });

    if (!response.ok) return null;

    return await response.json();
  } catch (err) {
    console.warn('[Usage] Failed to fetch from server:', err);
    return null;
  }
}

export function getToolUsage(usageData: UsageData | null, toolId: string): number {
  return usageData?.by_tool?.[toolId] || 0;
}

export function hasToolLimitReached(
  usageData: UsageData | null,
  _toolId: string,
  pagesCost: number = 1
): boolean {
  if (!usageData) return false;
  if (usageData.pages_limit === -1) return false;
  return usageData.pages_used + pagesCost > usageData.pages_limit;
}

export function getRemainingPages(usageData: UsageData | null): number {
  if (!usageData) return 0;
  if (usageData.pages_limit === -1) return Infinity;
  return Math.max(0, usageData.pages_limit - usageData.pages_used);
}

export function formatUsage(usageData: UsageData | null): string {
  if (!usageData) return '—';
  if (usageData.pages_limit === -1) return `${usageData.pages_used} pages used`;
  return `${usageData.pages_used} / ${usageData.pages_limit} pages`;
}