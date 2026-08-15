import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import ExtractionReview from '../../src/components/ExtractionReview';
import { CanonicalTransaction } from '../../types';

vi.mock('../../services/excelService', () => ({ downloadAsExcel: vi.fn() }));

const sample: CanonicalTransaction[] = [
  { date: '2024-01-06', description: 'Salary', amount: 1000, balance: 5000, charges: 10.5, direction: 'CREDIT', bankCode: 'FNB_SA', confidence: 95 },
  { date: '2024-01-07', description: 'Groceries', amount: -200, balance: 4800, direction: 'DEBIT', bankCode: 'FNB_SA', confidence: 60 },
];

describe('ExtractionReview', () => {
  it('renders summary and rows, allows edit and export', async () => {
    render(<ExtractionReview transactions={sample} onClearReview={() => {}} />);

    // Phase 2 UI: "2 Transactions" heading + "1 clean" summary
    expect(screen.getByText(/2 Transactions/)).toBeDefined();
    expect(screen.getByText(/1 clean/)).toBeDefined();
    expect(screen.getByText('Fees')).toBeDefined();
    expect(screen.getByText('10,50')).toBeDefined();

    // Click first row to open editor
    const firstRow = screen.getByText('Salary');
    fireEvent.click(firstRow);

    // Modal should appear
    expect(screen.getByRole('dialog')).toBeDefined();

    // Change description and save
    const descInput = screen.getByLabelText('Description') as HTMLInputElement;
    fireEvent.change(descInput, { target: { value: 'Updated Salary' } });
    fireEvent.change(screen.getByLabelText('Fees'), { target: { value: '12.75' } });
    const saveBtn = screen.getByText('Save Changes');
    fireEvent.click(saveBtn);

    // Updated row is present
    expect(await screen.findByText('Updated Salary')).toBeDefined();
    expect(screen.getByText('12,75')).toBeDefined();

    // Export should call downloadAsExcel
    const exportBtn = screen.getByText('Export Excel');
    fireEvent.click(exportBtn);
    const mod = await import('../../services/excelService');
    expect(mod.downloadAsExcel).toHaveBeenCalled();
  });

  it('shows reconciliation mismatch when balance is off', () => {
    const txWithBadBalance: CanonicalTransaction[] = [
      { date: '2024-01-06', description: 'Opening', amount: 0, balance: 1000, direction: 'CREDIT', bankCode: 'FNB_SA', confidence: 95 },
      { date: '2024-01-07', description: 'Payment', amount: -200, balance: 900, direction: 'DEBIT', bankCode: 'FNB_SA', confidence: 90 },
      // 900 + 500 = 1400, but balance says 1500 → mismatch
      { date: '2024-01-08', description: 'Deposit', amount: 500, balance: 1500, direction: 'CREDIT', bankCode: 'FNB_SA', confidence: 85 },
    ];
    render(<ExtractionReview transactions={txWithBadBalance} onClearReview={() => {}} />);

    // Should show mismatch count
    expect(screen.getByText(/mismatch/)).toBeDefined();
  });

  it('blocks editor export until the alignment review is resolved', () => {
    render(<ExtractionReview transactions={sample} exportAllowed={false} onClearReview={() => {}} />);
    expect((screen.getByText('Export Excel') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('replaces the review session and resets to the replacement document originals', async () => {
    const { rerender } = render(<ExtractionReview transactions={sample} onClearReview={() => {}} />);

    fireEvent.click(screen.getByText('Salary'));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Edited old document' } });
    fireEvent.click(screen.getByText('Save Changes'));
    expect(await screen.findByText('Edited old document')).toBeDefined();

    const replacement: CanonicalTransaction[] = [
      { date: '2024-02-01', description: 'Replacement row', amount: 250, balance: 250, direction: 'CREDIT', bankCode: 'FNB_SA', confidence: 99 },
    ];
    rerender(<ExtractionReview transactions={replacement} onClearReview={() => {}} />);

    expect(await screen.findByText('Replacement row')).toBeDefined();
    expect(screen.queryByText('Edited old document')).toBeNull();
    expect((screen.getByText('Undo') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText('Replacement row'));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Edited replacement' } });
    fireEvent.click(screen.getByText('Save Changes'));
    expect(await screen.findByText('Edited replacement')).toBeDefined();

    fireEvent.click(screen.getByText('Revert edits'));
    expect(await screen.findByText('Replacement row')).toBeDefined();
    expect(screen.queryByText('Edited replacement')).toBeNull();
  });

  it('clears the parent review when Reset is clicked', () => {
    const onClearReview = vi.fn();

    function ReviewHarness() {
      const [transactions, setTransactions] = useState(sample);
      return transactions.length > 0
        ? <ExtractionReview transactions={transactions} onClearReview={() => { onClearReview(); setTransactions([]); }} />
        : <p>Review cleared</p>;
    }

    render(<ReviewHarness />);
    fireEvent.click(screen.getByText('Reset'));

    expect(onClearReview).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Review cleared')).toBeDefined();
    expect(screen.queryByText('Salary')).toBeNull();
  });

  it('undoes and redoes an edit', async () => {
    render(<ExtractionReview transactions={sample} onClearReview={() => {}} />);

    fireEvent.click(screen.getByText('Salary'));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Undo target' } });
    fireEvent.click(screen.getByText('Save Changes'));
    expect(await screen.findByText('Undo target')).toBeDefined();

    fireEvent.click(screen.getByText('Undo'));
    expect(await screen.findByText('Salary')).toBeDefined();
    fireEvent.click(screen.getByText('Redo'));
    expect(await screen.findByText('Undo target')).toBeDefined();
  });

  it('undoes same-millisecond edits on different transactions independently', async () => {
    const threeTx: CanonicalTransaction[] = [
      { date: '2024-01-06', description: 'Alpha', amount: 100, balance: 1000, direction: 'CREDIT', bankCode: 'FNB_SA', confidence: 95 },
      { date: '2024-01-07', description: 'Beta', amount: -50, balance: 950, direction: 'DEBIT', bankCode: 'FNB_SA', confidence: 90 },
      { date: '2024-01-08', description: 'Gamma', amount: 200, balance: 1150, direction: 'CREDIT', bankCode: 'FNB_SA', confidence: 85 },
    ];
    render(<ExtractionReview transactions={threeTx} onClearReview={() => {}} />);

    // Edit first transaction
    fireEvent.click(screen.getByText('Alpha'));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Alpha Edited' } });
    fireEvent.click(screen.getByText('Save Changes'));
    expect(await screen.findByText('Alpha Edited')).toBeDefined();

    // Edit second transaction (same test run, could be same ms in fast CI)
    fireEvent.click(screen.getByText('Beta'));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Beta Edited' } });
    fireEvent.click(screen.getByText('Save Changes'));
    expect(await screen.findByText('Beta Edited')).toBeDefined();

    // Undo should revert only Beta Edited → Beta
    fireEvent.click(screen.getByText('Undo'));
    expect(await screen.findByText('Beta')).toBeDefined();
    expect(screen.getByText('Alpha Edited')).toBeDefined(); // Alpha still edited

    // Undo again should revert Alpha Edited → Alpha
    fireEvent.click(screen.getByText('Undo'));
    expect(await screen.findByText('Alpha')).toBeDefined();
    expect(screen.getByText('Beta')).toBeDefined();

    // Redo should re-apply Alpha Edited
    fireEvent.click(screen.getByText('Redo'));
    expect(await screen.findByText('Alpha Edited')).toBeDefined();
    expect(screen.getByText('Beta')).toBeDefined(); // Beta still original

    // Redo again should re-apply Beta Edited
    fireEvent.click(screen.getByText('Redo'));
    expect(await screen.findByText('Beta Edited')).toBeDefined();
    expect(screen.getByText('Alpha Edited')).toBeDefined();
  });
});
