import React from 'react';

export default function TransactionRow({ tx, reconError, onEdit }: { tx: any; reconError?: string; onEdit: () => void }) {
  const isHigh = tx.confidence > 90;
  const isMid = tx.confidence > 70;
  const hasReconError = !!reconError;
  const bgColor = hasReconError ? 'bg-rose-50/60' : isHigh ? '' : isMid ? 'bg-amber-50/50' : 'bg-red-50/50';
  const badgeColor = isHigh ? 'bg-emerald-100 text-emerald-700' : isMid ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  const amountColor = tx.amount >= 0 ? 'text-emerald-700' : 'text-slate-900';

  return (
    <tr className={`hover:bg-indigo-50/40 cursor-pointer transition-colors ${bgColor}`} onClick={onEdit} role="button">
      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{tx.date}</td>
      <td className="px-4 py-2.5 text-slate-800 max-w-[200px] truncate" title={tx.description}>{tx.description}</td>
      <td className={`px-4 py-2.5 text-right font-mono tabular-nums ${amountColor}`}>{typeof tx.amount === 'number' ? tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : tx.amount}</td>
      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          {tx.balance != null ? Number(tx.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
          {hasReconError && <span title={reconError} className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-rose-100 text-rose-600 text-[9px] font-black cursor-help flex-shrink-0">!</span>}
        </span>
      </td>
      <td className="px-4 py-2.5 text-center"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeColor}`}>{tx.confidence}%</span></td>
    </tr>
  );
}
