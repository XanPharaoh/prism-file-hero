import * as pdfjs from 'pdfjs-dist';

/**
 * Nedbank Bank Statement Extractor
 * 
 * Nedbank layout (from real PDFs, both English and Afrikaans):
 *   Tran list no | Date | Description | Fees/Debits (R) | Credits (R) | Balance (R)
 *   x~37          x~96   x~142         x~370-380          x~440-450     x~530-547
 * 
 * Key characteristics:
 * - Each transaction is on a SINGLE line with items at fixed x-positions
 * - Debits/fees in column at x~370-380, credits at x~440-450
 * - Fee amounts have * suffix (e.g., "15.60 *")
import * as pdfjs from 'pdfjs-dist';

/**
 * Nedbank Bank Statement Extractor
 * 
 * Nedbank layout (from real PDFs, both English and Afrikaans):
 *   Tran list no | Date | Description | Fees/Debits (R) | Credits (R) | Balance (R)
 *   x~37          x~96   x~142         x~370-380          x~440-450     x~530-547
 * 
 * Key characteristics:
 * - Each transaction is on a SINGLE line with items at fixed x-positions
 * - Debits/fees in column at x~370-380, credits at x~440-450
 * - Fee amounts have * suffix (e.g., "15.60 *")
 * - Balance can be negative (e.g., "-24.14")
 * - Opening: "Opening balance" / "Beginsaldo" with balance at x~542
 * - Closing: "Closing balance" / "Eindsaldo" with balance at x~532
 * - "Tran list no" (e.g., "000133") appears periodically
 */

export interface NedbankTransaction {
    Date: string;
    Description: string;
    Fee?: number | null;
    Debit?: number | null;
    Credit?: number | null;
    Amount: number | string;
    Balance: number | string;
    IsFee: boolean;
    Direction: 'DEBIT' | 'CREDIT' | 'FEE';
    _raw: string;
    _page: number;
}

const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;

function parseNedbankDate(str: string): string {
    const parts = str.split(/[\/\-]/);
    if (parts.length === 3 && parts[2].length === 4) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return str;
}

function parseNedbankMoney(str: string | null | undefined): number | null {
    if (!str) return null;
    const clean = str.replace(/[R\s,]/gi, '').replace(/\*/g, '').trim();
    if (!clean) return null;
    const num = Number(clean);
    return Number.isFinite(num) ? num : null;
}

