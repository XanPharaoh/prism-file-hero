import posthog from 'posthog-js';
import type { User } from '@supabase/supabase-js';
import type { ToolID } from '../types';

// Initialize PostHog (Using placeholder keys to be replaced via .env)
posthog.init(import.meta.env.VITE_POSTHOG_KEY || 'MISSING_KEY', {
  api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com',
  autocapture: false, // We will manually capture high-value events
  capture_pageview: true,
});

export const analytics = {
  identifyUser: (user: User, plan: string) => {
    posthog.identify(user.id, {
      email: user.email,
      plan: plan,
    });
  },
  resetUser: () => posthog.reset(),
  trackToolSelected: (toolId: ToolID) => posthog.capture('tool_selected', { tool_id: toolId }),
  trackFilesAdded: (toolId: ToolID, fileCount: number, totalSize: number) =>
    posthog.capture('files_added', { tool_id: toolId, file_count: fileCount, total_size_bytes: totalSize }),
  trackExecutionStarted: (toolId: ToolID, isPremium: boolean) =>
    posthog.capture('execution_started', { tool_id: toolId, is_premium: isPremium }),
  trackExecutionCompleted: (toolId: ToolID, success: boolean, errorMessage?: string) =>
    posthog.capture('execution_completed', { tool_id: toolId, success, error_message: errorMessage }),
  trackPaywallHit: (toolId: ToolID, reason: string) =>
    posthog.capture('paywall_hit', { tool_id: toolId, reason }),
  trackUpgradeClicked: (location: 'header' | 'ledger_guard' | 'usage_limit') =>
    posthog.capture('upgrade_clicked', { location }),
};