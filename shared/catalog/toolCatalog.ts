/**
 * Batch 06 — Canonical tool catalog: the single source of truth that reconciles the
 * THREE namespaces the product historically drifted across:
 *   • the marketing/site `slug` (site/assets/features.data.js),
 *   • the site in-browser runner key (site/assets/tool.js `TOOLS`),
 *   • the desktop/web-app handler id (src/registry/toolRegistry.ts).
 *
 * A shared catalog by itself is NOT functional parity, so `tests/toolCatalogParity.test.ts`
 * reads the actual source files and ENFORCES, per entry:
 *   - every advertised slug appears here (nothing advertised is silently dropped),
 *   - `siteSlug` (when declared) exists as a real runner in tool.js,
 *   - `appId` (when declared) exists as a real handler in toolRegistry,
 *   - any tool that claims browser/web-ai execution HAS a site runner.
 * An entry whose `appId` is null is an EXPLICIT "no app handler yet" — a declared gap,
 * never a dangling reference to a handler that does not exist.
 */

export type Exec = 'browser' | 'desktop' | 'offline' | 'web-ai' | 'android';

export interface CatalogTool {
  id: string;          // canonical id
  siteSlug: string;    // features.data.js slug
  runner: string | null;   // tool.js TOOLS key, or null if the site has no live runner
  appId: string | null;    // toolRegistry id, or null if there is no app handler yet
  family: string;
  exec: Exec[];
  /** Real implementation location when not a registry handler (pipeline module / AI). */
  impl?: string;
  /** Site AI adapter present in tool.js (calls the Worker /api/ai for this slug). */
  siteAi?: boolean;
  /**
   * Accurate site availability: a tool is browser-executable on the site only if it has a live
   * runner OR a site AI adapter. Recorded so the UI/tests never overclaim. A tool that is app-
   * or Worker-only must NOT carry a `browser` claim.
   */
  siteExecutable?: boolean;
  /**
   * False ONLY where the capability is advertised on the marketing site but has NO real
   * implementation anywhere yet. The parity test enforces that such a tool never claims browser
   * execution and stays reported in the unimplemented set — so the UI cannot overclaim it.
   */
  available?: boolean;
}