const NOISE_PATTERNS = [
    /^see money differently/i,
    /^sien geld anders/i,
    /^we subscribe/i,
    /^ons onderskryf/i,
    /^nedbank/i,
    /^page \d/i,
    /^bladsy \d/i,
    /^total$/i,
    /^totale?$/i,
    /^other debits/i,
    /^ander debiete/i,
    /^other credits/i,
    /^ander krediete/i,
    /^total charges/i,
    /^totale koste/i,
    /^electronic/i,
    /^elektroniese/i,
    /^narrative description/i,
    /^beskrywing/i,
    /^item cost/i,
    /^itemkoste/i,
    /^vat \(/i,
    /^btw \(/i,
    /^total \(/i,
    /^service fees$/i,
    /^diensgelde$/i,
    /^other charges$/i,
    /^gelde vir/i,
    /charges for the period/i,
    /koste vir die tydperk/i,
    /bank charges/i,
    /bankkoste/i,
    /^cashflow$/i,
    /account summary/i,
    /account type/i,
    /statement date/i,
    /statement period/i,
    /statement frequency/i,
    /total pages/i,
    /envelope:/i,
    /client vat/i,
    /bank vat/i,
    /annual credit/i,
    /please examine/i,
    /no error is reported/i,
    /% of utilisation/i,
    /% of funds/i,
    /^R[\d,]+\.\d{2}$/,
    /^\d+$/,
    /^tran list no$/i,
    /^tran-lys-nr$/i,
    /^date$/i,
    /^datum$/i,
    /^description$/i,
    /^fees\s*\(r\)/i,
    /^geld\s*\(r\)/i,
    /^debits?\s*\(r\)/i,
    /^debiete\s*\(r\)/i,
    /^credits?\s*\(r\)/i,
    /^krediete\s*\(r\)/i,
    /^balance\s*\(r\)/i,
    /^saldo\s*\(r\)/i,
    /lost cards/i,
    /client care/i,
    /^135 rivonia/i,
    /^p o box/i,
    /vat inclusive/i,
    /vat calculated/i,
    /funds received/i,
    /funds used/i,
    /^tax invoice/i,
    /authorised financial/i,
    /gemagtigde finansi/i,
    /registered credit provider/i,
    /geregistreerde krediet/i,
    /ombudsman/i,
    /saswitch/i,
    /banksake$/i,
];

function isNoiseLine(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 2) return true;
    return NOISE_PATTERNS.some(p => p.test(trimmed));
}

export async function extractNedbankStatement(file: File): Promise<{
    transactions: NedbankTransaction[];
    openingBalance: string;
    closingBalance: string;
    metadata: {
        pageCount: number;
        rowCount: number;
        bankCode: 'NEDBANK_SA';
        bankName: string;
        openingBalance: number | null;
        closingBalance: number | null;
        reconciles: boolean;
        method: 'nedbank-multiline-extraction';
    };
}> {
    const bytes = await file.arrayBuffer();
    // @ts-ignore
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    const pageCount = Math.min(pdf.numPages, 50);

    const allTransactions: NedbankTransaction[] = [];
    let openingBalance = '';
    let closingBalance = '';

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        if (content.items.length === 0) continue;

        // Group items into lines by Y position (3px snap)
        const lineMap = new Map<number, Array<{ str: string; x: number }>>();
        for (const item of content.items as any[]) {
            const str = item.str?.trim();
            if (!str) continue;
            const y = Math.round(item.transform[5] / 3) * 3;
            if (!lineMap.has(y)) lineMap.set(y, []);
            lineMap.get(y)!.push({
                str,
                x: Math.round(item.transform[4]),
            });
        }

        // Sort lines top-to-bottom (higher Y = top in PDF coords)
        const sortedY = Array.from(lineMap.keys()).sort((a, b) => b - a);
        let foundDataZone = false;

        // Header-derived column boundaries (replaces hardcoded X thresholds)
        let colBounds: { date: number; desc: number; fee: number; debit: number; credit: number; balance: number } | null = null;

        for (const y of sortedY) {
            const lineItems = lineMap.get(y)!.sort((a, b) => a.x - b.x);
            const lineText = lineItems.map(it => it.str).join(' ').trim();

            // Skip noise
            if (isNoiseLine(lineText)) continue;

            // Detect the header row to start the data zone
            if (!foundDataZone) {
                const lower = lineText.toLowerCase();
                // English: "Tran list no Date Description Fees (R) Debits (R) Credits (R) Balance (R)"
                // Afrikaans: "Tran-lys-nr Datum Beskrywing Geld (R) Debiete (R) Krediete (R) Saldo (R)"
                if ((lower.includes('date') || lower.includes('datum')) &&
                    (lower.includes('description') || lower.includes('beskrywing')) &&
                    (lower.includes('balance') || lower.includes('saldo'))) {
                    foundDataZone = true;

                    // Discover column boundaries from header keyword X positions
                    const headerCols: { name: string; x: number }[] = [];
                    for (const item of lineItems) {
                        const t = item.str.trim().toLowerCase();
                        if (/^tran|^tran-lys/.test(t)) headerCols.push({ name: 'tranList', x: item.x });
                        if (/^date$|^datum$/.test(t)) headerCols.push({ name: 'date', x: item.x });
                        if (/description|beskrywing|narrative/.test(t)) headerCols.push({ name: 'desc', x: item.x });
                        if (/^fees?/.test(t) || /^geld/.test(t)) headerCols.push({ name: 'fee', x: item.x });
                        if (/debits?|debiete/.test(t)) headerCols.push({ name: 'debit', x: item.x });
                        if (/credits?|krediete/.test(t)) headerCols.push({ name: 'credit', x: item.x });
                        if (/balance|saldo/.test(t)) headerCols.push({ name: 'balance', x: item.x });
                    }
                    headerCols.sort((a, b) => a.x - b.x);

                    if (headerCols.length >= 4) {
                        const headerStarts = Object.fromEntries(headerCols.map(({ name, x }) => [name, x]));
                        colBounds = {
                            date: headerStarts.date ?? 90,
                            desc: headerStarts.desc ?? 140,
                            fee: headerStarts.fee ?? 290,
                            debit: headerStarts.debit ?? 360,
                            credit: headerStarts.credit ?? 430,
                            balance: headerStarts.balance ?? 510,
                        };
                    }

                    continue;
                }
                continue;
            }

            // Separate items into zones using header-derived boundaries
            const tBound = colBounds?.date ?? 90;
            const dBound = colBounds?.desc ?? 140;
            const descBound = colBounds?.fee ?? 290;
            const debitBound = colBounds?.debit ?? 360;
            const creditBound = colBounds?.credit ?? 430;
            const balanceBound = colBounds?.balance ?? 510;

            let date = '';
            let description = '';
            let feeAmount = '';
            let debitAmount = '';
            let creditAmount = '';
            let balance = '';
            let hasFeeMarker = false;

            for (const item of lineItems) {
                const str = item.str;
                if (item.x < tBound) {
                    if (/opening balance|beginsaldo|closing balance|eindsaldo/i.test(str)) {
                        description = str;
                    }
                } else if (item.x < dBound) {
                    // Date column
                    if (DATE_RE.test(str)) {
                        date = str;
                    }
                } else if (item.x < descBound) {
                    // Description column
                    description = description ? description + ' ' + str : str;
                } else if (item.x < debitBound) {
                    // Fees column (Geld R)
                    feeAmount = str.replace(/\s*\*\s*$/, '').trim();
                    if (str.includes('*')) hasFeeMarker = true;
                } else if (item.x < creditBound) {
                    // Debit column (Debiete R)
                    debitAmount = str.replace(/\s*\*\s*$/, '').trim();
                    if (str.includes('*')) hasFeeMarker = true;
                } else if (item.x < balanceBound) {
                    // Credits column (Krediete R)
                    creditAmount = str.trim();
                } else {
                    // Balance column (Saldo R)
                    balance = str.trim();
                }
            }

            // Handle opening balance
            if (/opening balance|beginsaldo/i.test(description)) {
                if (!openingBalance && balance) {
                    openingBalance = balance.replace(/[,\s]/g, '');
                }
                continue;
            }

            // Handle closing balance
            if (/closing balance|eindsaldo/i.test(description) || /closing balance|eindsaldo/i.test(lineText)) {
                if (balance) {
                    closingBalance = balance.replace(/[,\s]/g, '');
                }
                continue;
            }

            // Skip if no date (header, metadata, etc.)
            if (!date) continue;

            // Determine amount, debit/credit fields, and direction
            const parsedCredit = parseNedbankMoney(creditAmount);
            const parsedDebit = parseNedbankMoney(debitAmount);
            const parsedFee = parseNedbankMoney(feeAmount);
            const parsedBalance = parseNedbankMoney(balance);

            let amount = 0;
            let direction: 'DEBIT' | 'CREDIT' | 'FEE' = 'DEBIT';

            if (parsedCredit !== null && (parsedDebit === null || parsedCredit > 0)) {
                amount = parsedCredit;
                direction = 'CREDIT';
            } else if (parsedDebit !== null && parsedDebit > 0) {
                amount = -parsedDebit;
                direction = hasFeeMarker ? 'FEE' : 'DEBIT';
            } else if (parsedFee !== null && parsedFee > 0) {
                amount = -parsedFee;
                direction = 'FEE';
                hasFeeMarker = true;
            } else if (parsedCredit === 0) {
                amount = 0;
                direction = 'CREDIT';
            }

            const isoDate = parseNedbankDate(date);

            if (date && (creditAmount || debitAmount || feeAmount || balance)) {
                allTransactions.push({
                    Date: isoDate,
                    Description: description.trim(),
                    Fee: parsedFee,
                    Debit: parsedDebit ?? (direction === 'DEBIT' || direction === 'FEE' ? Math.abs(amount) : null),
                    Credit: parsedCredit ?? (direction === 'CREDIT' ? amount : null),
                    Amount: amount,
                    Balance: parsedBalance !== null ? parsedBalance : balance,
                    IsFee: hasFeeMarker || direction === 'FEE',
                    Direction: direction,
                    _raw: lineText,
                    _page: pageNum,
                });
            }
        }
    }

    const openNum = parseNedbankMoney(openingBalance);
    const closeNum = parseNedbankMoney(closingBalance);
    const totalCredits = allTransactions.reduce((acc, t) => acc + (typeof t.Credit === 'number' ? t.Credit : 0), 0);
    const totalDebits = allTransactions.reduce((acc, t) => acc + (typeof t.Debit === 'number' ? t.Debit : (typeof t.Fee === 'number' ? t.Fee : 0)), 0);
    const reconciles = openNum !== null && closeNum !== null
        ? Math.abs(openNum + totalCredits - totalDebits - closeNum) <= 0.05
        : true;

    return {
        transactions: allTransactions,
        openingBalance,
        closingBalance,
        metadata: {
            pageCount,
            rowCount: allTransactions.length,
            bankCode: 'NEDBANK_SA',
            bankName: 'Nedbank',
            openingBalance: openNum,
            closingBalance: closeNum,
            reconciles,
            method: 'nedbank-multiline-extraction',
        },
    };
}

/**
 * Convert Nedbank transactions to Excel-ready rows
 */
export function convertNedbankToExcelRows(transactions: NedbankTransaction[]): Record<string, any>[] {
    return transactions.map(tx => ({
        Date: tx.Date,
        Description: tx.Description,
        Fee: tx.Fee ?? null,
        Debit: tx.Debit ?? null,
        Credit: tx.Credit ?? null,
        Amount: tx.Amount,
        Balance: tx.Balance,
        'Bank Fee': tx.IsFee ? 'Yes' : '',
        Direction: tx.Direction,
    }));
}

/**
 * Detect if a PDF is a Nedbank bank statement
 */
export async function isNedbankStatement(file: File): Promise<boolean> {
    try {
        const bytes = await file.arrayBuffer();
        // @ts-ignore
        const pdf = await pdfjs.getDocument({ data: bytes }).promise;
        const page = await pdf.getPage(1);
        const content = await page.getTextContent();
        const text = content.items.map((i: any) => i.str).join(' ').toLowerCase();
        return text.includes('nedbank');
    } catch {
        return false;
    }
}
