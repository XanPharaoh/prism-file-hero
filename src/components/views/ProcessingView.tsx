import { ArrowLeft, CheckCircle2, Plus, FileUp, Download, CheckCircle, AlertCircle, Loader2, Trash2, Zap, Camera } from '../ui/Icon';
import { ProcessStatus, type ToolID } from '../../types';
import { getToolById } from '../../registry/toolRegistry';
import { useAppStore } from '../../store/appStore';
import { isTauriEnvironment } from '../../providers/FileSystemProvider';
import ExtractionReview from '../ExtractionReview';
import TableAlignmentReview from '../TableAlignmentReview';
import PDFPageGrid from '../PDFPageGrid';
import type { ToolHandler } from '../../types';
import { getExcelBlob } from '../../../services/excelService';
import { getCachedFile } from '../../../services/fileCache';
import { alignmentToRows, type TableAlignmentResult } from '../../../services/spatialTableExtractor';
import { scanDocuments, isNativePlatform } from '../../../services/nativeBridge';

interface ProcessingViewProps {
  tool: ToolHandler;
  onBack: () => void;
  onSelectFiles: () => void;
  onFilesSelected: (files: File[]) => Promise<void>;
  onDownloadBlob: (blob: Blob, name: string) => Promise<void>;
  onRun: () => void;
  renderToolIcon: (name: string, className?: string) => React.ReactNode;
  progress?: number;
}

