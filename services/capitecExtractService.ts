import * as pdfjs from 'pdfjs-dist';

/**
 * Capitec Bank Statement Extractor
 * 
 * Capitec layout (from real PDFs):
 *   Post Date | Trans. Date | Description | Reference | Fees | Amount | Balance
 * 
 * Key characteristics:
 * - PostDate+TransDate+Description often arrive as a SINGLE text item at x~38
 *   e.g. "02/01/26 02/01/26 Debit Order" — must be parsed with regex
 * - Reference is a separate item at x~210 (may wrap across 1-3 continuation lines)
 * - Fees at x~370-390, Amount at x~430-455, Balance at x~515-530
 * - "Balance brought forward" is the opening balance
 * - Fee Total / VAT lines at the bottom
 * - Amounts prefixed with + or - signs
 */

export interface CapitecTransaction {
    PostDate: string;
    TransDate: string;
    Description: string;
    Reference: string;
    Fees: string;
    Amount: string;
    Balance: string;
    _raw: string;
    _page: number;
}

// Date pattern: dd/mm/yy or dd/mm/yyyy
const DATE_RE = /\d{2}\/\d{2}\/\d{2,4}/;
const DATE_PREFIX_RE = /^(\d{2}\/\d{2}\/\d{2,4})\s+(\d{2}\/\d{2}\/\d{2,4})\s*(.*)/;
const SINGLE_DATE_PREFIX_RE = /^(\d{2}\/\d{2}\/\d{2,4})\s+(.*)/;

// Money pattern: optional +/-, digits with spaces, decimal
const MONEY_RE = /^[+-]?[\d\s]+\.\d{2}$/;

const NOISE_PATTERNS = [
    /^capitec bank/i,
    /^business account statement/i,
    /^account no/i,
    /^account type/i,
    /^branch/i,
    /^telephone/i,
    /^business reg/i,
    /^client vat/i,
    /^statement no/i,
    /^page:/i,
    /^fee total/i,
    /^vat @/i,
    /^vat total/i,
    /all fees charged/i,
    /prime lending rate/i,
    /statements are accepted/i,
    /banking client care/i,
    /capitec bank is an authorised/i,
    /vat reg/i,
    /neutron road/i,
    /interest rate @/i,
    /no limit.*rate/i,
    /overdraft/i,
    /stamp placeholder/i,
    /^date\s*$/i,
    /^post\s*$/i,
    /^trans\.\s*$/i,
    /^capitec bank$/i,
    /^\d{2}\/\d{2}\/\d{4}$/,  // standalone date at top (statement date)
    /^branch:\s/i,
    /^device:\s/i,
    /^tel:\s/i,
];

function isNoiseLine(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 3) return true;
    return NOISE_PATTERNS.some(p => p.test(trimmed));
}

function isMoney(str: string): boolean {
    return MONEY_RE.test(str.trim());
}

/**
 * Parse a combined "PostDate TransDate Description" string.
 * Returns { postDate, transDate, description } or null if no dates found.
 */
function parseDateDescLine(text: string): { postDate: string; transDate: string; description: string } | null {
    const trimmed = text.trim();
    // Try two dates first: "dd/mm/yy dd/mm/yy Description text"
    const m2 = DATE_PREFIX_RE.exec(trimmed);
    if (m2) {
        return { postDate: m2[1], transDate: m2[2], description: m2[3].trim() };
    }
    // Try single date: "dd/mm/yy Description text"
    const m1 = SINGLE_DATE_PREFIX_RE.exec(trimmed);
    if (m1) {
        return { postDate: m1[1], transDate: '', description: m1[2].trim() };
    }
    return null;
}

