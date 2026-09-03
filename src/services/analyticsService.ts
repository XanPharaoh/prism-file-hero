import posthog from 'posthog-js';
import type { AppUser } from '../store/appStore';
import type { ToolID } from '../types';
import { isInternalDesktopDistribution } from '../config/distribution';

// Only enable PostHog when a valid public client key (phc_ prefix) is configured.
// PostHog secret/personal keys (phx_ prefix) grant administrative API access and must NEVER be used in client applications.
const rawKey = (import.meta.env.VITE_POSTHOG_KEY as string | undefined)?.trim();
const isEnabled = !isInternalDesktopDistribution && Boolean(rawKey) && rawKey.startsWith('phc_');

if (rawKey && !rawKey.startsWith('phc_')) {
  console.error('[Security Warning] Invalid PostHog key provided. Client applications must only use public project API keys starting with "phc_".');
}

if (isEnabled) {
  try {
    posthog.init(rawKey!, {
      api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com',
      autocapture: false, // We will manually capture high-value events
      capture_pageview: true,
    });
  } catch (err) {
    console.warn('[Analytics] PostHog init failed, disabling tracking:', err);
    // PostHog failed to initialize — force disable so no internal calls fire
    (window as any).__POSTHOG_DISABLED__ = true;
  }
}

/** Safe wrapper — checks isEnabled and wraps in try/catch so tracking never throws */
function safeCapture(event: string, properties?: Record<string, unknown>): void {
  if (!isEnabled || (window as any).__POSTHOG_DISABLED__) return;
  try {
    posthog.capture(event, properties);
  } catch {
    // Silently ignore — analytics must never break app functionality
  }
}

export const analytics = {
  identifyUser: (user: AppUser, plan: string) => {
    if (!isEnabled || (window as any).__POSTHOG_DISABLED__) return;
    try {
      posthog.identify(user.id, {
        email: user.email,
        plan: plan,
      });
    } catch {
      // Silently ignore
    }
  },
  resetUser: () => {
    if (!isEnabled || (window as any).__POSTHOG_DISABLED__) return;
    try {
      posthog.reset();
    } catch {
      // Silently ignore
    }
  },
  trackToolSelected: (toolId: ToolID) =>
    safeCapture('tool_selected', { tool_id: toolId }),
  trackFilesAdded: (toolId: ToolID, fileCount: number, totalSize: number) =>
    safeCapture('files_added', { tool_id: toolId, file_count: fileCount, total_size_bytes: totalSize }),
  trackExecutionStarted: (toolId: ToolID, isPremium: boolean) =>
    safeCapture('execution_started', { tool_id: toolId, is_premium: isPremium }),
  trackExecutionCompleted: (toolId: ToolID, success: boolean, errorMessage?: string) =>
    safeCapture('execution_completed', { tool_id: toolId, success, error_message: errorMessage }),
  trackPaywallHit: (toolId: ToolID, reason: string) =>
    safeCapture('paywall_hit', { tool_id: toolId, reason }),
  trackUpgradeClicked: (location: 'header' | 'ledger_guard' | 'usage_limit') =>
    safeCapture('upgrade_clicked', { location }),
};
