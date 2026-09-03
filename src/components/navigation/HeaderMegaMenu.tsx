import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Layers, FileType2, Shield, FileSpreadsheet, ArrowRight } from 'lucide-react';

interface HeaderMegaMenuProps {
  onSelectTool: (toolId: string) => void;
  onNavigatePricing: () => void;
  onNavigateBankStatement?: () => void;
}

const TOOL_COLUMNS = [
  {
    category: 'Organize',
    icon: Layers,
    tools: [
      { id: 'merge', name: 'Merge PDF', desc: 'Combine multiple PDFs into one' },
      { id: 'split', name: 'Split PDF', desc: 'Extract pages or separate files' },
      { id: 'rotate', name: 'Rotate PDF', desc: 'Turn upside-down or sideways pages' },
      { id: 'delete-pages', name: 'Delete Pages', desc: 'Remove unwanted sheets' },
      { id: 'reorder-pages', name: 'Reorder Pages', desc: 'Rearrange page sequence' },
    ],
  },
  {
    category: 'Convert',
    icon: FileType2,
    tools: [
      { id: 'pdf-to-word', name: 'PDF to Word', desc: 'Convert to editable DOCX' },
      { id: 'pdf-to-excel', name: 'PDF to Excel', desc: 'Extract tables to spreadsheet' },
      { id: 'jpg-to-pdf', name: 'JPG to PDF', desc: 'Turn photos and scans to PDF' },
      { id: 'pdf-to-jpg', name: 'PDF to JPG', desc: 'Extract pages as images' },
      { id: 'pdf-to-text', name: 'PDF to Text', desc: 'Extract plain text content' },
    ],
  },
  {
    category: 'Optimize & Secure',
    icon: Shield,
    tools: [
      { id: 'compress', name: 'Compress PDF', desc: 'Reduce file size cleanly' },
      { id: 'redact', name: 'Redact PDF', desc: 'Permanently remove sensitive info' },
      { id: 'protect', name: 'Protect PDF', desc: 'Add password encryption' },
      { id: 'unlock-pdf', name: 'Unlock PDF', desc: 'Remove password restrictions' },
      { id: 'ocr', name: 'OCR Searchable PDF', desc: 'Make scanned text selectable' },
    ],
  },
  {
    category: 'Financial Intelligence',
    icon: FileSpreadsheet,
    tools: [
      { id: 'pdf-to-excel', name: 'Bank Statement to Excel', desc: 'Reconciled SA & global statements (Pro)' },
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
        <div className="absolute top-full left-0 mt-2 w-[760px] -translate-x-12 bg-white dark:bg-[#111622] rounded-2xl shadow-2xl border border-slate-200/80 dark:border-slate-800 p-6 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="grid grid-cols-4 gap-6">
            {TOOL_COLUMNS.map((col) => {
              const IconComp = col.icon;
              return (
                <div key={col.category} className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 pb-1 border-b border-slate-100 dark:border-slate-800">
                    <IconComp className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    <span>{col.category}</span>
                  </div>
                  <ul className="space-y-2">
                    {col.tools.map((t) => (
                      <li key={t.id + t.name}>
                        <button
                          type="button"
                          onClick={() => { setIsOpen(false); onSelectTool(t.id); }}
                          className="w-full text-left group p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                        >
                          <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                            {t.name}
                          </span>
                          <span className="block text-[11px] text-slate-500 dark:text-slate-400 leading-tight line-clamp-1">
                            {t.desc}
                          </span>
                        </button>
                      </li>
                    ))}
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
