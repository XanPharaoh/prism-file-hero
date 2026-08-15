import * as pdfjs from 'pdfjs-dist';

/**
 * Capitec Bank Statement Extractor
 * 
 * Supports:
 * 1. Capitec Business Statements (e.g. 7-column):
 *    Date | Description | Reference | Money in | Money out | Fees* | Balance
 *    With header metadata: Opening balance, Closing balance, Total fees, Account number, Period, Business reg no.
 *    With robust multi-line reference aggregation (leading/trailing lines merged cleanly).
 * 
 * 2. Capitec Personal Statements (e.g. 7-column positional):
 *    Post Date | Trans. Date | Description | Reference | Fees | Amount | Balance
 *    With combined Date+Description parsing, and positional money fields.
 */

export interface CapitecTransaction {
    PostDate?: string;
    TransDate?: string;
    Date?: string;
    Description: string;
    Reference: string;
    Fees: string;
    Amount: string;
    Balance: string;
    MoneyIn?: string;
    MoneyOut?: string;
    _raw: string;
    _page: number;
}

export interface CapitecExtractionResult {
    transactions: CapitecTransaction[];
    openingBalance: string;
    closingBalance: string;
    feeTotal: string;
    accountNumber?: string;
    accountType?: string;
    statementPeriod?: string;
    statementDate?: string;
    businessRegNumber?: string;
    format: 'business' | 'personal';
    metadata: {
        pageCount: number;
        rowCount: number;
        method: 'capitec-business-extraction' | 'capitec-position-extraction';
        format: 'business' | 'personal';
    };
}

// Date patterns
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
    /unique document no/i,
    /24hr business banking client care/i,
];

function isNoiseLine(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 2) return true;
    return NOISE_PATTERNS.some(p => p.test(trimmed));
}

function isMoney(str: string): boolean {
    return MONEY_RE.test(str.trim());
}

/**
 * Parse a combined "PostDate TransDate Description" string for personal statements.
 */
function parseDateDescLine(text: string): { postDate: string; transDate: string; description: string } | null {
    const trimmed = text.trim();
    const m2 = DATE_PREFIX_RE.exec(trimmed);
    if (m2) {
        return { postDate: m2[1], transDate: m2[2], description: m2[3].trim() };
    }
    const m1 = SINGLE_DATE_PREFIX_RE.exec(trimmed);
    if (m1) {
        return { postDate: m1[1], transDate: '', description: m1[2].trim() };
    }
    return null;
}

/**
 * Main Capitec statement extraction function.
 * Automatically classifies into Business or Personal format.
 */
export async function extractCapitecStatement(file: File | Blob): Promise<CapitecExtractionResult> {
    const bytes = await file.arrayBuffer();
    // @ts-ignore
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    const pageCount = Math.min(pdf.numPages, 100);

    // Scan first 2 pages text to detect format & metadata
    let firstPagesText = '';
    for (let p = 1; p <= Math.min(2, pageCount); p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        firstPagesText += content.items.map((it: any) => it.str || '').join(' ') + '\n';
    }

    const isBusinessFormat =
        /capitec business account/i.test(firstPagesText) ||
        /business account statement/i.test(firstPagesText) ||
        (/money in/i.test(firstPagesText) && /money out/i.test(firstPagesText));

    if (isBusinessFormat) {
        return extractCapitecBusinessStatement(pdf, pageCount);
    } else {
        return extractCapitecPersonalStatement(pdf, pageCount);
    }
}

/**
 * Capitec Business Account Extractor
 * Layout: Date | Description | Reference | Money in | Money out | Fees* | Balance
 */
