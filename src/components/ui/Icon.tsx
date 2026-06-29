import React from 'react';

export interface IconProps {
  className?: string;
  size?: number;
  onClick?: () => void;
}

const baseProps = {
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

// --- Icon Definitions with Semantic Animations ---

export const Zap: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-zap ${className}`} onClick={onClick}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

export const Layers: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-layers ${className}`} onClick={onClick}>
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

export const Scissors: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-scissors ${className}`} onClick={onClick}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <line x1="20" y1="4" x2="8.12" y2="15.88" />
    <line x1="14.47" y1="14.48" x2="20" y2="20" />
    <line x1="8.12" y1="8.12" x2="12" y2="12" />
  </svg>
);

export const CheckCircle: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-check ${className}`} onClick={onClick}>
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

export const AlertCircle: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-alert ${className}`} onClick={onClick}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

export const History: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-history ${className}`} onClick={onClick}>
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    <line x1="12" y1="7" x2="12" y2="12" />
    <line x1="12" y1="12" x2="16" y2="12" />
  </svg>
);

export const Loader2: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-spin ${className}`} onClick={onClick}>
    <line x1="12" y1="2" x2="12" y2="6" />
    <line x1="12" y1="18" x2="12" y2="22" />
    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
    <line x1="2" y1="12" x2="6" y2="12" />
    <line x1="18" y1="12" x2="22" y2="12" />
    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
  </svg>
);

export const FileText: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-pulse ${className}`} onClick={onClick}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

export const FileSpreadsheet: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-pulse ${className}`} onClick={onClick}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="16" y2="17" />
    <line x1="12" y1="13" x2="12" y2="17" />
  </svg>
);

export const Wand2: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-sparkle ${className}`} onClick={onClick}>
    <path d="M21.64 3.64a1 1 0 0 0-1.28-.14L3.5 19.36a1 1 0 0 0-.14 1.28l1.42 1.42a1 1 0 0 0 1.28.14l16.86-16.86a1 1 0 0 0 .14-1.28l-1.42-1.42z" />
    <path d="M14 7l3 3" />
    <path d="M5 14l3 3" />
    <path d="M10 12l2 2" />
  </svg>
);

export const ShieldCheck: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-pulse ${className}`} onClick={onClick}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

export const Upload: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-bounce ${className}`} onClick={onClick}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

export const Download: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-bounce ${className}`} onClick={onClick}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export const Merge: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-pulse ${className}`} onClick={onClick}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
);

export const RotateCw: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-spin ${className}`} onClick={onClick}>
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

export const Eraser: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-pulse ${className}`} onClick={onClick}>
    <path d="M20 20H7L3 16C2 15 2 13 3 12L13 2L22 11L20 20Z" />
    <line x1="11" y1="11" x2="20" y2="20" />
  </svg>
);

export const AlertTriangle: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-alert ${className}`} onClick={onClick}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

export const ArrowLeft: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={className} onClick={onClick}>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

export const BarChart3: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-pulse ${className}`} onClick={onClick}>
    <path d="M3 3v18h18" />
    <path d="M18 17V9" />
    <path d="M13 17V5" />
    <path d="M8 17v-3" />
  </svg>
);

export const CheckCircle2: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-check ${className}`} onClick={onClick}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

export const ChevronLeft: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={className} onClick={onClick}>
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

export const ChevronRight: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={className} onClick={onClick}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export const Clock: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-pulse ${className}`} onClick={onClick}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

export const Eye: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-pulse ${className}`} onClick={onClick}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const FileArchive: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-pulse ${className}`} onClick={onClick}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="12" y1="18" x2="12" y2="12" />
    <line x1="9" y1="15" x2="15" y2="15" />
  </svg>
);

export const FileImage: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-pulse ${className}`} onClick={onClick}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <circle cx="10" cy="13" r="2" />
    <path d="M20 17l-4-4-6 6" />
  </svg>
);

export const FileType: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-pulse ${className}`} onClick={onClick}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M12 18v-6" />
    <path d="M9 15l3 3 3-3" />
  </svg>
);

export const FileUp: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-bounce ${className}`} onClick={onClick}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="12" y1="18" x2="12" y2="12" />
    <polyline points="9 15 12 12 15 15" />
  </svg>
);

export const Layout: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={className} onClick={onClick}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="9" y1="21" x2="9" y2="9" />
  </svg>
);

export const Lock: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-pulse ${className}`} onClick={onClick}>
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

export const PenTool: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-pulse ${className}`} onClick={onClick}>
    <path d="M12 19l7-7 3 3-7 7-3-3z" />
    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
    <path d="M2 2l7.586 7.586" />
    <circle cx="11" cy="11" r="2" />
  </svg>
);

export const Plus: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={className} onClick={onClick}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const Trash2: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={className} onClick={onClick}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

export const TrendingUp: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-pulse ${className}`} onClick={onClick}>
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
    <polyline points="17 6 23 6 23 12" />
  </svg>
);

export const UploadCloud: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={`icon-bounce ${className}`} onClick={onClick}>
    <polyline points="16 16 12 12 8 16" />
    <line x1="12" y1="12" x2="12" y2="21" />
    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
  </svg>
);

export const X: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={className} onClick={onClick}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const Menu: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={className} onClick={onClick}>
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);

export const Search: React.FC<IconProps> = ({ className = '', size = 24, onClick }) => (
  <svg {...baseProps} width={size} height={size} className={className} onClick={onClick}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

// Registry for dynamic mapping
export const ICON_REGISTRY: Record<string, React.FC<IconProps>> = {
  Zap, Layers, Scissors, CheckCircle, AlertCircle, History,
  Loader2, FileText, FileSpreadsheet, Wand2, ShieldCheck,
  Upload, Download, Merge, RotateCw, Eraser, AlertTriangle,
  ArrowLeft, BarChart3, CheckCircle2, ChevronLeft, ChevronRight,
  Clock, Eye, FileArchive, FileImage, FileType, FileUp, Layout,
  Lock, PenTool, Plus, Trash2, TrendingUp, UploadCloud, X, Menu, Search
};

// Dynamic Icon Component
export const Icon: React.FC<IconProps & { name: string }> = ({ name, ...props }) => {
  const IconComponent = ICON_REGISTRY[name] || Wand2;
  return <IconComponent {...props} />;
};
