import React, { useState, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileSpreadsheet,
  FileText,
  FileType2,
  Layers,
  LayoutGrid,
  Lock,
  Scissors,
  Search,
  ShieldCheck,
  Table,
  Upload,
  Zap,
} from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { getToolsByCategory } from '../../registry/toolRegistry';
import { isAiTool, isProTool } from '../../../services/usageConfig';
import type { ToolHandler, ToolCategory, ToolID } from '../../types';
import PopularToolsGrid from '../home/PopularToolsGrid';
import PricingPreview from '../home/PricingPreview';
import { Icon } from '../ui/Icon';

interface ToolDashboardProps {
  onSelectTool: (toolId: string) => void;
  onSelectFilesAndTool?: (toolId: string, files: File[]) => Promise<void>;
}

const CATEGORIES: { id: ToolCategory; label: string; icon: LucideIcon }[] = [
  { id: 'All', label: 'All Tools', icon: LayoutGrid },
  { id: 'AI Labs', label: 'Financial & Extraction', icon: FileSpreadsheet },
  { id: 'Organize', label: 'Pages & Assembly', icon: Scissors },
  { id: 'Optimize', label: 'Compression & Repair', icon: Zap },
  { id: 'Convert', label: 'Format Conversion', icon: FileType2 },
  { id: 'Security', label: 'Security & Redaction', icon: ShieldCheck },
];

const CATEGORY_NAMES: Record<ToolCategory, string> = {
  'All': 'All Tools',
  'AI Labs': 'Financial Document Intelligence',
  'Organize': 'Page Organization and Assembly',
  'Optimize': 'Compression and Repair',
  'Convert': 'Format Conversion',
  'Security': 'Redaction and Security',
};

const SECURITY_PILLARS = [
  {
    title: '100% In-Browser Execution',
    desc: 'Your documents and financial statements are parsed locally with client-side WebAssembly. Sensitive records never leave your browser.',
    icon: Zap,
    color: 'text-amber-500 bg-amber-50 dark:bg-amber-950/60 border-amber-200/60 dark:border-amber-900/40',
  },
  {
    title: 'Zero Document Retention',
    desc: 'No cloud storage, no server databases, and zero tracking of account numbers or transaction narratives.',
    icon: Lock,
    color: 'text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-950/60 border-brand-200/60 dark:border-brand-900/40',
  },
  {
    title: 'POPIA & GDPR Aligned',
    desc: 'Engineered for strict compliance with the South African Protection of Personal Information Act and international privacy standards.',
    icon: ShieldCheck,
    color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200/60 dark:border-emerald-900/40',
  },
  {
    title: 'Complete 37-Tool Arsenal',
    desc: 'Beyond statements, get full client-side tools to merge, split, compress, redact PII, stamp, and protect files.',
    icon: Layers,
    color: 'text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-950/60 border-brand-200/60 dark:border-brand-900/40',
  },
];

const FAQS = [
  {
    q: 'How does in-browser PDF processing work?',
    a: 'Prism File Hero runs document operations directly inside your browser using client-side WebAssembly and modern web technologies. Your files never leave your computer, ensuring maximum speed and security.',
  },
  {
    q: 'How does Bank Statement to Excel conversion work?',
    a: 'Our engine parses table geometry to extract statement lines into clean Microsoft Excel (.xlsx) and CSV spreadsheets. Opening balances, credits, debits, and closing balances are reconciled automatically.',
  },
  {
    q: 'Is my data safe and private?',
    a: 'Yes. Core PDF operations (merge, split, compress, redact) and bank statement extractions execute 100% client-side. Your files never touch external storage or unauthorized third parties.',
  },
  {
    q: 'What are the limits on the free plan?',
    a: 'You can test any tool with 1 free task without signing up, and get 3 free tasks per day when signed in. All standard PDF tools are fully available.',
  },
  {
    q: 'Can I cancel or upgrade my subscription anytime?',
    a: 'Absolutely. Subscriptions are billed on a monthly or annual cadence with no lock-in. You can upgrade, downgrade, or cancel your plan at any time from your account panel.',
  },
];

