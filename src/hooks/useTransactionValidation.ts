import { CanonicalTransaction } from '../types';

export function validateChronological(prevDateIso: string | undefined, dateIso: string): boolean {
  if (!prevDateIso) return true;
  try {
    const prev = new Date(prevDateIso);
    const cur = new Date(dateIso);
    return cur >= prev;
  } catch (e) {
    return false;
  }
}

export function validateBalance(prevBalance: number | undefined, amount: number, balance: number | undefined): boolean {
  if (prevBalance === undefined || balance === undefined) return true;
  const expected = Number((prevBalance - amount).toFixed(2));
  return Math.abs(expected - Number(balance)) < 0.01;
}

export function validateAmountFormat(amount: any): boolean {
  return typeof amount === 'number' && Number.isFinite(amount);
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

interface ValidationContext {
  previousTransaction?: CanonicalTransaction;
  allTransactions: CanonicalTransaction[];
  transactionIndex: number;
}

/**
 * Validates transaction data against business rules
 * - Date chronology (no backwards dates)
 * - Balance reconciliation (previous balance ± amount = current balance)
 * - Amount format validation (matches currency)
 * - Description requirements (non-empty, reasonable length)
 */
export function useTransactionValidation() {
  const validateDate = (date: string, context?: ValidationContext): ValidationResult => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // ISO 8601 format check
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push('Date must be in YYYY-MM-DD format');
      return { isValid: false, errors, warnings };
    }

    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      errors.push('Invalid date value');
      return { isValid: false, errors, warnings };
    }

    // Chronological check
    if (context?.previousTransaction) {
      const prevDate = new Date(context.previousTransaction.date);
      if (dateObj < prevDate) {
        errors.push(`Transaction date cannot be before previous transaction (${context.previousTransaction.date})`);
      }
    }

    // Check if date is far in future
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dateObj > today) {
      warnings.push('Transaction date is in the future');
    }

    return { isValid: errors.length === 0, errors, warnings };
  };

  const validateAmount = (amount: number, direction: 'DEBIT' | 'CREDIT'): ValidationResult => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if amount is a number
    if (typeof amount !== 'number' || isNaN(amount)) {
      errors.push('Amount must be a valid number');
      return { isValid: false, errors, warnings };
    }

    // Amount should never be zero
    if (amount === 0) {
      warnings.push('Zero amount transaction detected');
    }

    // Signed amount validation
    if (direction === 'DEBIT' && amount > 0) {
      errors.push('DEBIT transactions must have positive values');
    }
    if (direction === 'CREDIT' && amount < 0) {
      errors.push('CREDIT transactions must have negative values');
    }

    // Reasonable amount limit check (flagging as warning)
    if (Math.abs(amount) > 10_000_000) {
      warnings.push('Unusually large transaction amount');
    }

    // Decimal precision check (most currencies have 2 decimals)
    const decimalPlaces = (amount.toString().split('.')[1] || '').length;
    if (decimalPlaces > 2) {
      warnings.push('Amount has more than 2 decimal places');
    }

    return { isValid: errors.length === 0, errors, warnings };
  };

  const validateDescription = (description: string, bankCode: string): ValidationResult => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required field check
    if (!description || description.trim().length === 0) {
      errors.push('Description is required');
      return { isValid: false, errors, warnings };
    }

    // Bank-specific length limits
    const lengthLimits: Record<string, number> = {
      FNB_SA: 70,
      ABSA_ZA: 65,
      NEDBANK_ZA: 80,
      STANDARD_BANK_ZA: 70,
    };

    const limit = lengthLimits[bankCode] || 70;
    if (description.length > limit) {
      errors.push(`Description exceeds ${limit} character limit for ${bankCode} (${description.length} chars)`);
    }

    // Warning for very short descriptions
    if (description.trim().length < 3) {
      warnings.push('Description is very short');
    }

    // Check for suspicious patterns
    if (/^[A-Z0-9\s]*$/.test(description) && description.length > 10) {
      warnings.push('Description contains only uppercase and numbers');
    }

    return { isValid: errors.length === 0, errors, warnings };
  };

  const validateBalance = (
    currentBalance: number | undefined,
    previousBalance: number | undefined,
    amount: number
  ): ValidationResult => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // If no balance provided, skip validation
    if (currentBalance === undefined || currentBalance === null) {
      return { isValid: true, errors, warnings };
    }

    if (previousBalance === undefined || previousBalance === null) {
      return { isValid: true, errors, warnings };
    }

    // Check balance reconciliation: previous balance ± amount = current balance
    // Account for floating point precision errors
    const expectedBalance = previousBalance + amount;
    const tolerance = 0.01; // Allow 1 cent difference due to floating point math

    if (Math.abs(expectedBalance - currentBalance) > tolerance) {
      errors.push(
        `Balance reconciliation failed. Expected: ${expectedBalance.toFixed(2)}, Got: ${currentBalance.toFixed(2)}`
      );
    }

    return { isValid: errors.length === 0, errors, warnings };
  };

  const validateTransaction = (
    transaction: CanonicalTransaction,
    context?: ValidationContext
  ): ValidationResult => {
    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    // Date validation
    const dateResult = validateDate(transaction.date, context);
    allErrors.push(...dateResult.errors);
    allWarnings.push(...dateResult.warnings);

    // Amount validation
    const amountResult = validateAmount(transaction.amount ?? 0, (transaction.direction === 'UNKNOWN' ? 'DEBIT' : transaction.direction) as 'DEBIT' | 'CREDIT');

    allErrors.push(...amountResult.errors);
    allWarnings.push(...amountResult.warnings);

    // Description validation
    const descResult = validateDescription(transaction.description, transaction.bankCode);
    allErrors.push(...descResult.errors);
    allWarnings.push(...descResult.warnings);

    // Balance reconciliation validation
    if (context?.previousTransaction) {
      const balanceResult = validateBalance(
        transaction.balance,
        context.previousTransaction.balance,
        transaction.amount
      );
      allErrors.push(...balanceResult.errors);
      allWarnings.push(...balanceResult.warnings);
    }

    // Confidence score validation
    if (transaction.confidence < 0 || transaction.confidence > 100) {
      allErrors.push('Confidence score must be between 0 and 100');
    }

    return {
      isValid: allErrors.length === 0,
      errors: allErrors,
      warnings: allWarnings,
    };
  };

  return {
    validateDate,
    validateAmount,
    validateDescription,
    validateBalance,
    validateTransaction,
  };
}
