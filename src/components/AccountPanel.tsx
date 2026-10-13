import React, { useEffect, useRef, useState } from 'react';
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
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // The card is a popover: it must close on Escape and on any click outside it, otherwise it
  // stays floating over the workspace.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

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
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        aria-label={`Account: ${s.isPremium ? 'PRO' : 'FREE'} plan`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-[var(--nav-line)] px-2 py-1 text-[var(--nav-ink)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
      >
        <span className="w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center text-[10px] font-bold shrink-0">
          {initials}
        </span>
        <span className="font-mono uppercase tracking-wider text-[10px] font-bold">{s.isPremium ? 'PRO' : 'FREE'}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-3 z-50 w-60 rounded-xl border border-hairline bg-surface p-3 text-xs space-y-2.5" style={{ boxShadow: 'var(--shadow-card)' }}>
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-full bg-ink text-ground dark:bg-white dark:text-slate-950 flex items-center justify-center text-[11px] font-bold shrink-0">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-ink font-semibold truncate leading-tight">
            {user.name || user.email}
          </p>
          <p className="text-muted text-[10px] truncate leading-tight">
            {user.email}
          </p>
        </div>
      </div>

      <div className="pt-2 border-t border-hairline flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted">Plan:</span>
          {s.isPremium ? (
            <span className="px-1.5 py-0.5 rounded-full bg-credit/10 text-credit text-[10px] font-bold font-mono">
              PRO
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded-full bg-sunken text-muted text-[10px] font-medium font-mono">
              FREE
            </span>
          )}
        </div>

        {!s.isPremium && (
          <button
            type="button"
            onClick={() => s.setShowUpgradeCTA(true)}
            className="flex items-center gap-0.5 text-[10px] font-bold text-accent hover:underline"
          >
            <span>Upgrade</span>
            <ArrowUpRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {s.isPremium && (
        <div className="pt-2 border-t border-hairline space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted">PayPal subscription</span>
            <span className="text-[10px] font-semibold text-ink">
              {(ent?.subscription_status ?? 'active').toUpperCase()}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            {ent?.activeSubscriptionId ? (
              <button
                type="button"
                onClick={doCancel}
                disabled={busy}
                className="text-[10px] font-bold text-accent hover:underline disabled:opacity-50"
              >
                {busy ? 'Cancelling…' : 'Cancel subscription'}
              </button>
            ) : (
              <span className="text-[10px] text-muted">Manage via your PayPal account.</span>
            )}
            <span className="text-[9px] font-mono text-muted truncate max-w-[40%]">{ent?.activeSubscriptionId ?? ''}</span>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={async () => { await clerk.signOut(); setOpen(false); onSignOut(); }}
        className="w-full flex items-center justify-center gap-1.5 pt-1 text-muted hover:text-accent text-[11px] font-medium transition-colors"
      >
        <LogOut className="w-3 h-3" />
        <span>Sign Out</span>
      </button>
        </div>
      )}
    </div>
  );
}
