import React, { useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Upload,
  CheckCircle2,
  FileText,
  Layers,
  ShieldCheck,
  ArrowRight,
  Table,
  Zap,
  FileType2,
  Scissors,
  FileSpreadsheet,
  Lock,
  ChevronDown,
  HelpCircle,
  Check,
} from 'lucide-react';
import { getToolById } from '../../registry/toolRegistry';
import { intakeFiles } from '../../../services/fileIntake';
import type { ToolID } from '../../types';
import { SEOHelmet } from '../seo/SEOHelmet';
import { useAppStore } from '../../store/appStore';
import { BrandHeader } from '../ui/Brand';
import { Icon } from '../ui/Icon';

export interface ToolLandingViewProps {
  defaultTool?: ToolID | string;
  isBankStatement?: boolean;
}

interface SlugInfo {
  toolId: ToolID;
  isBankStatement?: boolean;
}

const SLUG_TO_TOOL_MAP: Record<string, SlugInfo> = {
  'merge-pdf': { toolId: 'merge' },
  'split-pdf': { toolId: 'split' },
  'compress-pdf': { toolId: 'compress' },
  'pdf-to-word': { toolId: 'pdf-to-word' },
  'pdf-to-excel': { toolId: 'pdf-to-excel' },
  'bank-statement-to-excel': { toolId: 'pdf-to-excel', isBankStatement: true },
  'jpg-to-pdf': { toolId: 'jpg-to-pdf' },
  'pdf-to-jpg': { toolId: 'pdf-to-jpg' },
  'redact-pdf': { toolId: 'redact' },
  'ocr-pdf': { toolId: 'ocr' },
};

interface RelatedToolItem {
  slug: string;
  id: ToolID;
  name: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  isPro?: boolean;
}

const ALL_TOP_TOOLS: RelatedToolItem[] = [
  { slug: 'bank-statement-to-excel', id: 'pdf-to-excel', name: 'Bank Statement to Excel', desc: 'Reconciled SA & global statements', icon: FileSpreadsheet, isPro: true },
  { slug: 'merge-pdf', id: 'merge', name: 'Merge PDF', desc: 'Combine multiple PDFs into one unified file', icon: Layers },
  { slug: 'split-pdf', id: 'split', name: 'Split PDF', desc: 'Separate or extract PDF pages cleanly', icon: Scissors },
  { slug: 'compress-pdf', id: 'compress', name: 'Compress PDF', desc: 'Reduce file size without quality loss', icon: Zap },
  { slug: 'pdf-to-word', id: 'pdf-to-word', name: 'PDF to Word', desc: 'Convert PDFs to editable documents', icon: FileType2 },
  { slug: 'pdf-to-excel', id: 'pdf-to-excel', name: 'PDF to Excel', desc: 'Extract data tables into spreadsheets', icon: Table },
  { slug: 'jpg-to-pdf', id: 'jpg-to-pdf', name: 'JPG to PDF', desc: 'Convert image files to PDF', icon: FileType2 },
  { slug: 'pdf-to-jpg', id: 'pdf-to-jpg', name: 'PDF to JPG', desc: 'Extract PDF pages as high-res images', icon: FileType2 },
  { slug: 'redact-pdf', id: 'redact', name: 'Redact PDF', desc: 'Permanently remove sensitive confidential data', icon: ShieldCheck, isPro: true },
  { slug: 'ocr-pdf', id: 'ocr', name: 'OCR PDF', desc: 'Make scanned documents selectable and searchable', icon: FileText, isPro: true },
];

