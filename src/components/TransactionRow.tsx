import React from 'react';

export default function TransactionRow({ tx, reconError, onEdit }: { tx: any; reconError?: string; onEdit: () => void }) {
  const confidence = typeof tx.confidence === 'number' ? tx.confidence : 95;
  const isHigh = confidence > 90;
  const isMid = confidence > 70;
  const hasReconError = !!reconError;
  const bgColor = hasReconError ? 'bg-rose-50/60' : isHigh ? '' : isMid ? 'bg-amber-50/50' : 'bg-red-50/50';
  const badgeColor = isHigh ? 'bg-emerald-100 text-emerald-700' : isMid ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';

  const dateVal = tx.date ?? tx.Date ?? tx['Post Date'] ?? '';
  const descVal = tx.description ?? tx.Description ?? '';
  const refVal = tx.reference ?? tx.Reference ?? '';
  const displayDesc = refVal && refVal !== descVal ? `${descVal} - ${refVal}` : descVal;

  let rawAmount = tx.amount ?? tx.Amount;
  if (rawAmount == null || rawAmount === '') {
    if (tx['Money In'] !== '' && tx['Money In'] != null) rawAmount = Number(tx['Money In']);
    else if (tx['Money Out'] !== '' && tx['Money Out'] != null) rawAmount = Number(tx['Money Out']);
    else if (tx.credit != null) rawAmount = Number(tx.credit);
    else if (tx.debit != null) rawAmount = -Number(tx.debit);
  }

  const chargesVal = tx.charges ?? tx.fees ?? tx.Fees ?? tx['Fees*'] ?? null;
  const balanceVal = tx.balance ?? tx.Balance ?? null;

  const numAmount = typeof rawAmount === 'number' ? rawAmount : (rawAmount ? Number(rawAmount) : null);
  const amountColor = numAmount !== null && numAmount >= 0 ? 'text-emerald-700' : 'text-slate-900';

  return (
    <tr className={`hover:bg-indigo-50/40 cursor-pointer transition-colors ${bgColor}`} onClick={onEdit} role="button">
      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{dateVal}</td>
      <td className="px-4 py-2.5 text-slate-800 max-w-[240px] truncate" title={displayDesc}>{displayDesc}</td>
      <td className={`px-4 py-2.5 text-right font-mono tabular-nums ${amountColor}`}>
        {numAmount !== null ? numAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (rawAmount ?? '')}
      </td>
      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600">
        {chargesVal != null && chargesVal !== '' ? Number(chargesVal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
      </td>
      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          {balanceVal != null && balanceVal !== '' ? Number(balanceVal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''}
          {hasReconError && <span title={reconError} className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-rose-100 text-rose-600 text-[9px] font-black cursor-help flex-shrink-0">!</span>}
        </span>
      </td>
      <td className="px-4 py-2.5 text-center"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeColor}`}>{confidence}%</span></td>
    </tr>
  );
}
