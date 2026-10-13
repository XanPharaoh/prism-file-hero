import React, { useEffect, useMemo, useState } from 'react';
import TransactionRow from './TransactionRow';
import EditModal from './EditModal';
import { useExtractionState } from '../hooks/useExtractionState';
import { downloadAsExcel } from '../../services/excelService';
import { CanonicalTransaction } from '../types';
import { reconcileCanonical } from '../utils/reconcileCanonical';

type Props = {
  transactions: CanonicalTransaction[];
  isPremium?: boolean;
  onSave?: (rows: CanonicalTransaction[]) => void;
  exportAllowed?: boolean;
  onClearReview: () => void;
};

const PAGE_SIZE = 100;

export default function ExtractionReview({ transactions: initialTransactions, onSave, exportAllowed = true, onClearReview }: Props) {
  const { transactions, updateTransaction, resetToOriginal, undoEdit, redoEdit, canUndo, canRedo, exportTransactions } = useExtractionState(initialTransactions);
  const items = transactions.map((t, i) => ({ ...t, __id: i }));
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<any | null>(null);

  // Reset component-only state with the review session for a replacement document.
  useEffect(() => {
    setPage(0);
    setEditing(null);
  }, [initialTransactions]);

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
    const { __id, ...updates } = updated;
    updateTransaction(__id, updates);
    setEditing(null);

    // State updates are asynchronous, so save the edited row directly instead
    // of exporting the previous render's transaction list.
    if (onSave) {
      onSave(transactions.map((transaction, index) => index === __id ? { ...transaction, ...updates } : { ...transaction }));
    }
  }

  async function exportAll() {
    const data = exportTransactions();
    const recon = reconcileCanonical(data);
    // Derive the REAL validation state from the live reconciliation so an
    // unverified ledger can never be exported as a normal (implied-verified) file.
    const validationPassed = recon.errors.size === 0 && recon.checked > 0 && recon.passed === recon.checked;
    const metadata = {
      confidence: data.length > 0 ? data.reduce((s, t) => s + t.confidence, 0) / data.length / 100 : 0,
      rowCount: data.length,
      processingComplete: true,
      validationPassed,
      requiresReview: !validationPassed,
      reviewRequired: !validationPassed,
      exportMode: validationPassed ? 'final' : 'draft',
      reviewReasons: validationPassed ? [] : [
        ...(recon.errors.size > 0 ? [`${recon.errors.size} row(s) failed balance reconciliation.`] : []),
        ...(recon.checked === 0 ? ['No balances available to verify.'] : []),
      ],
      reconciliation: {
        checked: recon.checked,
        passed: recon.passed,
        mismatches: recon.errors.size,
        rate: recon.checked > 0 ? `${Math.round((recon.passed / recon.checked) * 100)}%` : 'N/A',
      },
    };
    await downloadAsExcel(data, validationPassed ? 'extraction.xlsx' : 'UNVERIFIED_DRAFT_extraction.xlsx', metadata);
  }

  const dataGrid = (
    <div className="w-full h-full flex flex-col bg-surface overflow-hidden">
      {/* Toolbar */}
      <div className="flex-none p-4 border-b border-slate-200 bg-surface">
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
            <button onClick={onClearReview} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold rounded-lg text-xs transition-all border border-slate-200">Reset</button>
            <button onClick={resetToOriginal} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold rounded-lg text-xs transition-all border border-slate-200">Revert edits</button>
            <div className="flex items-center bg-slate-100 rounded-lg border border-slate-200 overflow-hidden">
              <button onClick={undoEdit} disabled={!canUndo} className={`px-3 py-1.5 font-semibold text-xs transition-all border-r border-slate-200 ${canUndo ? 'hover:bg-surface text-slate-700' : 'text-slate-400 cursor-not-allowed'}`}>Undo</button>
              <button onClick={redoEdit} disabled={!canRedo} className={`px-3 py-1.5 font-semibold text-xs transition-all ${canRedo ? 'hover:bg-surface text-slate-700' : 'text-slate-400 cursor-not-allowed'}`}>Redo</button>
            </div>
            <button disabled={!exportAllowed} onClick={exportAll} className="px-4 py-1.5 bg-brand-50 hover:bg-brand-100 disabled:opacity-40 disabled:cursor-not-allowed text-brand-700 font-semibold rounded-lg text-xs transition-all border border-brand-200">Export Excel</button>
            <button disabled={!exportAllowed} onClick={() => onSave && onSave(exportTransactions())} className="px-4 py-1.5 bg-slate-900 hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-lg text-xs transition-all shadow-sm">Save</button>
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
              <th className="px-4 py-3 text-right text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">Fees</th>
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
      <div className="flex-none p-3 border-t border-slate-200 bg-surface flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-400">Page {page + 1} of {pageCount}</div>
        <div className="flex items-center gap-1">
          <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg font-semibold text-xs text-slate-600 hover:bg-slate-200 disabled:opacity-40 transition-all">Prev</button>
          <button onClick={() => setPage(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1} className="px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg font-semibold text-xs text-slate-600 hover:bg-slate-200 disabled:opacity-40 transition-all">Next</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full border border-slate-200 rounded-2xl overflow-hidden bg-surface shadow-lg">
      {/* Editable data grid */}
      {dataGrid}

      {/* Edit modal overlay */}
      {editing && (
        <EditModal transaction={editing} onSave={saveEdit} onCancel={() => setEditing(null)} />
      )}
    </div>
  );
}
