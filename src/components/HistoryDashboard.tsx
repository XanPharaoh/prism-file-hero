import React, { useEffect, useState, useCallback } from 'react';
import { Icon, ChevronLeft, History, FileText, TrendingUp, BarChart3, Clock, Loader2, FileSpreadsheet, Download, Eye, Trash2, X } from './ui/Icon';
import {
  ExtractionHistoryRecord,
  fetchExtractionHistory,
  deleteExtractionRecord,
} from '../../services/historyService';
import { downloadAsExcel } from '../../services/excelService';
import { reconcileCanonical } from '../utils/reconcileCanonical';

type Props = {
  onBack: () => void;
};

const PAGE_SIZE = 12;

export default function HistoryDashboard({ onBack }: Props) {
  const [records, setRecords] = useState<ExtractionHistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [selectedRecord, setSelectedRecord] = useState<ExtractionHistoryRecord | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    const data = await fetchExtractionHistory(100);
    setRecords(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const pageCount = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const pageRecords = records.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  async function handleDelete(id: string) {
    setDeleting(id);
    const success = await deleteExtractionRecord(id);
    if (success) {
      setRecords(prev => prev.filter(r => r.id !== id));
      if (selectedRecord?.id === id) setSelectedRecord(null);
    }
    setDeleting(null);
  }

  async function handleDownloadExcel(record: ExtractionHistoryRecord) {
    // Reuse the STORED validation state so a re-export keeps the same review
    // labeling as the original. If the record predates gate metadata, derive it
    // from a fresh reconciliation so an unverified ledger is still labelled a draft.
    const rows = record.extracted_data.rows;
    const storedMeta = record.extracted_data.metadata || {};
    const hasValidation =
      storedMeta.validationPassed !== undefined || storedMeta.requiresReview !== undefined;
    let meta: Record<string, any> = {
      confidence: record.confidence / 100,
      rowCount: rows.length,
      bankCode: record.bank_code,
      ...storedMeta,
    };
    if (!hasValidation) {
      const recon = reconcileCanonical(rows as any);
      const validationPassed = recon.errors.size === 0 && recon.checked > 0 && recon.passed === recon.checked;
      meta = {
        ...meta,
        processingComplete: true,
        validationPassed,
        requiresReview: !validationPassed,
        reviewRequired: !validationPassed,
        exportMode: validationPassed ? 'final' : 'draft',
        reviewReasons: validationPassed ? [] : ['Restored from history without recorded validation — re-verify before filing.'],
      };
    }
    const draftLabel = meta.exportMode === 'draft' || meta.requiresReview === true || meta.validationPassed === false;
    await downloadAsExcel(
      rows,
      record.filename.replace(/\.pdf$/i, '') + (draftLabel ? '_UNVERIFIED_DRAFT.xlsx' : '_Extracted.xlsx'),
      meta
    );
  }

  // Stats
  const totalExtractions = records.length;
  const avgConfidence = records.length > 0
    ? Math.round(records.reduce((sum, r) => sum + r.confidence, 0) / records.length)
    : 0;
  const bankBreakdown = records.reduce<Record<string, number>>((acc, r) => {
    const code = r.bank_code || 'OTHER';
    acc[code] = (acc[code] || 0) + 1;
    return acc;
  }, {});
  const topBank = Object.entries(bankBreakdown).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="relative">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex items-center gap-3 text-slate-400 hover:text-indigo-600 font-black text-xs tracking-widest uppercase transition-all bg-white py-2.5 px-5 rounded-full border border-slate-100 shadow-sm hover:shadow-md active:scale-95"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          <div className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-black uppercase tracking-widest border border-indigo-100">
            <History className="w-3 h-3" />
            Extraction History
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center">
              <FileText className="w-4 h-4 text-indigo-500" />
            </div>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Extractions</span>
          </div>
          <p className="text-2xl font-black text-slate-900">{totalExtractions}</p>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
            </div>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Avg Confidence</span>
          </div>
          <p className="text-2xl font-black text-slate-900">{avgConfidence}%</p>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-amber-500" />
            </div>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Top Bank</span>
          </div>
          <p className="text-2xl font-black text-slate-900">{topBank ? topBank[0] : '—'}</p>
        </div>
        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-xl bg-rose-50 flex items-center justify-center">
              <Clock className="w-4 h-4 text-rose-500" />
            </div>
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Latest</span>
          </div>
          <p className="text-sm font-black text-slate-900">
            {records.length > 0
              ? new Date(records[0].created_at).toLocaleDateString()
              : '—'}
          </p>
        </div>
      </div>

      {/* Main Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-indigo-500" />
        </div>
      ) : records.length === 0 ? (
        <div className="bg-white rounded-[32px] border border-slate-100 shadow-sm p-12 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <History className="w-8 h-8 text-slate-300" />
          </div>
          <h3 className="text-lg font-black text-slate-900 mb-2">No Extractions Yet</h3>
          <p className="text-sm text-slate-500 font-medium">Your extraction history will appear here once you process documents.</p>
        </div>
      ) : (
        <div className="flex gap-6">
          {/* Records List */}
          <div className={`flex-1 space-y-3 ${selectedRecord ? 'hidden lg:block lg:w-1/2' : ''}`}>
            {pageRecords.map((record) => (
              <div
                key={record.id}
                className={`bg-white rounded-2xl border p-5 transition-all cursor-pointer group ${
                  selectedRecord?.id === record.id
                    ? 'border-indigo-300 shadow-md ring-1 ring-indigo-100'
                    : 'border-slate-100 shadow-sm hover:border-indigo-200 hover:shadow-md'
                }`}
                onClick={() => setSelectedRecord(record)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
                      <FileSpreadsheet className="w-5 h-5 text-indigo-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-900 truncate">{record.filename}</p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          {record.extracted_data.rows.length} rows
                        </span>
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${
                          record.confidence >= 80 ? 'text-emerald-500' :
                          record.confidence >= 50 ? 'text-amber-500' : 'text-red-500'
                        }`}>
                          {record.confidence}% conf.
                        </span>
                        {record.bank_code && record.bank_code !== 'UNKNOWN' && (
                          <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">
                            {record.bank_code}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1">
                        {new Date(record.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleDownloadExcel(record); }}
                      className="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-600 hover:text-white transition-all"
                      title="Download Excel"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedRecord(record); }}
                      className="p-2 bg-slate-50 text-slate-600 rounded-lg hover:bg-slate-100 transition-all"
                      title="View Details"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); void handleDelete(record.id); }}
                      disabled={deleting === record.id}
                      className="p-2 bg-red-50 text-red-500 rounded-lg hover:bg-red-500 hover:text-white transition-all disabled:opacity-30"
                      title="Delete"
                    >
                      {deleting === record.id ? (
                        <Loader2 className="w-3.5 h-3.5" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {/* Pagination */}
            {pageCount > 1 && (
              <div className="flex items-center justify-between pt-4">
                <span className="text-xs font-semibold text-slate-400">
                  Page {page + 1} of {pageCount}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg font-semibold text-xs text-slate-600 hover:bg-slate-200 disabled:opacity-40 transition-all"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() => setPage(Math.min(pageCount - 1, page + 1))}
                    disabled={page >= pageCount - 1}
                    className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg font-semibold text-xs text-slate-600 hover:bg-slate-200 disabled:opacity-40 transition-all"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Detail Panel */}
          {selectedRecord && (
            <div className="lg:w-1/2 bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden sticky top-24 h-fit max-h-[70vh] flex flex-col">
              <div className="flex items-center justify-between p-5 border-b border-slate-100">
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-900 truncate">{selectedRecord.filename}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{new Date(selectedRecord.created_at).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => void handleDownloadExcel(selectedRecord)}
                    className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded-lg text-xs transition-all border border-indigo-200"
                  >
                    <Download className="w-3.5 h-3.5 inline mr-1" />
                    Excel
                  </button>
                  <button
                    onClick={() => setSelectedRecord(null)}
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-all"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-auto">
                {selectedRecord.extracted_data.rows.length > 0 ? (
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 sticky top-0 z-10">
                      <tr>
                        {Object.keys(selectedRecord.extracted_data.rows[0]).slice(0, 6).map((col) => (
                          <th
                            key={col}
                            className="px-4 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedRecord.extracted_data.rows.slice(0, 100).map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50">
                          {Object.keys(row).slice(0, 6).map((col) => (
                            <td key={col} className="px-4 py-2.5 text-xs font-medium text-slate-700 max-w-[200px] truncate">
                              {String(row[col] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-8 text-center text-slate-400 text-sm">
                    No rows in this extraction
                  </div>
                )}
              </div>

              {selectedRecord.extracted_data.rows.length > 100 && (
                <div className="p-3 border-t border-slate-100 text-center">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Showing 100 of {selectedRecord.extracted_data.rows.length} rows — Download Excel for full data
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}