import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import ExtractionReview from '../../src/components/ExtractionReview';
import { CanonicalTransaction } from '../../types';

vi.mock('../../services/excelService', () => ({ downloadAsExcel: vi.fn() }));

const sample: CanonicalTransaction[] = [
  { date: '2024-01-06', description: 'Salary', amount: 1000, balance: 5000, direction: 'CREDIT', bankCode: 'FNB_SA', confidence: 95 },
  { date: '2024-01-07', description: 'Groceries', amount: -200, balance: 4800, direction: 'DEBIT', bankCode: 'FNB_SA', confidence: 60 },
];

describe('ExtractionReview', () => {
  it('renders summary and rows, allows edit and export', async () => {
    render(<ExtractionReview transactions={sample} />);

    // Phase 2 UI: "2 Transactions" heading + "1 clean" summary
    expect(screen.getByText(/2 Transactions/)).toBeDefined();
    expect(screen.getByText(/1 clean/)).toBeDefined();

    // Click first row to open editor
    const firstRow = screen.getByText('Salary');
    fireEvent.click(firstRow);

    // Modal should appear
    expect(screen.getByRole('dialog')).toBeDefined();

    // Change description and save
    const descInput = screen.getByLabelText('Description') as HTMLInputElement;
    fireEvent.change(descInput, { target: { value: 'Updated Salary' } });
    const saveBtn = screen.getByText('Save Changes');
    fireEvent.click(saveBtn);

    // Updated row is present
    expect(await screen.findByText('Updated Salary')).toBeDefined();

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
    render(<ExtractionReview transactions={txWithBadBalance} />);

    // Should show mismatch count
    expect(screen.getByText(/mismatch/)).toBeDefined();
  });
});
