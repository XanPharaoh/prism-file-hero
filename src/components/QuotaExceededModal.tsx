import React from 'react';
import { X, Zap, Cpu, AlertCircle, Sparkles } from './ui/Icon';
import { LOCAL_GLOBAL_CAP, AI_GLOBAL_CAP, LOCAL_PER_TOOL_LIMIT, AI_PER_TOOL_LIMIT } from '../../services/usageConfig';
import { useLocalTimezoneFormat } from '../hooks/useLocalTimezoneFormat';
import type { FeatureType } from '../../services/usageConfig';

interface QuotaExceededModalProps {
  /** Which quota was hit: 'local' or 'ai' */
  featureType: FeatureType;
  /** Pages requested by the current extraction attempt */
  requestedPages: number;
  /** Pages used today for this specific tool */
  usedToday: number;
  /** Daily limit per tool (5 for local, 2 for AI) */
  dailyLimit: number;
  /** Global usage today for the tier */
  globalUsedToday: number;
  /** Global cap for the tier (15 for local, 6 for AI) */
  globalCap: number;
  /** The specific reason: 'tool_limit' or 'global_cap' */
  limitReason: 'tool_limit' | 'global_cap';
  /** Next SAST midnight timestamp */
  nextReset: string;
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
  onClose,
}: QuotaExceededModalProps) {
  const isAi = featureType === 'ai';
  const localTz = useLocalTimezoneFormat(nextReset);

  // Determine specific message based on limit type
  const isToolLimit = limitReason === 'tool_limit';
  const title = isAi
    ? (isToolLimit ? 'Premium Feature Limit Reached' : 'Global Premium Limit Reached')
    : (isToolLimit ? 'Free Feature Limit Reached' : 'Global Free Limit Reached');

  const description = isAi
    ? (isToolLimit
        ? `This extraction needs ${requestedPages} page${requestedPages === 1 ? '' : 's'}, but the free premium allowance is ${dailyLimit} pages per day. You've used ${usedToday} of ${dailyLimit} pages today with this feature.`
        : `You've hit your global premium limit of ${globalCap} pages. You've used ${globalUsedToday} of ${globalCap} premium pages across all features today.`)
    : (isToolLimit
        ? `This extraction needs ${requestedPages} page${requestedPages === 1 ? '' : 's'}, but the free allowance is ${dailyLimit} pages per day for this feature. You've used ${usedToday} of ${dailyLimit} pages today with this feature.`
        : `You've hit your global free limit of ${globalCap} pages. You've used ${globalUsedToday} of ${globalCap} free pages across all features today.`);

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-[32px] shadow-2xl max-w-md w-full p-8 animate-in zoom-in-95 duration-200">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors"
        >
          <X className="w-5 h-5 text-slate-500" />
        </button>

        {/* Icon */}
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 ${
          isAi
            ? 'bg-gradient-to-br from-indigo-100 to-purple-100'
            : 'bg-gradient-to-br from-emerald-100 to-teal-100'
        }`}>
          {isAi ? (
            <Cpu className="w-8 h-8 text-indigo-600" />
          ) : (
            <Zap className="w-8 h-8 text-emerald-600" />
          )}
        </div>

        {/* Title */}
        <h2 className="text-2xl font-black text-slate-900 text-center mb-2">
          {title}
        </h2>

        {/* Description */}
        <p className="text-sm text-slate-500 text-center mb-6 leading-relaxed">
          {description}
        </p>

        {/* Usage bar */}
        <div className="bg-slate-50 rounded-2xl p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {isAi ? 'Premium Pages Today' : 'Free Pages Today'}
            </span>
            <span className="text-xs font-black text-slate-700">
              {isToolLimit ? `${usedToday}/${dailyLimit}` : `${globalUsedToday}/${globalCap}`}
            </span>
          </div>
          <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isAi ? 'bg-indigo-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${isToolLimit
                ? Math.min(100, (usedToday / dailyLimit) * 100)
                : Math.min(100, (globalUsedToday / globalCap) * 100)
              }%` }}
            />
          </div>
          <p className="text-[10px] text-slate-400 font-bold mt-2 text-center">
            {isToolLimit ? `Attempted: ${requestedPages} page${requestedPages === 1 ? '' : 's'} • ${localTz.formatted}` : localTz.formatted}
          </p>
        </div>

        {/* Contact CTA */}
        <a
          href="mailto:support@prismfilehero.com?subject=Prism%20File%20Hero%20%E2%80%93%20Quota%20Increase%20Request"
          className="w-full prism-gradient text-white font-black py-4 rounded-2xl shadow-xl hover:shadow-2xl transition-all active:scale-[0.98] flex items-center justify-center gap-2"
        >
          <Sparkles className="w-5 h-5" />
          Contact Us for More
        </a>

        {/* Dismiss */}
        <button
          onClick={onClose}
          className="w-full mt-3 text-sm font-bold text-slate-400 py-3 hover:text-slate-600 transition-colors"
        >
          Maybe Later
        </button>
      </div>
    </div>
  );
}
