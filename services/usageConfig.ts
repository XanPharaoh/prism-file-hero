import type { ToolID } from '../src/types';

export type Plan = 'free' | 'pro' | 'business';
export type FeatureType = 'local' | 'ai';

export interface ToolCost {
  aiPagesPerPage: number;
  aiPagesFlat: number;
  operationCost: number;
  category: 'free' | 'ai';
  featureType: FeatureType;
  displayName: string;
}

export const LOCAL_PER_TOOL_LIMIT = 3;
export const LOCAL_GLOBAL_CAP = 3;
export const AI_PER_TOOL_LIMIT = 0; // AI tools locked on free tier
export const AI_GLOBAL_CAP = 0;
export const SAST_OFFSET_HOURS = 2;

export const TOOL_COSTS: Record<string, ToolCost> = {
  'merge':         { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Merge PDF' },
  'split':         { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Split PDF' },
  'compress':      { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Compress PDF' },
  'rotate':        { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Rotate PDF' },
  'protect':       { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Protect PDF' },
  'watermark':     { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Watermark' },
  'jpg-to-pdf':    { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'JPG to PDF' },
  'pdf-to-jpg':    { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'PDF to JPG' },
  // Local extraction is attempted first, but scan/compression recovery sends pages
  // to the AI worker. Keep its entitlement aligned with that reachable AI path.
  'pdf-to-excel':  { aiPagesPerPage: 1, aiPagesFlat: 0, operationCost: 0, category: 'ai', featureType: 'ai', displayName: 'PDF to Excel' },
  'ocr':           { aiPagesPerPage: 1, aiPagesFlat: 0, operationCost: 0, category: 'ai', featureType: 'ai', displayName: 'OCR to Searchable PDF' },
  'ocr-to-md':     { aiPagesPerPage: 1, aiPagesFlat: 0, operationCost: 0, category: 'ai', featureType: 'ai', displayName: 'OCR to Markdown' },
  'pdf-to-word':   { aiPagesPerPage: 1, aiPagesFlat: 0, operationCost: 0, category: 'ai', featureType: 'ai', displayName: 'PDF to Word' },
  'redact':        { aiPagesPerPage: 1, aiPagesFlat: 0, operationCost: 0, category: 'ai', featureType: 'ai', displayName: 'Redact PDF' },
  'compare':       { aiPagesPerPage: 0, aiPagesFlat: 2, operationCost: 0, category: 'ai', featureType: 'ai', displayName: 'Compare PDF' },
  'grammar-check': { aiPagesPerPage: 1, aiPagesFlat: 0, operationCost: 0, category: 'ai', featureType: 'ai', displayName: 'Grammar Check' },
  'delete-pages':  { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Delete Pages' },
  'extract-pages': { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Extract Pages' },
  'page-numbers':  { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Add Page Numbers' },
  'unlock-pdf':    { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Unlock PDF' },
  'pdf-to-text':   { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'PDF to Text' },
  'pdf-repair':    { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Repair PDF' },
  'reorder-pages': { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Reorder Pages' },
  'header-footer': { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Header & Footer' },
  'crop-resize':   { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Crop & Resize' },
  'metadata-edit': { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Edit Metadata' },
  'remove-blank-pages': { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Remove Blank Pages' },
  'flatten-pdf':   { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Flatten PDF' },
  'pdf-to-docx':   { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'PDF to Word DOCX' },
  'pdf-qa':        { aiPagesPerPage: 1, aiPagesFlat: 0, operationCost: 0, category: 'ai', featureType: 'ai', displayName: 'PDF Q&A Assistant' },
  'pdf-summary':   { aiPagesPerPage: 1, aiPagesFlat: 0, operationCost: 0, category: 'ai', featureType: 'ai', displayName: 'PDF Summary' },
  'sanitize':      { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Sanitize PDF' },
  'extract-images':{ aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Extract Images' },
  'n-up':          { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Multi-Page Layout (N-Up)' },
  'scan-effect':   { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Scanner / Paper Look' },
  'invert-colors': { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Invert Colors' },
  'auto-rotate':   { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Auto-Rotate Pages' },
  'stamp':         { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', featureType: 'local', displayName: 'Add Stamp Badge' },
};

export const PLAN_LIMITS: Record<Plan, { aiPages: number; operations: number; maxFileSizeMB: number; maxPagesPerFile: number; }> = {
  free:     { aiPages: 0,     operations: 3,     maxFileSizeMB: 25,  maxPagesPerFile: 30 },
  pro:      { aiPages: 500,   operations: -1,    maxFileSizeMB: 50,  maxPagesPerFile: 100 },
  business: { aiPages: -1,    operations: -1,    maxFileSizeMB: 100, maxPagesPerFile: 500 },
};

export function getFeatureType(toolId: string): FeatureType { return TOOL_COSTS[toolId]?.featureType || 'local'; }
export function getPerToolLimit(featureType: FeatureType): number { return featureType === 'ai' ? AI_PER_TOOL_LIMIT : LOCAL_PER_TOOL_LIMIT; }
export function getDailyLimit(featureType: FeatureType): number { return getPerToolLimit(featureType); }
export function getGlobalCap(featureType: FeatureType): number { return featureType === 'ai' ? AI_GLOBAL_CAP : LOCAL_GLOBAL_CAP; }
export function getToolDisplayName(toolId: string): string { return TOOL_COSTS[toolId]?.displayName || toolId; }

export function getSastMidnightUTC(date: Date = new Date()): Date {
  const sastTime = new Date(date.getTime() + (SAST_OFFSET_HOURS * 60 * 60 * 1000));
  sastTime.setUTCHours(0, 0, 0, 0);
  return new Date(sastTime.getTime() - (SAST_OFFSET_HOURS * 60 * 60 * 1000));
}

export function getNextSastMidnightDate(date: Date = new Date()): Date {
  const todayMidnight = getSastMidnightUTC(date);
  if (date > todayMidnight) return new Date(todayMidnight.getTime() + 24 * 60 * 60 * 1000);
  return todayMidnight;
}

export function calculateToolCost(toolId: string, pagesProcessed: number): { aiPages: number; operations: number; } {
  const cost = TOOL_COSTS[toolId];
  if (!cost) return { aiPages: 0, operations: 0 };
  return { aiPages: (cost.aiPagesPerPage * pagesProcessed) + cost.aiPagesFlat, operations: cost.operationCost };
}

export function getCurrentMonthKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

export function isAiTool(toolId: string): boolean { return TOOL_COSTS[toolId]?.category === 'ai'; }
export function isFreeTool(toolId: string): boolean { return TOOL_COSTS[toolId]?.category === 'free'; }
export function isProTool(toolId: string): boolean {
  const cost = TOOL_COSTS[toolId];
  if (!cost) return false;
  return cost.category === 'ai' || cost.featureType === 'ai';
}
export function getToolPagesCost(toolId: string, pageCount: number = 1): number {
  const cost = TOOL_COSTS[toolId];
  if (!cost) return 0;
  return (cost.aiPagesPerPage * pageCount) + cost.aiPagesFlat;
}