async function extractCapitecBusinessStatement(
    pdf: pdfjs.PDFDocumentProxy,
    pageCount: number
): Promise<CapitecExtractionResult> {
    let openingBalance = '';
    let closingBalance = '';
    let feeTotal = '';
    let accountNumber = '';
    let accountType = 'Capitec Business Account';
    let statementPeriod = '';
    let statementDate = '';
    let businessRegNumber = '';

    const allTransactions: CapitecTransaction[] = [];

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        if (content.items.length === 0) continue;

        // Group text items by snapped Y coordinate (3px bucket)
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

        const sortedY = Array.from(lineMap.keys()).sort((a, b) => b - a);

        // Header metadata parsing on page 1
        if (pageNum === 1) {
            for (const y of sortedY) {
                const items = lineMap.get(y)!.sort((a, b) => a.x - b.x);
                const lineText = items.map(it => it.str).join(' ');

                if (/Opening balance/i.test(lineText)) {
                    const match = lineText.match(/Opening balance.*?R\s*([-\d\s,.]+)/i);
                    if (match) openingBalance = match[1].replace(/\s+/g, '');
                }
                if (/Closing balance/i.test(lineText)) {
                    const match = lineText.match(/Closing balance.*?R\s*([-\d\s,.]+)/i);
                    if (match) closingBalance = match[1].replace(/\s+/g, '');
                }
                if (/Total fees/i.test(lineText)) {
                    const match = lineText.match(/Total fees.*?R\s*([-\d\s,.]+)/i);
                    if (match) feeTotal = match[1].replace(/\s+/g, '');
                }
                if (/Account number/i.test(lineText)) {
                    const match = lineText.match(/Account number\s*(\d+)/i);
                    if (match) accountNumber = match[1];
                }
                if (/Account type/i.test(lineText)) {
                    const match = lineText.match(/Account type\s*(.+)/i);
                    if (match) accountType = match[1].trim();
                }
                if (/Statement period/i.test(lineText)) {
                    const match = lineText.match(/Statement period\s*(.+?)(?=Opening balance|$)/i);
                    if (match) statementPeriod = match[1].trim();
                }
                if (/Statement date/i.test(lineText)) {
                    const match = lineText.match(/Statement date\s*(.+?)(?=Closing balance|$)/i);
                    if (match) statementDate = match[1].trim();
                }
                if (/Business reg number/i.test(lineText)) {
                    const match = lineText.match(/Business reg number\s*(.+)/i);
                    if (match) businessRegNumber = match[1].trim();
                }
            }
        }

        // Collect lines for transaction extraction
        interface PageLine {
            y: number;
            items: Array<{ str: string; x: number; width: number }>;
            lineText: string;
            isTx: boolean;
            dateStr?: string;
        }

        const pageLines: PageLine[] = [];

        for (const y of sortedY) {
            // Ignore bottom footer zone (y <= 65)
            if (y <= 65) continue;

            const items = lineMap.get(y)!.sort((a, b) => a.x - b.x);
            const lineText = items.map(it => it.str).join(' ').trim();

            if (
                /Business Account Statement/i.test(lineText) ||
                /Capitec Bank Limited/i.test(lineText) ||
                /Account information/i.test(lineText) ||
                /Account number/i.test(lineText) ||
                /Account type/i.test(lineText) ||
                /Business reg/i.test(lineText) ||
                /Statement for account/i.test(lineText) ||
                /Statement period/i.test(lineText) ||
                /Statement date/i.test(lineText) ||
                /Opening balance/i.test(lineText) ||
                /Closing balance/i.test(lineText) ||
                /Total fees/i.test(lineText) ||
                /Transaction history/i.test(lineText) ||
                (/^Date\s+Description/i.test(lineText) && /Money/i.test(lineText)) ||
                /Client Care Centre/i.test(lineText) ||
                /authorised financial/i.test(lineText) ||
                /Unique Document No/i.test(lineText)
            ) {
                continue;
            }

            // Check if line contains a transaction date at x in [30, 85]
            const dateItem = items.find(it => it.x >= 30 && it.x <= 85 && /^\d{2}\/\d{2}\/\d{4}$/.test(it.str));

            pageLines.push({
                y,
                items,
                lineText,
                isTx: Boolean(dateItem),
                dateStr: dateItem?.str,
            });
        }

        // Build base transaction objects from primary transaction lines
        const pageTx: CapitecTransaction[] = [];
        for (const pl of pageLines) {
            if (pl.isTx && pl.dateStr) {
                const descItems = pl.items.filter(it => it.x > 85 && it.x < 195);
                const refItems = pl.items.filter(it => it.x >= 195 && it.x < 340);
                const moneyInItem = pl.items.find(it => it.x >= 340 && it.x < 395);
                const moneyOutItem = pl.items.find(it => it.x >= 395 && it.x < 455);
                const feeItem = pl.items.find(it => it.x >= 455 && it.x < 505);
                const balItem = pl.items.find(it => it.x >= 505);

                const moneyIn = moneyInItem ? moneyInItem.str.replace(/\s+/g, '') : '';
                const moneyOut = moneyOutItem ? moneyOutItem.str.replace(/\s+/g, '') : '';
                const fees = feeItem ? feeItem.str.replace(/\s+/g, '') : '';
                const balance = balItem ? balItem.str.replace(/\s+/g, '') : '';

                // Unified amount: positive for moneyIn, negative for moneyOut, or fee
                let amount = '';
                if (moneyIn) amount = moneyIn;
                else if (moneyOut) amount = moneyOut;
                else if (fees) amount = fees;

                pageTx.push({
                    Date: pl.dateStr,
                    PostDate: pl.dateStr,
                    TransDate: pl.dateStr,
                    Description: descItems.map(it => it.str).join(' ').trim(),
                    Reference: refItems.map(it => it.str).join(' ').trim(),
                    MoneyIn: moneyIn,
                    MoneyOut: moneyOut,
                    Fees: fees,
                    Amount: amount,
                    Balance: balance,
                    _raw: pl.lineText,
                    _page: pageNum,
                });
            }
        }

        // Merge multi-line references / descriptions from non-date lines on this page
        for (const pl of pageLines) {
            if (!pl.isTx) {
                const refItems = pl.items.filter(it => it.x >= 195 && it.x < 340);
                const descItems = pl.items.filter(it => it.x > 85 && it.x < 195);
                const fragment = [...descItems, ...refItems].map(it => it.str).join(' ').trim();
                if (!fragment) continue;

                // Find closest transaction on this page within vertical distance threshold (<= 25px)
                let closestTx: CapitecTransaction | null = null;
                let minDistance = Infinity;
                for (const tx of pageTx) {
                    const plTxLine = pageLines.find(l => l.isTx && l.dateStr === tx.Date && l.lineText === tx._raw);
                    const txY = plTxLine ? plTxLine.y : 0;
                    const dist = Math.abs(txY - pl.y);
                    if (dist < minDistance && dist <= 25) {
                        minDistance = dist;
                        closestTx = tx;
                    }
                }

                if (closestTx) {
                    const plTxLine = pageLines.find(l => l.isTx && l.dateStr === closestTx!.Date && l.lineText === closestTx!._raw);
                    const txY = plTxLine ? plTxLine.y : 0;
                    if (pl.y > txY) {
                        // Preceding line
                        closestTx.Reference = (fragment + ' ' + closestTx.Reference).trim();
                    } else {
                        // Trailing / continuation line
                        closestTx.Reference = (closestTx.Reference + ' ' + fragment).trim();
                    }
                }
            }
        }

        allTransactions.push(...pageTx);
    }

    // Determine closing balance from the last transaction if not parsed from page 1
    if (!closingBalance && allTransactions.length > 0) {
        closingBalance = allTransactions[allTransactions.length - 1].Balance.replace(/[+\s]/g, '');
    }

    return {
        transactions: allTransactions,
        openingBalance,
        closingBalance,
        feeTotal,
        accountNumber,
        accountType,
        statementPeriod,
        statementDate,
        businessRegNumber,
        format: 'business',
        metadata: {
            pageCount,
            rowCount: allTransactions.length,
            method: 'capitec-business-extraction',
            format: 'business',
        },
    };
}

