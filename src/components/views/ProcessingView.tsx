import React from 'react';
import { ArrowLeft, CheckCircle2, Plus, FileUp, Download, CheckCircle, AlertCircle, Loader2, Trash2, Zap } from '../ui/Icon';
import { ProcessStatus, type ToolID } from '../../types';
import { getToolById } from '../../registry/toolRegistry';
import { useAppStore } from '../../store/appStore';
import { isTauriEnvironment } from '../../providers/FileSystemProvider';
import ExtractionReview from '../ExtractionReview';
import TableAlignmentReview from '../TableAlignmentReview';
import type { ToolHandler } from '../../types';
import { getExcelBlob } from '../../../services/excelService';
import { getCachedFile } from '../../../services/fileCache';
import { alignmentToRows, type TableAlignmentResult } from '../../../services/spatialTableExtractor';

interface ProcessingViewProps {
  tool: ToolHandler;
  onBack: () => void;
  onSelectFiles: () => void;
  onDownloadBlob: (blob: Blob, name: string) => Promise<void>;
  onRun: () => void;
  renderToolIcon: (name: string, className?: string) => React.ReactNode;
  progress?: number;
}

export default function ProcessingView({
  tool,
  onBack,
  onSelectFiles,
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
    const blob = await getExcelBlob(s.extractedTransactions, { ...s.extractionMetadata, requiresReview: false });
    s.setReviewConfirmed(true);
    await onDownloadBlob(blob, `Reviewed_${Date.now()}.xlsx`);
  }

  function clearBatchAndExtractionReview() {
    s.clearBatch();
    s.clearExtractionReview();
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-3 text-slate-400 hover:text-indigo-600 font-black text-xs tracking-widest bg-white py-2.5 px-5 rounded-full border border-slate-100">
          <ArrowLeft className="w-4 h-4" />Back
        </button>
        <div className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-black">
          <CheckCircle2 className="w-3 h-3" />{tool.category}
        </div>
      </div>

      <div className="text-center">
        <div className={`w-20 h-20 lg:w-28 lg:h-28 ${tool.color} rounded-[32px] mx-auto shadow-2xl flex items-center justify-center text-white`}>
          {renderToolIcon(tool.icon, 'w-10 h-10 lg:w-12 lg:h-12')}
        </div>
        <h1 className="text-3xl lg:text-5xl font-black text-slate-900 mt-6">{tool.name}</h1>
      </div>

      {/* Tool-specific options */}
      {tool.id === 'protect' && (
        <div className="space-y-3 w-full max-w-md mx-auto">
          <label htmlFor="protect-password" className="block text-sm font-bold text-slate-700">
            Encryption Password
          </label>
          <input
            id="protect-password"
            type="password"
            placeholder="Enter a password to protect this PDF"
            value={s.toolOptions.password}
            onChange={(e) => s.setToolOptions({ password: e.target.value })}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-200"
          />
        </div>
      )}

      {tool.id === 'watermark' && (
        <div className="space-y-3 w-full max-w-md mx-auto">
          <label htmlFor="watermark-text" className="block text-sm font-bold text-slate-700">
            Watermark Text
          </label>
          <input
            id="watermark-text"
            type="text"
            placeholder="Enter watermark text"
            value={s.toolOptions.watermarkText}
            onChange={(e) => s.setToolOptions({ watermarkText: e.target.value })}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-200"
          />
        </div>
      )}

      {tool.id === 'rotate' && (
        <div className="space-y-3 w-full max-w-md mx-auto">
          <label htmlFor="rotation-angle" className="block text-sm font-bold text-slate-700">
            Rotation Angle
          </label>
          <select
            id="rotation-angle"
            value={s.toolOptions.rotationAngle}
            onChange={(e) => s.setToolOptions({ rotationAngle: e.target.value })}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-200"
          >
            <option value="90">90°</option>
            <option value="180">180°</option>
            <option value="270">270°</option>
          </select>
        </div>
      )}

      {tool.id === 'merge' && (
        <div className="space-y-3 w-full max-w-md mx-auto">
          <label htmlFor="merge-pages" className="block text-sm font-bold text-slate-700">
            Page Range (optional)
          </label>
          <input
            id="merge-pages"
            type="text"
            placeholder='e.g. "1-3,5" or leave empty for all pages'
            value={s.toolOptions.mergePages}
            onChange={(e) => s.setToolOptions({ mergePages: e.target.value })}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-200"
          />
        </div>
      )}

      {tool.id === 'split' && (
        <div className="space-y-3 w-full max-w-md mx-auto">
          <label htmlFor="split-pages" className="block text-sm font-bold text-slate-700">
            Split Pages
          </label>
          <input
            id="split-pages"
            type="text"
            placeholder='e.g. "1-3,4-6"'
            value={s.toolOptions.splitPages}
            onChange={(e) => s.setToolOptions({ splitPages: e.target.value })}
            className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-200"
          />
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
            const b = await getExcelBlob(rows as any);
            if (b) await onDownloadBlob(b, `Reviewed_${Date.now()}.xlsx`);
          }}
        />
      )}

      <div className="bg-white rounded-[40px] border border-slate-100 shadow-2xl overflow-hidden">
        <div
          className={`p-10 lg:p-20 border-4 border-dashed m-4 rounded-[32px] flex flex-col items-center text-center transition-all duration-300 ${
            s.isDragging
              ? 'border-indigo-400 bg-indigo-50/40 scale-[1.01]'
              : 'border-slate-200 bg-slate-50/30 hover:bg-slate-50 hover:border-slate-300'
          }`}
          onDragOver={e => { e.preventDefault(); s.setIsDragging(true); }}
          onDragLeave={() => s.setIsDragging(false)}
          onDrop={e => {
            e.preventDefault();
            s.setIsDragging(false);
            if (!isTauriEnvironment()) s.addFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <div className="w-16 h-16 bg-white rounded-2xl shadow-lg flex items-center justify-center mb-6">
            <Plus className={`w-8 h-8 text-indigo-500 ${s.isDragging ? 'animate-pulse' : ''}`} />
          </div>
          <button onClick={onSelectFiles} className="prism-gradient text-white font-black py-4 px-10 rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-200">
            <FileUp className="w-5 h-5 inline mr-2" />Select Files
          </button>
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
                      <button onClick={() => onDownloadBlob(i.resultBlob!, i.fileName.replace(/\.[^/.]+$/, '') + '.pdf')} className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                        <Download className="w-4 h-4" />
                      </button>
                    )}
                    {i.status === ProcessStatus.COMPLETED && <CheckCircle className="w-5 h-5 text-green-500" />}
                    {i.status === ProcessStatus.ERROR && <AlertCircle className="w-5 h-5 text-red-500" />}
                    {i.status === ProcessStatus.PROCESSING && <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />}
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
