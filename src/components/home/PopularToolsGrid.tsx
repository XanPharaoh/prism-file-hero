import React from 'react';
import {
  FileType2,
  Layers,
  Zap,
  ShieldCheck,
  Table,
  FileSpreadsheet,
  ChevronRight,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface PopularToolsGridProps {
  onSelectTool: (toolId: string) => void;
  onToggleAllTools: () => void;
  isAllToolsOpen: boolean;
}

const POPULAR_TOOLS = [
  {
    id: 'pdf-to-word',
    name: 'PDF to Word',
    desc: 'Convert PDFs to editable Word documents',
    badgeColor: 'bg-[#3D99F5]',
    icon: FileType2,
  },
  {
    id: 'merge',
    name: 'Merge PDF',
    desc: 'Combine multiple PDFs into one unified document',
    badgeColor: 'bg-[#7961F2]',
    icon: Layers,
  },
  {
    id: 'compress',
    name: 'Compress PDF',
    desc: 'Reduce file size without losing quality',
    badgeColor: 'bg-[#F23030]',
    icon: Zap,
  },
  {
    id: 'redact',
    name: 'Sign & Redact',
    desc: 'Fill forms, sign, and black out sensitive data',
    badgeColor: 'bg-[#E667E6]',
    icon: ShieldCheck,
  },
  {
    id: 'pdf-to-excel',
    name: 'PDF to Excel',
    desc: 'Extract document tables into clean spreadsheets',
    badgeColor: 'bg-[#10B981]',
    icon: Table,
  },
  {
    id: 'pdf-to-excel',
    name: 'Bank Statement to Excel',
    desc: 'Reconcile SA & global statements with clean math',
    badgeColor: 'bg-[#4F46E5]',
    icon: FileSpreadsheet,
    isPro: true,
  },
];

export default function PopularToolsGrid({
  onSelectTool,
  onToggleAllTools,
  isAllToolsOpen,
}: PopularToolsGridProps) {
  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-6 space-y-8">
      <div className="text-center max-w-xl mx-auto space-y-2">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-[#fafafa]">
          Most Popular Document Tools
        </h2>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-[#d4d4d8]">
          Fast, private tools to convert, compress, and edit PDFs. Try your first task free in seconds.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {POPULAR_TOOLS.map((tool, idx) => {
          const IconComp = tool.icon;
          return (
            <button
              key={tool.name + idx}
              type="button"
              onClick={() => onSelectTool(tool.id)}
              className="group relative bg-white/75 dark:bg-[#111622]/65 backdrop-blur-xl rounded-2xl p-5 border border-slate-200/60 dark:border-white/10 text-left hover:border-brand-400/80 dark:hover:border-brand-500/80 hover:shadow-xl hover:shadow-brand-500/10 transition-all flex flex-col justify-between min-h-[140px]"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className={`w-10 h-10 rounded-xl ${tool.badgeColor} text-white flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform`}>
                    <IconComp className="w-5 h-5" />
                  </div>
                  {tool.isPro ? (
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-brand-50/80 dark:bg-brand-950/80 backdrop-blur-sm text-brand-600 dark:text-brand-400 border border-brand-200/80 dark:border-brand-800/80 px-2 py-0.5 rounded-md">
                      Pro
                    </span>
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-brand-600 group-hover:translate-x-0.5 transition-all" />
                  )}
                </div>

                <h3 className="text-sm font-bold text-slate-900 dark:text-[#fafafa] group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                  {tool.name}
                </h3>
                <p className="text-xs text-slate-500 dark:text-[#d4d4d8] mt-1 leading-snug">
                  {tool.desc}
                </p>
              </div>

              <div className="mt-3 pt-2 border-t border-slate-100/80 dark:border-white/5 text-[11px] font-medium text-slate-400 flex items-center justify-between">
                <span>In-browser tool</span>
                <span className="text-brand-600 dark:text-brand-400 font-semibold group-hover:underline">Open →</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="text-center pt-2">
        <button
          type="button"
          onClick={onToggleAllTools}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl border border-slate-200/70 dark:border-white/10 bg-white/80 dark:bg-white/5 hover:bg-white dark:hover:bg-white/10 backdrop-blur-xl text-xs font-bold text-slate-800 dark:text-slate-200 shadow-xs transition-all hover:scale-[1.01]"
        >
          <span>{isAllToolsOpen ? 'Hide Full Directory' : 'See All 37 PDF Tools'}</span>
          {isAllToolsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>
    </section>
  );
}
