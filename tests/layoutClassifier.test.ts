import { describe, it, expect } from 'vitest';
import { classifyLayout } from '../services/layoutClassifier';

describe('layoutClassifier', () => {
  it('detects MONEY_IN_OUT_FEES from TymeBank headers', () => {
    const c = classifyLayout('Date Description Fees Money Out Money In Balance\n01 Nov 2025 ...');
    expect(c.profile).toBe('MONEY_IN_OUT_FEES');
    expect(c.confidence).toBeGreaterThanOrEqual(0.75);
  });
  it('detects DEBIT_CREDIT_BALANCE', () => {
    const c = classifyLayout('Date Description Debit Credit Balance\n2026/01/01 ...');
    expect(c.profile).toBe('DEBIT_CREDIT_BALANCE');
  });
  it('detects SINGLE_SIGNED_AMOUNT', () => {
    const c = classifyLayout('Date Description Amount Balance\n...');
    expect(c.profile).toBe('SINGLE_SIGNED_AMOUNT');
  });
  it('returns UNKNOWN for structureless text', () => {
    const c = classifyLayout('The quick brown fox jumps over the lazy dog.');
    expect(c.profile).toBe('UNKNOWN');
  });
});
