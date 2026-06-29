export enum TransactionKind {
    OPENING = 'OPENING',
    CLOSING = 'CLOSING',
    CREDIT = 'CREDIT',
    DEBIT = 'DEBIT',
    FEE = 'FEE',
    INFO = 'INFO'
}

function parseLoose(x: any): number {
    if (typeof x === 'number') return x;
    if (!x) return 0;
    const n = parseFloat(String(x).replace(/[R$£€\s,]/g, '').replace(/\*/g, ''));
    return Number.isFinite(n) ? Math.abs(n) : 0;
}

export function classifyRow(row: Record<string, any>): TransactionKind {
    const desc = String(row.Description || '').toLowerCase().trim();

    // Opening / closing detection
    if (desc.includes('opening balance') || desc.includes('beginsaldo') || desc === 'opening') {
        return TransactionKind.OPENING;
    }
    if (desc.includes('closing balance') || desc.includes('eindsaldo') || desc === 'closing') {
        return TransactionKind.CLOSING;
    }

    // Check for actual monetary movement in any column
    const hasDebit = parseLoose(row.Debits) > 0;
    const hasCredit = parseLoose(row.Credits) > 0;
    const hasFee = parseLoose(row.Fees) > 0;

    // Standard classification by column presence
    if (hasCredit) return TransactionKind.CREDIT;
    if (hasDebit) return TransactionKind.DEBIT;
    if (hasFee) return TransactionKind.FEE;

    // VAT/info lines: only classify as INFO if there's genuinely no money movement
    // A VAT line that has 0.00 in credits and nothing in debits/fees is informational
    if (
        (desc.startsWith('vat ') || desc.match(/^vat\b/) || desc.includes('info')) &&
        !hasDebit && !hasFee && !hasCredit
    ) {
        return TransactionKind.INFO;
    }

    // Fallback: check Amount column if present
    const amount = parseLoose(row.Amount);
    if (amount > 0) {
        // Inspect description for hints
        if (desc.includes('deposit') || desc.includes('payment received') || desc.includes('transfer in')) {
            return TransactionKind.CREDIT;
        }
        return TransactionKind.DEBIT;
    }

    return TransactionKind.INFO;
}
