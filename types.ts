
export type ToolCategory = 'All' | 'Organize' | 'Optimize' | 'Convert' | 'Security' | 'AI Labs';

export type ToolID =
  | 'merge' | 'split' | 'compress'
  | 'pdf-to-word' | 'pdf-to-excel' | 'pdf-to-jpg' | 'jpg-to-pdf'
  | 'protect' | 'redact' | 'watermark'
  | 'ocr' | 'compare' | 'rotate'
  | 'ocr-to-pdf' | 'ocr-to-md' | 'grammar-check';

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
  rows: Record<string, any>[];
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
  // File objects evicted from React/Zustand state to prevent mobile Safari memory crashes.
  // Use fileCache.ts (getCachedFile/setCachedFile/clearCachedFile) instead.
  filePath?: string;
  fileName: string;
  fileSize: number;
  status: ProcessStatus;
  progress: number;
  data: ExtractedData | null;
  error: string | null;
}

export interface PDFTool {
  id: ToolID;
  name: string;
  description: string;
  category: ToolCategory;
  icon: string;
  color: string;
}

// Frontend API Contract for Transaction Extraction
export interface CanonicalTransaction {
  date: string;           // ISO format YYYY-MM-DD
  description: string;    // Transaction narrative
  amount: number;         // Signed amount (+debit, -credit)
  balance?: number;       // Account balance after transaction
  charges?: number;       // Associated fees
  direction: 'DEBIT' | 'CREDIT';
  bankCode: string;       // Which bank (FNB_SA, ABSA_ZA, etc)
  confidence: number;     // 0-100 quality score
  metadata?: Record<string, any>;
}

export interface TransactionEdit {
  transactionId: number;  // Index in array
  field: keyof CanonicalTransaction;
  oldValue: any;
  newValue: any;
  timestamp: number;
}

export interface ExtractionReviewState {
  transactions: CanonicalTransaction[];
  editHistory: TransactionEdit[];
  currentEditIndex: number;
  selectedRows: Set<number>;
}
