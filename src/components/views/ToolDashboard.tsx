import React from 'react';
import BentoCard from '../ui/BentoCard';
import { Icon } from '../ui/Icon';
import { useAppStore } from '../../store/appStore';
import { getToolsByCategory } from '../../registry/toolRegistry';
import type { ToolHandler } from '../../types';

interface ToolDashboardProps {
  onSelectTool: (toolId: string) => void;
}

/* Map tools to strategic bento placements:
   - Hero (col-span-2 row-span-2): pdf-to-excel, compare
   - Wide (col-span-2 row-span-1): ocr, redact, pdf-to-word
   - Square (col-span-1 row-span-1): merge, split, compress, rotate, watermark, protect, jpg-to-pdf, pdf-to-jpg, ocr-to-pdf, ocr-to-md, grammar-check
*/
const HERO_TOOLS = new Set(['pdf-to-excel', 'compare']);
const WIDE_TOOLS = new Set(['ocr', 'redact', 'pdf-to-word']);

function getToolSpan(toolId: string): { colSpan: 1 | 2; rowSpan: 1 | 2 } {
  if (HERO_TOOLS.has(toolId)) return { colSpan: 2, rowSpan: 2 };
  if (WIDE_TOOLS.has(toolId)) return { colSpan: 2, rowSpan: 1 };
  return { colSpan: 1, rowSpan: 1 };
}

function getToolGradient(toolId: string): string {
  const gradients: Record<string, string> = {
    'pdf-to-excel': 'bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700',
    'compare': 'bg-gradient-to-br from-pink-500 via-rose-500 to-purple-600',
    'ocr': 'bg-gradient-to-br from-amber-400 via-orange-500 to-amber-600',
    'redact': 'bg-gradient-to-br from-red-500 via-red-600 to-rose-700',
    'pdf-to-word': 'bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-700',
  };
  return gradients[toolId] ?? '';
}

export default function ToolDashboard({ onSelectTool }: ToolDashboardProps) {
  const s = useAppStore();
  const ft = getToolsByCategory(s.activeCategory).filter(t =>
    s.searchQuery === '' ||
    t.name.toLowerCase().includes(s.searchQuery.toLowerCase()) ||
    t.description.toLowerCase().includes(s.searchQuery.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto space-y-10">
      {/* Hero heading */}
      <div className="text-center lg:text-left">
        <h2 className="text-3xl lg:text-5xl font-black text-slate-900 leading-tight">
          Elite PDF{' '}
          <span className="gradient-hero">Intelligence.</span>
        </h2>
        <p className="text-sm lg:text-base text-slate-500 font-medium mt-3 max-w-2xl">
          Enterprise-grade document processing powered by AI. Every tool is a precision instrument.
        </p>
      </div>

      {/* Asymmetric Bento Grid */}
      <div className="bento-grid">
        {ft.map((tool: ToolHandler) => {
          const { colSpan, rowSpan } = getToolSpan(tool.id);
          const isHero = HERO_TOOLS.has(tool.id);
          const isWide = WIDE_TOOLS.has(tool.id);
          const gradient = getToolGradient(tool.id);

          return (
            <BentoCard
              key={tool.id}
              colSpan={colSpan}
              rowSpan={rowSpan}
              onClick={() => onSelectTool(tool.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelectTool(tool.id); }}
              className={`flex flex-col ${isHero ? 'justify-between' : 'just-start'}`}
            >
              {/* Hero cards get a background gradient */}
              {isHero && gradient && (
                <div className={`absolute inset-0 rounded-[32px] ${gradient} opacity-[0.04] group-hover:opacity-[0.07] transition-opacity duration-500 pointer-events-none`} />
              )}

              {/* Icon */}
              <div className={`${isHero ? 'w-14 h-14 lg:w-20 lg:h-20' : 'w-10 h-10 lg:w-12 lg:h-12'} ${tool.color} rounded-xl lg:rounded-2xl flex items-center justify-center text-white shadow-lg`}>
                <Icon name={tool.icon} className={`${isHero ? 'w-7 h-7 lg:w-10 lg:h-10' : 'w-5 h-5 lg:w-6 lg:h-6'}`} />
              </div>

              {/* Content area */}
              <div className={`${isHero ? 'mt-auto' : 'mt-4'}`}>
                <h3 className={`font-black text-slate-900 ${isHero ? 'text-xl lg:text-2xl' : 'text-sm lg:text-base'} leading-tight`}>
                  {tool.name}
                </h3>
                {isHero && (
                  <p className="text-xs lg:text-sm text-slate-500 mt-1.5 leading-relaxed line-clamp-2">
                    {tool.description}
                  </p>
                )}
              </div>

              {/* Feature tags for hero cards */}
              {isHero && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {tool.id === 'pdf-to-excel' && (
                    <>
                      <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200/50">AI Extractor</span>
                      <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200/50">Batch</span>
                    </>
                  )}
                  {tool.id === 'compare' && (
                    <>
                      <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-pink-50 text-pink-600 border border-pink-200/50">AI Forensics</span>
                      <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-50 text-purple-600 border border-purple-200/50">Side-by-Side</span>
                    </>
                  )}
                </div>
              )}

              {/* Description for wide cards */}
              {isWide && !isHero && (
                <p className="text-xs text-slate-400 mt-1.5 line-clamp-1">{tool.description}</p>
              )}
            </BentoCard>
          );
        })}
      </div>
    </div>
  );
}