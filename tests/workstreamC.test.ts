import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAppStore } from '../src/store/appStore';
import { TOOL_REGISTRY, getToolById, getToolsByCategory } from '../src/registry/toolRegistry';
import type { ToolID } from '../src/types';

describe('Workstream C - Types, Store, Tool Registry & Page Preview Integration', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    useAppStore.setState({
      isDarkMode: false,
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
        ocrEngine: 'tesseract',
        unlockPassword: '',
        qaQuestion: '',
        summaryLength: 'medium',
        summaryFocus: '',
        docxQuality: 'standard',
        blankPageThreshold: 0.05,
      },
    });
  });

  describe('Tool IDs and Registry Registration', () => {
    const requiredNewTools: ToolID[] = [
      'delete-pages',
      'extract-pages',
      'page-numbers',
      'unlock-pdf',
      'pdf-to-text',
      'pdf-repair',
      'reorder-pages',
      'header-footer',
      'crop-resize',
      'metadata-edit',
      'remove-blank-pages',
      'flatten-pdf',
      'pdf-to-docx',
      'pdf-qa',
      'pdf-summary',
    ];

    it('should have all 15 new tools registered in TOOL_REGISTRY', () => {
      for (const toolId of requiredNewTools) {
        const handler = getToolById(toolId);
        expect(handler, `Tool ${toolId} must be registered`).toBeDefined();
        expect(handler?.id).toBe(toolId);
        expect(typeof handler?.handler).toBe('function');
      }
    });

    it('should properly categorize tools', () => {
      expect(getToolById('delete-pages')?.category).toBe('Organize');
      expect(getToolById('extract-pages')?.category).toBe('Organize');
      expect(getToolById('reorder-pages')?.category).toBe('Organize');
      expect(getToolById('header-footer')?.category).toBe('Organize');
      expect(getToolById('crop-resize')?.category).toBe('Optimize');
      expect(getToolById('remove-blank-pages')?.category).toBe('Optimize');
      expect(getToolById('pdf-repair')?.category).toBe('Optimize');
      expect(getToolById('unlock-pdf')?.category).toBe('Security');
      expect(getToolById('metadata-edit')?.category).toBe('Security');
      expect(getToolById('flatten-pdf')?.category).toBe('Security');
      expect(getToolById('pdf-to-text')?.category).toBe('Convert');
      expect(getToolById('pdf-to-docx')?.category).toBe('Convert');
      expect(getToolById('pdf-qa')?.category).toBe('AI Labs');
      expect(getToolById('pdf-summary')?.category).toBe('AI Labs');
    });
  });

  describe('Dark Mode in App Store', () => {
    it('should support toggling dark mode and sync with classList and localStorage', () => {
      const store = useAppStore.getState();
      expect(store.isDarkMode).toBe(false);

      store.toggleDarkMode();
      expect(useAppStore.getState().isDarkMode).toBe(true);
      expect(localStorage.getItem('theme')).toBe('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);

      store.toggleDarkMode();
      expect(useAppStore.getState().isDarkMode).toBe(false);
      expect(localStorage.getItem('theme')).toBe('light');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('should allow setting dark mode explicitly', () => {
      const store = useAppStore.getState();
      store.setDarkMode(true);
      expect(useAppStore.getState().isDarkMode).toBe(true);
      expect(document.documentElement.classList.contains('dark')).toBe(true);

      store.setDarkMode(false);
      expect(useAppStore.getState().isDarkMode).toBe(false);
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });

  describe('Tool Options in App Store', () => {
    it('should update tool options state correctly', () => {
      const { setToolOptions } = useAppStore.getState();

      setToolOptions({
        pageNumberPosition: 'top-right',
        pageNumberFormat: 'page_n',
        headerText: 'CONFIDENTIAL',
        footerText: 'Page {page}',
        cropMargins: { top: 15, bottom: 15, left: 15, right: 15 },
        metaTitle: 'Quarterly Report',
        metaAuthor: 'Financial Auditor',
        metaSubject: 'Audited Statement',
        stripMetadata: true,
        targetSize: 20,
        ocrEngine: 'gemini',
        deletePages: '1, 3-5',
        extractPages: '2, 4',
        reorderPages: '3, 1, 2',
        unlockPassword: 'SecretPassword123',
        qaQuestion: 'What was total revenue in Q4?',
        summaryLength: 'detailed',
      });

      const updated = useAppStore.getState().toolOptions;
      expect(updated.pageNumberPosition).toBe('top-right');
      expect(updated.pageNumberFormat).toBe('page_n');
      expect(updated.headerText).toBe('CONFIDENTIAL');
      expect(updated.footerText).toBe('Page {page}');
      expect(updated.cropMargins).toEqual({ top: 15, bottom: 15, left: 15, right: 15 });
      expect(updated.metaTitle).toBe('Quarterly Report');
      expect(updated.metaAuthor).toBe('Financial Auditor');
      expect(updated.metaSubject).toBe('Audited Statement');
      expect(updated.stripMetadata).toBe(true);
      expect(updated.targetSize).toBe(20);
      expect(updated.ocrEngine).toBe('gemini');
      expect(updated.deletePages).toBe('1, 3-5');
      expect(updated.extractPages).toBe('2, 4');
      expect(updated.reorderPages).toBe('3, 1, 2');
      expect(updated.unlockPassword).toBe('SecretPassword123');
      expect(updated.qaQuestion).toBe('What was total revenue in Q4?');
      expect(updated.summaryLength).toBe('detailed');
    });
  });
});
