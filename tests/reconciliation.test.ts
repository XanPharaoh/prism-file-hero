import { describe, it, expect } from 'vitest';
import { reconcileRows } from '../services/reconciliationService';

describe('Reconciliation Logic: Sovereignty & Kind Neutrality', () => {
    it('forces netChange to 0 for INFO rows even if description has numeric value', () => {
        const rows = [{ Description: 'VAT 123.45', Debits: '0', Credits: '0', Fees: '0', Balance: '100' }];
        const opening = '100';
        const result = reconcileRows(rows, opening, 'bank-statement');
        expect(result.rows[0].Amount).toBe(0); // Number
        expect(result.rows[0]._math_reconciled).toBe(true);
    });

    it('obeys explicit columns over Amount column', () => {
        const rows = [{ Description: 'Fee', Debits: '20', Credits: '0', Fees: '0', Amount: '999', Balance: '80' }];
        const opening = '100';
        const result = reconcileRows(rows, opening, 'bank-statement');
        expect(result.rows[0].Amount).toBe(-20); // Number
        expect(result.rows[0]._math_reconciled).toBe(true);
    });

    it('infers sign based on balance movement for unsigned amounts', () => {
        const rows = [
            { Date: '01/01', Description: 'Generic Fee', Amount: '20', Balance: '80' },
            { Date: '02/01', Description: 'Generic Credit', Amount: '50', Balance: '130' }
        ];
        const opening = '100';
        const result = reconcileRows(rows, opening, 'bank-statement');
        expect(result.rows[0].Amount).toBe(-20); // Number (balance went down)
        expect(result.rows[0]._math_reconciled).toBe(true);
        expect(result.rows[1].Amount).toBe(50); // Number (balance went up)
        expect(result.rows[1]._math_reconciled).toBe(true);
    });
});
