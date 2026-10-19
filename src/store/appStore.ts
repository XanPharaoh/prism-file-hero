import { create } from 'zustand';
import type { ToolID, ToolCategory, BatchItem, ProcessStatus, Toast } from '../types';
import { setCachedFile } from '../../services/fileCache';
import type { FeatureType } from '../../services/usageConfig';
import type { TableAlignmentResult } from '../../services/spatialTableExtractor';

/** Authenticated user shape — provider-agnostic (Clerk, Supabase, etc.) */
export interface AppUser {
  id: string;
  email: string;
  name: string;
}

const makeItemId = (): string => `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const getInitialDarkMode = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const saved = localStorage.getItem('theme');
    if (saved) return saved === 'dark';
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches || false;
  } catch {
    return false;
  }
};

// Initialize class on load in browser
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (getInitialDarkMode()) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

interface AppState {
  // Tool state
  selectedTool: ToolID | null;
  activeCategory: ToolCategory;
  searchQuery: string;
  setSelectedTool: (tool: ToolID | null) => void;
  setActiveCategory: (cat: ToolCategory) => void;
  setSearchQuery: (query: string) => void;

  // Batch queue
  batch: BatchItem[];
  addFiles: (files: File[]) => void;
  removeItem: (id: string) => void;
  clearBatch: () => void;
  updateItemStatus: (id: string, status: ProcessStatus, error?: string | null, resultBlob?: Blob | null) => void;

  // Processing
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;

  // Auth
  user: AppUser | null;
  setUser: (u: AppUser | null) => void;
  isPremium: boolean;
  setIsPremium: (v: boolean) => void;

  // UI
  showAuthModal: boolean;
  authModalMode: 'sign-in' | 'sign-up';
  setShowAuthModal: (v: boolean) => void;
  setAuthModal: (open: boolean, mode?: 'sign-in' | 'sign-up') => void;
  showUpgradeCTA: boolean;
  setShowUpgradeCTA: (v: boolean) => void;
  showHistory: boolean;
  setShowHistory: (v: boolean) => void;
  isDragging: boolean;
  setIsDragging: (v: boolean) => void;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (v: boolean) => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  setDarkMode: (isDark: boolean) => void;

  // Extraction review
  extractedTransactions: Record<string, unknown>[];
  currentPdfUrl: string | null;
  extractionMetadata: Record<string, unknown>;
  alignmentResult: TableAlignmentResult | null;
  activeReviewFileId: string | null;
  reviewConfirmed: boolean;
  setExtractedTransactions: (txs: Record<string, unknown>[], _legacyPdfUrl?: string | null) => void;
  setExtractionReview: (
    txs: Record<string, unknown>[],
    metadata: Record<string, unknown>,
    fileId: string | null,
  ) => void;
  setAlignmentResult: (result: TableAlignmentResult | null) => void;
  setReviewConfirmed: (confirmed: boolean) => void;
  clearExtractionReview: () => void;

  // Toasts
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: number) => void;

  toolOptions: {
    password: string;
    watermarkText: string;
    watermarkMode: 'tiled' | 'single';
    headerRow: string;
    dataRange: string;
    detectMergeCells: boolean;
    rotationAngle: string;
    mergePages: string;
    splitPages: string;
    jpgPages: string;
    compressionLevel: 'extreme' | 'recommended' | 'low';
    compressionMode: 'images' | 'rasterize';
    compressionQuality?: number;
    redactKeywords: string;
    deletePages: string;
    extractPages: string;
    reorderPages: string;
    pageNumberPosition: 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right' | 'top-left';
    pageNumberFormat: 'page_n' | 'page_n_of_m' | 'n' | 'n_of_m';
    pageNumberStart: number;
    headerText: string;
    footerText: string;
    cropMargins: { top: number; bottom: number; left: number; right: number };
    metaTitle: string;
    metaAuthor: string;
    metaSubject: string;
    metaKeywords: string;
    metaCreator: string;
    metaProducer: string;
    stripMetadata: boolean;
    targetSize: number;
    allowAIFallback: boolean;
    resizeMode: 'fit' | 'fill' | 'stretch' | 'clip';
    ocrEngine: 'tesseract' | 'gemini' | 'hybrid';
    unlockPassword: string;
    qaQuestion: string;
    summaryLength: 'short' | 'medium' | 'detailed';
    summaryFocus: string;
    docxQuality: 'standard' | 'high';
    blankPageThreshold: number;
    stampText: string;
    stampColor: 'red' | 'green' | 'blue';
    stampDate: boolean;
    nUpGrid: 2 | 4 | 9;
    scannerContrast: number;
    scannerNoise: number;
    scannerTilt: boolean;
    sanitizeRemoveJs: boolean;
    sanitizeRemoveAttachments: boolean;
    sanitizeRemoveLinks: boolean;
    sanitizeRemoveMetadata: boolean;
  };
  setToolOptions: (opts: Partial<AppState['toolOptions']>) => void;

  // Page counting (for quota enforcement)
  totalSelectedPages: number;
  setTotalSelectedPages: (pages: number) => void;

  // Quota exceeded modal
  showQuotaModal: boolean;
  setShowQuotaModal: (v: boolean) => void;
  quotaModalInfo: {
    featureType: FeatureType;
    requestedPages: number;
    usedToday: number;
    dailyLimit: number;
    globalUsedToday: number;
    globalCap: number;
    limitReason: 'tool_limit' | 'global_cap';
    nextReset: string;
    serverReason?: string;
  } | null;
  setQuotaModalInfo: (info: { featureType: FeatureType; requestedPages: number; usedToday: number; dailyLimit: number; globalUsedToday: number; globalCap: number; limitReason: 'tool_limit' | 'global_cap'; nextReset: string; serverReason?: string } | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Tool state
  selectedTool: null,
  activeCategory: 'All',
  searchQuery: '',
  setSelectedTool: (tool: ToolID | null) => set({ selectedTool: tool }),
  setActiveCategory: (cat: ToolCategory) => set({ activeCategory: cat }),
  setSearchQuery: (query: string) => set({ searchQuery: query }),

  // Batch queue
  batch: [],
  addFiles: (files: File[]) => {
    const newItems: BatchItem[] = files.map((file) => {
      const id = makeItemId();
      setCachedFile(id, file);
      return {
        id,
        fileName: file.name,
        fileSize: file.size,
        status: 'IDLE' as ProcessStatus,
        progress: 0,
        data: null,
        error: null,
      };
    });
    set((state) => ({ batch: [...state.batch, ...newItems] }));
  },
  removeItem: (id: string) => {
    set((state) => {
      const item = state.batch.find((b) => b.id === id);
      if (item?.resultBlob) {
        try { URL.revokeObjectURL(URL.createObjectURL(item.resultBlob)); } catch { /* ignore */ }
      }
      return { batch: state.batch.filter((b) => b.id !== id) };
    });
  },
  clearBatch: () => {
    const { batch } = get();
    batch.forEach((item) => {
      if (item.resultBlob) {
        try { URL.revokeObjectURL(URL.createObjectURL(item.resultBlob)); } catch { /* ignore */ }
      }
    });
    set({ batch: [] });
  },
  updateItemStatus: (id, status, error = null, resultBlob = null) => {
    set((state) => ({
      batch: state.batch.map((item) =>
        item.id === id
          ? { ...item, status, error: error ?? item.error, resultBlob: resultBlob ?? item.resultBlob }
          : item
      ),
    }));
  },

  // Processing
  isProcessing: false,
  setIsProcessing: (v: boolean) => set({ isProcessing: v }),

  // Auth
  user: null,
  setUser: (u: AppUser | null) => set({ user: u }),
  isPremium: false,
  setIsPremium: (v: boolean) => set({ isPremium: v }),

  // UI
  showAuthModal: false,
  authModalMode: 'sign-in',
  setShowAuthModal: (v: boolean) => set({ showAuthModal: v, authModalMode: 'sign-in' }),
  setAuthModal: (open: boolean, mode: 'sign-in' | 'sign-up' = 'sign-in') => set({ showAuthModal: open, authModalMode: mode }),
  showUpgradeCTA: false,
  setShowUpgradeCTA: (v: boolean) => set({ showUpgradeCTA: v }),
  showHistory: false,
  setShowHistory: (v: boolean) => set({ showHistory: v }),
  isDragging: false,
  setIsDragging: (v: boolean) => set({ isDragging: v }),
  isMobileMenuOpen: false,
  setIsMobileMenuOpen: (v: boolean) => set({ isMobileMenuOpen: v }),
  isDarkMode: getInitialDarkMode(),
  toggleDarkMode: () => {
    set((state) => {
      const next = !state.isDarkMode;
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('theme', next ? 'dark' : 'light');
        } catch { /* ignore */ }
        if (next) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }
      return { isDarkMode: next };
    });
  },
  setDarkMode: (isDark: boolean) => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
      } catch { /* ignore */ }
      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }
    set({ isDarkMode: isDark });
  },

  // Extraction review
  extractedTransactions: [],
  currentPdfUrl: null,
  extractionMetadata: {},
  alignmentResult: null,
  activeReviewFileId: null,
  reviewConfirmed: false,
  setExtractedTransactions: (txs: Record<string, unknown>[], legacyPdfUrl = null) => {
    set({ extractedTransactions: txs, currentPdfUrl: legacyPdfUrl });
  },
  setExtractionReview: (txs, metadata, fileId) => {
    set({
      extractedTransactions: txs,
      extractionMetadata: metadata,
      alignmentResult: (metadata.alignment as TableAlignmentResult | undefined) ?? null,
      activeReviewFileId: fileId,
      reviewConfirmed: !metadata.requiresReview,
      currentPdfUrl: null,
    });
  },
  setAlignmentResult: (result) => set({ alignmentResult: result }),
  setReviewConfirmed: (confirmed) => set({ reviewConfirmed: confirmed }),
  clearExtractionReview: () => set({
    extractedTransactions: [],
    extractionMetadata: {},
    alignmentResult: null,
    activeReviewFileId: null,
    reviewConfirmed: false,
    currentPdfUrl: null,
  }),

  // Toasts
  toasts: [],
  addToast: (toast: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    const duration = toast.duration ?? 4000;
    set((state) => ({ toasts: [...state.toasts.slice(-4), { ...toast, id }] }));
    if (duration > 0) {
      setTimeout(() => {
        const { toasts: currentToasts } = get();
        const stillExists = currentToasts.some((t) => t.id === id);
        if (stillExists) {
          set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
        }
      }, duration);
    }
  },
  removeToast: (id: number) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  // Page counting
  totalSelectedPages: 0,
  setTotalSelectedPages: (pages: number) => set({ totalSelectedPages: pages }),

  // Quota exceeded modal
  showQuotaModal: false,
  setShowQuotaModal: (v: boolean) => set({ showQuotaModal: v }),
  quotaModalInfo: null,
  setQuotaModalInfo: (info) => set({ quotaModalInfo: info }),

  // Tool options
  toolOptions: {
    password: '',
    watermarkText: 'CONFIDENTIAL',
    watermarkMode: 'tiled',
    headerRow: '1',
    dataRange: '',
    detectMergeCells: true,
    rotationAngle: '90',
    mergePages: '',
    splitPages: '',
    jpgPages: '',
    compressionLevel: 'recommended',
    compressionMode: 'images',
    compressionQuality: 0.6,
    redactKeywords: '',
    deletePages: '',
    extractPages: '',
    reorderPages: '',
    pageNumberPosition: 'bottom-center',
    pageNumberFormat: 'page_n_of_m',
    pageNumberStart: 1,
    headerText: '',
    footerText: '',
    cropMargins: { top: 20, bottom: 20, left: 20, right: 20 },
    metaTitle: '',
    metaAuthor: '',
    metaSubject: '',
    metaKeywords: '',
    metaCreator: '',
    metaProducer: '',
    stripMetadata: false,
    targetSize: 10,
    allowAIFallback: false,
    resizeMode: 'fit',
    ocrEngine: 'tesseract',
    unlockPassword: '',
    qaQuestion: '',
    summaryLength: 'medium',
    summaryFocus: '',
    docxQuality: 'standard',
    blankPageThreshold: 0.05,
    stampText: 'APPROVED',
    stampColor: 'red',
    stampDate: true,
    nUpGrid: 2,
    scannerContrast: 1.2,
    scannerNoise: 15,
    scannerTilt: true,
    sanitizeRemoveJs: true,
    sanitizeRemoveAttachments: true,
    sanitizeRemoveLinks: true,
    sanitizeRemoveMetadata: true,
  },
  setToolOptions: (opts: Partial<AppState['toolOptions']>) => {
    set((state) => ({ toolOptions: { ...state.toolOptions, ...opts } }));
  },
}));
