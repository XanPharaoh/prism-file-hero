import React, { useState, useEffect, useRef } from 'react';
import { X, Check, ShieldCheck, Zap, Sparkles, Building, CreditCard, ExternalLink } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { analytics } from '../services/analyticsService';
import { startPayPalSubscribe, fetchEntitlement, reconcile } from '../../services/billingService';

interface UpgradeModalProps {
  onClose: () => void;
  defaultPlan?: 'pro' | 'business';
}

export default function UpgradeModal({ onClose, defaultPlan = 'pro' }: UpgradeModalProps) {
  const s = useAppStore();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [currency, setCurrency] = useState<'ZAR' | 'USD'>('ZAR');
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<'pro' | 'business' | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // R3 — after checkout, the plan is NOT granted by the browser. Poll the SERVER entitlement until a
  // verified webhook flips it off 'free'. This is the only source of truth (survives refresh/logout).
  useEffect(() => {
    if (!pendingPlan) return;
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts += 1;
      const ent = await fetchEntitlement();
      if (ent && (ent.entitled || ent.plan === 'pro' || ent.plan === 'business')) {
        if (pollRef.current) clearInterval(pollRef.current);
        setPendingPlan(null);
        s.setIsPremium(true);
        s.addToast({ type: 'success', message: `Subscription active — ${ent.plan.toUpperCase()} unlocked.` });
      } else if (attempts >= 45) { // ~3 min at 4s
        if (pollRef.current) clearInterval(pollRef.current);
        setPendingPlan(null);
        s.addToast({ type: 'info', message: 'Checkout recorded. Entitlement will activate shortly once the payment provider confirms.' });
      }
    }, 4000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [pendingPlan]);

  const isAnnual = billingCycle === 'annual';

  const prices = {
    pro: {
      ZAR: isAnnual ? 239 : 299,
      USD: isAnnual ? 15 : 19,
    },
    business: {
      ZAR: isAnnual ? 639 : 799,
      USD: isAnnual ? 39 : 49,
    },
  };

  const currencySymbol = currency === 'ZAR' ? 'R' : '$';

  const handleSubscribe = async (planId: 'pro' | 'business') => {
    setLoadingPlan(planId);
    analytics.trackUpgradeClicked('usage_limit');

    // If user is not authenticated, prompt sign up / sign in first
    if (!s.user) {
      setLoadingPlan(null);
      s.addToast({
        type: 'info',
        message: 'Please sign in or create an account first to link your subscription.',
      });
      s.setAuthModal(true, 'sign-up');
      onClose();
      return;
    }

    try {
      // R7: the browser sends ONLY plan + cycle. The server derives the identity from the verified
      // token, maps plan+cycle to an allowlisted PayPal plan id, creates the PayPal subscription, and
      // persists the user↔subscription link. No userId/customer_id/plan id is trusted from here.
      const res = await startPayPalSubscribe(planId, billingCycle);
      if (res.configured === false) {
        s.addToast({ type: 'info', message: 'PayPal checkout isn’t enabled in this build yet (no sandbox/live credentials configured).' });
        return;
      }
      if (!res.ok) {
        s.addToast({ type: 'error', message: res.error === 'network' ? 'Unable to reach the billing service.' : (res.error || 'Unable to start checkout.') });
        return;
      }
      if (res.approveUrl && typeof window !== 'undefined') {
        window.open(res.approveUrl, '_blank', 'noopener,noreferrer');
      }
      s.addToast({ type: 'success', message: `Complete your ${planId === 'pro' ? 'Pro' : 'Business'} subscription in PayPal…` });
      setPendingPlan(planId); // poll the SERVER for confirmation (browser approval grants nothing)
    } catch (err) {
      console.error('[Subscription] Failed to initiate checkout:', err);
      s.addToast({ type: 'error', message: 'Unable to start checkout. Please contact support@prismfilehero.com.' });
    } finally {
      setLoadingPlan(null);
    }
  };

  const handleReconcile = async () => {
    const r = await reconcile();
    if (r.configured === false) s.addToast({ type: 'info', message: 'PayPal reconciliation isn’t enabled in this build yet.' });
    else if (r.ok) s.addToast({ type: 'info', message: 'Subscription status refreshed from PayPal.' });
    else s.addToast({ type: 'error', message: 'Could not refresh subscription status.' });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[300] flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-4xl relative bg-white dark:bg-[#111622] border border-slate-200 dark:border-slate-800 rounded-lg shadow-2xl overflow-hidden my-6 animate-in fade-in zoom-in-95 duration-150">
        {/* Top Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F19]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-[#fafafa]">
              Prism File Hero Subscription Plans
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close upgrade modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Header & Controls */}
        <div className="p-6 text-center space-y-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-[#fafafa]">
            High-Volume Document & Bank Statement Intelligence
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-[#d4d4d8] max-w-xl mx-auto leading-relaxed">
            Eliminate daily limits, batch-process multi-page financial statements into reconciled Excel sheets, and run unlimited private PDF operations.
          </p>

          {/* Toggle Controls */}
          <div className="pt-2 flex flex-wrap items-center justify-center gap-4 text-xs">
            {/* Billing Cycle Toggle */}
            <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 p-0.5">
              <button
                type="button"
                onClick={() => setBillingCycle('monthly')}
                className={`px-3 py-1 font-semibold rounded text-xs transition-colors duration-100 ${
                  billingCycle === 'monthly'
                    ? 'bg-white dark:bg-[#111622] text-slate-900 dark:text-[#fafafa] shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setBillingCycle('annual')}
                className={`px-3 py-1 font-semibold rounded text-xs transition-colors duration-100 flex items-center gap-1.5 ${
                  billingCycle === 'annual'
                    ? 'bg-white dark:bg-[#111622] text-slate-900 dark:text-[#fafafa] shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                <span>Annual</span>
                <span className="px-1 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[10px] font-mono font-bold">
                  Save 20%
                </span>
              </button>
            </div>

            {/* Currency Toggle */}
            <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/80 p-0.5">
              <button
                type="button"
                onClick={() => setCurrency('ZAR')}
                className={`px-2.5 py-1 font-mono font-semibold rounded text-xs transition-colors duration-100 ${
                  currency === 'ZAR'
                    ? 'bg-white dark:bg-[#111622] text-slate-900 dark:text-[#fafafa] shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                ZAR (R)
              </button>
              <button
                type="button"
                onClick={() => setCurrency('USD')}
                className={`px-2.5 py-1 font-mono font-semibold rounded text-xs transition-colors duration-100 ${
                  currency === 'USD'
                    ? 'bg-white dark:bg-[#111622] text-slate-900 dark:text-[#fafafa] shadow-xs'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                USD ($)
              </button>
            </div>
          </div>
        </div>

        {/* Pricing Cards Grid */}
        <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* FREE PLAN */}
          <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-5 flex flex-col justify-between space-y-5">
            <div className="space-y-4">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Starter / Free
                </span>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-slate-900 dark:text-[#fafafa]">
                    {currencySymbol}0
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">/ forever</span>
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-[#d4d4d8] leading-relaxed">
                  Basic utility conversion and daily statement verification for casual use.
                </p>
              </div>

              <div className="space-y-2 border-t border-slate-100 dark:border-slate-800/80 pt-4 text-xs">
                <div className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                  <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  <span>15 local PDF operations / day</span>
                </div>
                <div className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                  <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  <span>2 bank statement pages / day</span>
                </div>
                <div className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                  <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  <span>Client-side WebAssembly sandbox</span>
                </div>
                <div className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                  <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  <span>Standard XLSX / CSV export</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={!s.isPremium}
              onClick={onClose}
              className="w-full py-2 px-3 rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 text-xs font-semibold cursor-default"
            >
              {!s.isPremium ? 'Active Plan' : 'Free Tier'}
            </button>
          </div>

          {/* PRO PLAN (RECOMMENDED) */}
          <div className="relative rounded-md border-2 border-slate-900 dark:border-white bg-slate-50/70 dark:bg-[#151c2c] p-5 flex flex-col justify-between space-y-5 shadow-md">
            {/* Top Recommended Tag */}
            <div className="absolute -top-3 right-4 px-2 py-0.5 rounded bg-slate-900 text-white dark:bg-white dark:text-slate-950 text-[10px] font-mono font-bold tracking-wider uppercase">
              Most Popular
            </div>

            <div className="space-y-4">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                  Professional
                </span>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-slate-900 dark:text-[#fafafa]">
                    {currencySymbol}{prices.pro[currency]}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">/ month</span>
                </div>
                <p className="mt-2 text-xs text-slate-600 dark:text-[#d4d4d8] leading-relaxed">
                  Ideal for accountants, financial advisors, SME owners, and power users.
                </p>
              </div>

              <div className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-4 text-xs">
                <div className="flex items-start gap-2 text-slate-900 dark:text-[#fafafa] font-semibold">
                  <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  <span>Unlimited local operations (Merge, Split, OCR)</span>
                </div>
                <div className="flex items-start gap-2 text-slate-900 dark:text-[#fafafa] font-semibold">
                  <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  <span>100 AI statement pages / month</span>
                </div>
                <div className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                  <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  <span>SBSA, FNB, Capitec, ABSA, Nedbank, TymeBank</span>
                </div>
                <div className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                  <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  <span>Balance reconciliation verification</span>
                </div>
                <div className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                  <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  <span>Multi-page batch statement extraction</span>
                </div>
                <div className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                  <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  <span>Priority processing queue</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={loadingPlan === 'pro'}
              onClick={() => handleSubscribe('pro')}
              className="w-full py-2.5 px-3 rounded-md bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 text-xs font-bold transition-colors duration-100 flex items-center justify-center gap-1.5 shadow-sm active:translate-y-px"
            >
              {loadingPlan === 'pro' ? (
                <span>Loading checkout...</span>
              ) : pendingPlan === 'pro' ? (
                <span>Confirming payment…</span>
              ) : (
                <>
                  <span>Subscribe to Pro</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>

          {/* BUSINESS PLAN */}
          <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111622] p-5 flex flex-col justify-between space-y-5">
            <div className="space-y-4">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Business / Firm
                </span>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-slate-900 dark:text-[#fafafa]">
                    {currencySymbol}{prices.business[currency]}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">/ month</span>
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-[#d4d4d8] leading-relaxed">
                  For accounting practices, legal firms, and corporate audit teams.
                </p>
              </div>

              <div className="space-y-2 border-t border-slate-100 dark:border-slate-800/80 pt-4 text-xs">
                <div className="flex items-start gap-2 text-slate-700 dark:text-slate-300 font-semibold">
                  <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  <span>500 AI statement pages / month</span>
                </div>
                <div className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                  <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  <span>Custom bank schema & wealth statements</span>
                </div>
                <div className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                  <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  <span>Multi-account batch parsing</span>
                </div>
                <div className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                  <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  <span>Formal SARS / VAT compliant tax invoices</span>
                </div>
                <div className="flex items-start gap-2 text-slate-700 dark:text-slate-300">
                  <Check className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  <span>Dedicated priority support</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={loadingPlan === 'business'}
              onClick={() => handleSubscribe('business')}
              className="w-full py-2 px-3 rounded-md border border-slate-900 dark:border-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-900 dark:text-[#fafafa] text-xs font-bold transition-colors duration-100 flex items-center justify-center gap-1.5 active:translate-y-px"
            >
              {loadingPlan === 'business' ? (
                <span>Loading checkout...</span>
              ) : (
                <>
                  <span>Subscribe to Business</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Security & Guarantees Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0F19] flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              256-bit encrypted checkout
            </span>
            <span className="flex items-center gap-1">
              <Zap className="w-3.5 h-3.5 text-slate-400" />
              Instant license activation
            </span>
            <span>Cancel anytime</span>
            <button
              type="button"
              onClick={handleReconcile}
              className="inline-flex items-center gap-1 rounded border border-slate-300 dark:border-slate-700 px-2 py-0.5 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <CreditCard className="w-3 h-3" /> Refresh from PayPal
            </button>
          </div>
          <div className="font-mono text-[10px]">
            Inquiries: <a href="mailto:support@prismfilehero.com" className="underline hover:text-slate-900 dark:hover:text-white">support@prismfilehero.com</a>
          </div>
        </div>
      </div>
    </div>
  );
}
