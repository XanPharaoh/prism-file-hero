import type { ToolID } from '../types';

export interface ToolConfig {
  id: ToolID;
  category: 'free' | 'ai';
  pagesPerUse: number;
  description: string;
}

export const TOOL_USAGE_CONFIG: Record<ToolID, ToolConfig> = {
  // Free tools - unlimited
  merge: { id: 'merge', category: 'free', pagesPerUse: 0, description: 'Combine PDFs' },
  split: { id: 'split', category: 'free', pagesPerUse: 0, description: 'Split PDFs' },
  compress: { id: 'compress', category: 'free', pagesPerUse: 0, description: 'Compress PDFs' },
  rotate: { id: 'rotate', category: 'free', pagesPerUse: 0, description: 'Rotate pages' },
  'jpg-to-pdf': { id: 'jpg-to-pdf', category: 'free', pagesPerUse: 0, description: 'Images to PDF' },
  protect: { id: 'protect', category: 'free', pagesPerUse: 0, description: 'Password protect' },
  watermark: { id: 'watermark', category: 'free', pagesPerUse: 0, description: 'Add watermark' },

  // AI tools - limited
  'pdf-to-excel': { id: 'pdf-to-excel', category: 'ai', pagesPerUse: 1, description: 'PDF to Excel' },
  'pdf-to-word': { id: 'pdf-to-word', category: 'ai', pagesPerUse: 1, description: 'PDF to Markdown' },
  'pdf-to-jpg': { id: 'pdf-to-jpg', category: 'ai', pagesPerUse: 1, description: 'PDF to JPG' },
  ocr: { id: 'ocr', category: 'ai', pagesPerUse: 1, description: 'OCR PDF' },
  'ocr-to-pdf': { id: 'ocr-to-pdf', category: 'ai', pagesPerUse: 1, description: 'OCR to PDF' },
  'ocr-to-md': { id: 'ocr-to-md', category: 'ai', pagesPerUse: 1, description: 'OCR to Markdown' },
  compare: { id: 'compare', category: 'ai', pagesPerUse: 2, description: 'Compare PDFs' },
  redact: { id: 'redact', category: 'ai', pagesPerUse: 1, description: 'Redact PII' },
  'grammar-check': { id: 'grammar-check', category: 'ai', pagesPerUse: 1, description: 'Grammar check' },
};

export function isFreeTool(toolId: ToolID): boolean {
  return TOOL_USAGE_CONFIG[toolId]?.category === 'free';
}

export function getToolPagesCost(toolId: ToolID): number {
  return TOOL_USAGE_CONFIG[toolId]?.pagesPerUse || 0;
}

export function getAiTools(): ToolID[] {
  return Object.values(TOOL_USAGE_CONFIG)
    .filter(t => t.category === 'ai')
    .map(t => t.id);
}

export function getFreeTools(): ToolID[] {
  return Object.values(TOOL_USAGE_CONFIG)
    .filter(t => t.category === 'free')
    .map(t => t.id);
}