/**
 * Capitec Personal Account Extractor (Legacy layout)
 * Layout: Post Date | Trans. Date | Description | Reference | Fees | Amount | Balance
 */
async function extractCapitecPersonalStatement(
    pdf: pdfjs.PDFDocumentProxy,
    pageCount: number
): Promise<CapitecExtractionResult> {
    const allTransactions: CapitecTransaction[] = [];
    let openingBalance = '';
    let closingBalance = '';
    let feeTotal = '';

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        if (content.items.length === 0) continue;

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

        const sortedY = Array.from(lineMap.keys()).sort((a, b) => b - a);
        let foundDataZone = false;
        let colBoundaries: { left: number; date: number; ref: number; moneyStart: number } | null = null;

        for (let i = 0; i < sortedY.length; i++) {
            const y = sortedY[i];
            const lineItems = lineMap.get(y)!.sort((a, b) => a.x - b.x);
            const lineText = lineItems.map(it => it.str).join(' ').trim();

            if (isNoiseLine(lineText)) continue;

            if (!foundDataZone) {
                const lower = lineText.toLowerCase();
                const isCapitecHeader =
                    (lower.includes('post') && (lower.includes('description') || lower.includes('trans'))) ||
                    lower === 'date' || lower === 'date date';

                if (isCapitecHeader) {
                    foundDataZone = true;
                    const headerKeywords: { name: string; x: number }[] = [];
                    for (const item of lineItems) {
                        const t = item.str.trim().toLowerCase();
                        if (/^post/.test(t)) headerKeywords.push({ name: 'post', x: item.x });
                        if (/^date/.test(t) || /^datum/.test(t)) headerKeywords.push({ name: 'date', x: item.x });
                        if (/description|beskrywing|narrative/.test(t)) headerKeywords.push({ name: 'desc', x: item.x });
                        if (/reference|verwysing/.test(t)) headerKeywords.push({ name: 'ref', x: item.x });
                        if (/^fe[eè]s?$/.test(t) || /^fooie$/.test(t)) headerKeywords.push({ name: 'fees', x: item.x });
                        if (/amount|bedrag/.test(t)) headerKeywords.push({ name: 'amount', x: item.x });
                        if (/balance|saldo/.test(t)) headerKeywords.push({ name: 'balance', x: item.x });
                    }
                    headerKeywords.sort((a, b) => a.x - b.x);

                    const descIdx = headerKeywords.findIndex(h => h.name === 'desc' || h.name === 'ref');
                    const moneyKeywords = headerKeywords.filter(h => h.name === 'fees' || h.name === 'amount' || h.name === 'balance');
                    const moneyStartIdx = headerKeywords.indexOf(moneyKeywords[0]);

                    if (descIdx >= 0 && moneyStartIdx >= 0) {
                        const descX = headerKeywords[descIdx].x;
                        const moneyX = headerKeywords[moneyStartIdx].x;
                        const midpoint1 = (headerKeywords[Math.max(0, descIdx - 1)].x + descX) / 2;
                        const midpoint2 = moneyX;
                        colBoundaries = {
                            left: midpoint1,
                            date: midpoint1,
                            ref: midpoint2,
                            moneyStart: midpoint2,
                        };
                    }
                    continue;
                }
                if (lower === 'date' || lower === 'date date') {
                    foundDataZone = true;
                    continue;
                }
                continue;
            }

            if (/balance brought forward/i.test(lineText)) {
                for (let j = lineItems.length - 1; j >= 0; j--) {
                    if (isMoney(lineItems[j].str)) {
                        openingBalance = lineItems[j].str.replace(/[+\s]/g, '');
                        break;
                    }
                }
                continue;
            }

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

            const leftBound = colBoundaries?.left ?? 200;
            const moneyBound = colBoundaries?.moneyStart ?? 370;

            const leftItems: string[] = [];
            const refItems: string[] = [];
            const moneyItems: Array<{ str: string; x: number }> = [];

            for (const item of lineItems) {
                if (item.x < leftBound) {
                    leftItems.push(item.str);
                } else if (item.x < moneyBound) {
                    refItems.push(item.str);
                } else {
                    moneyItems.push({ str: item.str, x: item.x });
                }
            }

            const leftText = leftItems.join(' ').trim();
            const refText = refItems.join(' ').trim();
            const parsed = parseDateDescLine(leftText);

            moneyItems.sort((a, b) => b.x - a.x);
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
                if (moneyItems[0].x >= 480) {
                    balance = moneyItems[0].str.trim();
                } else {
                    amount = moneyItems[0].str.trim();
                }
            }

            const row: CapitecTransaction = {
                Date: parsed?.postDate || '',
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

            const hasDate = !!parsed;
            const hasNumeric = row.Balance || row.Amount;

            if (hasDate && hasNumeric) {
                allTransactions.push(row);
            } else if (hasDate && !hasNumeric && row.Description) {
                allTransactions.push(row);
            } else if (!hasDate && allTransactions.length > 0) {
                const last = allTransactions[allTransactions.length - 1];
                if (refText) {
                    last.Reference = (last.Reference + ' ' + refText).trim();
                }
                if (leftText && !isMoney(leftText)) {
                    last.Reference = (last.Reference + ' ' + leftText).trim();
                }
            }
        }
    }

    if (allTransactions.length > 0) {
        closingBalance = allTransactions[allTransactions.length - 1].Balance.replace(/[+\s]/g, '');
    }

    return {
        transactions: allTransactions,
        openingBalance,
        closingBalance,
        feeTotal,
        format: 'personal',
        metadata: {
            pageCount,
            rowCount: allTransactions.length,
            method: 'capitec-position-extraction',
            format: 'personal',
        },
    };
}