export default function ProcessingView({
  tool,
  onBack,
  onSelectFiles,
  onFilesSelected,
  onDownloadBlob,
  onRun,
  renderToolIcon,
  progress,
}: ProcessingViewProps) {
  const s = useAppStore();
  const requiresReview = Boolean(s.extractionMetadata.requiresReview) && !s.reviewConfirmed;
  const sourceFile = s.activeReviewFileId ? getCachedFile(s.activeReviewFileId) : null;

  function mapAlignedRows(result: TableAlignmentResult) {
    const metadata = s.extractionMetadata;
    return alignmentToRows(result).map((row) => {
      const read = (...names: string[]) => {
        const key = Object.keys(row).find((candidate) => names.includes(candidate.toLowerCase()));
        return key ? row[key] : '';
      };
      const number = (value: string) => Number(value.replace(/[^0-9.-]/g, '')) || 0;
      const debit = read('debit', 'money out', 'withdrawal');
      const credit = read('credit', 'money in', 'deposit');
      const amountValue = read('amount');
      const amount = debit ? -Math.abs(number(debit)) : credit ? Math.abs(number(credit)) : number(amountValue);
      return {
        date: read('date', 'post date', 'transaction date'),
        description: read('description', 'details', 'narrative', 'reference'),
        amount,
        balance: number(read('balance')) || undefined,
        direction: amount < 0 ? 'DEBIT' : 'CREDIT',
        bankCode: metadata.bankCode ?? 'UNKNOWN',
        confidence: Math.round(result.confidence * 100),
        metadata,
      };
    });
  }

  async function confirmReviewExport() {
    // This is an EXPLICIT DRAFT export, not a pass. Acknowledging the warning must
    // NOT clear validation or the review gate — the recorded reasons survive, and the
    // file is labelled as an unverified draft.
    const meta = { ...s.extractionMetadata, exportMode: 'draft' as const };
    const blob = await getExcelBlob(s.extractedTransactions, meta);
    await onDownloadBlob(blob, `UNVERIFIED_DRAFT_${Date.now()}.xlsx`);
  }

  function clearBatchAndExtractionReview() {
    s.clearBatch();
    s.clearExtractionReview();
  }

  const firstBatchFile = s.batch[0] ? getCachedFile(s.batch[0].id) : null;
  const isPdf = firstBatchFile?.type === 'application/pdf' || Boolean(firstBatchFile?.name.toLowerCase().endsWith('.pdf'));

  const parseSelection = (str: string): number[] => {
    if (!str || !str.trim()) return [];
    const parts = str.split(/[\s,]+/);
    const nums: number[] = [];
    for (const part of parts) {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(Number);
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
            nums.push(i);
          }
        }
      } else {
        const n = Number(part);
        if (!isNaN(n) && n > 0) nums.push(n);
      }
    }
    return Array.from(new Set(nums)).sort((a, b) => a - b);
  };

  const togglePageInSelection = (pageNum: number, currentStr: string, onUpdate: (val: string) => void) => {
    const current = parseSelection(currentStr);
    const set = new Set(current);
    if (set.has(pageNum)) {
      set.delete(pageNum);
    } else {
      set.add(pageNum);
    }
    const arr = Array.from(set).sort((a, b) => a - b);
    onUpdate(arr.join(', '));
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-3 text-slate-400 hover:text-brand-600 font-black text-xs tracking-widest bg-surface dark:bg-slate-800 py-2.5 px-5 rounded-full border border-slate-100 dark:border-slate-700">
          <ArrowLeft className="w-4 h-4" />Back
        </button>
        <div className="flex items-center gap-2 px-4 py-2 bg-brand-50 dark:bg-brand-950/60 text-brand-600 dark:text-brand-400 rounded-full text-[10px] font-black">
          <CheckCircle2 className="w-3 h-3" />{tool.category}
        </div>
      </div>

      <div className="text-center">
        <div className={`w-20 h-20 lg:w-28 lg:h-28 ${tool.color} rounded-[32px] mx-auto shadow-2xl flex items-center justify-center text-white`}>
          {renderToolIcon(tool.icon, 'w-10 h-10 lg:w-12 lg:h-12')}
        </div>
        <h1 className="text-3xl lg:text-5xl font-black text-slate-900 dark:text-white mt-6">{tool.name}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium mt-2 max-w-xl mx-auto">{tool.description}</p>
      </div>

      {/* Tool-specific options */}
      {tool.id === 'protect' && (
        <div className="space-y-3 w-full max-w-md mx-auto">
          <label htmlFor="protect-password" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
            Encryption Password
          </label>
          <input
            id="protect-password"
            type="password"
            placeholder="Enter a strong password to lock this PDF"
            value={s.toolOptions.password}
            onChange={(e) => s.setToolOptions({ password: e.target.value })}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
          />
          <p className="text-[11px] text-slate-400">
            Standard AES/RC4 PDF encryption is applied. The document will require this password to open.
          </p>
        </div>
      )}

      {tool.id === 'unlock-pdf' && (
        <div className="space-y-3 w-full max-w-md mx-auto">
          <label htmlFor="unlock-password" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
            PDF Password (if known)
          </label>
          <input
            id="unlock-password"
            type="password"
            placeholder="Enter the password or leave empty to strip permission restrictions"
            value={s.toolOptions.unlockPassword}
            onChange={(e) => s.setToolOptions({ unlockPassword: e.target.value })}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
          />
          <p className="text-[11px] text-slate-400">
            Removes password requirements, print locks, and permission restrictions.
          </p>
        </div>
      )}

      {tool.id === 'compress' && (
        <div className="space-y-3 w-full max-w-md mx-auto">
          <label htmlFor="compress-level" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
            Compression Level
          </label>
          <select
            id="compress-level"
            value={s.toolOptions.compressionLevel}
            onChange={(e) => s.setToolOptions({ compressionLevel: e.target.value as 'extreme' | 'recommended' | 'low' })}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
          >
            <option value="recommended">Recommended Compression (Good quality, ~60% smaller)</option>
            <option value="extreme">Extreme Compression (Maximum size reduction for email/upload)</option>
            <option value="low">Low Compression (Highest visual quality, mild compression)</option>
          </select>
          <p className="text-[11px] text-slate-400">
            Optimizes high-resolution scans and rasterizes heavy streams while preserving original dimensions.
          </p>
        </div>
      )}

      {tool.id === 'watermark' && (
        <div className="space-y-3 w-full max-w-md mx-auto">
          <label htmlFor="watermark-text" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
            Watermark Text
          </label>
          <input
            id="watermark-text"
            type="text"
            placeholder="e.g. CONFIDENTIAL, DRAFT, COPY"
            value={s.toolOptions.watermarkText}
            onChange={(e) => s.setToolOptions({ watermarkText: e.target.value })}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
          />
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => s.setToolOptions({ watermarkMode: 'tiled' })}
              className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                s.toolOptions.watermarkMode === 'tiled'
                  ? 'bg-brand-50 dark:bg-brand-950 border-brand-500 text-brand-700 dark:text-brand-300'
                  : 'bg-surface dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
              }`}
            >
              Full Page Repeating Grid (Spam)
            </button>
            <button
              type="button"
              onClick={() => s.setToolOptions({ watermarkMode: 'single' })}
              className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                s.toolOptions.watermarkMode === 'single'
                  ? 'bg-brand-50 dark:bg-brand-950 border-brand-500 text-brand-700 dark:text-brand-300'
                  : 'bg-surface dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
              }`}
            >
              Single Large Diagonal Stamp
            </button>
          </div>
        </div>
      )}

      {tool.id === 'rotate' && (
        <div className="space-y-3 w-full max-w-md mx-auto">
          <label htmlFor="rotation-angle" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
            Rotation Angle
          </label>
          <select
            id="rotation-angle"
            value={s.toolOptions.rotationAngle}
            onChange={(e) => s.setToolOptions({ rotationAngle: e.target.value })}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
          >
            <option value="90">90° Clockwise</option>
            <option value="180">180° Flip</option>
            <option value="270">270° (90° Counter-Clockwise)</option>
          </select>
        </div>
      )}

      {tool.id === 'delete-pages' && (
        <div className="space-y-4 w-full max-w-2xl mx-auto">
          <div className="space-y-2">
            <label htmlFor="delete-pages-input" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
              Pages to Delete
            </label>
            <input
              id="delete-pages-input"
              type="text"
              placeholder='e.g. "1, 3-5" or select below'
              value={s.toolOptions.deletePages}
              onChange={(e) => s.setToolOptions({ deletePages: e.target.value })}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
            />
            <p className="text-[11px] text-slate-400">
              Click thumbnails below to toggle pages for removal.
            </p>
          </div>
          {isPdf && firstBatchFile && (
            <PDFPageGrid
              file={firstBatchFile}
              selectedPages={parseSelection(s.toolOptions.deletePages)}
              onTogglePage={(pageNum) => togglePageInSelection(pageNum, s.toolOptions.deletePages, (val) => s.setToolOptions({ deletePages: val }))}
              onSelectAll={() => s.setToolOptions({ deletePages: '1-100' })}
              onDeselectAll={() => s.setToolOptions({ deletePages: '' })}
            />
          )}
        </div>
      )}

      {tool.id === 'extract-pages' && (
        <div className="space-y-4 w-full max-w-2xl mx-auto">
          <div className="space-y-2">
            <label htmlFor="extract-pages-input" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
              Pages to Extract
            </label>
            <input
              id="extract-pages-input"
              type="text"
              placeholder='e.g. "1-3, 5" or click thumbnails below'
              value={s.toolOptions.extractPages}
              onChange={(e) => s.setToolOptions({ extractPages: e.target.value })}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
            />
            <p className="text-[11px] text-slate-400">
              Selected pages will be extracted into a new standalone PDF.
            </p>
          </div>
          {isPdf && firstBatchFile && (
            <PDFPageGrid
              file={firstBatchFile}
              selectedPages={parseSelection(s.toolOptions.extractPages)}
              onTogglePage={(pageNum) => togglePageInSelection(pageNum, s.toolOptions.extractPages, (val) => s.setToolOptions({ extractPages: val }))}
              onDeselectAll={() => s.setToolOptions({ extractPages: '' })}
            />
          )}
        </div>
      )}

      {tool.id === 'reorder-pages' && (
        <div className="space-y-4 w-full max-w-2xl mx-auto">
          <div className="space-y-2">
            <label htmlFor="reorder-pages-input" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
              Page Sequence
            </label>
            <input
              id="reorder-pages-input"
              type="text"
              placeholder='e.g. "3, 1, 2" or use arrow buttons below'
              value={s.toolOptions.reorderPages}
              onChange={(e) => s.setToolOptions({ reorderPages: e.target.value })}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
            />
          </div>
          {isPdf && firstBatchFile && (
            <PDFPageGrid
              file={firstBatchFile}
              reorderable={true}
              selectable={false}
              onReorderPages={(newOrder) => s.setToolOptions({ reorderPages: newOrder.join(', ') })}
            />
          )}
        </div>
      )}

      {tool.id === 'page-numbers' && (
        <div className="space-y-4 w-full max-w-md mx-auto">
          <div className="space-y-2">
            <label htmlFor="page-number-position" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
              Position
            </label>
            <select
              id="page-number-position"
              value={s.toolOptions.pageNumberPosition}
              onChange={(e) => s.setToolOptions({ pageNumberPosition: e.target.value as any })}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
            >
              <option value="bottom-center">Bottom Center</option>
              <option value="bottom-right">Bottom Right</option>
              <option value="bottom-left">Bottom Left</option>
              <option value="top-center">Top Center</option>
              <option value="top-right">Top Right</option>
              <option value="top-left">Top Left</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label htmlFor="page-number-format" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
                Format
              </label>
              <select
                id="page-number-format"
                value={s.toolOptions.pageNumberFormat}
                onChange={(e) => s.setToolOptions({ pageNumberFormat: e.target.value as any })}
                className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
              >
                <option value="page_n_of_m">Page X of Y</option>
                <option value="page_n">Page X</option>
                <option value="n_of_m">X / Y</option>
                <option value="n">X (Number only)</option>
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="page-number-start" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
                Start Number
              </label>
              <input
                id="page-number-start"
                type="number"
                min="1"
                value={s.toolOptions.pageNumberStart}
                onChange={(e) => s.setToolOptions({ pageNumberStart: parseInt(e.target.value, 10) || 1 })}
                className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
              />
            </div>
          </div>
        </div>
      )}

      {tool.id === 'header-footer' && (
        <div className="space-y-3 w-full max-w-md mx-auto">
          <div className="space-y-2">
            <label htmlFor="header-text" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
              Header Text
            </label>
            <input
              id="header-text"
              type="text"
              placeholder="e.g. Document Title - {date}"
              value={s.toolOptions.headerText}
              onChange={(e) => s.setToolOptions({ headerText: e.target.value })}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="footer-text" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
              Footer Text
            </label>
            <input
              id="footer-text"
              type="text"
              placeholder="e.g. Confidential - Page {page} of {total}"
              value={s.toolOptions.footerText}
              onChange={(e) => s.setToolOptions({ footerText: e.target.value })}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
            />
          </div>
          <p className="text-[11px] text-slate-400">
            Supports dynamic tokens: <code className="bg-slate-100 dark:bg-slate-700 px-1 py-0.5 rounded">{`{page}`}</code>, <code className="bg-slate-100 dark:bg-slate-700 px-1 py-0.5 rounded">{`{total}`}</code>, and <code className="bg-slate-100 dark:bg-slate-700 px-1 py-0.5 rounded">{`{date}`}</code>.
          </p>
        </div>
      )}

      {tool.id === 'crop-resize' && (
        <div className="space-y-4 w-full max-w-md mx-auto">
          <div className="space-y-2">
            <label htmlFor="crop-margins" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
              Margin Trim (mm)
            </label>
            <input
              id="crop-margins"
              type="number"
              min="0"
              placeholder="Margin in millimeters"
              value={s.toolOptions.cropMargins?.top ?? 0}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10) || 0;
                s.setToolOptions({ cropMargins: { top: val, bottom: val, left: val, right: val } });
              }}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="target-size" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
              Target Standard Page Size
            </label>
            <select
              id="target-size"
              value={String(s.toolOptions.targetSize || '')}
              onChange={(e) => s.setToolOptions({ targetSize: e.target.value as any })}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
            >
              <option value="">Maintain Original Size</option>
              <option value="A4">A4 (210 x 297 mm)</option>
              <option value="LETTER">US Letter (8.5 x 11 in)</option>
              <option value="LEGAL">US Legal (8.5 x 14 in)</option>
              <option value="A3">A3 (297 x 420 mm)</option>
              <option value="A5">A5 (148 x 210 mm)</option>
            </select>
          </div>
        </div>
      )}

      {tool.id === 'metadata-edit' && (
        <div className="space-y-3 w-full max-w-md mx-auto">
          <div className="space-y-2">
            <label htmlFor="meta-title" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
              Title
            </label>
            <input
              id="meta-title"
              type="text"
              placeholder="Document Title"
              value={s.toolOptions.metaTitle}
              onChange={(e) => s.setToolOptions({ metaTitle: e.target.value })}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="meta-author" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
              Author
            </label>
            <input
              id="meta-author"
              type="text"
              placeholder="Author Name"
              value={s.toolOptions.metaAuthor}
              onChange={(e) => s.setToolOptions({ metaAuthor: e.target.value })}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="meta-subject" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
              Subject
            </label>
            <input
              id="meta-subject"
              type="text"
              placeholder="Subject or Summary"
              value={s.toolOptions.metaSubject}
              onChange={(e) => s.setToolOptions({ metaSubject: e.target.value })}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
            />
          </div>
          <label className="flex items-center gap-3 pt-2 cursor-pointer">
            <input
              type="checkbox"
              checked={s.toolOptions.stripMetadata}
              onChange={(e) => s.setToolOptions({ stripMetadata: e.target.checked })}
              className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500"
            />
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
              Strip all identifying metadata and creator stamps
            </span>
          </label>
        </div>
      )}

      {tool.id === 'remove-blank-pages' && (
        <div className="space-y-4 w-full max-w-2xl mx-auto">
          <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 text-center">
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Smart ink scanner analyzes page canvas pixels to automatically detect and discard blank scan pages.
            </p>
          </div>
          {isPdf && firstBatchFile && (
            <PDFPageGrid file={firstBatchFile} selectable={false} />
          )}
        </div>
      )}

      {tool.id === 'flatten-pdf' && (
        <div className="space-y-4 w-full max-w-2xl mx-auto">
          <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 text-center">
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Freezes form fields, digital signatures, and markup annotations permanently into the PDF background.
            </p>
          </div>
          {isPdf && firstBatchFile && (
            <PDFPageGrid file={firstBatchFile} selectable={false} />
          )}
        </div>
      )}

      {tool.id === 'pdf-to-docx' && (
        <div className="space-y-4 w-full max-w-2xl mx-auto">
          <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 text-center">
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Extracts text structure, typography, and headings to generate an editable Microsoft Word (.docx) file.
            </p>
          </div>
          {isPdf && firstBatchFile && (
            <PDFPageGrid file={firstBatchFile} selectable={false} />
          )}
        </div>
      )}

      {tool.id === 'pdf-to-text' && (
        <div className="space-y-4 w-full max-w-2xl mx-auto">
          <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 text-center">
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Extracts pure readable text into a lightweight, formatted plain text (.txt) file.
            </p>
          </div>
          {isPdf && firstBatchFile && (
            <PDFPageGrid file={firstBatchFile} selectable={false} />
          )}
        </div>
      )}

      {tool.id === 'pdf-repair' && (
        <div className="space-y-4 w-full max-w-2xl mx-auto">
          <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 text-center">
            <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Rebuilds damaged cross-reference tables, stream dictionaries, and malformed trailer objects.
            </p>
          </div>
          {isPdf && firstBatchFile && (
            <PDFPageGrid file={firstBatchFile} selectable={false} />
          )}
        </div>
      )}

      {tool.id === 'pdf-qa' && (
        <div className="space-y-4 w-full max-w-2xl mx-auto">
          <div className="space-y-2">
            <label htmlFor="qa-question" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
              Ask a question about this document
            </label>
            <input
              id="qa-question"
              type="text"
              placeholder='e.g. "What is the total contract value and renewal terms?"'
              value={s.toolOptions.qaQuestion}
              onChange={(e) => s.setToolOptions({ qaQuestion: e.target.value })}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
            />
          </div>
          {isPdf && firstBatchFile && (
            <PDFPageGrid file={firstBatchFile} selectable={false} />
          )}
        </div>
      )}

      {tool.id === 'pdf-summary' && (
        <div className="space-y-4 w-full max-w-2xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-2">
              <label htmlFor="summary-length" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
                Summary Length
              </label>
              <select
                id="summary-length"
                value={s.toolOptions.summaryLength}
                onChange={(e) => s.setToolOptions({ summaryLength: e.target.value as any })}
                className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
              >
                <option value="short">Short (Quick bullet points)</option>
                <option value="medium">Medium (Executive summary)</option>
                <option value="detailed">Detailed (In-depth analysis)</option>
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="summary-focus" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
                Custom Focus (optional)
              </label>
              <input
                id="summary-focus"
                type="text"
                placeholder='e.g. "Financial risks & deadlines"'
                value={s.toolOptions.summaryFocus}
                onChange={(e) => s.setToolOptions({ summaryFocus: e.target.value })}
                className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
              />
            </div>
          </div>
          {isPdf && firstBatchFile && (
            <PDFPageGrid file={firstBatchFile} selectable={false} />
          )}
        </div>
      )}

      {tool.id === 'sanitize' && (
        <div className="space-y-4 w-full max-w-md mx-auto">
          <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
            <p className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">Sanitization Rules</p>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={s.toolOptions.sanitizeRemoveJs}
                onChange={(e) => s.setToolOptions({ sanitizeRemoveJs: e.target.checked })}
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Purge embedded JavaScript and auto-execution actions
              </span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={s.toolOptions.sanitizeRemoveAttachments}
                onChange={(e) => s.setToolOptions({ sanitizeRemoveAttachments: e.target.checked })}
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Strip document file attachments and embedded payloads
              </span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={s.toolOptions.sanitizeRemoveLinks}
                onChange={(e) => s.setToolOptions({ sanitizeRemoveLinks: e.target.checked })}
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Remove external hyperlinks and tracking web URIs
              </span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={s.toolOptions.sanitizeRemoveMetadata}
                onChange={(e) => s.setToolOptions({ sanitizeRemoveMetadata: e.target.checked })}
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Wipe hidden XML metadata and author history streams
              </span>
            </label>
          </div>
          {isPdf && firstBatchFile && (
            <PDFPageGrid file={firstBatchFile} selectable={false} />
          )}
        </div>
      )}

      {tool.id === 'extract-images' && (
        <div className="space-y-4 w-full max-w-2xl mx-auto">
          <div className="p-4 bg-teal-50 dark:bg-teal-950/40 rounded-2xl border border-teal-200 dark:border-teal-800 text-center">
            <p className="text-xs font-bold text-teal-800 dark:text-teal-200">
              Extracts all high-resolution figures, photos, and scanned page graphics into a downloadable ZIP package.
            </p>
          </div>
          {isPdf && firstBatchFile && (
            <PDFPageGrid file={firstBatchFile} selectable={false} />
          )}
        </div>
      )}

      {tool.id === 'n-up' && (
        <div className="space-y-4 w-full max-w-2xl mx-auto">
          <div className="space-y-2 max-w-md mx-auto">
            <label htmlFor="nup-layout" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
              Pages Per Physical Sheet
            </label>
            <select
              id="nup-layout"
              value={s.toolOptions.nUpGrid}
              onChange={(e) => s.setToolOptions({ nUpGrid: Number(e.target.value) as 2 | 4 | 9 })}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
            >
              <option value="2">2 Pages Per Sheet (2-in-1 Side-by-Side)</option>
              <option value="4">4 Pages Per Sheet (4-in-1 2x2 Grid)</option>
              <option value="9">9 Pages Per Sheet (9-in-1 3x3 Grid)</option>
            </select>
          </div>
          {isPdf && firstBatchFile && (
            <PDFPageGrid file={firstBatchFile} selectable={false} />
          )}
        </div>
      )}

      {tool.id === 'scan-effect' && (
        <div className="space-y-4 w-full max-w-2xl mx-auto">
          <div className="p-4 bg-amber-50 dark:bg-amber-950/40 rounded-2xl border border-amber-200 dark:border-amber-800 space-y-3 max-w-md mx-auto">
            <div className="space-y-1">
              <label htmlFor="scanner-contrast" className="block text-xs font-bold text-slate-700 dark:text-slate-200">
                Photocopy Toner Contrast
              </label>
              <input
                id="scanner-contrast"
                type="range"
                min="1.0"
                max="1.8"
                step="0.1"
                value={s.toolOptions.scannerContrast}
                onChange={(e) => s.setToolOptions({ scannerContrast: parseFloat(e.target.value) })}
                className="w-full"
              />
            </div>
            <label className="flex items-center gap-3 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={s.toolOptions.scannerTilt}
                onChange={(e) => s.setToolOptions({ scannerTilt: e.target.checked })}
                className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500"
              />
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Realistic scanner feed tilt &amp; micro-skew
              </span>
            </label>
          </div>
          {isPdf && firstBatchFile && (
            <PDFPageGrid file={firstBatchFile} selectable={false} />
          )}
        </div>
      )}

      {tool.id === 'invert-colors' && (
        <div className="space-y-4 w-full max-w-2xl mx-auto">
          <div className="p-4 bg-slate-900 text-white rounded-2xl border border-slate-700 text-center">
            <p className="text-xs font-bold">
              Inverts white backgrounds to black for high-contrast dark reading and reduced glare.
            </p>
          </div>
          {isPdf && firstBatchFile && (
            <PDFPageGrid file={firstBatchFile} selectable={false} />
          )}
        </div>
      )}

      {tool.id === 'auto-rotate' && (
        <div className="space-y-4 w-full max-w-2xl mx-auto">
          <div className="p-4 bg-cyan-50 dark:bg-cyan-950/40 rounded-2xl border border-cyan-200 dark:border-cyan-800 text-center">
            <p className="text-xs font-bold text-cyan-800 dark:text-cyan-200">
              Detects sideways/landscape orientations and standardizes pages to uniform portrait orientation.
            </p>
          </div>
          {isPdf && firstBatchFile && (
            <PDFPageGrid file={firstBatchFile} selectable={false} />
          )}
        </div>
      )}

      {tool.id === 'stamp' && (
        <div className="space-y-4 w-full max-w-md mx-auto">
          <div className="space-y-2">
            <label htmlFor="stamp-text" className="block text-sm font-bold text-slate-700 dark:text-slate-200">
              Stamp Badge Text
            </label>
            <input
              id="stamp-text"
              type="text"
              placeholder="e.g. APPROVED, CONFIDENTIAL, REJECTED, FINAL"
              value={s.toolOptions.stampText}
              onChange={(e) => s.setToolOptions({ stampText: e.target.value })}
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-surface dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-200 dark:text-white"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-200">
              Stamp Color
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['red', 'green', 'blue'] as const).map((col) => (
                <button
                  key={col}
                  type="button"
                  onClick={() => s.setToolOptions({ stampColor: col })}
                  className={`py-2 px-3 rounded-xl text-xs font-black uppercase border transition-all ${
                    s.toolOptions.stampColor === col
                      ? col === 'red'
                        ? 'bg-rose-50 border-rose-500 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                        : col === 'green'
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'bg-blue-50 border-blue-500 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                      : 'bg-surface dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {col}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-3 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={s.toolOptions.stampDate}
              onChange={(e) => s.setToolOptions({ stampDate: e.target.checked })}
              className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500"
            />
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              Include current date stamp on the badge
            </span>
          </label>
        </div>
      )}

      {tool.id === 'pdf-to-excel' && requiresReview && s.alignmentResult && (
        <TableAlignmentReview
          alignment={s.alignmentResult}
          sourceFile={sourceFile}
          canPassReview={!(s.extractionMetadata.reviewReasons as string[] | undefined)?.some((reason) => reason.includes('do not reconcile'))}
          onRecompute={(alignment, passed) => {
            const metadata = { ...s.extractionMetadata, alignment, requiresReview: !passed };
            s.setExtractionReview(mapAlignedRows(alignment), metadata, s.activeReviewFileId);
            s.setReviewConfirmed(passed);
          }}
          onConfirm={() => { void confirmReviewExport(); }}
        />
      )}

      {tool.id === 'pdf-to-excel' && requiresReview && !s.alignmentResult && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <p className="font-black">Review required before export</p>
          <p className="mt-1">{(s.extractionMetadata.reviewReasons as string[] | undefined)?.join(' ') || 'This extraction could not be validated automatically.'}</p>
          <button onClick={() => { void confirmReviewExport(); }} className="mt-3 px-4 py-2 rounded-lg bg-amber-600 text-white text-xs font-bold">Export with warning</button>
        </div>
      )}

      {tool.id === 'pdf-to-excel' && s.extractedTransactions.length > 0 && (
        <ExtractionReview
          transactions={s.extractedTransactions as any}
          isPremium={s.isPremium}
          exportAllowed={!requiresReview}
          onClearReview={s.clearExtractionReview}
          onSave={async (rows) => {
            // Final only when the recorded validation actually passed; otherwise this is
            // an unverified draft and the export is labelled and stamped as such.
            const validated = s.extractionMetadata.validationPassed !== false && !s.extractionMetadata.requiresReview;
            const meta = { ...s.extractionMetadata, exportMode: (validated ? 'final' : 'draft') as 'final' | 'draft' };
            const b = await getExcelBlob(rows as any, meta);
            if (b) await onDownloadBlob(b, `${validated ? '' : 'UNVERIFIED_DRAFT_'}Reviewed_${Date.now()}.xlsx`);
          }}
        />
      )}

      <div className="bg-surface rounded-[40px] border border-slate-100 shadow-2xl overflow-hidden">
        <div
          className={`p-10 lg:p-20 border-4 border-dashed m-4 rounded-[32px] flex flex-col items-center text-center transition-all duration-300 ${
            s.isDragging
              ? 'border-brand-400 bg-brand-50/40 scale-[1.01]'
              : 'border-slate-200 bg-slate-50/30 hover:bg-slate-50 hover:border-slate-300'
          }`}
          onDragOver={e => { e.preventDefault(); s.setIsDragging(true); }}
          onDragLeave={() => s.setIsDragging(false)}
          onDrop={e => {
            e.preventDefault();
            s.setIsDragging(false);
            if (!isTauriEnvironment()) void onFilesSelected(Array.from(e.dataTransfer.files));
          }}
        >
          <div className="w-16 h-16 bg-surface rounded-2xl shadow-lg flex items-center justify-center mb-6">
            <Plus className={`w-8 h-8 text-brand-500 ${s.isDragging ? 'animate-pulse' : ''}`} />
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button onClick={onSelectFiles} className="prism-gradient text-white font-black py-4 px-8 rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-200 flex items-center">
              <FileUp className="w-5 h-5 inline mr-2" />Select Files
            </button>
            {isNativePlatform() && (
              <button
                type="button"
                onClick={async () => {
                  const scannedFiles = await scanDocuments();
                  if (scannedFiles.length > 0) await onFilesSelected(scannedFiles);
                }}
                className="bg-slate-900 dark:bg-slate-800 text-white font-black py-4 px-6 rounded-2xl shadow-xl hover:bg-slate-800 transition-all duration-200 flex items-center border border-slate-700 active:scale-95"
              >
                <Camera className="w-5 h-5 inline mr-2 text-brand-400" />Scan Document
              </button>
            )}
          </div>
        </div>

        {s.batch.length > 0 && (
          <div className="p-6 space-y-6 border-t border-slate-50">
            <div className="flex items-center justify-between">
              <h4 className="font-black text-xs text-slate-400">Queue ({s.batch.length})</h4>
              <button onClick={clearBatchAndExtractionReview} className="text-xs font-black text-red-500">Clear</button>
            </div>
            {s.batch.map(i => (
              <div key={i.id} className={`flex flex-col p-4 rounded-2xl border ${i.status === ProcessStatus.ERROR ? 'border-red-200 bg-red-50/20' : 'border-slate-200/50'}`}>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black truncate">{i.fileName}</p>
                    <p className="text-[9px] text-slate-400">{(i.fileSize / 1024).toFixed(1)} KB</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {i.status === ProcessStatus.COMPLETED && i.resultBlob && (
                      <button onClick={() => onDownloadBlob(i.resultBlob!, i.fileName.replace(/\.[^/.]+$/, '') + '.pdf')} className="p-2 bg-brand-50 text-brand-600 rounded-lg">
                        <Download className="w-4 h-4" />
                      </button>
                    )}
                    {i.status === ProcessStatus.COMPLETED && <CheckCircle className="w-5 h-5 text-green-500" />}
                    {i.status === ProcessStatus.ERROR && <AlertCircle className="w-5 h-5 text-red-500" />}
                    {i.status === ProcessStatus.PROCESSING && <Loader2 className="w-5 h-5 text-brand-500 animate-spin" />}
                    <button disabled={s.isProcessing} onClick={() => s.removeItem(i.id)} className="text-slate-300 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {i.status === ProcessStatus.ERROR && i.error && (
                  <div className="mt-2 px-3 py-2 bg-red-50 border border-red-100 rounded-xl">
                    <p className="text-[11px] text-red-600 leading-relaxed">
                      {i.error.includes('compression') || i.error.includes('blank pages')
                        ? 'This PDF has unusual compression. We tried alternative methods but could not extract data. Try re-saving the PDF with Adobe Acrobat ("Save As") and upload again.'
                        : i.error.includes('password')
                        ? 'This PDF is password-protected. Please upload an unprotected version.'
                        : i.error.includes('Sign in required') || i.error.includes('sign in')
                        ? 'AI-powered extraction requires sign-in. Please sign in and try again.'
                        : i.error}
                    </p>
                  </div>
                )}
              </div>
            ))}
            <button onClick={onRun} disabled={s.isProcessing} className="w-full prism-gradient text-white font-black py-5 rounded-[32px] shadow-2xl disabled:opacity-50">
              {s.isProcessing ? (
                <><Loader2 className="w-6 h-6 inline mr-2 animate-spin" />Processing...</>
              ) : (
                <><Zap className="w-6 h-6 inline mr-2" />Start Operation</>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
