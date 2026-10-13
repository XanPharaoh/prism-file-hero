import React from 'react';
import { Check, ArrowRight } from 'lucide-react';

interface PricingPreviewProps {
  onUpgrade: () => void;
  onSelectFree: () => void;
}

export default function PricingPreview({ onUpgrade, onSelectFree }: PricingPreviewProps) {
  return (
    <section id="pricing" className="max-w-4xl mx-auto px-4 sm:px-6 space-y-8 pt-6">
      <div className="text-center max-w-lg mx-auto space-y-2">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 ">
          Simple, Fair Pricing
        </h2>
        <p className="text-xs sm:text-sm text-slate-500 ">
          Free for daily tasks. Upgrade to Pro when your business needs unlimited statement conversions.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
        {/* Free Plan */}
        <div className="bg-surface backdrop-blur-2xl rounded-2xl p-6 border border-slate-200/70 dark:border-hairline flex flex-col justify-between shadow-xs">
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 ">Free Tier</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                For students, teachers, and casual office tasks.
              </p>
            </div>
            <div className="pt-1">
              <span className="text-3xl font-extrabold text-slate-900 dark:text-white">R 0</span>
              <span className="text-xs text-slate-400 ml-1.5">forever</span>
            </div>
            <ul className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300 pt-3 border-t border-slate-100/80 dark:border-hairline">
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600" /> 1 free task with zero sign-up</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600" /> 3 free tasks per day (signed in)</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600" /> All standard PDF tools included</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600" /> 100% in-browser processing</li>
            </ul>
          </div>
          <button
            type="button"
            onClick={onSelectFree}
            className="w-full mt-6 py-2.5 rounded-xl border border-slate-300/80 dark:border-slate-700/80 bg-surface dark:bg-surface backdrop-blur-md hover:bg-surface dark:hover:bg-surface text-xs font-bold text-slate-800 dark:text-slate-200 transition-colors"
          >
            Start Free
          </button>
        </div>

        {/* Pro Plan */}
        <div className="relative bg-surface backdrop-blur-2xl rounded-2xl p-6 border-2 border-brand-600/90 dark:border-brand-500/90 flex flex-col justify-between shadow-xl shadow-brand-600/15">
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-600 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-full">
            Most Popular
          </span>
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 ">Professional</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                For accountants, bookkeepers, and heavy document work.
              </p>
            </div>
            <div className="pt-1">
              <span className="text-3xl font-extrabold text-slate-900 dark:text-white">R 239</span>
              <span className="text-xs text-slate-400 ml-1.5">/ month</span>
            </div>
            <ul className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300 pt-3 border-t border-slate-100/80 dark:border-hairline">
              <li className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white"><Check className="w-4 h-4 text-brand-600" /> Unlimited bank statement conversions</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-600" /> Unlimited daily operations</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-600" /> Advanced OCR for scanned statements</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-brand-600" /> QuickBooks, Xero &amp; Sage exports</li>
            </ul>
          </div>
          <button
            type="button"
            onClick={onUpgrade}
            className="w-full mt-6 py-2.5 rounded-xl bg-brand-600/95 hover:bg-brand-600 text-white text-xs font-bold shadow-lg shadow-brand-600/25 border border-brand-400/30 backdrop-blur-md transition-colors flex items-center justify-center gap-2"
          >
            <span>Upgrade to Pro</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
