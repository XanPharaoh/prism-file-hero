import React from 'react';
import { Layers, FileSpreadsheet, ShieldCheck, ArrowRight, CheckCircle2 } from 'lucide-react';

export default function FeatureShowcase({ onSelectTool }: { onSelectTool: (id: string) => void }) {
  return (
    <div className="space-y-20 max-w-5xl mx-auto px-4 sm:px-6">
      {/* Row 1: Assemble and Organize */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
        <div className="space-y-4">
          <div className="w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-950/50 text-[#7961F2] flex items-center justify-center border border-brand-100 dark:border-brand-900/40">
            <Layers className="w-5 h-5" />
          </div>
          <h3 className="text-2xl font-bold tracking-tight text-slate-900 ">
            Assemble and organize in seconds
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
            Drag and drop pages to rearrange reports, delete unnecessary blank sheets, or merge multiple contracts into one clean submission package. No complicated menus or heavy desktop software.
          </p>
          <button
            type="button"
            onClick={() => onSelectTool('merge')}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-600 dark:text-brand-400 hover:underline pt-2"
          >
            <span>Merge a PDF now</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="bg-surface backdrop-blur-xl rounded-2xl p-6 border border-slate-200/60 dark:border-hairline shadow-sm space-y-3 font-mono text-xs">
          <div className="flex items-center justify-between text-slate-400 border-b border-slate-200/60 dark:border-hairline pb-2">
            <span>Document Assembly</span>
            <span className="text-emerald-600 font-semibold">100% Client-Side</span>
          </div>
          <div className="space-y-2 text-slate-700 dark:text-slate-300">
            <div className="flex items-center justify-between bg-surface dark:bg-surface backdrop-blur-md p-2.5 rounded-lg border border-slate-200/50 dark:border-hairline">
              <span>Section_1_Intro.pdf</span>
              <span className="text-slate-400 text-[11px]">Pages 1–4</span>
            </div>
            <div className="flex items-center justify-between bg-surface dark:bg-surface backdrop-blur-md p-2.5 rounded-lg border border-slate-200/50 dark:border-hairline">
              <span>Section_2_Financials.pdf</span>
              <span className="text-slate-400 text-[11px]">Pages 5–12</span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: The Sharp Blade - Bank Statements */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
        <div className="order-2 md:order-1 bg-surface backdrop-blur-xl rounded-2xl p-6 border border-slate-200/60 dark:border-hairline shadow-sm space-y-3 font-mono text-xs">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-hairline pb-2">
            <span className="font-bold text-slate-900 ">Reconciled Excel Export</span>
            <span className="bg-emerald-50/80 dark:bg-emerald-950/80 backdrop-blur-sm text-emerald-700 dark:text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded border border-emerald-200/50 dark:border-emerald-900/50">
              Math Verified ✓
            </span>
          </div>
          <div className="text-[11px] space-y-1.5 text-slate-600 dark:text-slate-300">
            <div className="flex justify-between py-1 border-b border-slate-50 dark:border-slate-800">
              <span>Standard Bank / Capitec / FNB</span>
              <span className="text-slate-400">Zero Shifted Rows</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-50 dark:border-slate-800">
              <span>Debits &amp; Credits</span>
              <span className="text-emerald-600 font-semibold">Separated cleanly</span>
            </div>
            <div className="flex justify-between py-1">
              <span>Closing Balance</span>
              <span className="font-bold text-slate-900 dark:text-white">Reconciled</span>
            </div>
          </div>
        </div>
        <div className="order-1 md:order-2 space-y-4">
          <div className="w-10 h-10 rounded-xl bg-brand-50 dark:bg-brand-950/50 text-[#4F46E5] flex items-center justify-center border border-brand-100 dark:border-brand-900/40">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <h3 className="text-2xl font-bold tracking-tight text-slate-900 ">
            Bank statements that actually balance
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
            Standard Bank, FNB, Capitec, ABSA, Nedbank, TymeBank, and international accounts. Extract transactions into Microsoft Excel (.xlsx) with clean columns and verified closing math—no hours wasted cleaning up exports.
          </p>
          <button
            type="button"
            onClick={() => onSelectTool('pdf-to-excel')}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-600 dark:text-brand-400 hover:underline pt-2"
          >
            <span>Try statement converter</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Row 3: Fast, Private, and In-Browser */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
        <div className="space-y-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 flex items-center justify-center border border-emerald-100 dark:border-emerald-900/40">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h3 className="text-2xl font-bold tracking-tight text-slate-900 ">
            Fast, private, and in-browser
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
            Your documents, your business. Everyday tools run directly inside your browser. When advanced tools require our servers, files are processed in memory and deleted the moment you’re done.
          </p>
          <div className="pt-2 flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400 font-medium">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>No files sold</span>
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>No software to install</span>
            </span>
          </div>
        </div>
        <div className="bg-surface backdrop-blur-xl rounded-2xl p-8 border border-slate-200/60 dark:border-hairline text-center space-y-3 shadow-sm">
          <div className="inline-flex p-3 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h4 className="text-sm font-bold text-slate-900 ">Zero Storage Retention</h4>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Sensitive tax records, medical files, and personal contracts remain strictly under your control.
          </p>
        </div>
      </div>
    </div>
  );
}
