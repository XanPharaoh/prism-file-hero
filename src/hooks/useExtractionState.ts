import { useState, useCallback, useEffect, useRef } from 'react';
import { CanonicalTransaction, TransactionEdit } from '../types';

interface UseExtractionStateReturn {
  transactions: CanonicalTransaction[];
  editHistory: TransactionEdit[];
  canUndo: boolean;
  canRedo: boolean;
  selectedRows: Set<number>;
  updateTransaction: (index: number, updates: Partial<CanonicalTransaction>) => void;
  undoEdit: () => void;
  redoEdit: () => void;
  resetToOriginal: () => void;
  toggleRowSelection: (index: number) => void;
  clearSelection: () => void;
  selectAll: () => void;
  getTransactionHistory: (index: number) => TransactionEdit[];
  exportTransactions: () => CanonicalTransaction[];
}

/**
 * Manages extraction state with undo/redo history tracking
 * Maintains audit trail of all user corrections
 */
export function useExtractionState(initialTransactions: CanonicalTransaction[]): UseExtractionStateReturn {
  const cloneTransactions = useCallback(
    (rows: CanonicalTransaction[]) => rows.map((transaction) => ({
      ...transaction,
      metadata: transaction.metadata ? { ...transaction.metadata } : undefined,
    })),
    []
  );
  const [transactions, setTransactions] = useState<CanonicalTransaction[]>(() => cloneTransactions(initialTransactions));
  const [editHistory, setEditHistory] = useState<TransactionEdit[]>([]);
  const [currentEditIndex, setCurrentEditIndex] = useState<number>(-1);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const sequenceCounter = useRef(0);
  const [originalTransactions, setOriginalTransactions] = useState<CanonicalTransaction[]>(() => cloneTransactions(initialTransactions));

  // A converted document replaces the review session rather than extending it.
  // Keep an independent snapshot so Reset can never restore rows from a prior file.
  useEffect(() => {
    const nextOriginalTransactions = cloneTransactions(initialTransactions);
    setTransactions(nextOriginalTransactions);
    setOriginalTransactions(cloneTransactions(initialTransactions));
    setEditHistory([]);
    setCurrentEditIndex(-1);
    setSelectedRows(new Set());
    sequenceCounter.current = 0;
  }, [initialTransactions, cloneTransactions]);

  const updateTransaction = useCallback(
    (index: number, updates: Partial<CanonicalTransaction>) => {
      setTransactions((prevTransactions) => {
        const newTransactions = [...prevTransactions];
        const oldTransaction = newTransactions[index];

        // Create edit record for each field changed
        const newEdits: TransactionEdit[] = [];
        const timestamp = Date.now();
        const seq = ++sequenceCounter.current;

        Object.entries(updates).forEach(([field, newValue]) => {
          const oldValue = (oldTransaction as any)[field];
          if (oldValue !== newValue) {
            newEdits.push({
              transactionId: index,
              field: field as keyof CanonicalTransaction,
              oldValue,
              newValue,
              timestamp,
              seq,
            });
          }
        });

        if (newEdits.length === 0) return prevTransactions;

        // Update the transaction
        newTransactions[index] = { ...oldTransaction, ...updates };

        // Add to history (removing any redo history)
        const newHistory = editHistory.slice(0, currentEditIndex + 1);
        newHistory.push(...newEdits);
        setEditHistory(newHistory);
        setCurrentEditIndex(newHistory.length - 1);

        return newTransactions;
      });
    },
    [editHistory, currentEditIndex]
  );

  const undoEdit = useCallback(() => {
    if (currentEditIndex < 0) return;

    // Get all edits at current level
    const currentLevel = editHistory[currentEditIndex];
    const levelEdits = editHistory.filter(
      (edit) => edit.timestamp === currentLevel.timestamp && edit.transactionId === currentLevel.transactionId
    );

    setTransactions((prevTransactions) => {
      const newTransactions = [...prevTransactions];

      levelEdits.forEach((edit) => {
        newTransactions[edit.transactionId] = {
          ...newTransactions[edit.transactionId],
          [edit.field]: edit.oldValue,
        };
      });

      return newTransactions;
    });

    // Move back — skip all edits with the same sequence number (same logical group)
    let newIndex = currentEditIndex - 1;
    while (newIndex >= 0) {
      if (editHistory[newIndex].seq !== currentLevel.seq) {
        break;
      }
      newIndex--;
    }
    setCurrentEditIndex(newIndex);
  }, [currentEditIndex, editHistory]);

  const redoEdit = useCallback(() => {
    if (currentEditIndex >= editHistory.length - 1) return;

    const nextIndex = currentEditIndex + 1;
    if (nextIndex >= editHistory.length) return;

    const nextLevel = editHistory[nextIndex];
    const levelEdits = editHistory.filter(
      (edit) => edit.timestamp === nextLevel.timestamp && edit.transactionId === nextLevel.transactionId
    );

    setTransactions((prevTransactions) => {
      const newTransactions = [...prevTransactions];

      levelEdits.forEach((edit) => {
        newTransactions[edit.transactionId] = {
          ...newTransactions[edit.transactionId],
          [edit.field]: edit.newValue,
        };
      });

      return newTransactions;
    });

    // Find the last edit with same sequence number (same logical group)
    let newIndex = nextIndex;
    while (newIndex < editHistory.length - 1 && editHistory[newIndex + 1].seq === nextLevel.seq) {
      newIndex++;
    }
    setCurrentEditIndex(newIndex);
  }, [currentEditIndex, editHistory]);

  const resetToOriginal = useCallback(() => {
    setTransactions(cloneTransactions(originalTransactions));
    setEditHistory([]);
    setCurrentEditIndex(-1);
    setSelectedRows(new Set());
  }, [cloneTransactions, originalTransactions]);

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

  const clearSelection = useCallback(() => {
    setSelectedRows(new Set());
  }, []);

  const selectAll = useCallback(() => {
    const all = new Set<number>();
    for (let i = 0; i < transactions.length; i++) {
      all.add(i);
    }
    setSelectedRows(all);
  }, [transactions.length]);

  const getTransactionHistory = useCallback(
    (index: number): TransactionEdit[] => {
      return editHistory.filter((edit) => edit.transactionId === index);
    },
    [editHistory]
  );

  const exportTransactions = useCallback((): CanonicalTransaction[] => {
    return transactions.map((transaction) => ({ ...transaction }));
  }, [transactions]);

  const canUndo = currentEditIndex >= 0;
  const canRedo = currentEditIndex < editHistory.length - 1;

  return {
    transactions,
    editHistory,
    canUndo,
    canRedo,
    selectedRows,
    updateTransaction,
    undoEdit,
    redoEdit,
    resetToOriginal,
    toggleRowSelection,
    clearSelection,
    selectAll,
    getTransactionHistory,
    exportTransactions,
  };
}
