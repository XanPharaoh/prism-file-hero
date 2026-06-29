import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAppStore } from '../src/store/appStore';
import { ProcessStatus } from '../types';

// Reset store between tests
beforeEach(() => {
  useAppStore.setState({
    selectedTool: null,
    activeCategory: 'All',
    searchQuery: '',
    batch: [],
    isProcessing: false,
    user: null,
    isPremium: false,
    showAuthModal: false,
    showUpgradeCTA: false,
    showHistory: false,
    isDragging: false,
    isMobileMenuOpen: false,
    extractedTransactions: [],
    currentPdfUrl: null,
    toasts: [],
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
  });
});

describe('App Store', () => {
  it('should initialize with default state', () => {
    const state = useAppStore.getState();
    expect(state.selectedTool).toBeNull();
    expect(state.activeCategory).toBe('All');
    expect(state.searchQuery).toBe('');
    expect(state.batch).toEqual([]);
    expect(state.isProcessing).toBe(false);
    expect(state.user).toBeNull();
    expect(state.isPremium).toBe(false);
    expect(state.showAuthModal).toBe(false);
    expect(state.showUpgradeCTA).toBe(false);
    expect(state.showHistory).toBe(false);
    expect(state.isDragging).toBe(false);
    expect(state.isMobileMenuOpen).toBe(false);
    expect(state.extractedTransactions).toEqual([]);
    expect(state.currentPdfUrl).toBeNull();
    expect(state.toasts).toEqual([]);
  });

  describe('Tool state mutations', () => {
    it('should set selected tool', () => {
      useAppStore.getState().setSelectedTool('merge');
      expect(useAppStore.getState().selectedTool).toBe('merge');
    });

    it('should set active category', () => {
      useAppStore.getState().setActiveCategory('AI Labs');
      expect(useAppStore.getState().activeCategory).toBe('AI Labs');
    });

    it('should set search query', () => {
      useAppStore.getState().setSearchQuery('merge');
      expect(useAppStore.getState().searchQuery).toBe('merge');
    });
  });

  describe('Batch operations', () => {
    it('should add files to batch', () => {
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });
      useAppStore.getState().addFiles([file]);
      const { batch } = useAppStore.getState();
      expect(batch.length).toBe(1);
      expect(batch[0].fileName).toBe('test.pdf');
      expect(batch[0].status).toBe(ProcessStatus.IDLE);
    });

    it('should add multiple files', () => {
      const files = [
        new File(['test1'], 'test1.pdf', { type: 'application/pdf' }),
        new File(['test2'], 'test2.pdf', { type: 'application/pdf' }),
      ];
      useAppStore.getState().addFiles(files);
      expect(useAppStore.getState().batch.length).toBe(2);
    });

    it('should remove item from batch', () => {
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });
      useAppStore.getState().addFiles([file]);
      const id = useAppStore.getState().batch[0].id;
      useAppStore.getState().removeItem(id);
      expect(useAppStore.getState().batch.length).toBe(0);
    });

    it('should clear batch', () => {
      const files = [
        new File(['test1'], 'test1.pdf', { type: 'application/pdf' }),
        new File(['test2'], 'test2.pdf', { type: 'application/pdf' }),
      ];
      useAppStore.getState().addFiles(files);
      useAppStore.getState().clearBatch();
      expect(useAppStore.getState().batch.length).toBe(0);
    });

    it('should update item status', () => {
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });
      useAppStore.getState().addFiles([file]);
      const id = useAppStore.getState().batch[0].id;
      useAppStore.getState().updateItemStatus(id, ProcessStatus.COMPLETED, null);
      expect(useAppStore.getState().batch[0].status).toBe(ProcessStatus.COMPLETED);
    });

    it('should update item status with error', () => {
      const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });
      useAppStore.getState().addFiles([file]);
      const id = useAppStore.getState().batch[0].id;
      useAppStore.getState().updateItemStatus(id, ProcessStatus.ERROR, 'Test error');
      expect(useAppStore.getState().batch[0].status).toBe(ProcessStatus.ERROR);
      expect(useAppStore.getState().batch[0].error).toBe('Test error');
    });
  });

  describe('Processing state', () => {
    it('should set isProcessing', () => {
      useAppStore.getState().setIsProcessing(true);
      expect(useAppStore.getState().isProcessing).toBe(true);
      useAppStore.getState().setIsProcessing(false);
      expect(useAppStore.getState().isProcessing).toBe(false);
    });
  });

  describe('Auth state', () => {
    it('should set user', () => {
      const mockUser = { id: 'test-user-id', email: 'test@example.com' } as any;
      useAppStore.getState().setUser(mockUser);
      expect(useAppStore.getState().user).toEqual(mockUser);
    });

    it('should set user to null', () => {
      useAppStore.getState().setUser(null);
      expect(useAppStore.getState().user).toBeNull();
    });

    it('should set isPremium', () => {
      useAppStore.getState().setIsPremium(true);
      expect(useAppStore.getState().isPremium).toBe(true);
    });
  });

  describe('UI state', () => {
    it('should set showAuthModal', () => {
      useAppStore.getState().setShowAuthModal(true);
      expect(useAppStore.getState().showAuthModal).toBe(true);
    });

    it('should set showUpgradeCTA', () => {
      useAppStore.getState().setShowUpgradeCTA(true);
      expect(useAppStore.getState().showUpgradeCTA).toBe(true);
    });

    it('should set showHistory', () => {
      useAppStore.getState().setShowHistory(true);
      expect(useAppStore.getState().showHistory).toBe(true);
    });

    it('should set isDragging', () => {
      useAppStore.getState().setIsDragging(true);
      expect(useAppStore.getState().isDragging).toBe(true);
    });

    it('should set isMobileMenuOpen', () => {
      useAppStore.getState().setIsMobileMenuOpen(true);
      expect(useAppStore.getState().isMobileMenuOpen).toBe(true);
    });
  });

  describe('Toast operations', () => {
    it('should add toast', () => {
      useAppStore.getState().addToast({ type: 'success', message: 'Test toast' });
      const { toasts } = useAppStore.getState();
      expect(toasts.length).toBe(1);
      expect(toasts[0].type).toBe('success');
      expect(toasts[0].message).toBe('Test toast');
    });

    it('should remove toast', () => {
      useAppStore.getState().addToast({ type: 'success', message: 'Test toast' });
      const id = useAppStore.getState().toasts[0].id;
      useAppStore.getState().removeToast(id);
      expect(useAppStore.getState().toasts.length).toBe(0);
    });

    it('should limit toasts to 5 max', () => {
      for (let i = 0; i < 10; i++) {
        useAppStore.getState().addToast({ type: 'info', message: `Toast ${i}` });
      }
      expect(useAppStore.getState().toasts.length).toBeLessThanOrEqual(5);
    });

    it('should auto-remove toast after duration', async () => {
      vi.useFakeTimers();
      useAppStore.getState().addToast({ type: 'info', message: 'Auto-remove', duration: 1000 });
      expect(useAppStore.getState().toasts.length).toBe(1);
      await vi.advanceTimersByTimeAsync(1500);
      expect(useAppStore.getState().toasts.length).toBe(0);
      vi.useRealTimers();
    });
  });

  describe('Extracted transactions', () => {
    it('should set extracted transactions with URL', () => {
      const transactions = [{ date: '2024-01-01', description: 'Test', amount: 100 }];
      useAppStore.getState().setExtractedTransactions(transactions, 'blob:test-url');
      expect(useAppStore.getState().extractedTransactions).toEqual(transactions);
      expect(useAppStore.getState().currentPdfUrl).toBe('blob:test-url');
    });

    it('should set extracted transactions without URL', () => {
      const transactions = [{ date: '2024-01-01', description: 'Test', amount: 100 }];
      useAppStore.getState().setExtractedTransactions(transactions);
      expect(useAppStore.getState().extractedTransactions).toEqual(transactions);
      expect(useAppStore.getState().currentPdfUrl).toBeNull();
    });
  });

  describe('Tool options', () => {
    it('should initialize with default tool options', () => {
      const { toolOptions } = useAppStore.getState();
      expect(toolOptions.password).toBe('');
      expect(toolOptions.watermarkText).toBe('CONFIDENTIAL');
      expect(toolOptions.headerRow).toBe('1');
      expect(toolOptions.dataRange).toBe('');
      expect(toolOptions.detectMergeCells).toBe(true);
      expect(toolOptions.rotationAngle).toBe('90');
      expect(toolOptions.mergePages).toBe('');
      expect(toolOptions.splitPages).toBe('');
    });

    it('should set partial tool options', () => {
      useAppStore.getState().setToolOptions({ password: 'test123', watermarkText: 'DRAFT' });
      const { toolOptions } = useAppStore.getState();
      expect(toolOptions.password).toBe('test123');
      expect(toolOptions.watermarkText).toBe('DRAFT');
      expect(toolOptions.headerRow).toBe('1'); // unchanged
    });
  });
});