export async function extractCapitecStatement(file: File): Promise<{
    transactions: CapitecTransaction[];
    openingBalance: string;
    closingBalance: string;
    feeTotal: string;
    metadata: {
        pageCount: number;
        rowCount: number;
        method: 'capitec-position-extraction';
    };
}> {
    const bytes = await file.arrayBuffer();
    // @ts-ignore
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    const pageCount = Math.min(pdf.numPages, 50);

    const allTransactions: CapitecTransaction[] = [];
    let openingBalance = '';
    let closingBalance = '';
    let feeTotal = '';

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        if (content.items.length === 0) continue;

        // Group items into lines by Y position (3px snap)
        const lineMap = new Map<number, Array<{ str: string; x: number; width: number }>>();
        for (const item of content.items as any[]) {
            const str = item.str?.trim();
            if (!str) continue;
            const y = Math.round(item.transform[5] / 3) * 3;
            if (!lineMap.has(y)) lineMap.set(y, []);
            lineMap.get(y)!.push({
                str,
                x: Math.round(item.transform[4]),
                width: item.width || 0,
            });
        }

        // Sort lines top-to-bottom (higher Y = top of page in PDF coords)
        const sortedY = Array.from(lineMap.keys()).sort((a, b) => b - a);
        let foundDataZone = false;

        for (let i = 0; i < sortedY.length; i++) {
            const y = sortedY[i];
            const lineItems = lineMap.get(y)!.sort((a, b) => a.x - b.x);
            const lineText = lineItems.map(it => it.str).join(' ').trim();

            // Skip noise
            if (isNoiseLine(lineText)) continue;

            // Detect the header row to start the data zone
            if (!foundDataZone) {
                const lower = lineText.toLowerCase();
                if (lower.includes('post') && (lower.includes('description') || lower.includes('trans'))) {
                    foundDataZone = true;
                    continue;
                }
                // Split header: exact "Date" or "Date Date" after a "Post" line
                if (lower === 'date' || lower === 'date date') {
                    foundDataZone = true;
                    continue;
                }
                continue;
            }

            // Check for "Balance brought forward"
            if (/balance brought forward/i.test(lineText)) {
                // The balance value is the rightmost money-like item
                for (let j = lineItems.length - 1; j >= 0; j--) {
                    if (isMoney(lineItems[j].str)) {
                        openingBalance = lineItems[j].str.replace(/[+\s]/g, '');
                        break;
                    }
                }
                continue;
            }

            // Check for Fee Total / VAT lines
            if (/fee total/i.test(lineText)) {
                for (let j = lineItems.length - 1; j >= 0; j--) {
                    if (isMoney(lineItems[j].str)) {
                        feeTotal = lineItems[j].str.replace(/[+\-\s]/g, '');
                        break;
                    }
                }
                continue;
            }
            if (/vat\s*@/i.test(lineText) || /vat\s*total/i.test(lineText)) continue;
            if (/all fees charged/i.test(lineText)) continue;

            // --- Build a transaction row ---
            // Strategy: separate items by x-position into groups:
            //   Left zone (x < 200): may contain combined "PostDate TransDate Description"
            //   Reference zone (200 <= x < 370): Reference text
            //   Money zone (x >= 370): Fees, Amount, Balance (rightmost = Balance)
            
            const leftItems: string[] = [];
            const refItems: string[] = [];
            const moneyItems: Array<{ str: string; x: number }> = [];

            for (const item of lineItems) {
                if (item.x < 200) {
                    leftItems.push(item.str);
                } else if (item.x < 370) {
                    refItems.push(item.str);
                } else {
                    moneyItems.push({ str: item.str, x: item.x });
                }
            }

            const leftText = leftItems.join(' ').trim();
            const refText = refItems.join(' ').trim();

            // Try to parse dates from left zone
            const parsed = parseDateDescLine(leftText);

            // Sort money items by x position, assign: rightmost=Balance, next=Amount, next=Fees
            moneyItems.sort((a, b) => b.x - a.x);  // rightmost first
            let balance = '';
            let amount = '';
            let fees = '';

            if (moneyItems.length >= 3) {
                balance = moneyItems[0].str.trim();
                amount = moneyItems[1].str.trim();
                fees = moneyItems[2].str.trim();
            } else if (moneyItems.length === 2) {
                balance = moneyItems[0].str.trim();
                amount = moneyItems[1].str.trim();
            } else if (moneyItems.length === 1) {
                // Single money item — could be balance or amount depending on x
                if (moneyItems[0].x >= 480) {
                    balance = moneyItems[0].str.trim();
                } else {
                    amount = moneyItems[0].str.trim();
                }
            }

            const row: CapitecTransaction = {
                PostDate: parsed?.postDate || '',
                TransDate: parsed?.transDate || '',
                Description: parsed?.description || (!parsed ? leftText : ''),
                Reference: refText,
                Fees: fees,
                Amount: amount,
                Balance: balance,
                _raw: lineText,
                _page: pageNum,
            };

            // Is this a transaction row (has at least one date)?
            const hasDate = !!parsed;
            const hasNumeric = row.Balance || row.Amount;

            if (hasDate && hasNumeric) {
                allTransactions.push(row);
            } else if (hasDate && !hasNumeric && row.Description) {
                // Date line with description but no amounts — still a valid transaction
                // (amounts might be on a continuation line, but that's rare for Capitec)
                allTransactions.push(row);
            } else if (!hasDate && allTransactions.length > 0) {
                // Continuation line — append Reference/Description to last transaction
                const last = allTransactions[allTransactions.length - 1];
                if (refText) {
                    last.Reference = (last.Reference + ' ' + refText).trim();
                }
                if (leftText && !isMoney(leftText)) {
                    // Only append text that isn't a money value
                    last.Reference = (last.Reference + ' ' + leftText).trim();
                }
            }
        }
    }

    // The closing balance is the balance of the last transaction
    if (allTransactions.length > 0) {
        closingBalance = allTransactions[allTransactions.length - 1].Balance.replace(/[+\s]/g, '');
    }

    return {
        transactions: allTransactions,
        openingBalance,
        closingBalance,
        feeTotal,
        metadata: {
            pageCount,
            rowCount: allTransactions.length,
            method: 'capitec-position-extraction',
        },
    };
}

/**
 * Convert Capitec transactions to Excel-ready rows
 */
export function convertCapitecToExcelRows(transactions: CapitecTransaction[]): Record<string, any>[] {
    return transactions.map(tx => ({
        'Post Date': tx.PostDate,
        'Trans Date': tx.TransDate,
        Description: tx.Description,
        Reference: tx.Reference,
        Fees: tx.Fees,
        Amount: tx.Amount,
        Balance: tx.Balance,
    }));
}

/**
 * Detect if a PDF is a Capitec bank statement by checking first-page text
 */
export async function isCapitecStatement(file: File): Promise<boolean> {
    try {
        const bytes = await file.arrayBuffer();
        // @ts-ignore
        const pdf = await pdfjs.getDocument({ data: bytes }).promise;
        const page = await pdf.getPage(1);
        const content = await page.getTextContent();
        const text = content.items.map((i: any) => i.str).join(' ').toLowerCase();
        return text.includes('capitec');
    } catch {
        return false;
    }
}
