import React from 'react';
import { LayoutGrid as Layout, Scissors, Zap, FileType2 as FileType, ShieldCheck, WandSparkles as Wand2, History, Shield, ArrowUpRight } from 'lucide-react';
import { BrandHeader } from './ui/Brand';
import type { ToolCategory } from '../types';
import { useAppStore } from '../store/appStore';
import { getToolById, getToolsByCategory } from '../registry/toolRegistry';

const CATEGORIES: { id: ToolCategory; label: string; icon: React.FC<any> }[] = [
  { id: 'All' as ToolCategory, label: 'All Tools', icon: Layout },
  { id: 'AI Labs' as ToolCategory, label: 'AI & Banking', icon: Wand2 },
  { id: 'Organize' as ToolCategory, label: 'Organize', icon: Scissors },
  { id: 'Optimize' as ToolCategory, label: 'Optimize', icon: Zap },
  { id: 'Convert' as ToolCategory, label: 'Convert', icon: FileType },
  { id: 'Security' as ToolCategory, label: 'Security', icon: ShieldCheck },
];

export const SidebarContent: React.FC = () => {
  const {
    activeCategory,
    selectedTool,
    showHistory,
    isPremium,
    setActiveCategory,
    setSelectedTool,
    setShowHistory,
    setShowUpgradeCTA,
    setIsMobileMenuOpen,
    user,
  } = useAppStore();
  const currentTool = selectedTool ? getToolById(selectedTool) : undefined;

  return (
    <div className="flex flex-col h-full justify-between space-y-6">
      <div className="space-y-6">
        {/* Brand header */}
        <div className="pt-1">
          <BrandHeader />
        </div>

        {/* Categories Navigation */}
        <div className="space-y-1">
          <p className="px-3 text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500 tracking-wider mb-2 flex items-center justify-between">
            <span>Workspaces</span>
            <span className="font-mono text-[9px] text-slate-400">37</span>
          </p>
          {CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat.id && !showHistory;
            const CategoryIcon = cat.icon;
            const toolCount = cat.id === 'All' ? 37 : getToolsByCategory(cat.id).length;

            return (
              <button
                key={cat.id}
                onClick={() => {
                  setActiveCategory(cat.id);
                  setSelectedTool(null);
                  setShowHistory(false);
                  setIsMobileMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <CategoryIcon className="w-3.5 h-3.5" />
                  <span>{cat.label}</span>
                </div>
                <span
                  className={`text-[10px] font-mono px-1 py-0.2 rounded ${
                    isActive
                      ? 'bg-white/20 text-white dark:bg-slate-900/20 dark:text-slate-900'
                      : 'text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {toolCount}
                </span>
              </button>
            );
          })}
        </div>

        {/* Active Tool Chip */}
        {currentTool && (
          <div className="p-3 bg-slate-100 dark:bg-[#111622] rounded-md text-slate-900 dark:text-[#fafafa] border border-slate-200 dark:border-slate-800 flex items-center gap-2.5">
            <div className="p-1.5 rounded bg-slate-900 text-white dark:bg-white dark:text-slate-950">
              <Layout className="w-3.5 h-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold truncate text-slate-900 dark:text-[#fafafa]">{currentTool.name}</p>
              <p className="text-[9px] font-mono text-slate-500 uppercase">Active Workspace</p>
            </div>
          </div>
        )}

        {user && (
          <button
            onClick={() => {
              setShowHistory(true);
              setSelectedTool(null);
              setIsMobileMenuOpen(false);
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-colors duration-100 ${
              showHistory
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950 shadow-xs'
                : 'text-slate-600 hover:text-slate-900 dark:text-[#d4d4d8] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/80'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Extraction History</span>
          </button>
        )}

        {!isPremium && (
          <button
            type="button"
            onClick={() => {
              setShowUpgradeCTA(true);
              setIsMobileMenuOpen(false);
            }}
            className="w-full p-2.5 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-[#111622] dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-left transition-colors flex items-center justify-between group"
          >
            <div>
              <p className="text-[11px] font-bold text-slate-900 dark:text-[#fafafa] flex items-center gap-1.5">
                <span>Prism Pro</span>
                <span className="px-1.5 py-0.2 rounded bg-slate-900 text-white dark:bg-white dark:text-slate-950 text-[9px] font-mono uppercase font-bold">
                  Upgrade
                </span>
              </p>
              <p className="text-[10px] text-slate-500 dark:text-[#d4d4d8]">100 AI bank statement pages/mo</p>
            </div>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white transition-colors" />
          </button>
        )}
      </div>

      {/* Bottom Privacy & Security Badge */}
      <div className="p-3 rounded-md bg-slate-50 dark:bg-[#111622] border border-slate-200 dark:border-slate-800 text-left space-y-1">
        <div className="flex items-center gap-1.5 text-slate-800 dark:text-[#fafafa] text-xs font-semibold">
          <Shield className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>Local Client-Side</span>
        </div>
        <p className="text-[10px] text-slate-500 dark:text-[#d4d4d8] leading-normal">
          Zero data uploads. Documents are processed entirely in your browser sandbox.
        </p>
      </div>
    </div>
  );
};