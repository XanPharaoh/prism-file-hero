import { describe, it, expect } from 'vitest';
import { applyReviewGate, type DocumentServiceResult } from '../services/documentService';

function baseResult(metadata: Partial<DocumentServiceResult['metadata']>): DocumentServiceResult {
    return {
        rows: [{ date: '2026-01-01', description: 'X', amount: -10, balance: 100 }],
        metadata: {
            rowCount: 1,
            pageCount: 1,
            confidence: 0.9,
            columnCount: 4,
            columns: ['date', 'description', 'amount', 'balance'],
            source: 'bank-statement',
            bankCode: 'ABSA',
            ...metadata,
        } as DocumentServiceResult['metadata'],
    };
}

describe('finance review gate (Batch 01)', () => {
    it('keeps a clean, reconciling bank statement export-ready (no review)', () => {
        const gated = applyReviewGate(baseResult({ documentType: 'bank-statement', reconciles: true }));
        expect(gated.metadata.requiresReview).toBe(false);
        expect(gated.metadata.reviewReasons ?? []).toHaveLength(0);
    });

    it('flags a non-reconciling bank statement and preserves the phrase ProcessingView disables pass-review', () => {
        const gated = applyReviewGate(
            baseResult({
                documentType: 'bank-statement',
                reconciles: false,
                ledgerHealth: { isValid: false },
            })
        );
        expect(gated.metadata.requiresReview).toBe(true);
        const reasons = gated.metadata.reviewReasons ?? [];
        expect(reasons.some(r => r.includes('do not reconcile'))).toBe(true);
    });

    it('flags low confidence, parser disagreement and raw-text fallback', () => {
        const lowConf = applyReviewGate(baseResult({ confidence: 0.4 }));
        expect(lowConf.metadata.requiresReview).toBe(true);

        const disagree = applyReviewGate(baseResult({ parserDisagreement: true }));
        expect((disagree.metadata.reviewReasons ?? []).some(r => /disagreed/i.test(r))).toBe(true);

        const rawText = applyReviewGate(baseResult({ source: 'raw-text-fallback', confidence: 0.15 }));
        expect((rawText.metadata.reviewReasons ?? []).some(r => /raw text/i.test(r))).toBe(true);
    });

    it('preserves review reasons already set by bank-specific extractors', () => {
        const preset = baseResult({ reviewReasons: ['FNB: currency column ambiguous'] });
        const gated = applyReviewGate(preset);
        expect(gated.metadata.reviewReasons).toContain('FNB: currency column ambiguous');
        expect(gated.metadata.requiresReview).toBe(true);
    });

    it('de-duplicates repeated reasons', () => {
        const dup = baseResult({
            source: 'raw-text-fallback',
            reviewReasons: ['No structured table was detected. Rows are raw text lines and must be reviewed before use.'],
        });
        const gated = applyReviewGate(dup);
        const asRawText = (gated.metadata.reviewReasons ?? []).filter(r => /raw text/i.test(r));
        expect(asRawText.length).toBe(1);
    });

    it('does not fabricate balances (no zero-fill): balances pass through untouched', () => {
        const gated = applyReviewGate(baseResult({ openingBalance: null, closingBalance: null }));
        expect(gated.rows[0]).toMatchObject({ balance: 100 });
        expect(gated.metadata.openingBalance ?? null).toBe(null);
    });
});
