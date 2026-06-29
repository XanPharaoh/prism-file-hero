import { create } from 'zustand';
import type { User } from '@supabase/supabase-js';
import type { ToolID, ToolCategory, BatchItem, ProcessStatus, Toast } from '../types';
import { setCachedFile } from '../../services/fileCache';

const makeItemId = (): string => `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

interface AppStore {
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
  user: User | null;
  setUser: (u: User | null) => void;
  isPremium: boolean;
  setIsPremium: (v: boolean) => void;

  // UI
  showAuthModal: boolean;
  setShowAuthModal: (v: boolean) => void;
  showUpgradeCTA: boolean;
  setShowUpgradeCTA: (v: boolean) => void;
  showHistory: boolean;
  setShowHistory: (v: boolean) => void;
  isDragging: boolean;
  setIsDragging: (v: boolean) => void;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (v: boolean) => void;

  // Extraction review
  extractedTransactions: Record<string, unknown>[];
  currentPdfUrl: string | null;
  setExtractedTransactions: (txs: Record<string, unknown>[], pdfUrl?: string) => void;

  // Toasts
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: number) => void;

  // Tool options
  toolOptions: {
    password: string;
    watermarkText: string;
    headerRow: string;
    dataRange: string;
    detectMergeCells: boolean;
    rotationAngle: string;
    mergePages: string;
    splitPages: string;
  };
  setToolOptions: (opts: Partial<AppStore['toolOptions']>) => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  // Tool state
  selectedTool: null,
  activeCategory: 'All',
  searchQuery: '',
  setSelectedTool: (tool) => set({ selectedTool: tool }),
  setActiveCategory: (cat) => set({ activeCategory: cat }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  // Batch queue
  batch: [],
  addFiles: (files) => {
    const newItems: BatchItem[] = files.map((file) => {
      const id = makeItemId();
      setCachedFile(id, file); // Store file in transient cache, not Zustand
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
  removeItem: (id) => {
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
  setIsProcessing: (v) => set({ isProcessing: v }),

  // Auth
  user: null,
  setUser: (u) => set({ user: u }),
  isPremium: false,
  setIsPremium: (v) => set({ isPremium: v }),

  // UI
  showAuthModal: false,
  setShowAuthModal: (v) => set({ showAuthModal: v }),
  showUpgradeCTA: false,
  setShowUpgradeCTA: (v) => set({ showUpgradeCTA: v }),
  showHistory: false,
  setShowHistory: (v) => set({ showHistory: v }),
  isDragging: false,
  setIsDragging: (v) => set({ isDragging: v }),
  isMobileMenuOpen: false,
  setIsMobileMenuOpen: (v) => set({ isMobileMenuOpen: v }),

  // Extraction review
  extractedTransactions: [],
  currentPdfUrl: null,
  setExtractedTransactions: (txs, pdfUrl) => {
    // Revoke previous object URL to prevent memory leaks
    const { currentPdfUrl } = get();
    if (currentPdfUrl) {
      try { URL.revokeObjectURL(currentPdfUrl); } catch { /* ignore */ }
    }
    set({ extractedTransactions: txs, currentPdfUrl: pdfUrl ?? null });
  },

  // Toasts
  toasts: [],
  addToast: (toast) => {
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
  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  // Tool options
  toolOptions: {
    password: '',
    watermarkText: 'CONFIDENTIAL',
    headerRow: '1',
    dataRange: '',
    detectMergeCells: true,
    rotationAngle: '90',
    mergePages: '',
    splitPages: '',
  },
  setToolOptions: (opts) => {
    set((state) => ({ toolOptions: { ...state.toolOptions, ...opts } }));
  },
}));