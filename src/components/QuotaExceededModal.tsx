import React from 'react';
import { X, Zap, Cpu, AlertCircle, Sparkles } from './ui/Icon';
import { LOCAL_GLOBAL_CAP, AI_GLOBAL_CAP, LOCAL_PER_TOOL_LIMIT, AI_PER_TOOL_LIMIT } from '../../services/usageConfig';
import { useLocalTimezoneFormat } from '../hooks/useLocalTimezoneFormat';
import type { FeatureType } from '../../services/usageConfig';
import { useAppStore } from '../store/appStore';

interface QuotaExceededModalProps {
  /** Which quota was hit: 'local' pages today or 'ai' cloud pages */
  featureType: FeatureType;
  /** Pages requested by the current extraction attempt */
  requestedPages: number;
  /** Pages used today for this specific tool */
  usedToday: number;
  /** Daily limit per tool */
  dailyLimit: number;
  /** Global usage today for the tier */
  globalUsedToday: number;
  /** Global cap for the tier */
  globalCap: number;
  /** The specific reason: 'tool_limit' or 'global_cap' */
  limitReason: 'tool_limit' | 'global_cap';
  /** Next SAST midnight timestamp */
  nextReset: string;
  /** Why the backend refused, in its own words — preferred over any guess made here. */
  serverReason?: string;
  onClose: () => void;
}

export default function QuotaExceededModal({
  featureType,
  requestedPages,
  usedToday,
  dailyLimit,
  globalUsedToday,
  globalCap,
  limitReason,
  nextReset,
  serverReason,
  onClose,
}: QuotaExceededModalProps) {
  const isAi = featureType === 'ai';
  const localTz = useLocalTimezoneFormat(nextReset);

  // Determine specific message based on limit type
  const isToolLimit = limitReason === 'tool_limit';
  const title = isAi
    ? (isToolLimit ? 'Cloud page allowance reached' : 'Cloud page allowance reached')
    : (isToolLimit ? 'Free Feature Limit Reached' : 'Global Free Limit Reached');

  // An entitlement refusal must be named as such: it is not a page count, and the tool may well
  // have run entirely on this device.
  const needsPlan = /paid plan|premium/i.test(serverReason || '');
  const description = serverReason
    ? (needsPlan
      ? `${serverReason} This plan covers processing on your own device as well as the cloud tools.`
      : serverReason)
    : isAi
      ? (isToolLimit
        ? `This run needs ${requestedPages} cloud page${requestedPages === 1 ? '' : 's'}, and the plan's daily ceiling is ${dailyLimit}. You've used ${usedToday} of ${dailyLimit} today with this feature.`
        : `You've used ${globalUsedToday} of ${globalCap} cloud pages across all features today.`)
      : (isToolLimit
        ? `This run needs ${requestedPages} page${requestedPages === 1 ? '' : 's'}, but the free allowance is ${dailyLimit} pages per day for this feature. You've used ${usedToday} of ${dailyLimit} pages today.`
        : `You've hit your global free limit of ${globalCap} pages. You've used ${globalUsedToday} of ${globalCap} free pages across all features today.`);

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-surface border border-slate-200 dark:border-slate-800 rounded-lg shadow-2xl max-w-md w-full p-6 animate-in zoom-in-95 duration-150 space-y-5">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header & Title */}
        <div className="text-center space-y-2 pt-2">
          <h2 className="text-lg font-bold text-slate-900 ">
            {title}
          </h2>
          <p className="text-xs text-slate-500 leading-relaxed">
            {description}
          </p>
        </div>

        {/* Usage bar */}
        <div className="bg-slate-50 border border-slate-200 dark:border-slate-800 rounded-md p-3.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-500 dark:text-slate-400 uppercase text-[10px] tracking-wider">
              {isAi ? 'Daily AI Statement Allowance' : 'Daily Local Operation Allowance'}
            </span>
            <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
              {isToolLimit ? `${usedToday} / ${dailyLimit}` : `${globalUsedToday} / ${globalCap}`}
            </span>
          </div>
          <div className="h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-slate-900 dark:bg-surface transition-all duration-300"
              style={{ width: `${isToolLimit
                ? Math.min(100, (usedToday / dailyLimit) * 100)
                : Math.min(100, (globalUsedToday / globalCap) * 100)
              }%` }}
            />
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono text-center">
            Resets at midnight SAST • {localTz.formatted}
          </p>
        </div>

        {/* Upgrade CTA */}
        <div className="space-y-2 pt-1">
          <button
            type="button"
            onClick={() => {
              onClose();
              useAppStore.getState().setShowUpgradeCTA(true);
            }}
            className="w-full bg-slate-900 hover:bg-slate-800 text-white dark:bg-surface dark:text-slate-950 dark:hover:bg-slate-200 font-bold py-2.5 px-4 rounded-md text-xs transition-colors duration-100 flex items-center justify-center gap-1.5 active:translate-y-px"
          >
            <span>Upgrade to Pro for Unlimited Processing</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-full text-xs font-semibold text-slate-400 dark:text-slate-500 py-1.5 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            Continue with Free Plan
          </button>
        </div>
      </div>
    </div>
  );
}
