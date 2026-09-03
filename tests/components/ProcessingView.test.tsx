import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import ProcessingView from '../../src/components/views/ProcessingView';
import { useAppStore } from '../../src/store/appStore';

const transaction = {
  date: '2024-01-06',
  description: 'Salary',
  amount: 1000,
  balance: 5000,
  direction: 'CREDIT',
  bankCode: 'FNB_SA',
  confidence: 95,
};

const tool = {
  id: 'pdf-to-excel',
  name: 'PDF to Excel',
  category: 'Convert',
  color: 'bg-indigo-500',
  icon: 'FileText',
} as any;

function renderProcessingView() {
  return render(
    <ProcessingView
      tool={tool}
      onBack={() => {}}
      onSelectFiles={() => {}}
      onFilesSelected={async () => {}}
      onDownloadBlob={async () => {}}
      onRun={() => {}}
      renderToolIcon={() => null}
    />,
  );
}

afterEach(() => {
  act(() => {
    useAppStore.getState().clearBatch();
    useAppStore.getState().clearExtractionReview();
  });
});

describe('ProcessingView', () => {
  it('bottom Clear removes both the queue and displayed extraction review', () => {
    act(() => {
      useAppStore.setState({
        batch: [{ id: 'file-1', fileName: 'statement.pdf', fileSize: 1024, status: 'IDLE', progress: 0, data: null, error: null }],
        extractedTransactions: [transaction],
        extractionMetadata: { bankCode: 'FNB_SA' },
        activeReviewFileId: 'file-1',
        reviewConfirmed: true,
      });
    });

    renderProcessingView();
    expect(screen.getByText('1 Transactions')).toBeDefined();
    expect(screen.getByText('Queue (1)')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(useAppStore.getState().batch).toEqual([]);
    expect(useAppStore.getState().extractedTransactions).toEqual([]);
    expect(screen.queryByText('1 Transactions')).toBeNull();
    expect(screen.queryByText('Queue (1)')).toBeNull();
  });
});
