import React, { useState } from 'react';

export default function EditModal({ transaction, onSave, onCancel }: { transaction: any; onSave: (t: any) => void; onCancel: () => void }) {
  const [date, setDate] = useState(transaction.date || '');
  const [description, setDescription] = useState(transaction.description || '');
  const [amount, setAmount] = useState(String(transaction.amount ?? ''));
  const [balance, setBalance] = useState(transaction.balance ?? '');
  const [charges, setCharges] = useState(transaction.charges ?? '');

  function handleSave() {
    const parsedAmount = Number(String(amount).replace(/[^0-9.-]/g, ''));
    onSave({
      ...transaction,
      date,
      description,
      amount: parsedAmount,
      balance: balance === '' ? undefined : Number(balance),
      charges: charges === '' ? undefined : Number(charges),
    });
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-11/12 max-w-lg border border-slate-200">
        <h3 className="text-lg font-bold text-slate-900 mb-4">Edit Transaction</h3>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Date
            <input value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" aria-label="Date" />
          </label>
          <label className="flex flex-col text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Amount
            <input value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 text-right font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" aria-label="Amount" />
          </label>
          <label className="flex flex-col text-xs font-semibold text-slate-500 uppercase tracking-wider col-span-2">
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" aria-label="Description" />
          </label>
          <label className="flex flex-col text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Balance
            <input value={String(balance ?? '')} onChange={(e) => setBalance(e.target.value)} className="mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 text-right font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" aria-label="Balance" />
          </label>
          <label className="flex flex-col text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Fees
            <input value={String(charges ?? '')} onChange={(e) => setCharges(e.target.value)} className="mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 text-right font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent" aria-label="Fees" />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-sm transition-all">Cancel</button>
          <button onClick={handleSave} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg text-sm transition-all shadow-sm">Save Changes</button>
        </div>
      </div>
    </div>
  );
}