export const ToolLandingView: React.FC<ToolLandingViewProps> = (props) => {
  const params = useParams<{ toolId?: string; toolSlug?: string }>();
  const navigate = useNavigate();
  const setSelectedTool = useAppStore((s) => s.setSelectedTool);
  const addFiles = useAppStore((s) => s.addFiles);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  const rawSlug = (params.toolSlug || params.toolId || '').toLowerCase().trim();

  let resolvedToolId: ToolID | undefined = (props.defaultTool as ToolID) || undefined;
  let isBankStatement = Boolean(props.isBankStatement);

  if (!resolvedToolId && rawSlug) {
    if (SLUG_TO_TOOL_MAP[rawSlug]) {
      resolvedToolId = SLUG_TO_TOOL_MAP[rawSlug].toolId;
      if (SLUG_TO_TOOL_MAP[rawSlug].isBankStatement) {
        isBankStatement = true;
      }
    } else {
      const candidateTool = getToolById(rawSlug as ToolID);
      if (candidateTool) {
        resolvedToolId = candidateTool.id;
      }
    }
  }

  if (rawSlug === 'bank-statement-to-excel') {
    isBankStatement = true;
  }

  const tool = resolvedToolId ? getToolById(resolvedToolId) : undefined;

  if (!tool) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 ">
        <div className="text-center p-8 bg-surface rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm max-w-md mx-auto">
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white mb-3">Tool Not Found</h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm mb-6">
            The requested document tool could not be found or has moved.
          </p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const top10Slug = isBankStatement
    ? 'bank-statement-to-excel'
    : Object.keys(SLUG_TO_TOOL_MAP).find((s) => SLUG_TO_TOOL_MAP[s].toolId === tool.id && !SLUG_TO_TOOL_MAP[s].isBankStatement);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://prismfilehero.com';
  const canonicalUrl = top10Slug
    ? `${origin}/${top10Slug}`
    : `${origin}/tools/${params.toolId || tool.id}`;

  const toolDisplayName = tool.id === 'pdf-to-word' ? 'PDF to Word' : tool.name;

  const displayTitle = isBankStatement
    ? 'Bank Statement to Excel Converter'
    : `Free Online ${toolDisplayName} Tool`;

  const displayH1 = isBankStatement
    ? 'Bank Statement to Excel Converter'
    : `Free Online ${toolDisplayName}`;

  const displayDesc = isBankStatement
    ? 'Convert PDF bank statements to reconciled Excel (.xlsx) and CSV spreadsheets. 100% private in-browser math verification with zero file retention.'
    : tool.id === 'pdf-to-word'
    ? 'Convert PDF documents to editable Microsoft Word and Markdown formats with layout preserved. Fast, secure, and 100% free right in your browser.'
    : `${tool.description} Fast, secure, and 100% free right in your browser.`;

  const handleFiles = async (files: File[]) => {
    if (!files.length) return;
    setSelectedTool(tool.id);
    // The workspace bills AI work against totalSelectedPages, so an upload that enters from
    // this page has to run the same intake as the workspace dropzone: a raw addFiles() left
    // the batch showing 0 pages and under-reported the usage the server charges for.
    // Intake now reports an unreadable or password-locked document instead of counting it as 0 pages.
    // This entry point chooses to surface that as an error toast and stop, rather than pretending the
    // file entered the batch.
    let intake: Awaited<ReturnType<typeof intakeFiles>>;
    try {
      intake = await intakeFiles(tool, files, useAppStore.getState().batch.length);
    } catch (error) {
      useAppStore.getState().addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'That file could not be read.',
      });
      return;
    }
    const state = useAppStore.getState();
    intake.warnings.forEach((message) => state.addToast({ type: 'warning', message }));
    if (!intake.accepted.length) return;
    state.setTotalSelectedPages(state.totalSelectedPages + intake.pages);
    addFiles(intake.accepted);
    navigate('/');
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = Array.from(e.dataTransfer.files || []);
    void handleFiles(dropped);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    void handleFiles(selected);
  };

  const relatedTools = ALL_TOP_TOOLS.filter((t) => {
    if (isBankStatement) return t.slug !== 'bank-statement-to-excel';
    return t.id !== tool.id;
  }).slice(0, 3);

  const getFaqs = () => {
    if (isBankStatement) {
      return [
        {
          q: 'How does Bank Statement to Excel reconciliation work?',
          a: 'Our engine parses spatial table layouts directly from PDF statements to separate transaction dates, descriptions, credits, and debits without row shifts. It reconciles that Opening Balance + Total Credits - Total Debits exactly matches Closing Balance.',
        },
        {
          q: 'Which banks are supported?',
          a: 'Standard Bank, FNB, Capitec, ABSA, Nedbank, Investec, TymeBank, and global bank formats. Both native digital PDFs and scanned statements are supported.',
        },
        {
          q: 'Are my financial statements secure and private?',
          a: 'Yes. Processing runs with client-side WebAssembly in your browser. We never store, retain, or read your private financial data.',
        },
        {
          q: 'Can I test this without signing up?',
          a: 'Yes! You can convert your first test statement completely free with zero sign-up required.',
        },
      ];
    }

    return [
      {
        q: `How does the ${tool.name} tool work?`,
        a: `Prism File Hero runs ${tool.name.toLowerCase()} operations locally inside your web browser using modern client-side WebAssembly. Your files are processed in real-time with maximum speed and privacy.`,
      },
      {
        q: 'Will my original document quality be preserved?',
        a: 'Yes. Our high-fidelity document engine preserves vector text, font formatting, images, and layout geometries without degradation.',
      },
      {
        q: 'Is my data stored or shared?',
        a: 'Never. Standard PDF operations execute entirely in memory inside your browser. No files are saved to external server databases.',
      },
      {
        q: 'Is this tool free to use?',
        a: 'Yes. Every user gets 1 free guest task with zero sign-up, and 3 free tasks per day when signed in.',
      },
    ];
  };

  const faqs = getFaqs();

  const fileTypeLabel = isBankStatement
    ? 'Bank Statement PDF'
    : tool.id === 'jpg-to-pdf'
    ? 'Images (JPG, PNG)'
    : 'PDF document';

  return (
    <>
      <SEOHelmet
        title={`${displayTitle} | Prism File Hero`}
        description={displayDesc}
        canonicalUrl={canonicalUrl}
        structuredData={{
          '@type': 'HowTo',
          name: `How to use ${displayTitle}`,
          description: displayDesc,
          step: [
            {
              '@type': 'HowToStep',
              name: 'Upload your document',
              text: `Select or drag and drop your ${fileTypeLabel} into the working area at the top of the page.`,
            },
            {
              '@type': 'HowToStep',
              name: 'Configure & process',
              text: 'The in-browser engine prepares your document instantly with zero file retention.',
            },
            {
              '@type': 'HowToStep',
              name: 'Download result',
              text: 'Download your processed file immediately to your computer or device.',
            },
          ],
        }}
      />

      <div className="min-h-screen bg-ground text-ink flex flex-col">
        {/* Top Minimal Navigation Bar */}
        <header className="sticky top-0 z-40 w-full px-4 pt-4">
          <div className="nav-pill">
            <Link to="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity">
              <BrandHeader />
            </Link>
            <div className="flex items-center gap-3 text-xs font-semibold">
              <Link
                to="/"
                className="nav-link py-1 px-2.5 transition-colors"
              >
                All Tools
              </Link>
              <button
                type="button"
                onClick={() => navigate('/')}
                className="px-4 py-1.5 rounded-full bg-accent text-white text-xs font-semibold transition-[filter,transform] duration-200 hover:brightness-110"
              >
                Open Dashboard
              </button>
            </div>
          </div>
        </header>

        {/* ── LIVE WORKING TOOL RUNNER AT TOP OF VIEWPORT ── */}
        <section className="relative w-full bg-surface border-b border-hairline pt-14 sm:pt-20 pb-14">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 space-y-5">
            <p className="eyebrow">
              {tool.category} · runs entirely in this tab
            </p>

            <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-ink leading-[1.04] max-w-3xl">
              {displayH1}
            </h1>

            <p className="text-base sm:text-lg text-muted max-w-2xl leading-relaxed">
              {displayDesc}
            </p>

            {/* ── Active Dropzone Box ── */}
            <div className="pt-6 max-w-2xl">
              <div
                role="button"
                tabIndex={0}
                aria-label={`Upload files for ${displayTitle}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                data-dragging={isDragOver ? 'true' : 'false'}
                className="dropzone-dashed group rounded-2xl p-8 sm:p-10 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={tool.allowedFileTypes.join(',')}
                  multiple={tool.maxFiles !== 1}
                  onChange={handleFileInput}
                  className="hidden"
                />

                <div className="relative w-12 h-12 rounded-xl bg-sunken border border-hairline flex items-center justify-center mb-4 text-muted group-hover:text-accent group-hover:scale-105 transition-all">
                  <Icon name={tool.icon} size={22} />
                </div>

                <h3 className="font-display text-base sm:text-lg font-semibold text-ink">
                  Drop files here
                </h3>

                <p className="text-xs sm:text-sm text-muted mt-1.5">
                  or <span className="text-accent font-semibold underline underline-offset-2">click to choose</span> · {fileTypeLabel}
                </p>

                <p className="mt-4 font-mono text-[11px] tracking-wide text-muted">
                  up to 50 MB · client-side · nothing uploaded
                </p>

                {isBankStatement && (
                  <p className="text-xs text-accent font-semibold mt-3">
                    Automatically reconciled debits, credits, and closing balance math
                  </p>
                )}
              </div>

              <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-run-block mt-5">
                Run {displayH1.replace(/^Free Online /, '').toLowerCase()}
              </button>
            </div>
          </div>
        </section>

        {/* ── HIGH-INTENT SEO CONTENT BENEATH ACTIVE TOOL ── */}
        <div className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 py-16 space-y-16">
          {/* 1. Step-by-Step Guide */}
          <section className="space-y-6 text-center sm:text-left">
            <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                How to Use the {displayH1} Tool
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                Follow these simple steps to process your document in seconds with zero software installation.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
              <div className="bg-surface rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
                <div className="w-8 h-8 rounded-lg bg-brand-50 dark:bg-brand-950/80 text-brand-600 dark:text-brand-400 font-extrabold flex items-center justify-center text-xs">
                  1
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Step 1: Upload Your File</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Place your file into the runner box above, or click to choose from your desktop or phone storage.
                </p>
              </div>

              <div className="bg-surface rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
                <div className="w-8 h-8 rounded-lg bg-brand-50 dark:bg-brand-950/80 text-brand-600 dark:text-brand-400 font-extrabold flex items-center justify-center text-xs">
                  2
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Step 2: Configure &amp; Preview</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Customize pages, check options, or preview table extraction with deterministic precision.
                </p>
              </div>

              <div className="bg-surface rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-3">
                <div className="w-8 h-8 rounded-lg bg-brand-50 dark:bg-brand-950/80 text-brand-600 dark:text-brand-400 font-extrabold flex items-center justify-center text-xs">
                  3
                </div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Step 3: Process &amp; Save</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Execute processing in browser memory and save the output document directly to your device.
                </p>
              </div>
            </div>
          </section>

          {/* 2. Technical Advantages & Trust Matrix */}
          <section className="bg-surface rounded-2xl p-8 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-6">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Why Choose Prism File Hero for {tool.name}?
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-xs text-slate-600 dark:text-slate-300">
              <div className="space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white text-sm">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>100% In-Browser Privacy</span>
                </div>
                <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                  Your files are not sent to any remote server or third-party cloud. Processing executes in local device memory using WebAssembly.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white text-sm">
                  <Zap className="w-4 h-4 text-amber-500" />
                  <span>Instant Performance</span>
                </div>
                <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                  No queue delays or waiting for massive upload transfers. Files are processed immediately at native hardware speed.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white text-sm">
                  <Lock className="w-4 h-4 text-brand-600" />
                  <span>Zero Data Retention</span>
                </div>
                <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                  Sensitive financial data, invoices, and private identity files are immediately cleared when you close the tab.
                </p>
              </div>
            </div>
          </section>

          {/* 3. Related Tools Grid */}
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                Related Tools
              </h2>
              <Link
                to="/"
                className="text-xs font-semibold text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1"
              >
                <span>View all 37 tools</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {relatedTools.map((rel) => {
                const IconComp = rel.icon;
                return (
                  <Link
                    key={rel.slug}
                    to={`/${rel.slug}`}
                    className="group bg-surface rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 hover:border-brand-400 dark:hover:border-brand-500 hover:shadow-xs transition-all flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <div className="w-9 h-9 rounded-xl bg-sunken border border-hairline text-accent flex items-center justify-center group-hover:scale-105 transition-transform">
                          <IconComp className="w-4 h-4" />
                        </div>
                        {rel.isPro && (
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-brand-50 dark:bg-brand-950 text-brand-600 dark:text-brand-400 border border-brand-200 dark:border-brand-900 px-2 py-0.5 rounded-md">
                            Pro
                          </span>
                        )}
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                        {rel.name}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                        {rel.desc}
                      </p>
                    </div>

                    <div className="mt-4 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[11px] font-medium text-brand-600 dark:text-brand-400 flex items-center justify-between">
                      <span>Open tool</span>
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* 4. Frequently Asked Questions */}
          <section className="space-y-6">
            <div className="border-b border-slate-200 dark:border-slate-800 pb-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                Frequently Asked Questions
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                Everything you need to know about using {displayTitle}.
              </p>
            </div>

            <div className="space-y-3">
              {faqs.map((faq, idx) => {
                const isOpen = openFaqIndex === idx;
                return (
                  <div
                    key={faq.q}
                    className="bg-surface rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                      className="w-full text-left p-5 flex items-center justify-between gap-4 font-semibold text-xs sm:text-sm text-slate-900 dark:text-white hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                    >
                      <span>{faq.q}</span>
                      <ChevronDown
                        className={`w-4 h-4 text-slate-400 transition-transform duration-200 flex-shrink-0 ${
                          isOpen ? 'rotate-180 text-brand-600' : ''
                        }`}
                      />
                    </button>
                    {isOpen && (
                      <div className="px-5 pb-5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed border-t border-slate-100 dark:border-slate-800/80 pt-3">
                        {faq.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* 5. Bottom Call to Action */}
          <section className="rounded-3xl bg-brand-600 p-8 sm:p-12 text-center text-white space-y-4 shadow-lg shadow-brand-600/10">
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Ready to process your document?
            </h2>
            <p className="text-xs sm:text-sm text-brand-100 max-w-xl mx-auto leading-relaxed">
              Drop your file above to get started immediately, or jump straight into the full workbench dashboard.
            </p>
            <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-6 py-2.5 rounded-xl bg-surface text-brand-600 font-bold text-xs hover:bg-brand-50 shadow-xs transition-colors"
              >
                Choose File
              </button>
              <button
                type="button"
                onClick={() => navigate('/')}
                className="px-6 py-2.5 rounded-xl border border-brand-400 hover:bg-brand-700 text-white font-bold text-xs transition-colors"
              >
                Go to Dashboard
              </button>
            </div>
          </section>
        </div>

        {/* Footer */}
        <footer className="mt-auto border-t border-slate-200 dark:border-slate-800 bg-surface py-8 text-center text-xs text-slate-500 dark:text-slate-400">
          <div className="max-w-6xl mx-auto px-4 space-y-2">
            <p>&copy; {new Date().getFullYear()} Prism File Hero. All rights reserved.</p>
            <p>100% In-Browser Document Processing • POPIA &amp; GDPR Compliant</p>
          </div>
        </footer>
      </div>
    </>
  );
};

export default ToolLandingView;