/**
 * Convert Capitec transactions to Excel-ready rows.
 * Automatically adapts output columns to Business or Personal layout.
 */
export function convertCapitecToExcelRows(transactions: CapitecTransaction[]): Record<string, any>[] {
    if (transactions.length === 0) return [];

    const isBusiness = transactions.some(tx => tx.MoneyIn !== undefined || tx.MoneyOut !== undefined);

    if (isBusiness) {
        return transactions.map(tx => {
            const moneyInVal = tx.MoneyIn ? parseFloat(tx.MoneyIn.replace(/[,\s]/g, '')) : null;
            const moneyOutVal = tx.MoneyOut ? parseFloat(tx.MoneyOut.replace(/[,\s]/g, '')) : null;
            const feesVal = tx.Fees ? parseFloat(tx.Fees.replace(/[,\s]/g, '')) : null;
            const balanceVal = tx.Balance ? parseFloat(tx.Balance.replace(/[,\s]/g, '')) : null;

            return {
                Date: tx.Date || tx.PostDate || '',
                Description: tx.Description || '',
                Reference: tx.Reference || '',
                'Money In': moneyInVal !== null && !isNaN(moneyInVal) ? moneyInVal : (tx.MoneyIn || ''),
                'Money Out': moneyOutVal !== null && !isNaN(moneyOutVal) ? moneyOutVal : (tx.MoneyOut || ''),
                Fees: feesVal !== null && !isNaN(feesVal) ? feesVal : (tx.Fees || ''),
                Balance: balanceVal !== null && !isNaN(balanceVal) ? balanceVal : (tx.Balance || ''),
            };
        });
    }

    return transactions.map(tx => ({
        'Post Date': tx.PostDate || tx.Date || '',
        'Trans Date': tx.TransDate || '',
        Description: tx.Description || '',
        Reference: tx.Reference || '',
        Fees: tx.Fees || '',
        Amount: tx.Amount || '',
        Balance: tx.Balance || '',
    }));
}

/**
 * Detect if a PDF is a Capitec bank statement by checking first-page text
 */
export async function isCapitecStatement(file: File | Blob): Promise<boolean> {
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
