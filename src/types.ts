export type ToolCategory = 'All' | 'Organize' | 'Optimize' | 'Convert' | 'Security' | 'AI Labs';

export type ToolID =
  | 'merge' | 'split' | 'compress'
  | 'pdf-to-word' | 'pdf-to-excel' | 'pdf-to-jpg' | 'jpg-to-pdf'
  | 'protect' | 'redact' | 'watermark'
  | 'ocr' | 'compare' | 'rotate'
  | 'ocr-to-md' | 'grammar-check'
  | 'delete-pages' | 'extract-pages' | 'page-numbers'
  | 'unlock-pdf' | 'pdf-to-text' | 'pdf-repair'
  | 'reorder-pages' | 'header-footer' | 'crop-resize'
  | 'metadata-edit' | 'remove-blank-pages' | 'flatten-pdf'
  | 'pdf-to-docx' | 'pdf-qa' | 'pdf-summary'
  | 'sanitize' | 'extract-images' | 'n-up'
  | 'scan-effect' | 'invert-colors' | 'auto-rotate' | 'stamp'
  | 'portfolio-statements';

export interface PDFTool {
  id: ToolID;
  name: string;
  description: string;
  category: ToolCategory;
  icon: string;
  color: string;
}

export interface ToolUsage {
  toolId: ToolID;
  pages: number;
  timestamp: string;
}

export interface AccountUsage {
  freeToolsUsed: number;
  aiToolsUsed: number;
  aiPagesUsed: number;
  aiPagesLimit: number;
  byTool: Record<ToolID, number>;
}

export interface ExtractedData {
  headers: string[];
  rows: Record<string, unknown>[];
  fullText?: string;
  markdown?: string;
}

export enum ProcessStatus {
  IDLE = 'IDLE',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface BatchItem {
  id: string;
  filePath?: string;
  fileName: string;
  fileSize: number;
  status: ProcessStatus;
  progress: number;
  data: ExtractedData | null;
  error: string | null;
  resultBlob?: Blob;
}

export interface CanonicalTransaction {
  date: string;
  description: string;
  /** Net transaction amount (positive = credit, negative = debit). May be null for fee-only rows. */
  amount: number | null;
  balance?: number | null;
  charges?: number;
  direction: 'DEBIT' | 'CREDIT' | 'UNKNOWN';
  bankCode: string;
  confidence: number;
  /** Raw text fragment from the source document (used for audit trail). */
  raw?: string;
  /** Extractor source identifier (e.g. 'docling', 'fnb-position', 'generic-text'). */
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface TransactionEdit {
  transactionId: number;
  field: keyof CanonicalTransaction;
  oldValue: unknown;
  newValue: unknown;
  timestamp: number;
  seq: number;
}

export interface ExtractionReviewState {
  transactions: CanonicalTransaction[];
  editHistory: TransactionEdit[];
  currentEditIndex: number;
  selectedRows: Set<number>;
}

export interface ToolExecutionPayload {
  files: File[];
  options: Record<string, unknown>;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}

export interface ToolResult {
  blob?: Blob;
  filename?: string;
  data?: unknown;
  metadata?: Record<string, unknown>;
}

export interface ToolHandler {
  id: ToolID;
  category: ToolCategory;
  name: string;
  description: string;
  icon: string;
  color: string;
  requiresAuth: boolean;
  allowedFileTypes: string[];
  maxFiles: number;
  supportsBatchProcessing: boolean;
  handler: (payload: ToolExecutionPayload) => Promise<ToolResult>;
}

export interface FileSystemProvider {
  pickFiles(toolId: ToolID, allowedTypes: string[], maxFiles: number): Promise<File[]>;
  saveBlob(blob: Blob, filename: string): Promise<void>;
  readFileAsArrayBuffer(file: File): Promise<ArrayBuffer>;
}

export interface Toast {
  id: number;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
}

export interface ToolOptions {
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
  jpgDpi: number;
  jpgQuality: number;
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
}