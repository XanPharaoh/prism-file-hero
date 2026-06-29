export type ToolCategory = 'All' | 'Organize' | 'Optimize' | 'Convert' | 'Security' | 'AI Labs';

export type ToolID =
  | 'merge' | 'split' | 'compress'
  | 'pdf-to-word' | 'pdf-to-excel' | 'pdf-to-jpg' | 'jpg-to-pdf'
  | 'protect' | 'redact' | 'watermark'
  | 'ocr' | 'compare' | 'rotate'
  | 'ocr-to-pdf' | 'ocr-to-md' | 'grammar-check';

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
  amount: number;
  balance?: number;
  charges?: number;
  direction: 'DEBIT' | 'CREDIT';
  bankCode: string;
  confidence: number;
  metadata?: Record<string, unknown>;
}

export interface TransactionEdit {
  transactionId: number;
  field: keyof CanonicalTransaction;
  oldValue: unknown;
  newValue: unknown;
  timestamp: number;
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
  headerRow: string;
  dataRange: string;
  detectMergeCells: boolean;
  rotationAngle: string;
  mergePages: string;
  splitPages: string;
}