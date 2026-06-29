import { useState, useCallback } from 'react';
import type { CanonicalTransaction, TransactionEdit } from '../types';
import { verifyStatementMath, computeLocalMathOnly, type VerificationResult } from '../../services/hy3VerifyService';

interface UseExtractionVerificationReturn {
  editHistory: TransactionEdit[];
  selectedRows: Set<number>;
  isReviewing: boolean;
  isVerifying: boolean;
  verificationResult: VerificationResult | null;
  verificationError: string | null;
  toggleRowSelection: (index: number) => void;
  selectAllRows: () => void;
  deselectAllRows: () => void;
  editTransaction: (
    transactions: CanonicalTransaction[],
    index: number,
    field: keyof CanonicalTransaction,
    newValue: unknown
  ) => CanonicalTransaction[];
  removeSelectedTransactions: (
    transactions: CanonicalTransaction[],
    selectedRows: Set<number>
  ) => { transactions: CanonicalTransaction[]; selectedRows: Set<number> };
  setIsReviewing: (v: boolean) => void;
  runVerification: (
    transactions: CanonicalTransaction[],
    openingBalance: number,
    closingBalance: number
  ) => Promise<void>;
  resetVerification: () => void;
}

export function useExtractionVerification(): UseExtractionVerificationReturn {
  const [editHistory, setEditHistory] = useState<TransactionEdit[]>([]);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [isReviewing, setIsReviewing] = useState(false);
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(null);

  const toggleRowSelection = useCallback((index: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const selectAllRows = useCallback(() => {
    setIsReviewing(true);
  }, []);

  const deselectAllRows = useCallback(() => {
    setSelectedRows(new Set());
  }, []);

  const editTransaction = useCallback(
    (
      transactions: CanonicalTransaction[],
      index: number,
      field: keyof CanonicalTransaction,
      newValue: unknown
    ): CanonicalTransaction[] => {
      const oldValue = transactions[index]?.[field];
      const edit: TransactionEdit = {
        transactionId: index,
        field,
        oldValue,
        newValue,
        timestamp: Date.now(),
      };
      setEditHistory((prev) => [...prev, edit]);

      return transactions.map((tx, i) =>
        i === index ? { ...tx, [field]: newValue } : tx
      );
    },
    []
  );

  const removeSelectedTransactions = useCallback(
    (
      transactions: CanonicalTransaction[],
      selected: Set<number>
    ): { transactions: CanonicalTransaction[]; selectedRows: Set<number> } => {
      const filtered = transactions.filter((_, i) => !selected.has(i));
      return { transactions: filtered, selectedRows: new Set<number>() };
    },
    []
  );

  const runVerification = useCallback(async (
    transactions: CanonicalTransaction[],
    openingBalance: number,
    closingBalance: number
  ) => {
    setIsVerifying(true);
    setVerificationError(null);

    try {
      const payload = {
        rows: transactions.map(t => ({
          date: t.date,
          description: t.description,
          debit: t.direction === 'DEBIT' ? Math.abs(t.amount) : null,
          credit: t.direction === 'CREDIT' ? Math.abs(t.amount) : null,
          balance: t.balance ?? 0,
          charges: t.charges ?? 0,
        })),
        opening_balance: openingBalance,
        closing_balance: closingBalance,
      };

      const result = await verifyStatementMath(payload);
      setVerificationResult(result);
    } catch (err: any) {
      console.warn('[Hy3] Verification failed, proceeding with local math:', err);
      setVerificationError(err.message);

      const fallbackPayload = {
        rows: transactions.map(t => ({
          date: t.date,
          description: t.description,
          debit: t.direction === 'DEBIT' ? Math.abs(t.amount) : null,
          credit: t.direction === 'CREDIT' ? Math.abs(t.amount) : null,
          balance: t.balance ?? 0,
          charges: t.charges ?? 0,
        })),
        opening_balance: openingBalance,
        closing_balance: closingBalance,
      };
      setVerificationResult(computeLocalMathOnly(fallbackPayload));
    } finally {
      setIsVerifying(false);
    }
  }, []);

  const resetVerification = useCallback(() => {
    setVerificationResult(null);
    setVerificationError(null);
    setIsVerifying(false);
  }, []);

  return {
    editHistory,
    selectedRows,
    isReviewing,
    isVerifying,
    verificationResult,
    verificationError,
    toggleRowSelection,
    selectAllRows,
    deselectAllRows,
    editTransaction,
    removeSelectedTransactions,
    setIsReviewing,
    runVerification,
    resetVerification,
  };
}