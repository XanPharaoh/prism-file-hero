import { WORKER_BASE_URL } from './apiConfig';
import { getAuthToken } from './authService';
import { getToolPagesCost } from './usageConfig';
import type { ToolID } from '../src/types';
import { isInternalDesktopDistribution } from '../src/config/distribution';

export interface ExecutionCheckResult {
  allowed: boolean;
  plan: 'free' | 'pro' | 'business';
  pagesUsed: number;
  limit: number;
  reason?: string;
}

/**
 * Calls the backend /api/execute endpoint to verify the user is authorized
 * to perform a heavy operation. Uses the tool's configured page cost.
 * Returns whether execution is allowed, or throws an error with the 402 status details.
 */
export async function checkExecutionAuthorization(
  toolId: ToolID,
  pageCount?: number
): Promise<ExecutionCheckResult> {
  if (isInternalDesktopDistribution) return { allowed: true, plan: 'business', pagesUsed: 0, limit: -1 };
  try {
    // Get the current Clerk session token
    const token = await getAuthToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Use tool-specific page cost if pageCount not explicitly provided
    const pages = pageCount ?? getToolPagesCost(toolId);

    const response = await fetch(`${WORKER_BASE_URL}/api/execute`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ toolId, pageCount: pages }),
    });

    const data = await response.json();

    if (response.status === 402) {
      return {
        allowed: false,
        plan: data.plan ?? 'free',
        pagesUsed: data.pages_used ?? 0,
        limit: data.limit ?? 10,
        reason: data.reason ?? 'Usage limit reached. Upgrade to continue.',
      };
    }

    if (!response.ok && response.status !== 200) {
      // For non-402 errors, log but don't block (fail open for non-auth errors)
      console.warn(`[Edge Enforcement] Non-critical error ${response.status}:`, data);
    }

    return {
      allowed: true,
      plan: data.plan ?? 'free',
      pagesUsed: data.pages_used ?? 0,
      limit: data.limit ?? 10,
    };
  } catch (err) {
    // Phase 2: Fail CLOSED — prevent users from starting operations that will inevitably fail
    console.error('[Edge Enforcement] Worker unreachable, failing CLOSED:', err);
    return {
      allowed: false,
      plan: 'free',
      pagesUsed: 0,
      limit: 10,
      reason: 'Network error. Please check your connection.',
    };
  }
}
