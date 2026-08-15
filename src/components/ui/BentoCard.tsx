import React from 'react';

interface BentoCardProps {
  children: React.ReactNode;
  colSpan?: 1 | 2;
  rowSpan?: 1 | 2;
  className?: string;
  onClick?: () => void;
  role?: string;
  tabIndex?: number;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

const colSpanClass: Record<number, string> = {
  1: 'col-span-1',
  2: 'col-span-2',
};

const rowSpanClass: Record<number, string> = {
  1: 'row-span-1',
  2: 'row-span-2',
};

export default function BentoCard({
  children,
  colSpan = 1,
  rowSpan = 1,
  className = '',
  onClick,
  role,
  tabIndex,
  onKeyDown,
}: BentoCardProps) {
  return (
    <div
      onClick={onClick}
      role={role}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      className={`
        ${colSpanClass[colSpan]} ${rowSpanClass[rowSpan]}
        bg-white/60 backdrop-blur-xl border border-white/40
        shadow-xl shadow-slate-200/50 rounded-[32px] p-6 lg:p-8
        transition-all duration-300 ease-out
        hover:-translate-y-1 hover:scale-[1.02] hover:shadow-2xl hover:shadow-slate-300/60
        hover:border-white/60 hover:bg-white/70
        relative overflow-hidden group
        ${onClick ? 'cursor-pointer' : ''}
        ${className}
      `}
    >
      {/* Inner glow overlay */}
      <div className="absolute inset-0 rounded-[32px] bg-gradient-to-br from-white/40 via-transparent to-white/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      {/* Subtle top shine */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      {children}
    </div>
  );
}