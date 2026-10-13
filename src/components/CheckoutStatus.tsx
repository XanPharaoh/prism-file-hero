import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock, X } from 'lucide-react';
import { fetchEntitlement, reconcile, type Entitlement } from '../../services/billingService';
import { useAppStore } from '../store/appStore';

type Outcome = 'pending' | 'entitled' | 'unconfirmed' | 'needsAuth' | 'cancelled';

/**
 * Post-PayPal return state. The ?checkout= parameter decides only WHICH MESSAGE is shown; every
 * payment or plan claim below comes from /api/billing/entitlement. While pending the panel polls the
 * server (and can trigger /reconcile), so a delayed webhook resolves without the user doing anything.
 */
export default function CheckoutStatus() {
  const s = useAppStore();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [ent, setEnt] = useState<Entitlement | null>(null);
  const started = useRef(false);
  const polls = useRef(0);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const param = new URLSearchParams(window.location.search).get('checkout');
    if (param !== 'success' && param !== 'cancelled') return;
    if (param === 'cancelled') { setOutcome('cancelled'); } else { setOutcome('pending'); }
    // The URL is a navigation artefact, not a claim: drop it so a reload or shared link cannot
    // re-assert a checkout state the server has not confirmed.
    const url = new URL(window.location.href);
    url.searchParams.delete('checkout');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    if (outcome !== 'pending') return;
    let cancelled = false;
    const tick = async () => {
      const e = await fetchEntitlement();
      if (cancelled) return;
      if (e?.unauthenticated) { setEnt(e); setOutcome('needsAuth'); return; }
      if (e?.entitled) { setEnt(e); s.setIsPremium(true); setOutcome('entitled'); return; }
      polls.current += 1;
      if (polls.current >= 6) { setEnt(e); setOutcome('unconfirmed'); return; }
      window.setTimeout(tick, 2000);
    };
    window.setTimeout(tick, 1200);
    return () => { cancelled = true; };
  }, [outcome, s]);

  const onRefresh = async () => {
    polls.current = 0;
    setOutcome('pending');
    await reconcile();
    const e = await fetchEntitlement();
    if (e?.unauthenticated) { setEnt(e); setOutcome('needsAuth'); return; }
    if (e?.entitled) { setEnt(e); s.setIsPremium(true); setOutcome('entitled'); }
    else { setEnt(e); setOutcome('unconfirmed'); }
  };

  if (!outcome) return null;

  const goToWorkspace = () => {
    setOutcome(null);
    const zone = document.querySelector('[aria-label="Upload PDF document"]');
    if (zone) zone.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const shell = 'fixed bottom-4 right-4 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-md border bg-surface p-3.5 text-xs shadow-lg';
  const tone = outcome === 'entitled'
    ? 'border-emerald-200 dark:border-emerald-900'
    : outcome === 'cancelled' || outcome === 'needsAuth'
      ? 'border-slate-200 dark:border-slate-800'
      : 'border-amber-200 dark:border-amber-900';
  const title = {
    entitled: `${ent?.plan ?? 'pro'} is active`,
    pending: 'Confirming your payment with PayPal…',
    unconfirmed: 'Not confirmed yet',
    needsAuth: 'Sign in to confirm your subscription',
    cancelled: 'Checkout cancelled',
  }[outcome];
  const body = {
    entitled: ent?.paidUntil
      ? `Paid through ${new Date(ent.paidUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}. Access is granted by the server from a verified payment, so it survives refresh and sign-out.`
      : 'Access is granted by the server from a verified payment, so it survives refresh and sign-out.',
    pending: 'This page only reports what PayPal has confirmed server-side — returning here does not unlock anything.',
    unconfirmed: `PayPal has not confirmed a payment covering this period yet${ent?.subscription_status ? ` (subscription: ${ent.subscription_status})` : ''}. Re-check below; if it still fails, no payment has been captured.`,
    needsAuth: 'You returned from PayPal, but this browser has no session, so there is no account to check. Sign in with the account you used to upgrade to see your plan.',
    cancelled: 'PayPal reported the checkout as cancelled. Your plan is whatever the server confirms for your account.',
  }[outcome];

  return (
    <div className={`${shell} ${tone}`} role="status" aria-live="polite">
      <div className="flex items-start gap-2.5">
        {outcome === 'entitled'
          ? <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          : <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 ">{title}</p>
          <p className="mt-1 text-slate-500 dark:text-slate-400 leading-relaxed">{body}</p>
          {outcome === 'entitled' && (
            <button type="button" onClick={goToWorkspace}
              className="mt-2 px-2 py-1 rounded bg-slate-900 text-white dark:bg-surface dark:text-slate-950 font-semibold hover:opacity-90">
              Open the workspace
            </button>
          )}
          {outcome === 'needsAuth' && (
            <button type="button" onClick={() => s.setAuthModal(true, 'sign-in')}
              className="mt-2 px-2 py-1 rounded bg-brand-600 text-white font-semibold hover:bg-brand-500">
              Sign in
            </button>
          )}
          {outcome === 'unconfirmed' && (
            <button type="button" onClick={onRefresh}
              className="mt-2 px-2 py-1 rounded bg-slate-900 text-white dark:bg-surface dark:text-slate-950 font-semibold hover:opacity-90">
              Re-check with PayPal
            </button>
          )}
        </div>
        {outcome !== 'pending' && (
          <button type="button" onClick={() => setOutcome(null)} aria-label="Dismiss"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
