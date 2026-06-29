import React, { useMemo, useState } from 'react';
import TransactionRow from './TransactionRow';
import EditModal from './EditModal';
import PdfViewer from './PdfViewer';
import { useExtractionState } from '../hooks/useExtractionState';
import { downloadAsExcel } from '../../services/excelService';
import { CanonicalTransaction } from '../../types';
import { reconcileCanonical, ReconciliationResult } from '../utils/reconcileCanonical';
import { AlertTriangle, Zap } from './ui/Icon';
import { analytics } from '../services/analyticsService';

type Props = {
  transactions: CanonicalTransaction[];
  pdfUrl?: string;
  isPremium?: boolean;
  onSave?: (rows: CanonicalTransaction[]) => void;
};

const PAGE_SIZE = 100;

export default function ExtractionReview({ transactions: initialTransactions, pdfUrl, isPremium = false, onSave }: Props) {
  const { transactions, updateTransaction, resetToOriginal, undoEdit, redoEdit, canUndo, canRedo, exportTransactions } = useExtractionState(initialTransactions);
  const items = transactions.map((t, i) => ({ ...t, __id: i }));
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<any | null>(null);

  const reconciliation = useMemo(() => reconcileCanonical(transactions), [transactions]);

  const summary = useMemo(() => {
    const total = items.length;
    const high = items.filter((t) => t.confidence > 90).length;
    const need = total - high;
    const reconErrors = reconciliation.errors.size;
    return { total, high, need, reconErrors };
  }, [items, reconciliation]);

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const pageItems = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function openEditor(tx: any) {
    setEditing(tx);
  }

  function saveEdit(updated: any) {
    updateTransaction(updated.__id, updated);
    setEditing(null);
    if (onSave) onSave(exportTransactions());
  }

  async function exportAll() {
    const data = exportTransactions();
    const recon = reconcileCanonical(data);
    const metadata = {
      confidence: data.length > 0 ? data.reduce((s, t) => s + t.confidence, 0) / data.length / 100 : 0,
      rowCount: data.length,
      reconciliation: {
        checked: recon.checked,
        passed: recon.passed,
        mismatches: recon.errors.size,
        rate: recon.checked > 0 ? `${Math.round((recon.passed / recon.checked) * 100)}%` : 'N/A',
      },
    };
    await downloadAsExcel(data, 'extraction.xlsx', metadata);
  }

  const dataGrid = (
    <div className={`w-full ${pdfUrl ? 'lg:w-1/2' : ''} h-full flex flex-col bg-white overflow-hidden`}>
      {/* Toolbar */}
      <div className="flex-none p-4 border-b border-slate-200 bg-white">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight">{summary.total} Transactions</h2>
            <div className="text-xs font-semibold text-slate-500 mt-1 flex items-center gap-3">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> {summary.high} clean</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> {summary.need} to review</span>
              {summary.reconErrors > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500" /> {summary.reconErrors} balance {summary.reconErrors === 1 ? 'mismatch' : 'mismatches'}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <button onClick={resetToOriginal} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold rounded-lg text-xs transition-all border border-slate-200">Reset</button>
            <div className="flex items-center bg-slate-100 rounded-lg border border-slate-200 overflow-hidden">
              <button onClick={undoEdit} disabled={!canUndo} className={`px-3 py-1.5 font-semibold text-xs transition-all border-r border-slate-200 ${canUndo ? 'hover:bg-white text-slate-700' : 'text-slate-400 cursor-not-allowed'}`}>Undo</button>
              <button onClick={redoEdit} disabled={!canRedo} className={`px-3 py-1.5 font-semibold text-xs transition-all ${canRedo ? 'hover:bg-white text-slate-700' : 'text-slate-400 cursor-not-allowed'}`}>Redo</button>
            </div>
            <button onClick={exportAll} className="px-4 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded-lg text-xs transition-all border border-indigo-200">Export Excel</button>
            <button onClick={() => onSave && onSave(exportTransactions())} className="px-4 py-1.5 bg-slate-900 hover:bg-black text-white font-bold rounded-lg text-xs transition-all shadow-sm">Save</button>
          </div>
        </div>
      </div>

      {/* Scrollable table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Date</th>
              <th className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">Description</th>
              <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Amount</th>
              <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Balance</th>
              <th className="px-4 py-3 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider w-16">Score</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pageItems.map((t: any, idx: number) => (
              <TransactionRow key={`${t.__id}-${idx}`} tx={t} reconError={reconciliation.errors.get(t.__id)} onEdit={() => openEditor(t)} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      <div className="flex-none p-3 border-t border-slate-200 bg-white flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-400">Page {page + 1} of {pageCount}</div>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg font-semibold text-xs text-slate-600 hover:bg-slate-200 disabled:opacity-40 transition-all">Prev</button>
          <button onClick={() => setPage(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1} className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg font-semibold text-xs text-slate-600 hover:bg-slate-200 disabled:opacity-40 transition-all">Next</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className={`flex flex-col lg:flex-row ${pdfUrl ? 'h-[80vh]' : ''} border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-lg`}>
      {/* Left pane: Native PDF viewer (only when pdfUrl provided) */}
      {pdfUrl && (
        <div className="w-full lg:w-1/2 h-[40vh] lg:h-full border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-100 flex flex-col">
          <div className="flex-none px-4 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-indigo-500" />
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-widest">Source PDF</span>
            </div>
            <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded">Native View</span>
          </div>
          <div className="flex-1">
            <PdfViewer url={pdfUrl} />
          </div>
        </div>
      )}

      {/* Right pane: Editable data grid */}
      {dataGrid}

      {/* Phase 3: Ledger Guard upsell overlay for free users */}
      {!isPremium && summary.reconErrors > 0 && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/80 backdrop-blur-sm rounded-2xl">
          <div className="max-w-md mx-auto p-8 text-center animate-in zoom-in-95 duration-500">
            <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-amber-600" />
            </div>
            <h3 className="text-lg font-black text-slate-900 mb-2">Ledger Guard Detected Issues</h3>
            <p className="text-sm text-slate-600 mb-3 font-medium">
              {summary.reconErrors} balance {summary.reconErrors === 1 ? 'mismatch' : 'mismatches'} detected. Ledger Guard can auto-reconcile and fix flow conservation failures.
            </p>
            <p className="text-xs text-slate-500 mb-6">
              Upgrade to Premium to auto-reconcile and fix flow conservation failures.
            </p>
            <button
              onClick={() => { analytics.trackUpgradeClicked('ledger_guard'); alert('Upgrade flow coming soon!'); }}
              className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-black transition-all active:scale-95 shadow-xl shadow-slate-900/20"
            >
              <Zap className="w-4 h-4 inline mr-2" />
              Upgrade to Premium
            </button>
            <button
              onClick={() => {/* dismiss - just navigate away or ignore */}}
              className="mt-3 block mx-auto text-[10px] font-bold text-slate-400 uppercase tracking-widest hover:text-slate-600 transition-colors"
            >
              Continue Without Reconciliation
            </button>
          </div>
        </div>
      )}

      {/* Edit modal overlay */}
      {editing && (
        <EditModal transaction={editing} onSave={saveEdit} onCancel={() => setEditing(null)} />
      )}
    </div>
  );
}