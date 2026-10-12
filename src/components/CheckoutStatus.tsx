import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock, X } from 'lucide-react';
import { fetchEntitlement, reconcile, type Entitlement } from '../../services/billingService';
import { useAppStore } from '../store/appStore';

type Outcome = 'pending' | 'entitled' | 'unconfirmed' | 'cancelled';

/**
 * Post-PayPal return state. The ?checkout= parameter only decides which MESSAGE is shown; access is
 * decided by the server. While pending we poll /api/billing/entitlement (and can trigger /reconcile),
 * so a delayed webhook still resolves without the user doing anything.
 */
export default function CheckoutStatus() {
  const s = useAppStore();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [ent, setEnt] = useState<Entitlement | null>(null);
  const [attempts, setAttempts] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const param = new URLSearchParams(window.location.search).get('checkout');
    if (param !== 'success' && param !== 'cancelled') { started.current = true; return; }
    if (param === 'cancelled') { setOutcome('cancelled'); return; }
    setOutcome('pending');
    // The URL is a navigation artefact, not a claim: drop it so a reload/shared link cannot assert
    // a checkout state the server has not confirmed.
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
      if (e?.entitled) {
        setEnt(e);
        s.setIsPremium(true);
        setOutcome('entitled');
        return;
      }
      setAttempts((a) => {
        const next = a + 1;
        if (next >= 6) { setEnt(e); setOutcome('unconfirmed'); return next; }
        window.setTimeout(tick, 2000);
        return next;
      });
    };
    window.setTimeout(tick, 1200);
    return () => { cancelled = true; };
  }, [outcome, s]);

  const onRefresh = async () => {
    setOutcome('pending');
    await reconcile();
    const e = await fetchEntitlement();
    if (e?.entitled) { setEnt(e); s.setIsPremium(true); setOutcome('entitled'); }
    else { setEnt(e); setOutcome('unconfirmed'); }
  };

  if (!outcome) return null;

  const dismiss = () => setOutcome(null);
  const shell = 'fixed bottom-4 right-4 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-md border bg-white dark:bg-[#111622] p-3.5 text-xs shadow-lg';
  const tone = outcome === 'entitled'
    ? 'border-emerald-200 dark:border-emerald-900'
    : outcome === 'cancelled'
      ? 'border-slate-200 dark:border-slate-800'
      : 'border-amber-200 dark:border-amber-900';

  return (
    <div className={`${shell} ${tone}`} role="status" aria-live="polite">
      <div className="flex items-start gap-2.5">
        {outcome === 'entitled'
          ? <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
          : <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 dark:text-[#fafafa]">
            {outcome === 'entitled' && `${(ent?.plan ?? 'pro').toUpperCase()} is active`}
            {outcome === 'pending' && 'Confirming your payment with PayPal…'}
            {outcome === 'unconfirmed' && 'Not confirmed yet'}
            {outcome === 'cancelled' && 'Checkout cancelled'}
          </p>
          <p className="mt-1 text-slate-500 dark:text-slate-400 leading-relaxed">
            {outcome === 'entitled' && 'Access is granted by the server from a verified payment, so it survives refresh and sign-out.'}
            {outcome === 'pending' && 'This page only reports what PayPal has confirmed server-side — returning here does not unlock anything.'}
            {outcome === 'unconfirmed' && `PayPal has not confirmed a payment covering this period yet${ent?.subscription_status ? ` (subscription: ${ent.subscription_status})` : ''}. Re-check below; if it still fails, the payment has not been captured.`}
            {outcome === 'cancelled' && 'No subscription was created and nothing was charged.'}
          </p>
          {outcome === 'unconfirmed' && (
            <button type="button" onClick={onRefresh}
              className="mt-2 px-2 py-1 rounded bg-slate-900 text-white dark:bg-white dark:text-slate-950 font-semibold hover:opacity-90">
              Re-check with PayPal
            </button>
          )}
        </div>
        {outcome !== 'pending' && (
          <button type="button" onClick={dismiss} aria-label="Dismiss"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
