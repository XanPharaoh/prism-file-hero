import React from 'react';
import { ArrowLeft, CheckCircle2, Plus, FileUp, Download, CheckCircle, AlertCircle, Loader2, Trash2, Zap } from '../ui/Icon';
import { ProcessStatus, type ToolID } from '../../../types';
import { getToolById } from '../../registry/toolRegistry';
import { useAppStore } from '../../store/appStore';
import { isTauriEnvironment } from '../../providers/FileSystemProvider';
import ExtractionReview from '../ExtractionReview';
import type { ToolHandler } from '../../types';
import { getExcelBlob } from '../../../services/excelService';

interface ProcessingViewProps {
  tool: ToolHandler;
  onBack: () => void;
  onSelectFiles: () => void;
  onDownloadBlob: (blob: Blob, name: string) => Promise<void>;
  onRun: () => void;
  renderToolIcon: (name: string, className?: string) => React.ReactNode;
}

export default function ProcessingView({
  tool,
  onBack,
  onSelectFiles,
  onDownloadBlob,
  onRun,
  renderToolIcon,
}: ProcessingViewProps) {
  const s = useAppStore();

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

      {tool.id === 'pdf-to-excel' && s.extractedTransactions.length > 0 && s.currentPdfUrl && (
        <ExtractionReview
          pdfUrl={s.currentPdfUrl}
          transactions={s.extractedTransactions as any}
          isPremium={s.isPremium}
          onSave={async (rows) => {
            const b = await getExcelBlob(rows as any);
            if (b) await onDownloadBlob(b, `Reviewed_${Date.now()}.xlsx`);
          }}
        />
      )}

      <div className="bg-white rounded-[40px] border border-slate-100 shadow-2xl overflow-hidden">
        <div
          className="p-10 lg:p-20 border-4 border-dashed m-4 rounded-[32px] flex flex-col items-center text-center bg-slate-50/30 hover:bg-slate-50"
          onDragOver={e => { e.preventDefault(); s.setIsDragging(true); }}
          onDragLeave={() => s.setIsDragging(false)}
          onDrop={e => {
            e.preventDefault();
            s.setIsDragging(false);
            if (!isTauriEnvironment()) s.addFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <div className="w-16 h-16 bg-white rounded-2xl shadow-lg flex items-center justify-center mb-6">
            <Plus className="w-8 h-8 text-indigo-500" />
          </div>
          <button onClick={onSelectFiles} className="bg-slate-900 text-white font-black py-4 px-10 rounded-2xl shadow-xl hover:bg-black">
            <FileUp className="w-5 h-5 inline mr-2" />Select Files
          </button>
        </div>

        {s.batch.length > 0 && (
          <div className="p-6 space-y-6 border-t border-slate-50">
            <div className="flex items-center justify-between">
              <h4 className="font-black text-xs text-slate-400">Queue ({s.batch.length})</h4>
              <button onClick={s.clearBatch} className="text-xs font-black text-red-500">Clear</button>
            </div>
            {s.batch.map(i => (
              <div key={i.id} className={`flex items-center p-4 rounded-2xl border ${i.status === ProcessStatus.ERROR ? 'border-red-200 bg-red-50/20' : 'border-slate-200/50'}`}>
                <div className="flex-1">
                  <p className="text-sm font-black truncate">{i.fileName}</p>
                  <p className="text-[9px] text-slate-400">{(i.fileSize / 1024).toFixed(1)} KB</p>
                </div>
                <div className="flex items-center gap-2">
                  {i.status === ProcessStatus.COMPLETED && i.resultBlob && (
                    <button onClick={() => onDownloadBlob(i.resultBlob!, i.fileName.replace(/\.[^/.]+$/, '') + '.pdf')} className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                      <Download className="w-4 h-4" />
                    </button>
                  )}
                  {i.status === ProcessStatus.COMPLETED && <CheckCircle className="w-5 h-5 text-green-500" />}
                  {i.status === ProcessStatus.ERROR && <AlertCircle className="w-5 h-5 text-red-500" />}
                  {i.status === ProcessStatus.PROCESSING && <Loader2 className="w-5 h-5 text-indigo-500" />}
                  <button disabled={s.isProcessing} onClick={() => s.removeItem(i.id)} className="text-slate-300 hover:text-red-500">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
            <button onClick={onRun} disabled={s.isProcessing} className="w-full prism-gradient text-white font-black py-5 rounded-[32px] shadow-2xl disabled:opacity-50">
              {s.isProcessing ? (
                <><Loader2 className="w-6 h-6 inline mr-2" />Processing...</>
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