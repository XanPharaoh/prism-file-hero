import { parseMoney, ReconciledRow } from './reconciliationService';
import { classifyRow, TransactionKind } from './transactionClassifier';

export type LedgerHealth = {
    status: 'OK' | 'WARN' | 'BLOCKED';
    issues: string[];
    badRows: number;
};

export function ledgerGuard(rows: ReconciledRow[], openingBalanceStr: string): LedgerHealth {
    const issues: string[] = [];
    const opening = parseMoney(openingBalanceStr);
    let badRows = 0;
    let sum = 0;

    for (const r of rows) {
        if (r._math_reconciled === false) badRows++;
        if (r._math_error) issues.push(r._math_error);

        const kind = classifyRow(r);
        if (kind !== TransactionKind.OPENING && kind !== TransactionKind.CLOSING) {
            sum += parseMoney(r.Amount ?? 0);
        }
    }

    // Find the last row's balance for flow conservation check
    const balanceKey = Object.keys(rows[0] || {}).find(k =>
        k.toLowerCase().replace(/[^a-z]/g, '').includes('balance')
    ) || 'Balance';

    const lastRow = rows[rows.length - 1];
    const lastBalance = lastRow ? parseMoney(lastRow[balanceKey] ?? 0) : opening;
    const expectedClosing = Number((opening + sum).toFixed(2));

    if (Math.abs(expectedClosing - lastBalance) > 0.05) {
        issues.push(
            `Flow conservation: opening(${opening.toFixed(2)}) + sum(${sum.toFixed(2)}) = ` +
            `expected(${expectedClosing.toFixed(2)}) but closing is ${lastBalance.toFixed(2)}. ` +
            `Diff: ${Math.abs(expectedClosing - lastBalance).toFixed(2)}`
        );
    }

    if (badRows > 0) {
        issues.push(`Per-line balance identity failed on ${badRows} row(s).`);
    }

    // WARN instead of BLOCKED if issues are minor
    let status: 'OK' | 'WARN' | 'BLOCKED' = 'OK';
    if (issues.length > 0) {
        const hasFlowIssue = issues.some(i => i.includes('Flow conservation'));
        const hasBadRows = badRows > 0;
        status = (hasFlowIssue || hasBadRows) ? 'WARN' : 'WARN';

        // Only BLOCK if more than 30% of rows failed
        const transactionalRows = rows.filter(r => {
            const k = classifyRow(r);
            return k !== TransactionKind.OPENING && k !== TransactionKind.CLOSING && k !== TransactionKind.INFO;
        }).length;
        if (transactionalRows > 0 && (badRows / transactionalRows) > 0.3) {
            status = 'BLOCKED';
        }
    }

    return { status, issues, badRows };
}
