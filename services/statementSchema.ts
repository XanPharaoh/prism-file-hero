export interface CanonicalRow {
    [key: string]: any;
    'Tran list no'?: string;
    Date?: string;
    Description?: string;
    Fees?: string;
    Debits?: string;
    Credits?: string;
    Balance?: string;
}

const COLUMN_MAP: Record<string, string[]> = {
    'Tran list no': [
        'tranlistno', 'tran list no', 'transno', 'trans no', 'ref',
        'reference', 'transactionnumber', 'transaction no', 'trn'
    ],
    'Date': [
        'date', 'datum', 'transactiondate', 'transdate', 'trans date',
        'valuedate', 'value date', 'postingdate', 'posting date', 'bookingdate'
    ],
    'Description': [
        'description', 'beskrywing', 'narrative', 'details', 'detail',
        'particular', 'particulars', 'transaction', 'transactiondescription',
        'paymentdetails', 'payment details', 'information'
    ],
    'Fees': [
        'fees', 'fee', 'charges', 'charge', 'bankcharges', 'bankcharge',
        'feesr', 'fees r', 'chargesr', 'servicecharge', 'servicecharges',
        'service charge', 'service charges'
    ],
    'Debits': [
        'debits', 'debit', 'debiet', 'uit', 'withdrawal', 'withdrawals',
        'dr', 'debitsr', 'debits r', 'debitamount', 'debit amount',
        'moneyout', 'money out', 'paid', 'paidout', 'paid out'
    ],
    'Credits': [
        'credits', 'credit', 'krediet', 'in', 'deposit', 'deposits',
        'cr', 'creditsr', 'credits r', 'creditamount', 'credit amount',
        'moneyin', 'money in', 'received'
    ],
    'Balance': [
        'balance', 'saldo', 'bal', 'runningbalance', 'running balance',
        'balancer', 'balance r', 'closingbalance', 'closing balance',
        'availablebalance', 'available balance', 'ledgerbalance'
    ],
};

/**
 * Aggressively normalize a key: lowercase, strip parenthetical units like (R),
 * remove all non-alpha characters.
 */
function normalizeKey(key: string): string {
    return key
        .toLowerCase()
        .replace(/\(.*?\)/g, '')   // remove (R), (ZAR), etc.
        .replace(/[^a-z\s]/g, '')  // remove non-alpha except spaces
        .replace(/\s+/g, '')       // collapse spaces
        .trim();
}

function findCanonicalName(rawKey: string): string | null {
    const norm = normalizeKey(rawKey);
    if (!norm) return null;

    for (const [canonical, aliases] of Object.entries(COLUMN_MAP)) {
        for (const alias of aliases) {
            const normAlias = alias.replace(/[^a-z]/g, '');
            // Exact match or contains match
            if (norm === normAlias || norm.includes(normAlias) || normAlias.includes(norm)) {
                return canonical;
            }
        }
    }
    return null;
}

export function canonicalizeRows(rows: Record<string, any>[]): CanonicalRow[] {
    if (rows.length === 0) return [];

    const rawKeys = Object.keys(rows[0]);
    const mapping: Record<string, string> = {};
    const usedCanonicals = new Set<string>();

    // First pass: map raw keys to canonical names
    for (const rawKey of rawKeys) {
        const canonical = findCanonicalName(rawKey);
        if (canonical && !usedCanonicals.has(canonical)) {
            mapping[rawKey] = canonical;
            usedCanonicals.add(canonical);
        }
    }

    // Second pass: keep unmapped keys as-is
    for (const rawKey of rawKeys) {
        if (!mapping[rawKey]) {
            mapping[rawKey] = rawKey;
        }
    }

    return rows.map(row => {
        const canon: CanonicalRow = {};
        for (const [rawKey, value] of Object.entries(row)) {
            const mappedKey = mapping[rawKey] || rawKey;
            canon[mappedKey] = value;
        }
        return canon;
    });
}
