import type { ToolID } from '../src/types';

export type Plan = 'free' | 'pro' | 'business';
export type FeatureType = 'local' | 'ai';
/**
 * Where the work actually runs. This is the only honest basis for billing cloud pages:
 *   local  — client-side WebAssembly, never touches a provider
 *   hybrid — client-side first, escalating to the AI worker only for specific pages/modes
 *   cloud  — the provider call IS the feature
 * Only `cloud` work (and a hybrid run's escalation) consumes the plan's AI-page budget,
 * and it is booked by the AI worker at the moment of the provider call — exactly once.
 */
export type Processing = 'local' | 'hybrid' | 'cloud';

export interface ToolCost {
  aiPagesPerPage: number;
  aiPagesFlat: number;
  operationCost: number;
  category: 'free' | 'ai';
  featureType: FeatureType;
  processing: Processing;
  displayName: string;
}

export const LOCAL_PER_TOOL_LIMIT = 3;
export const LOCAL_GLOBAL_CAP = 3;
export const AI_PER_TOOL_LIMIT = 0; // AI tools locked on free tier
export const AI_GLOBAL_CAP = 0;
export const SAST_OFFSET_HOURS = 2;
/** Sentinel used by both the browser gate and `check_usage_limit` for "no ceiling". */
export const UNLIMITED = -1;
export const isUnlimited = (cap: number): boolean => cap === UNLIMITED;

/**
 * Daily ceilings per plan, mirroring the deployed authority. `check_usage_limit` answers
 * free with 2 AI pages per tool / 6 per day and 5 local / 15 per day, and paid plans with
 * -1 — no daily ceiling, because a Professional plan sells 500 AI pages a month with
 * "unlimited daily operations" (site/pricing.html), which a 6-page day cannot deliver.
 * The plan-specific budget stays monthly (`PLAN_LIMITS.aiPages`), enforced in both layers.
 */
export const DAILY_CEILINGS: Record<Plan, Record<FeatureType, { perTool: number; global: number }>> = {
  free: {
    local: { perTool: LOCAL_PER_TOOL_LIMIT, global: LOCAL_GLOBAL_CAP },
    ai: { perTool: AI_PER_TOOL_LIMIT, global: AI_GLOBAL_CAP },
  },
  pro: {
    local: { perTool: UNLIMITED, global: UNLIMITED },
    ai: { perTool: UNLIMITED, global: UNLIMITED },
  },
  business: {
    local: { perTool: UNLIMITED, global: UNLIMITED },
    ai: { perTool: UNLIMITED, global: UNLIMITED },
  },
};