export const TOOL_CATALOG: CatalogTool[] = [
  // Organize
  { id: 'merge', siteSlug: 'merge-pdf', runner: 'merge-pdf', appId: 'merge', family: 'Organize', exec: ['browser', 'desktop', 'offline'] },
  { id: 'split', siteSlug: 'split-pdf', runner: 'split-pdf', appId: 'split', family: 'Organize', exec: ['browser', 'desktop', 'offline'] },
  { id: 'rotate', siteSlug: 'rotate-pdf', runner: 'rotate-pdf', appId: 'rotate', family: 'Organize', exec: ['browser', 'desktop', 'offline'] },
  { id: 'auto-rotate', siteSlug: 'auto-rotate-pages', runner: 'auto-rotate-pages', appId: 'auto-rotate', family: 'Organize', exec: ['desktop', 'offline'] },
  { id: 'delete-pages', siteSlug: 'delete-pages', runner: 'delete-pages', appId: 'delete-pages', family: 'Organize', exec: ['browser', 'desktop', 'offline'] },
  { id: 'extract-pages', siteSlug: 'extract-pages', runner: 'extract-pages', appId: 'extract-pages', family: 'Organize', exec: ['browser', 'desktop', 'offline'] },
  { id: 'reorder-pages', siteSlug: 'reorder-pages', runner: 'reorder-pages', appId: 'reorder-pages', family: 'Organize', exec: ['browser', 'desktop', 'offline'] },
  { id: 'page-numbers', siteSlug: 'add-page-numbers', runner: 'add-page-numbers', appId: 'page-numbers', family: 'Organize', exec: ['desktop', 'offline'] },
  { id: 'header-footer', siteSlug: 'header-and-footer', runner: 'header-and-footer', appId: 'header-footer', family: 'Organize', exec: ['desktop', 'offline'] },
  { id: 'n-up', siteSlug: 'multi-page-layout', runner: 'multi-page-layout', appId: 'n-up', family: 'Organize', exec: ['desktop', 'offline'] },
  { id: 'stamp', siteSlug: 'add-stamp-badge', runner: 'add-stamp-badge', appId: 'stamp', family: 'Organize', exec: ['desktop', 'offline'] },
  { id: 'remove-blank-pages', siteSlug: 'remove-blank-pages', runner: 'remove-blank-pages', appId: 'remove-blank-pages', family: 'Organize', exec: ['desktop', 'offline'] },

  // Convert
  { id: 'pdf-to-excel', siteSlug: 'pdf-to-excel', runner: 'pdf-to-excel', appId: 'pdf-to-excel', family: 'Convert', exec: ['desktop', 'web-ai'] },
  { id: 'pdf-to-word', siteSlug: 'pdf-to-word', runner: 'pdf-to-word', appId: 'pdf-to-word', family: 'Convert', exec: ['desktop', 'web-ai'] },
  { id: 'pdf-to-docx', siteSlug: 'pdf-to-word', runner: null, appId: 'pdf-to-docx', family: 'Convert', exec: ['desktop'] },
  { id: 'pdf-to-text', siteSlug: 'pdf-to-plain-text', runner: 'pdf-to-plain-text', appId: 'pdf-to-text', family: 'Convert', exec: ['browser', 'desktop', 'offline'] },
  { id: 'pdf-to-md', siteSlug: 'pdf-to-markdown', runner: 'pdf-to-markdown', appId: 'ocr-to-md', family: 'Convert', exec: ['web-ai', 'desktop'] },
  { id: 'pdf-to-jpg', siteSlug: 'pdf-to-jpg', runner: 'pdf-to-jpg', appId: 'pdf-to-jpg', family: 'Convert', exec: ['browser', 'desktop', 'offline'] },
  { id: 'jpg-to-pdf', siteSlug: 'jpg-to-pdf', runner: 'jpg-to-pdf', appId: 'jpg-to-pdf', family: 'Convert', exec: ['browser', 'desktop', 'android', 'offline'] },
  { id: 'extract-images', siteSlug: 'extract-images', runner: 'extract-images', appId: 'extract-images', family: 'Convert', exec: ['desktop', 'offline'] },

  // Optimize
  { id: 'compress', siteSlug: 'compress-pdf', runner: 'compress-pdf', appId: 'compress', family: 'Optimize', exec: ['desktop', 'offline'] },
  { id: 'pdf-repair', siteSlug: 'repair-pdf', runner: 'repair-pdf', appId: 'pdf-repair', family: 'Optimize', exec: ['desktop', 'offline'] },
  { id: 'crop-resize', siteSlug: 'crop-and-resize', runner: 'crop-and-resize', appId: 'crop-resize', family: 'Optimize', exec: ['desktop', 'offline'] },
  { id: 'scan-effect', siteSlug: 'scanner-paper-look', runner: 'scanner-paper-look', appId: 'scan-effect', family: 'Optimize', exec: ['desktop', 'android', 'offline'] },
  { id: 'invert-colors', siteSlug: 'invert-colors', runner: 'invert-colors', appId: 'invert-colors', family: 'Optimize', exec: ['desktop', 'offline'] },
  { id: 'flatten', siteSlug: 'flatten-pdf', runner: 'flatten-pdf', appId: 'flatten-pdf', family: 'Optimize', exec: ['desktop', 'offline'] },

  // Security
  { id: 'protect', siteSlug: 'protect-pdf', runner: 'protect-pdf', appId: 'protect', family: 'Security', exec: ['desktop', 'offline'] },
  { id: 'unlock', siteSlug: 'unlock-pdf', runner: 'unlock-pdf', appId: 'unlock-pdf', family: 'Security', exec: ['desktop', 'offline'] },
  { id: 'redact', siteSlug: 'redact-pdf', runner: 'redact-pdf', appId: 'redact', family: 'Security', exec: ['desktop', 'web-ai'] },
  { id: 'watermark', siteSlug: 'watermark', runner: 'watermark', appId: 'watermark', family: 'Security', exec: ['desktop', 'offline'] },
  { id: 'metadata-edit', siteSlug: 'edit-metadata', runner: 'edit-metadata', appId: 'metadata-edit', family: 'Security', exec: ['browser', 'desktop', 'offline'] },
  { id: 'sanitize', siteSlug: 'sanitize-pdf', runner: 'sanitize-pdf', appId: 'sanitize', family: 'Security', exec: ['desktop', 'offline'] },

  // OCR / AI Labs
  { id: 'ocr-searchable', siteSlug: 'ocr-to-searchable-pdf', runner: 'ocr-to-searchable-pdf', appId: null, family: 'OCR', exec: ['desktop', 'web-ai', 'offline'] },
  { id: 'ocr-to-md', siteSlug: 'ocr-to-markdown', runner: 'ocr-to-markdown', appId: 'ocr-to-md', family: 'OCR', exec: ['web-ai', 'desktop'] },
  { id: 'ocr', siteSlug: 'ocr-to-markdown', runner: null, appId: 'ocr', family: 'OCR', exec: ['desktop'] },
  // AI Labs — these four have a real site AI adapter (tool.js aiCall) + app handler.
  { id: 'compare', siteSlug: 'compare-pdf', runner: 'compare-pdf', appId: 'compare', family: 'AI Labs', exec: ['web-ai', 'desktop'], siteAi: true, siteExecutable: true },
  { id: 'grammar-check', siteSlug: 'grammar-and-spell-check', runner: 'grammar-and-spell-check', appId: 'grammar-check', family: 'AI Labs', exec: ['web-ai'], siteAi: true, siteExecutable: true },
  { id: 'pdf-qa', siteSlug: 'pdf-qa-assistant', runner: 'pdf-qa-assistant', appId: 'pdf-qa', family: 'AI Labs', exec: ['web-ai'], siteAi: true, siteExecutable: true },
  { id: 'pdf-summary', siteSlug: 'pdf-summary', runner: 'pdf-summary', appId: 'pdf-summary', family: 'AI Labs', exec: ['web-ai'], siteAi: true, siteExecutable: true },

  // Finance — availability recorded HONESTLY. `siteExecutable:false` + no runner/adapter means
  // the SITE cannot run them today (they open the desktop app). `impl` is where the capability
  // actually lives; a null impl means it is NOT implemented anywhere (an advertised-but-missing
  // capability the UI must not present as working).
  { id: 'ledger-guard', siteSlug: 'ledger-guard', runner: 'ledger-guard', appId: null, family: 'Finance', exec: ['desktop', 'web-ai'], impl: 'services/ledgerGuard + reconciliationService', siteExecutable: true },
  { id: 'bank-statement-to-xlsx', siteSlug: 'bank-statement-to-xlsx', runner: null, appId: 'pdf-to-excel', family: 'Finance', exec: ['desktop', 'web-ai'], impl: 'services/documentService (app only)', siteExecutable: false },
  { id: 'vat-ready-workbooks', siteSlug: 'vat-ready-workbooks', runner: null, appId: null, family: 'Finance', exec: ['desktop', 'web-ai'], impl: 'pipeline/workbookPreProcessor.mjs (CLI; not a UI handler)', siteExecutable: false },
  { id: 'per-client-rules-engine', siteSlug: 'per-client-rules-engine', runner: null, appId: null, family: 'Finance', exec: ['desktop'], impl: 'pipeline/clientRulesEngine.mjs (CLI; not a UI handler)', siteExecutable: false },
  // NOT implemented anywhere — the site/app must present this as unavailable, not as a feature.
  { id: 'industry-templates', siteSlug: 'industry-templates', runner: null, appId: null, family: 'Finance', exec: ['desktop'], impl: null, siteExecutable: false, available: false },
  { id: 'portfolio-statements', siteSlug: 'portfolio-statements', runner: null, appId: 'portfolio-statements', family: 'Finance', exec: ['desktop', 'web-ai'], impl: 'services/investmentExtractService (app handler)', siteExecutable: false },
];

export const CATALOG_BY_SLUG: Record<string, CatalogTool> = (() => {
  const map: Record<string, CatalogTool> = {};
  for (const t of TOOL_CATALOG) map[t.siteSlug] = t;
  return map;
})();
