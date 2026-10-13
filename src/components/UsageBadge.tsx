import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Zap, AlertCircle, Cpu } from './ui/Icon';
import { fetchUsageFromServer, getToolDisplayName, type UsageData } from '../../services/usageTrackingService';
import { getFeatureType, getDailyLimit, isUnlimited } from '../../services/usageConfig';
import { useCountdown } from '../hooks/useCountdown';
import { useLocalTimezoneFormat } from '../hooks/useLocalTimezoneFormat';
import { useAppStore, type AppUser } from '../store/appStore';

interface UsageBadgeProps {
  user: AppUser | null;
  compact?: boolean;
}

export default function UsageBadge({ user, compact = false }: UsageBadgeProps) {
  // 1. ALL hooks must run unconditionally on every render path.
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const nextReset = usage?.next_sast_midnight;
  const { hours, minutes, seconds, isExpired } = useCountdown(nextReset);
  const localTz = useLocalTimezoneFormat(nextReset);

  const handleMouseEnter = useCallback(() => {
    if (!('ontouchstart' in window)) setPopoverOpen(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (!('ontouchstart' in window)) setPopoverOpen(false);
  }, []);

  const handleClick = useCallback(() => {
    setPopoverOpen(prev => !prev);
  }, []);

  useEffect(() => {
    if (!user) {
      setUsage(null);
      setLoading(false);
      return;
    }

    const loadUsage = async () => {
      setLoading(true);
      const data = await fetchUsageFromServer();
      setUsage(data);
      setLoading(false);
    };

    loadUsage();
    const interval = setInterval(loadUsage, 30000);
    return () => clearInterval(interval);
  }, [user]);

  // Close popover on click outside
  useEffect(() => {
    if (!popoverOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [popoverOpen]);

  // Close popover on Escape
  useEffect(() => {
    if (!popoverOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopoverOpen(false);
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [popoverOpen]);

  // 2. Early returns only AFTER every hook above has run.
  if (!user || loading) return null;

  const localUsed = usage?.local_pages_used_today ?? 0;
  const localCap = usage?.local_daily_limit ?? 15;
  const aiUsed = usage?.ai_pages_used_today ?? 0;
  const aiCap = usage?.ai_daily_limit ?? 6;
  const byTool = usage?.by_tool ?? {};
  const plan = usage?.plan === 'pro' || usage?.plan === 'business' ? usage.plan : 'free';

  // Paid plans have no daily ceiling; their budget is the monthly page allowance, so the
  // meter must not render -1 as a number or treat any usage as "over".
  const capText = (cap: number) => (isUnlimited(cap) ? '∞' : String(cap));
  const fillPct = (used: number, cap: number) => (isUnlimited(cap) || cap <= 0 ? 0 : Math.min(100, (used / cap) * 100));
  const tone = (used: number, cap: number, over: string, near: string, ok: string) =>
    isUnlimited(cap) ? ok : used >= cap ? over : used >= cap * 0.7 ? near : ok;

  // Calculate tool breakdown
  const toolBreakdownList = Object.entries(byTool)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 8);

  if (compact) {
    return (
      <div className="relative" ref={triggerRef}>
        {/* Compact trigger badge */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold cursor-pointer transition-all duration-200 hover:shadow-lg bg-sunken text-ink border border-hairline hover:bg-surface"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
        >
          <Zap className="w-3 h-3 text-emerald-500" />
          <span className="hidden sm:inline">{localUsed}/{capText(localCap)}</span>
          <span className="hidden sm:inline text-slate-300">|</span>
          <Cpu className="w-3 h-3 text-brand-500" />
          <span>{aiUsed}/{capText(aiCap)}</span>
        </div>

        {/* Glassmorphic Popover */}
        {popoverOpen && (
          <div
            ref={popoverRef}
            className="absolute top-full right-0 mt-2 z-[500]"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <div className="bg-surface border border-hairline rounded-2xl p-4 w-72 transition-all duration-200" style={{ boxShadow: 'var(--shadow-float)' }}>
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-brand-500" />
                  <span className="text-xs font-black uppercase tracking-widest text-slate-500">
                    Today’s usage
                  </span>
                </div>
                <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                  SAST
                </span>
              </div>

              {/* On-device section */}
              <div className="mb-3">
                <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1">
                  <span className="flex items-center gap-1">
                    <Zap className="w-3 h-3 text-emerald-500" />
                    On-device
                  </span>
                  <span>{localUsed}/{capText(localCap)} pages</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${tone(localUsed, localCap, 'bg-red-500', 'bg-amber-500', 'bg-emerald-500')}`}
                    style={{ width: `${fillPct(localUsed, localCap)}%` }}
                  />
                </div>
                {/* Local tool breakdown */}
                {toolBreakdownList.filter(([id]) => getFeatureType(id) === 'local').length > 0 && (
                  <div className="mt-2 space-y-1">
                    {toolBreakdownList
                      .filter(([id]) => getFeatureType(id) === 'local')
                      .slice(0, 4)
                      .map(([toolId, pages]) => {
                        const limit = getDailyLimit('local', plan);
                        return (
                          <div key={toolId} className="flex items-center justify-between text-[10px]">
                            <span className="text-slate-500 truncate max-w-[140px]">{getToolDisplayName(toolId)}</span>
                            <span className={`font-bold ${!isUnlimited(limit) && Number(pages) >= limit ? 'text-accent' : 'text-slate-600'}`}>
                              {String(pages)}/{capText(limit)} pg
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* Cloud AI section */}
              <div className="mb-3">
                <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1">
                  <span className="flex items-center gap-1">
                    <Cpu className="w-3 h-3 text-brand-500" />
                    Cloud AI
                  </span>
                  <span>{aiUsed}/{capText(aiCap)} pages</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${tone(aiUsed, aiCap, 'bg-red-500', 'bg-amber-500', 'bg-brand-500')}`}
                    style={{ width: `${fillPct(aiUsed, aiCap)}%` }}
                  />
                </div>
                {!isUnlimited(usage?.pages_limit ?? -1) && (
                  <div className="mt-1 text-[10px] font-bold text-slate-400">
                    {usage?.pages_used ?? 0} of {usage?.pages_limit} AI pages this month
                  </div>
                )}
                {/* AI tool breakdown */}
                {toolBreakdownList.filter(([id]) => getFeatureType(id) === 'ai').length > 0 && (
                  <div className="mt-2 space-y-1">
                    {toolBreakdownList
                      .filter(([id]) => getFeatureType(id) === 'ai')
                      .slice(0, 4)
                      .map(([toolId, pages]) => {
                        const limit = getDailyLimit('ai', plan);
                        return (
                          <div key={toolId} className="flex items-center justify-between text-[10px]">
                            <span className="text-slate-500 truncate max-w-[140px]">{getToolDisplayName(toolId)}</span>
                            <span className={`font-bold ${!isUnlimited(limit) && Number(pages) >= limit ? 'text-accent' : 'text-slate-600'}`}>
                              {String(pages)}/{capText(limit)} pg
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* Smart Timer Footer */}
              <div className="pt-3 border-t border-slate-100">
                {/* Live Countdown */}
                {!isExpired ? (
                  <div className="text-center">
                    <span className="text-[11px] font-black text-slate-400 tabular-nums tracking-wider">
                      Resets in {hours}h {minutes}m {seconds}s
                    </span>
                  </div>
                ) : (
                  <div className="text-center">
                    <span className="text-[11px] font-black text-emerald-500">
                      Resetting now...
                    </span>
                  </div>
                )}
                {/* Local timezone translation */}
                <div className="text-center mt-1">
                  <span className="text-[9px] text-slate-400 font-bold">
                    {localTz.formatted}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Full view (non-compact) — kept for AccountPanel integration
  return (
    <div className="bg-surface border border-hairline rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-brand-500" />
          <span className="text-xs font-black uppercase tracking-widest text-slate-500">
            Today’s usage
          </span>
        </div>
        <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
          SAST
        </span>
      </div>

      {/* Local progress */}
      <div className="mb-2">
        <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1">
          <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-emerald-500" /> On-device</span>
          <span>{localUsed}/{capText(localCap)} pages</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${tone(localUsed, localCap, 'bg-red-500', 'bg-amber-500', 'bg-emerald-500')}`}
            style={{ width: `${fillPct(localUsed, localCap)}%` }} />
        </div>
      </div>

      {/* AI progress */}
      <div className="mb-2">
        <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1">
          <span className="flex items-center gap-1"><Cpu className="w-3 h-3 text-brand-500" /> Cloud AI</span>
          <span>{aiUsed}/{capText(aiCap)} pages</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${tone(aiUsed, aiCap, 'bg-red-500', 'bg-amber-500', 'bg-brand-500')}`}
            style={{ width: `${fillPct(aiUsed, aiCap)}%` }} />
        </div>
      </div>

      {/* Timer */}
      <div className="pt-2 border-t border-slate-100 mt-2">
        {!isExpired ? (
          <div className="text-center">
            <span className="text-[10px] font-black text-slate-400 tabular-nums tracking-wider">
              Resets in {hours}h {minutes}m {seconds}s
            </span>
            <div className="text-[8px] text-slate-400 font-bold mt-0.5">
              {localTz.formatted}
            </div>
          </div>
        ) : (
          <div className="text-center">
            <span className="text-[10px] font-black text-emerald-500">Resetting now...</span>
          </div>
        )}
      </div>

      {/* Alerts */}
      {localUsed >= localCap && (
        <button
          type="button"
          onClick={() => {
            setPopoverOpen(false);
            useAppStore.getState().setShowUpgradeCTA(true);
          }}
          className="mt-2 w-full flex items-center justify-between text-xs text-accent bg-accent/10 hover:bg-accent/15 rounded-md px-2.5 py-1.5 transition-colors text-left"
        >
          <div className="flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="font-semibold text-[11px]">Free limit reached</span>
          </div>
          <span className="underline font-bold text-[11px]">Upgrade →</span>
        </button>
      )}
      {aiUsed >= aiCap && (
        <button
          type="button"
          onClick={() => {
            setPopoverOpen(false);
            useAppStore.getState().setShowUpgradeCTA(true);
          }}
          className="mt-2 w-full flex items-center justify-between text-xs text-accent bg-accent/10 hover:bg-accent/15 rounded-md px-2.5 py-1.5 transition-colors text-left"
        >
          <div className="flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="font-semibold text-[11px]">Premium limit reached</span>
          </div>
          <span className="underline font-bold text-[11px]">Upgrade →</span>
        </button>
      )}
    </div>
  );
}