export const TOOL_COSTS: Record<string, ToolCost> = {
  'merge':         { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Merge PDF' },
  'split':         { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Split PDF' },
  'compress':      { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Compress PDF' },
  'rotate':        { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Rotate PDF' },
  'protect':       { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Protect PDF' },
  'watermark':     { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Watermark' },
  'jpg-to-pdf':    { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'JPG to PDF' },
  'pdf-to-jpg':    { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'PDF to JPG' },
  'portfolio-statements': { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Portfolio Statements' },
  // Local extraction is attempted first, but scan/compression recovery sends pages
  // to the AI worker. Keep its entitlement aligned with that reachable AI path.
  'pdf-to-excel':  { aiPagesPerPage: 1, aiPagesFlat: 0, operationCost: 0, category: 'ai', processing: 'hybrid', featureType: 'ai', displayName: 'PDF to Excel' },
  'ocr':           { aiPagesPerPage: 1, aiPagesFlat: 0, operationCost: 0, category: 'ai', processing: 'hybrid', featureType: 'ai', displayName: 'OCR to Searchable PDF' },
  'ocr-to-md':     { aiPagesPerPage: 1, aiPagesFlat: 0, operationCost: 0, category: 'ai', processing: 'cloud', featureType: 'ai', displayName: 'OCR to Markdown' },
  'pdf-to-word':   { aiPagesPerPage: 1, aiPagesFlat: 0, operationCost: 0, category: 'ai', processing: 'cloud', featureType: 'ai', displayName: 'PDF to Word' },
  'redact':        { aiPagesPerPage: 1, aiPagesFlat: 0, operationCost: 0, category: 'ai', processing: 'hybrid', featureType: 'ai', displayName: 'Redact PDF' },
  'compare':       { aiPagesPerPage: 0, aiPagesFlat: 2, operationCost: 0, category: 'ai', processing: 'cloud', featureType: 'ai', displayName: 'Compare PDF' },
  'grammar-check': { aiPagesPerPage: 1, aiPagesFlat: 0, operationCost: 0, category: 'ai', processing: 'cloud', featureType: 'ai', displayName: 'Grammar Check' },
  'delete-pages':  { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Delete Pages' },
  'extract-pages': { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Extract Pages' },
  'page-numbers':  { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Add Page Numbers' },
  'unlock-pdf':    { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Unlock PDF' },
  'pdf-to-text':   { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'PDF to Text' },
  'pdf-repair':    { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Repair PDF' },
  'reorder-pages': { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Reorder Pages' },
  'header-footer': { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Header & Footer' },
  'crop-resize':   { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Crop & Resize' },
  'metadata-edit': { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Edit Metadata' },
  'remove-blank-pages': { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Remove Blank Pages' },
  'flatten-pdf':   { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Flatten PDF' },
  'pdf-to-docx':   { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'PDF to Word DOCX' },
  'pdf-qa':        { aiPagesPerPage: 1, aiPagesFlat: 0, operationCost: 0, category: 'ai', processing: 'cloud', featureType: 'ai', displayName: 'PDF Q&A Assistant' },
  'pdf-summary':   { aiPagesPerPage: 1, aiPagesFlat: 0, operationCost: 0, category: 'ai', processing: 'cloud', featureType: 'ai', displayName: 'PDF Summary' },
  'sanitize':      { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Sanitize PDF' },
  'extract-images':{ aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Extract Images' },
  'n-up':          { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Multi-Page Layout (N-Up)' },
  'scan-effect':   { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Scanner / Paper Look' },
  'invert-colors': { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Invert Colors' },
  'auto-rotate':   { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Auto-Rotate Pages' },
  'stamp':         { aiPagesPerPage: 0, aiPagesFlat: 0, operationCost: 1, category: 'free', processing: 'local', featureType: 'local', displayName: 'Add Stamp Badge' },
};

export const PLAN_LIMITS: Record<Plan, { aiPages: number; operations: number; maxFileSizeMB: number; maxPagesPerFile: number; }> = {
  free:     { aiPages: 0,     operations: 3,     maxFileSizeMB: 25,  maxPagesPerFile: 30 },
  pro:      { aiPages: 500,   operations: -1,    maxFileSizeMB: 50,  maxPagesPerFile: 100 },
  business: { aiPages: -1,    operations: -1,    maxFileSizeMB: 100, maxPagesPerFile: 500 },
};

export function getFeatureType(toolId: string): FeatureType { return TOOL_COSTS[toolId]?.processing === 'cloud' ? 'ai' : 'local'; }
export function getProcessing(toolId: string): Processing { return TOOL_COSTS[toolId]?.processing || 'local'; }
/** Premium = needs a paid entitlement. It does NOT imply a cloud page cost: hybrid tools
 *  such as OCR run in the browser and are entitled, not metered. */
export function isPremiumTool(toolId: string): boolean { return TOOL_COSTS[toolId]?.category === 'ai'; }
export function getPerToolLimit(featureType: FeatureType, plan: Plan = 'free'): number { return DAILY_CEILINGS[plan][featureType].perTool; }
export function getDailyLimit(featureType: FeatureType, plan: Plan = 'free'): number { return getPerToolLimit(featureType, plan); }
export function getGlobalCap(featureType: FeatureType, plan: Plan = 'free'): number { return DAILY_CEILINGS[plan][featureType].global; }
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
  if (toolId === 'protect' || toolId === 'unlock-pdf') return true;
  const cost = TOOL_COSTS[toolId];
  if (!cost) return false;
  return cost.category === 'ai' || cost.featureType === 'ai';
}
export function getToolPagesCost(toolId: string, pageCount: number = 1): number {
  const cost = TOOL_COSTS[toolId];
  if (!cost) return 0;
  return (cost.aiPagesPerPage * pageCount) + cost.aiPagesFlat;
}
