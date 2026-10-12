import React, { useEffect, useState } from 'react';
import { useClerk } from '@clerk/react';
import { LogOut, ArrowUpRight } from 'lucide-react';
import { useAppStore, type AppUser } from '../store/appStore';
import { fetchEntitlement, cancelSubscription, type Entitlement } from '../../services/billingService';

interface Props {
  user: AppUser;
  onSignOut: () => void;
}

function getInitials(name: string, email: string): string {
  if (name && name.length >= 2) return name.slice(0, 2).toUpperCase();
  const fromEmail = email.split('@')[0];
  if (fromEmail && fromEmail.length >= 2) return fromEmail.slice(0, 2).toUpperCase();
  return (fromEmail || 'PF').slice(0, 2).toUpperCase();
}

export default function AccountPanel({ user, onSignOut }: Props) {
  const clerk = useClerk();
  const s = useAppStore();
  const initials = getInitials(user.name, user.email);
  const [ent, setEnt] = useState<Entitlement & { activeSubscriptionId?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  // R7 Req 8 — subscription status + cancellation, all server-derived (never a browser claim).
  useEffect(() => {
    if (!user) return;
    fetchEntitlement().then((e) => { if (e) setEnt(e as typeof ent); }).catch(() => {});
  }, [user, s.isPremium]);

  const doCancel = async () => {
    if (!ent?.activeSubscriptionId || busy) return;
    setBusy(true);
    const r = await cancelSubscription(ent.activeSubscriptionId);
    setBusy(false);
    s.addToast({ type: r.ok ? 'success' : 'error', message: r.ok ? 'Subscription canceled.' : (r.error || 'Could not cancel.') });
    fetchEntitlement().then((e) => { if (e) setEnt(e as typeof ent); if (e && !e.entitled) s.setIsPremium(false); });
  };

  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-3 text-xs shadow-sm space-y-2.5">
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded bg-slate-900 text-white dark:bg-white dark:text-slate-950 flex items-center justify-center text-[11px] font-bold shrink-0">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-slate-900 dark:text-[#fafafa] font-semibold truncate leading-tight">
            {user.name || user.email}
          </p>
          <p className="text-slate-400 dark:text-slate-500 text-[10px] truncate leading-tight">
            {user.email}
          </p>
        </div>
      </div>

      <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">Plan:</span>
          {s.isPremium ? (
            <span className="px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold font-mono">
              PRO
            </span>
          ) : (
            <span className="px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-medium font-mono">
              FREE
            </span>
          )}
        </div>

        {!s.isPremium && (
          <button
            type="button"
            onClick={() => s.setShowUpgradeCTA(true)}
            className="flex items-center gap-0.5 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            <span>Upgrade</span>
            <ArrowUpRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {s.isPremium && (
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">PayPal subscription</span>
            <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
              {(ent?.subscription_status ?? 'active').toUpperCase()}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            {ent?.activeSubscriptionId ? (
              <button
                type="button"
                onClick={doCancel}
                disabled={busy}
                className="text-[10px] font-bold text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
              >
                {busy ? 'Cancelling…' : 'Cancel subscription'}
              </button>
            ) : (
              <span className="text-[10px] text-slate-400">Manage via your PayPal account.</span>
            )}
            <span className="text-[9px] font-mono text-slate-400 truncate max-w-[40%]">{ent?.activeSubscriptionId ?? ''}</span>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={async () => { await clerk.signOut(); onSignOut(); }}
        className="w-full flex items-center justify-center gap-1.5 pt-1 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 text-[11px] font-medium transition-colors"
      >
        <LogOut className="w-3 h-3" />
        <span>Sign Out</span>
      </button>
    </div>
  );
}
