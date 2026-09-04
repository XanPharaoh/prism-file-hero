import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  Layers,
  FileType2,
  Shield,
  FileSpreadsheet,
  ArrowRight,
  Scissors,
  RotateCw,
  Trash2,
  ArrowUpDown,
  FileText,
  Table,
  Image,
  ImageDown,
  FileType,
  Zap,
  Eraser,
  Lock,
  KeyRound,
  Sparkles,
  LucideIcon,
} from 'lucide-react';

interface HeaderMegaMenuProps {
  onSelectTool: (toolId: string) => void;
  onNavigatePricing: () => void;
  onNavigateBankStatement?: () => void;
}

interface MegaMenuToolItem {
  id: string;
  name: string;
  desc: string;
  icon: LucideIcon;
  color: string;
  isPro?: boolean;
}

interface MegaMenuCategory {
  category: string;
  icon: LucideIcon;
  tools: MegaMenuToolItem[];
}

const TOOL_COLUMNS: MegaMenuCategory[] = [
  {
    category: 'Organize',
    icon: Layers,
    tools: [
      { id: 'merge', name: 'Merge PDF', desc: 'Combine multiple PDFs into one', icon: Layers, color: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/60' },
      { id: 'split', name: 'Split PDF', desc: 'Extract pages or separate files', icon: Scissors, color: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-950/60' },
      { id: 'rotate', name: 'Rotate PDF', desc: 'Turn upside-down or sideways pages', icon: RotateCw, color: 'text-blue-600 bg-blue-50 dark:bg-blue-950/60' },
      { id: 'delete-pages', name: 'Delete Pages', desc: 'Remove unwanted sheets', icon: Trash2, color: 'text-rose-600 bg-rose-50 dark:bg-rose-950/60' },
      { id: 'reorder-pages', name: 'Reorder Pages', desc: 'Rearrange page sequence', icon: ArrowUpDown, color: 'text-purple-600 bg-purple-50 dark:bg-purple-950/60' },
    ],
  },
  {
    category: 'Convert',
    icon: FileType2,
    tools: [
      { id: 'pdf-to-word', name: 'PDF to Word', desc: 'Convert to editable DOCX', icon: FileText, color: 'text-blue-600 bg-blue-50 dark:bg-blue-950/60' },
      { id: 'pdf-to-excel', name: 'PDF to Excel', desc: 'Extract tables to spreadsheet', icon: Table, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60' },
      { id: 'jpg-to-pdf', name: 'JPG to PDF', desc: 'Turn photos and scans to PDF', icon: Image, color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/60' },
      { id: 'pdf-to-jpg', name: 'PDF to JPG', desc: 'Extract pages as images', icon: ImageDown, color: 'text-orange-600 bg-orange-50 dark:bg-orange-950/60' },
      { id: 'pdf-to-text', name: 'PDF to Text', desc: 'Extract plain text content', icon: FileType, color: 'text-slate-600 bg-slate-100 dark:bg-slate-800' },
    ],
  },
  {
    category: 'Optimize & Secure',
    icon: Shield,
    tools: [
      { id: 'compress', name: 'Compress PDF', desc: 'Reduce file size cleanly', icon: Zap, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60' },
      { id: 'redact', name: 'Redact PDF', desc: 'Permanently remove sensitive info', icon: Eraser, color: 'text-rose-600 bg-rose-50 dark:bg-rose-950/60', isPro: true },
      { id: 'protect', name: 'Protect PDF', desc: 'Add password encryption', icon: Lock, color: 'text-purple-600 bg-purple-50 dark:bg-purple-950/60', isPro: true },
      { id: 'unlock-pdf', name: 'Unlock PDF', desc: 'Remove password restrictions', icon: KeyRound, color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/60', isPro: true },
      { id: 'ocr', name: 'OCR Searchable PDF', desc: 'Make scanned text selectable', icon: Sparkles, color: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/60', isPro: true },
    ],
  },
  {
    category: 'Financial Intelligence',
    icon: FileSpreadsheet,
    tools: [
      { id: 'pdf-to-excel', name: 'Bank Statement to Excel', desc: 'Reconciled SA & global statements', icon: FileSpreadsheet, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60', isPro: true },
    ],
  },
];

export default function HeaderMegaMenu({ onSelectTool, onNavigatePricing, onNavigateBankStatement }: HeaderMegaMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={menuRef} className="relative flex items-center gap-6 text-sm font-medium">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 py-2 transition-colors"
      >
        <span>Tools</span>
        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180 text-indigo-600' : ''}`} />
      </button>

      <button
        type="button"
        onClick={() => { setIsOpen(false); onNavigateBankStatement ? onNavigateBankStatement() : onSelectTool('pdf-to-excel'); }}
        className="text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 py-2 transition-colors"
      >
        Bank Statements
      </button>

      <button
        type="button"
        onClick={() => { setIsOpen(false); onNavigatePricing(); }}
        className="text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 py-2 transition-colors"
      >
        Pricing
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-[820px] -translate-x-14 bg-white dark:bg-[#111622] rounded-2xl shadow-2xl border border-slate-200/80 dark:border-slate-800 p-6 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="grid grid-cols-4 gap-5">
            {TOOL_COLUMNS.map((col) => {
              const IconComp = col.icon;
              return (
                <div key={col.category} className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 pb-1.5 border-b border-slate-100 dark:border-slate-800">
                    <IconComp className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    <span>{col.category}</span>
                  </div>
                  <ul className="space-y-1">
                    {col.tools.map((t) => {
                      const ItemIcon = t.icon;
                      return (
                        <li key={t.id + t.name}>
                          <button
                            type="button"
                            onClick={() => { setIsOpen(false); onSelectTool(t.id); }}
                            className="w-full text-left group flex items-start gap-2.5 p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                          >
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 shadow-2xs group-hover:scale-105 transition-transform ${t.color}`}>
                              <ItemIcon className="w-3.5 h-3.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 truncate">
                                  {t.name}
                                </span>
                                {t.isPro && (
                                  <span className="text-[9px] font-bold uppercase tracking-wider bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200/80 dark:border-indigo-900 px-1.5 py-0.2 rounded shrink-0">
                                    Pro
                                  </span>
                                )}
                              </div>
                              <span className="block text-[11px] text-slate-500 dark:text-slate-400 leading-tight line-clamp-1">
                                {t.desc}
                              </span>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>

          <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Core tools run locally in your browser with zero file uploads.</span>
            <button
              type="button"
              onClick={() => { setIsOpen(false); onNavigatePricing(); }}
              className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
            >
              <span>Explore Pro features</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
