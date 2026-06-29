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
    Amount: string;
    Balance: string;
    IsFee: boolean;
    Direction: string;
    _raw: string;
    _page: number;
}

const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;

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
                    continue;
                }
                continue;
            }

            // Separate items into zones based on x-position
            // Tran list no (x<90), Date (90-140), Description (140-360),
            // Debit/Fees (360-430), Credits (430-520), Balance (520+)
            let date = '';
            let description = '';
            let debitAmount = '';
            let creditAmount = '';
            let balance = '';
            let hasFeeMarker = false;
            let isTranListNo = false;

            for (const item of lineItems) {
                const str = item.str;
                if (item.x < 90) {
                    // Tran list no or opening/closing balance text starting at left
                    if (/^\d{6}$/.test(str)) {
                        isTranListNo = true;
                        // Don't skip - this line still has transaction data
                    } else if (/opening balance|beginsaldo|closing balance|eindsaldo/i.test(str)) {
                        description = str;
                    }
                } else if (item.x < 140) {
                    // Date column
                    if (DATE_RE.test(str)) {
                        date = str;
                    }
                } else if (item.x < 360) {
                    // Description column
                    description = description ? description + ' ' + str : str;
                } else if (item.x < 430) {
                    // Debit/Fees column
                    debitAmount = str.replace(/\s*\*\s*$/, '').trim();
                    if (str.includes('*')) hasFeeMarker = true;
                } else if (item.x < 520) {
                    // Credits column
                    creditAmount = str.trim();
                } else {
                    // Balance column
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

            // Determine amount and direction
            let amount = '';
            let direction = '';
            if (creditAmount) {
                amount = creditAmount;
                direction = 'In';
            } else if (debitAmount) {
                amount = debitAmount;
                direction = 'Out';
            }

            if (date && (amount || balance)) {
                allTransactions.push({
                    Date: date,
                    Description: description,
                    Amount: direction === 'Out' ? '-' + amount : amount,
                    Balance: balance,
                    IsFee: hasFeeMarker,
                    Direction: direction,
                    _raw: lineText,
                    _page: pageNum,
                });
            }
        }
    }

    return {
        transactions: allTransactions,
        openingBalance,
        closingBalance,
        metadata: {
            pageCount,
            rowCount: allTransactions.length,
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
