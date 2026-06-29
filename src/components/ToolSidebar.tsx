import React from 'react';
import { Icon, Layout, Scissors, Zap, FileType, ShieldCheck, Wand2, History } from './ui/Icon';
import { BrandHeader } from './ui/Brand';
import type { ToolCategory } from '../types';
import { useAppStore } from '../store/appStore';
import { getToolById } from '../registry/toolRegistry';

const CATEGORIES: { id: ToolCategory; name: string; icon: React.FC<any> }[] = [
  { id: 'All' as ToolCategory, name: 'Layout', icon: Layout },
  { id: 'Organize' as ToolCategory, name: 'Scissors', icon: Scissors },
  { id: 'Optimize' as ToolCategory, name: 'Zap', icon: Zap },
  { id: 'Convert' as ToolCategory, name: 'FileType', icon: FileType },
  { id: 'Security' as ToolCategory, name: 'ShieldCheck', icon: ShieldCheck },
  { id: 'AI Labs' as ToolCategory, name: 'Wand2', icon: Wand2 },
];

export const SidebarContent: React.FC = () => {
  const { activeCategory, selectedTool, showHistory, setActiveCategory, setSelectedTool, setShowHistory, setIsMobileMenuOpen, user } = useAppStore();
  const currentTool = selectedTool ? getToolById(selectedTool) : undefined;

  return (
    <div className="flex flex-col h-full space-y-10">
      {/* Brand header with custom PrismLogo */}
      <BrandHeader />

      <div className="space-y-2 flex-1 overflow-y-auto">
        <p className="px-4 text-[10px] font-black uppercase text-slate-400 tracking-widest mb-4">Categories</p>
        {CATEGORIES.map((cat) => {
          const isActive = activeCategory === cat.id && !showHistory;
          const CategoryIcon = cat.icon;
          return (
            <button
              key={cat.id}
              onClick={() => { setActiveCategory(cat.id); setSelectedTool(null); setShowHistory(false); setIsMobileMenuOpen(false); }}
              className={`w-full flex items-center justify-between px-4 py-4 rounded-2xl text-sm font-bold transition-all group ${isActive ? 'bg-white/70 backdrop-blur-sm shadow-sm border border-white/60 text-indigo-600' : 'text-slate-500 hover:bg-white/50 hover:backdrop-blur-sm hover:border hover:border-white/40 hover:text-slate-900'}`}>
              <div className="flex items-center gap-3">
                <CategoryIcon className={`w-4 h-4 transition-transform group-hover:scale-110 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                {cat.id}
              </div>
              {isActive && !selectedTool && <div className="w-1.5 h-1.5 rounded-full bg-indigo-600" />}
            </button>
          );
        })}
      </div>

      {currentTool && (
        <div className="p-4 bg-slate-900/90 backdrop-blur-md rounded-2xl text-white shadow-xl flex items-center gap-3 border border-white/10">
          <div className={`p-2 rounded-lg ${currentTool.color} text-white`}>
            <Layout className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-black truncate">{currentTool.name}</p>
            <p className="text-[9px] font-medium text-slate-400 tracking-wider uppercase">Active Agent</p>
          </div>
        </div>
      )}

      {user && (
        <button
          onClick={() => { setShowHistory(true); setSelectedTool(null); setIsMobileMenuOpen(false); }}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold transition-all ${showHistory ? 'bg-white/70 backdrop-blur-sm shadow-sm border border-white/60 text-indigo-600' : 'text-slate-500 hover:bg-white/50 hover:backdrop-blur-sm hover:border hover:border-white/40 hover:text-slate-900'}`}>
          <History className={`w-4 h-4 ${showHistory ? 'text-indigo-600' : 'text-slate-400'}`} />
          <span>Extraction History</span>
        </button>
      )}
    </div>
  );
};