export default function ToolDashboard({ onSelectTool, onSelectFilesAndTool }: ToolDashboardProps) {
  const s = useAppStore();
  const [activeTab, setActiveTab] = useState<'statement' | 'merge' | 'split' | 'edit'>('statement');
  const [isDragOver, setIsDragOver] = useState(false);
  const [isAllToolsOpen, setIsAllToolsOpen] = useState(false);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(
      (f) => f.type === 'application/pdf' || f.name.endsWith('.pdf')
    );
    if (!files.length) return;

    const toolMap: Record<string, ToolID> = {
      statement: 'pdf-to-excel',
      merge: 'merge',
      split: 'split',
      edit: 'metadata-edit',
    };
    const targetTool = toolMap[activeTab] || 'pdf-to-excel';

    if (onSelectFilesAndTool) {
      await onSelectFilesAndTool(targetTool, files);
    } else {
      onSelectTool(targetTool);
    }
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(
      (f) => f.type === 'application/pdf' || f.name.endsWith('.pdf')
    );
    // Allow the same file to be chosen again after the queue is cleared: without this, re-picking an
    // identical path fires no change event and the uploader silently does nothing a second time.
    e.target.value = '';
    if (!files.length) return;

    const toolMap: Record<string, ToolID> = {
      statement: 'pdf-to-excel',
      merge: 'merge',
      split: 'split',
      edit: 'metadata-edit',
    };
    const targetTool = toolMap[activeTab] || 'pdf-to-excel';

    if (onSelectFilesAndTool) {
      await onSelectFilesAndTool(targetTool, files);
    } else {
      onSelectTool(targetTool);
    }
  };

  const handleSampleClick = async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sample-bank-statement.pdf`);
      if (!res.ok) throw new Error('Sample unavailable');
      const blob = await res.blob();
      const file = new File([blob], 'SBSA_Sample_Statement.pdf', { type: 'application/pdf' });
      if (onSelectFilesAndTool) {
        await onSelectFilesAndTool('pdf-to-excel', [file]);
      } else {
        onSelectTool('pdf-to-excel');
      }
    } catch {
      onSelectTool('pdf-to-excel');
    }
  };

  const scrollToWorkbench = () => {
    const el = document.getElementById('workbench');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    fileInputRef.current?.click();
  };

  const handleExploreTools = () => {
    setIsAllToolsOpen(true);
    setTimeout(() => {
      document.getElementById('pdf-tools')?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  };

  const filterTools = (toolsList: ToolHandler[]) => {
    if (!s.searchQuery.trim()) return toolsList;
    const q = s.searchQuery.toLowerCase();
    const bankingAliases = [
      'fnb', 'capitec', 'absa', 'nedbank', 'standard bank', 'sbsa', 'tyme', 'tymebank',
      'investec', 'sanlam', 'sars', 'statement', 'bank', 'excel', 'reconciliation', 'tax',
    ];
    const isBankingSearch = bankingAliases.some((alias) => q.includes(alias));

    return toolsList.filter(
      (tool) =>
        tool.name.toLowerCase().includes(q) ||
        tool.description.toLowerCase().includes(q) ||
        tool.category.toLowerCase().includes(q) ||
        (isBankingSearch && (tool.id === 'pdf-to-excel' || tool.id === 'ocr' || tool.id === 'pdf-summary'))
    );
  };

  const activeCategoriesToRender: ToolCategory[] =
    s.activeCategory === 'All'
      ? ['AI Labs', 'Organize', 'Optimize', 'Convert', 'Security']
      : [s.activeCategory];

  return (
    <div className="w-full space-y-16 pb-20">
      {/* ── HERO: the live home page is flat white with one oversized Geist headline ── */}
      <section className="relative w-full pt-10 pb-6">
        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 flex flex-col items-center text-center">
          <h1 className="font-display text-4xl sm:text-6xl lg:text-[4.6rem] font-bold tracking-tight text-ink max-w-4xl leading-[1.02]">
            We make document work simple.
          </h1>

          <p className="text-base sm:text-lg text-muted mt-6 max-w-2xl leading-relaxed">
            All the tools you need to convert, compress, merge, and sign PDFs right in your browser.
          </p>

          {/* Hero CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-3 mt-9">
            <button type="button" onClick={scrollToWorkbench} className="btn-run">
              <span>Try it Free</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button type="button" onClick={handleExploreTools} className="btn-quiet">
              Explore All 37 Tools
            </button>
          </div>

          {/* ── Workbench: the live site's hairline "demo window" with a mono title bar ── */}
          <div
            id="workbench"
            className="demo-window w-full max-w-5xl mt-12 overflow-hidden text-left transition-all scroll-mt-24"
          >
            <div className="demo-bar">
              <span className="traffic" aria-hidden="true">
                <i style={{ background: '#ff5f57' }} />
                <i style={{ background: '#febc2e' }} />
                <i style={{ background: '#28c840' }} />
              </span>
              <span>prism · in your browser</span>
              <span className="ml-auto">{s.batch.length} file{s.batch.length === 1 ? '' : 's'}</span>
            </div>
            {/* Top Switcher Tabs */}
            <div className="bg-surface p-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar border-b border-hairline">
              <button
                type="button"
                onClick={() => setActiveTab('statement')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all duration-150 ${
                  activeTab === 'statement'
                    ? 'bg-surface text-accent border border-hairline'
                    : 'text-muted hover:text-ink hover:bg-surface/70'
                }`}
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Bank Statement to Excel</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('merge')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all duration-150 ${
                  activeTab === 'merge'
                    ? 'bg-surface text-accent shadow-sm border border-hairline'
                    : 'text-muted hover:text-ink hover:bg-surface/70'
                }`}
              >
                <Layers className="w-4 h-4" />
                <span>Merge PDF</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('split')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all duration-150 ${
                  activeTab === 'split'
                    ? 'bg-surface text-accent shadow-sm border border-hairline'
                    : 'text-muted hover:text-ink hover:bg-surface/70'
                }`}
              >
                <Scissors className="w-4 h-4" />
                <span>Split PDF</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('edit')}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition-all duration-150 ${
                  activeTab === 'edit'
                    ? 'bg-surface text-accent shadow-sm border border-hairline'
                    : 'text-muted hover:text-ink hover:bg-surface/70'
                }`}
              >
                <FileText className="w-4 h-4" />
                <span>Edit PDF</span>
              </button>
            </div>

            {/* Dropzone Body */}
            <div className="p-6 sm:p-8 flex flex-col space-y-5">
              <div
                role="button"
                tabIndex={0}
                aria-label="Upload PDF document"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                data-dragging={isDragOver ? 'true' : 'false'}
                className="dropzone-dashed relative group rounded-2xl p-8 sm:p-12 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  multiple
                  onChange={handleFileInput}
                  className="hidden"
                />

                <div className="relative w-12 h-12 rounded-xl bg-sunken border border-hairline flex items-center justify-center mb-4 text-muted group-hover:text-accent group-hover:scale-105 transition-all">
                  <Upload className="w-7 h-7" aria-hidden="true" />
                </div>

                <h3 className="font-display text-base sm:text-lg font-semibold text-ink">
                  {activeTab === 'statement'
                    ? 'Drag and drop your PDF here'
                    : `Drag and drop PDF to ${activeTab}`}
                </h3>

                <p className="font-body text-xs sm:text-sm text-muted mt-1.5">
                  or <span className="text-accent font-semibold underline underline-offset-2">choose a file</span> from your computer
                </p>

                <div className="mt-4 inline-flex items-center gap-2 bg-surface dark:bg-surface backdrop-blur-md px-3.5 py-1 rounded-full border border-hairline dark:border-hairline text-[11px] text-slate-500 dark:text-slate-400 font-mono shadow-2xs">
                  <FileText className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                  <span>PDF documents • Up to 50&nbsp;MB • 100% In-Browser</span>
                </div>

                <p className="text-xs text-slate-400 dark:text-slate-500 mt-4 flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <span>Fast, private processing right in your browser.</span>
                </p>
              </div>

              {/* Sample Statement and Format Helpers */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs">
                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                  <span className="font-medium">Format:</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-800 dark:text-slate-200 bg-surface dark:bg-surface backdrop-blur-md border border-slate-200/60 dark:border-hairline px-2.5 py-1 rounded-md shadow-2xs">
                    <Table className="w-3 h-3 text-emerald-600" />
                    Excel (.xlsx) / CSV / PDF
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleSampleClick}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Try with Standard Bank Sample</span>
                </button>
              </div>
            </div>
          </div>

          {/* Trust Indicators Row below Workbench */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 sm:gap-10 text-xs text-slate-600 dark:text-slate-400 font-medium">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-brand-600 dark:text-brand-400" />
              <span>Client-side WebAssembly &amp; AES-256</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              <span>Zero cloud storage • 100% in-browser</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Deterministic balance reconciliation</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2. POPULAR TOOLS GRID (SMALLPDF ADAPTATION) ── */}
      <PopularToolsGrid
        onSelectTool={onSelectTool}
        onToggleAllTools={() => setIsAllToolsOpen((prev) => !prev)}
        isAllToolsOpen={isAllToolsOpen}
      />

      {/* ── 3. COLLAPSIBLE 37-TOOL DIRECTORY (ACCORDION DRAWER) ── */}
      {isAllToolsOpen && (
        <section id="pdf-tools" className="max-w-5xl mx-auto px-4 sm:px-6 space-y-8 scroll-mt-20">
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
                  All 37 Document Tools
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  Full browser-based suite for organizing, converting, compressing, and protecting PDFs.
                </p>
              </div>

              {/* Category Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                {CATEGORIES.map((category) => {
                  const isActive = s.activeCategory === category.id;
                  const count = category.id === 'All' ? 37 : getToolsByCategory(category.id).length;

                  return (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => s.setActiveCategory(category.id)}
                      className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        isActive
                          ? 'bg-slate-900 text-white dark:bg-surface dark:text-slate-950'
                          : 'bg-slate-100 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      <category.icon className="w-3.5 h-3.5 shrink-0" />
                      <span>{category.label}</span>
                      <span className="text-[10px] opacity-75">({count})</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Search bar inside tools section */}
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                name="toolSearch"
                autoComplete="off"
                spellCheck={false}
                aria-label="Search tools"
                placeholder="Search tools (e.g. merge, compress, excel, redact, ocr, split)…"
                value={s.searchQuery}
                onChange={(e) => s.setSearchQuery(e.target.value)}
                className="w-full bg-surface border border-slate-200 dark:border-slate-800 rounded-xl py-2.5 pl-10 pr-4 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500/20 transition-colors shadow-xs"
              />
            </div>
          </div>

          {/* Categorized Tools Grid */}
          <div className="space-y-8">
            {activeCategoriesToRender.map((categoryKey) => {
              const categoryName = CATEGORY_NAMES[categoryKey];
              const rawTools = getToolsByCategory(categoryKey);
              const categoryTools = filterTools(rawTools);

              if (categoryTools.length === 0) return null;

              return (
                <div key={categoryKey} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {categoryName}
                    </h3>
                    <span className="text-[10px] font-mono text-slate-400">({categoryTools.length})</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {categoryTools.map((tool: ToolHandler) => {
                      const isAi = isAiTool(tool.id);
                      const isPro = isProTool(tool.id);

                      return (
                        <button
                          key={tool.id}
                          type="button"
                          onClick={() => onSelectTool(tool.id)}
                          className="group flex flex-col justify-between rounded-xl border border-slate-200/80 dark:border-slate-800 bg-surface p-4 text-left hover:border-brand-400 dark:hover:border-brand-500 hover:shadow-sm transition-all min-h-[125px]"
                        >
                          <div>
                            <div className="mb-2.5 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-white shrink-0 shadow-2xs group-hover:scale-105 transition-transform ${tool.color || 'bg-brand-600'}`}>
                                  <Icon name={tool.icon} size={14} className="text-white" />
                                </div>
                                <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                                  {tool.category}
                                </span>
                              </div>
                              {isPro ? (
                                <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400 border border-brand-200/80 dark:border-brand-900">
                                  {isAi ? 'Pro • AI' : 'Pro'}
                                </span>
                              ) : isAi ? (
                                <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase rounded bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400 border border-brand-200/60 dark:border-brand-900">
                                  AI Assisted
                                </span>
                              ) : null}
                            </div>

                            <span className="block text-xs font-bold text-slate-900 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                              {tool.name}
                            </span>
                            <span className="block mt-1 text-[11px] text-slate-500 leading-snug line-clamp-2">
                              {tool.description}
                            </span>
                          </div>

                          <div className="mt-3 flex items-center justify-between border-t border-slate-100 dark:border-slate-800/80 pt-2 text-[10px] text-slate-400">
                            {isPro ? (
                              <span className="font-mono text-brand-600 dark:text-brand-400 font-semibold">Pro Feature</span>
                            ) : (
                              <span className="font-mono">Client-side</span>
                            )}
                            <span className="font-semibold text-brand-600 dark:text-brand-400 flex items-center gap-0.5">
                              <span>Open</span>
                              <ArrowUpRight className="w-3 h-3" />
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── 4. MODULAR PRICING PREVIEW (CLEAN 2-CARD MATRIX) ── */}
      <PricingPreview
        onUpgrade={() => s.setShowUpgradeCTA(true)}
        onSelectFree={scrollToWorkbench}
      />

      {/* ── 5. 4-PILLAR TRUST & COMPLIANCE GRID ── */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 space-y-8 pt-4">
        <div className="bg-slate-50/70 rounded-2xl p-8 border border-slate-200/80 dark:border-slate-800 space-y-6">
          <div className="text-center max-w-xl mx-auto space-y-2">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 ">
              Bank-Grade Privacy &amp; POPIA Compliance
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 ">
              Your financial and business documents contain sensitive records. Our software is architected so we never see them.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {SECURITY_PILLARS.map((p, idx) => {
              const PillarIcon = p.icon;
              return (
                <div
                  key={idx}
                  className="bg-surface backdrop-blur-xl rounded-xl p-4 border border-slate-200/60 dark:border-hairline shadow-xs hover:shadow-md hover:border-brand-400/50 dark:hover:border-brand-500/40 transition-all space-y-2"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${p.color}`}>
                    <PillarIcon className="w-4 h-4" />
                  </div>
                  <h3 className="text-xs font-bold text-slate-900 ">{p.title}</h3>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    {p.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── 6. FREQUENTLY ASKED QUESTIONS (FAQ) SECTION ── */}
      <section id="faq" className="max-w-3xl mx-auto px-4 sm:px-6 space-y-6 pt-4 scroll-mt-20">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-slate-900 text-balance">
            Frequently Asked Questions
          </h2>
        </div>

        <div className="space-y-3">
          {FAQS.map((faq, idx) => {
            const isOpen = expandedFaq === idx;
            return (
              <div
                key={idx}
                className="rounded-xl border border-slate-200/70 dark:border-hairline bg-surface backdrop-blur-xl overflow-hidden shadow-2xs transition-all"
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`faq-answer-${idx}`}
                  onClick={() => setExpandedFaq(isOpen ? null : idx)}
                  className="w-full px-5 py-4 flex items-center justify-between text-left text-xs sm:text-sm font-bold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <span>{faq.q}</span>
                  {isOpen ? (
                    <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                  )}
                </button>
                {isOpen && (
                  <div
                    id={`faq-answer-${idx}`}
                    className="px-5 pb-4 text-xs text-slate-600 leading-relaxed border-t border-slate-100 dark:border-hairline pt-3"
                  >
                    {faq.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 7. HIGH-CONVERSION FINAL CALL TO ACTION ── */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="bg-slate-900 rounded-3xl p-8 sm:p-12 text-center text-white space-y-6 border border-slate-800 shadow-xl">
          <div className="max-w-2xl mx-auto space-y-3">
            <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-white">
              Ready to simplify your document workflow?
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed max-w-lg mx-auto">
              Join thousands of users converting, merging, and securing PDFs with 100% in-browser privacy.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={scrollToWorkbench}
              className="px-6 py-3 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-2"
            >
              <span>Get Started Free</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleSampleClick}
              className="px-5 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition-colors flex items-center gap-2"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              <span>Test with Standard Bank Sample</span>
            </button>
          </div>

          <p className="text-[11px] text-slate-500 font-mono pt-2">
            No credit card required • 100% local client-side processing • POPIA aligned
          </p>
        </div>
      </section>

      {/* ── 8. FOOTER ── */}
      <footer className="w-full bg-surface border-t border-slate-200/80 dark:border-slate-800 pt-10 pb-12 mt-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 space-y-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-5 pb-6 border-b border-slate-100 dark:border-slate-800">
            {/* Privacy note pill */}
            <div className="flex items-center gap-2 bg-slate-50 px-4 py-2 rounded-full border border-slate-200/60 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
              <Lock className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400 shrink-0" />
              <span>Your privacy is our priority. Files are processed locally with bank-level encryption.</span>
            </div>

            {/* Links */}
            <div className="flex items-center gap-6 text-xs text-slate-500 dark:text-slate-400 font-medium">
              <a href="#pricing" className="hover:text-slate-900 dark:hover:text-white transition-colors">Pricing</a>
              <button
                type="button"
                onClick={handleExploreTools}
                className="hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                PDF Tools
              </button>
              <a href="#faq" className="hover:text-slate-900 dark:hover:text-white transition-colors">FAQ</a>
              <a href="mailto:support@prismfilehero.com" className="hover:text-slate-900 dark:hover:text-white transition-colors">Support</a>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400 dark:text-slate-500 font-mono text-center sm:text-left">
            <p>© 2026 Prism File Hero (prismfilehero.com). All rights reserved.</p>
            <p>Designed for seamless financial &amp; PDF document workflows.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
