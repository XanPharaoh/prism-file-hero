import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Zap, AlertCircle, Cpu } from './ui/Icon';
import { fetchUsageFromServer, getToolDisplayName, type UsageData } from '../../services/usageTrackingService';
import { getFeatureType, getDailyLimit } from '../../services/usageConfig';
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

  // Calculate tool breakdown
  const toolBreakdownList = Object.entries(byTool)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 8);

  if (compact) {
    return (
      <div className="relative" ref={triggerRef}>
        {/* Compact trigger badge */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold cursor-pointer transition-all duration-200 hover:shadow-lg bg-slate-50 text-slate-600 border border-slate-200/50 hover:bg-white"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
        >
          <Zap className="w-3 h-3 text-emerald-500" />
          <span className="hidden sm:inline">{localUsed}/{localCap}</span>
          <span className="hidden sm:inline text-slate-300">|</span>
          <Cpu className="w-3 h-3 text-indigo-500" />
          <span>{aiUsed}/{aiCap}</span>
        </div>

        {/* Glassmorphic Popover */}
        {popoverOpen && (
          <div
            ref={popoverRef}
            className="absolute top-full right-0 mt-2 z-[500]"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            <div className="bg-white/80 backdrop-blur-xl border border-white/40 shadow-2xl rounded-2xl p-4 w-72 transition-all duration-200">
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-indigo-500" />
                  <span className="text-xs font-black uppercase tracking-widest text-slate-500">
                    Daily Usage
                  </span>
                </div>
                <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                  SAST
                </span>
              </div>

              {/* Local Section */}
              <div className="mb-3">
                <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1">
                  <span className="flex items-center gap-1">
                    <Zap className="w-3 h-3 text-emerald-500" />
                    Free
                  </span>
                  <span>{localUsed}/{localCap} pages</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${localUsed >= localCap ? 'bg-red-500' : localUsed >= localCap * 0.7 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${localCap > 0 ? Math.min(100, (localUsed / localCap) * 100) : 0}%` }}
                  />
                </div>
                {/* Local tool breakdown */}
                {toolBreakdownList.filter(([id]) => getFeatureType(id) === 'local').length > 0 && (
                  <div className="mt-2 space-y-1">
                    {toolBreakdownList
                      .filter(([id]) => getFeatureType(id) === 'local')
                      .slice(0, 4)
                      .map(([toolId, pages]) => {
                        const limit = getDailyLimit('local');
                        return (
                          <div key={toolId} className="flex items-center justify-between text-[10px]">
                            <span className="text-slate-500 truncate max-w-[140px]">{getToolDisplayName(toolId)}</span>
                            <span className={`font-bold ${Number(pages) >= limit ? 'text-red-500' : 'text-slate-600'}`}>
                              {String(pages)}/{limit} pg
                            </span>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* Premium Section */}
              <div className="mb-3">
                <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1">
                  <span className="flex items-center gap-1">
                    <Cpu className="w-3 h-3 text-indigo-500" />
                    Premium
                  </span>
                  <span>{aiUsed}/{aiCap} pages</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${aiUsed >= aiCap ? 'bg-red-500' : aiUsed >= aiCap * 0.7 ? 'bg-amber-500' : 'bg-indigo-500'}`}
                    style={{ width: `${aiCap > 0 ? Math.min(100, (aiUsed / aiCap) * 100) : 0}%` }}
                  />
                </div>
                {/* AI tool breakdown */}
                {toolBreakdownList.filter(([id]) => getFeatureType(id) === 'ai').length > 0 && (
                  <div className="mt-2 space-y-1">
                    {toolBreakdownList
                      .filter(([id]) => getFeatureType(id) === 'ai')
                      .slice(0, 4)
                      .map(([toolId, pages]) => {
                        const limit = getDailyLimit('ai');
                        return (
                          <div key={toolId} className="flex items-center justify-between text-[10px]">
                            <span className="text-slate-500 truncate max-w-[140px]">{getToolDisplayName(toolId)}</span>
                            <span className={`font-bold ${Number(pages) >= limit ? 'text-red-500' : 'text-slate-600'}`}>
                              {String(pages)}/{limit} pg
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
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-indigo-500" />
          <span className="text-xs font-black uppercase tracking-widest text-slate-500">
            Daily Usage
          </span>
        </div>
        <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
          SAST
        </span>
      </div>

      {/* Local progress */}
      <div className="mb-2">
        <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1">
          <span className="flex items-center gap-1"><Zap className="w-3 h-3 text-emerald-500" /> Free</span>
          <span>{localUsed}/{localCap} pages</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${localUsed >= localCap ? 'bg-red-500' : localUsed >= localCap * 0.7 ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{ width: `${localCap > 0 ? Math.min(100, (localUsed / localCap) * 100) : 0}%` }} />
        </div>
      </div>

      {/* AI progress */}
      <div className="mb-2">
        <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1">
          <span className="flex items-center gap-1"><Cpu className="w-3 h-3 text-indigo-500" /> Premium</span>
          <span>{aiUsed}/{aiCap} pages</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${aiUsed >= aiCap ? 'bg-red-500' : aiUsed >= aiCap * 0.7 ? 'bg-amber-500' : 'bg-indigo-500'}`}
            style={{ width: `${aiCap > 0 ? Math.min(100, (aiUsed / aiCap) * 100) : 0}%` }} />
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
          className="mt-2 w-full flex items-center justify-between text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-md px-2.5 py-1.5 transition-colors text-left"
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
          className="mt-2 w-full flex items-center justify-between text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-md px-2.5 py-1.5 transition-colors text-left"
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
