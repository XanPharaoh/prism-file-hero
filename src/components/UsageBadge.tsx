import React, { useEffect, useState } from 'react';
import { Zap, AlertCircle } from './ui/Icon';
import { fetchUsageFromServer, formatUsage, getRemainingPages, type UsageData } from '../../services/usageTrackingService';
import type { User } from '@supabase/supabase-js';

interface UsageBadgeProps {
  user: User | null;
  compact?: boolean;
}

export default function UsageBadge({ user, compact = false }: UsageBadgeProps) {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

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

    // Refresh every 30 seconds
    const interval = setInterval(loadUsage, 30000);
    return () => clearInterval(interval);
  }, [user]);

  if (!user || loading) return null;

  const remaining = getRemainingPages(usage);
  const isLow = remaining <= 3 && remaining > 0;
  const isExhausted = remaining === 0;

  if (compact) {
    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold ${
        isExhausted ? 'bg-red-50 text-red-600' :
        isLow ? 'bg-amber-50 text-amber-600' :
        'bg-slate-50 text-slate-600'
      }`}>
        <Zap className="w-3 h-3" />
        <span>{formatUsage(usage)}</span>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap className={`w-4 h-4 ${isExhausted ? 'text-red-500' : isLow ? 'text-amber-500' : 'text-indigo-500'}`} />
          <span className="text-xs font-black uppercase tracking-widest text-slate-500">
            Monthly Usage
          </span>
        </div>
        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
          usage?.plan === 'business' ? 'bg-purple-50 text-purple-600' :
          usage?.plan === 'pro' ? 'bg-indigo-50 text-indigo-600' :
          'bg-slate-100 text-slate-600'
        }`}>
          {usage?.plan || 'free'}
        </span>
      </div>

      {/* Progress bar */}
      {usage && usage.pages_limit > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-[10px] font-bold text-slate-500 mb-1">
            <span>{usage.pages_used} pages used</span>
            <span>{usage.pages_limit} limit</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isExhausted ? 'bg-red-500' :
                isLow ? 'bg-amber-500' :
                'bg-indigo-500'
              }`}
              style={{ width: `${Math.min(100, (usage.pages_used / usage.pages_limit) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Per-tool breakdown */}
      {usage?.by_tool && Object.keys(usage.by_tool).length > 0 && (
        <div className="space-y-1.5 pt-3 border-t border-slate-100">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
            By Tool
          </p>
          {Object.entries(usage.by_tool)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([toolId, pages]) => (
              <div key={toolId} className="flex items-center justify-between text-xs">
                <span className="text-slate-600 font-medium capitalize truncate">
                  {toolId.replace(/-/g, ' ')}
                </span>
                <span className="text-slate-400 font-bold">{pages} pg</span>
              </div>
            ))}
        </div>
      )}

      {/* Warning messages */}
      {isExhausted && (
        <div className="mt-3 flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="font-bold">Limit reached. Upgrade for more.</span>
        </div>
      )}
      {isLow && (
        <div className="mt-3 flex items-center gap-2 text-xs text-amber-600 bg-amber-50 rounded-xl px-3 py-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="font-bold">Only {remaining} pages left this month.</span>
        </div>
      )}
    </div>
  );
}