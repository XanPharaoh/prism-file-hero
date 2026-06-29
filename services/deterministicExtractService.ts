import * as pdfjs from 'pdfjs-dist';

export interface DeterministicRow { [key: string]: string; }
export interface DeterministicResult { rows: DeterministicRow[]; metadata: any; hasTextLayer: boolean; }

// Known header keywords that should NEVER be merged together
const SEMANTIC_BOUNDARIES = [
    'tran', 'date', 'description', 'narrative', 'particular',
    'fees', 'fee', 'charge', 'debit', 'credit', 'balance',
    'amount', 'reference', 'ref', 'withdrawal', 'deposit',
    'saldo', 'bedrag', 'datum', 'beskrywing'
];

const NOISE_PHRASES = [
    "total charges", "bank charge", "vat inclusive", "vat calculated",
    "service fees", "narrative description", "item cost",
    "total funds", "annual credit", "see money",
    "we subscribe", "ombudsman", "authorised financial",
    "% of utilisation", "% of funds", "nedbank ltd",
    "statement date:", "statement period:", "statement frequency:",
    "account type", "account number", "envelope:",
    "total pages:", "client vat", "bank vat",
    "lost cards", "client care", ".co.za", "tax invoice",
    "cashflow", "charges summary", "charges for the period",
    "funds received", "funds used", "electronic transfers",
    "electronic payments", "other debits", "other credits",
    "please examine", "no error is reported",
    "our fees will change", "our updated fees",
    "banking experience", "relationship banker",
    "reg no 1951", "credit provider", "page 1 of", "page 2 of",
];

// Regex patterns for rescuing collapsed rows
const RESCUE_PATTERNS = [
    // Date + Description + optional Fee + Debit/Credit + Balance
    // e.g. "25/12/2025 MTN R5 Airtime 0634082146 5.00 358.14"
    /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([\d,.]+\.\d{2})\s*\*?\s+([\d,.]+\.\d{2})$/,
    // Date + Description + Fee* + Amount + Balance (with fee marker)
    /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([\d,.]+\.\d{2})\s*\*\s+([\d,.]+\.\d{2})$/,
    // Date + Description + Balance only (e.g. opening/closing balance)
    /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([\d,.]+\.\d{2})$/,
    // With tran list no prefix: "000133 25/12/2025 MTN R5 Airtime..."
    /^(\d{4,6})\s+(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([\d,.]+\.\d{2})\s*\*?\s+([\d,.]+\.\d{2})$/,
];

function looksLikeHeaderWord(str: string): boolean {
    const lower = str.toLowerCase().replace(/[^a-z]/g, '');
    return SEMANTIC_BOUNDARIES.some(kw => lower === kw || (kw.length > 3 && lower.includes(kw)));
}

function mergeHeaderWords(items: any[]): any[] {
    if (items.length === 0) return [];

    const groups: any[][] = [];
    let cur = [items[0]];

    for (let i = 1; i < items.length; i++) {
        const gap = items[i].x0 - cur[cur.length - 1].x1;
        const currentWord = items[i].str.trim();
        const previousGroupText = cur.map(it => it.str).join(' ').trim();

        // Force split if:
        // 1. The gap is large enough (> 15px), OR
        // 2. The new word is a known header keyword AND the existing group
        //    already contains a different header keyword
        const newWordIsHeader = looksLikeHeaderWord(currentWord);
        const existingHasHeader = SEMANTIC_BOUNDARIES.some(kw =>
            previousGroupText.toLowerCase().replace(/[^a-z]/g, '').includes(kw)
        );

        // Semantic check: Don't split "Fees" from "(R)"
        const isQualifier = currentWord.match(/^\(.*\)$/);

        const differentSemantics = newWordIsHeader && existingHasHeader && !isQualifier && !isSameSemanticGroup(previousGroupText, currentWord);

        if (gap > 15 || differentSemantics) {
            groups.push(cur);
            cur = [items[i]];
        } else {
            cur.push(items[i]);
        }
    }
    groups.push(cur);

    return groups.map(g => ({
        name: g.map(it => it.str).join(' ').trim(),
        x_left: g[0].x0,
        x_right: g[g.length - 1].x1,
        x_center: (g[0].x0 + g[g.length - 1].x1) / 2
    }));
}

/**
 * Check if two header fragments belong to the same semantic column.
 * e.g. "Fees" and "(R)" are the same; "Fees" and "Balance" are not.
 */
function isSameSemanticGroup(existingText: string, newWord: string): boolean {
    const lower = newWord.toLowerCase().replace(/[^a-z]/g, '');
    // Parenthetical qualifiers like (R) belong to the previous group
    if (newWord.trim().match(/^\(.*\)$/)) return true;
    // "list" after "Tran" — same group
    if (lower === 'list' || lower === 'no') return true;
    return false;
}

/**
 * Attempt to rescue a collapsed row where all data ended up in one column.
 * Returns a properly split row object, or null if rescue fails.
 */
function tryRescueRow(
    rowObj: DeterministicRow,
    columns: any[]
): DeterministicRow | null {
    // Find the column that has all the data
    const populatedCols = Object.entries(rowObj).filter(([_, v]) => v.trim().length > 0);
    const emptyCols = Object.entries(rowObj).filter(([_, v]) => v.trim().length === 0);

    // Only rescue if most columns are empty but one is overstuffed
    // Allow rescue if we have fewer than 3 populated columns but defined >= 4 columns
    if (populatedCols.length > 2) return null;

    const mergedText = populatedCols.map(([_, v]) => v).join(' ').trim();
    if (!mergedText.match(/\d{2}\/\d{2}\/\d{4}/)) return null; // must contain a date

    // Identify canonical column names
    const colNames = columns.map(c => c.name);
    const dateCol = findColByHint(colNames, ['date', 'datum']);
    const descCol = findColByHint(colNames, ['description', 'narrative', 'particular']);
    const feeCol = findColByHint(colNames, ['fee', 'charge']);
    const debitCol = findColByHint(colNames, ['debit', 'withdrawal']);
    const creditCol = findColByHint(colNames, ['credit', 'deposit']);
    const balanceCol = findColByHint(colNames, ['balance', 'saldo']);
    const tranCol = findColByHint(colNames, ['tran', 'ref']);

    // Try each rescue pattern
    for (const pattern of RESCUE_PATTERNS) {
        const match = mergedText.match(pattern);
        if (!match) continue;

        const rescued: DeterministicRow = {};
        colNames.forEach(c => rescued[c] = '');

        try {
            if (match.length === 6) {
                // Pattern with tran list no
                if (tranCol) rescued[tranCol] = match[1];
                if (dateCol) rescued[dateCol] = match[2];
                if (descCol) rescued[descCol] = match[3].trim();
                // Determine if the second-to-last number is fee/debit
                assignAmountToColumn(rescued, match[4], match[5], feeCol, debitCol, balanceCol);
            } else if (match.length === 5) {
                // Date + Desc + Amount + Balance
                if (dateCol) rescued[dateCol] = match[1];
                if (descCol) rescued[descCol] = match[2].trim();
                assignAmountToColumn(rescued, match[3], match[4], feeCol, debitCol, balanceCol);
            } else if (match.length === 4) {
                // Date + Desc + Balance only
                if (dateCol) rescued[dateCol] = match[1];
                if (descCol) rescued[descCol] = match[2].trim();
                if (balanceCol) rescued[balanceCol] = match[3];
            }

            // Validate: rescued row must have at least date + balance
            if (rescued[dateCol || ''] && rescued[balanceCol || '']) return rescued;
        } catch (e) {
            // Pattern match failed logical assignment
            continue;
        }
    }

    // Final fallback: smarter splitting by scanning for numeric tokens from the right
    return tryNumericSplitRescue(mergedText, colNames, dateCol, descCol, feeCol, debitCol, creditCol, balanceCol, tranCol);
}

function tryNumericSplitRescue(
    text: string,
    colNames: string[],
    dateCol: string | null,
    descCol: string | null,
    feeCol: string | null,
    debitCol: string | null,
    creditCol: string | null,
    balanceCol: string | null,
    tranCol: string | null
): DeterministicRow | null {
    const rescued: DeterministicRow = {};
    colNames.forEach(c => rescued[c] = '');

    // Extract tran list no if present at start
    let remaining = text;
    const tranMatch = remaining.match(/^(\d{4,6})\s+/);
    if (tranMatch && tranCol) {
        rescued[tranCol] = tranMatch[1];
        remaining = remaining.substring(tranMatch[0].length);
    }

    // Extract date
    const dateMatch = remaining.match(/(\d{2}\/\d{2}\/\d{4})\s+/);
    if (!dateMatch) return null;

    // If date is not at start (e.g. after some garbage), slice up to it? 
    // Generally assume date is near start.
    const dateIdx = remaining.indexOf(dateMatch[1]);
    if (dateIdx > -1) {
        if (dateCol) rescued[dateCol] = dateMatch[1];
        remaining = remaining.substring(dateIdx + dateMatch[0].length);
    } else {
        return null;
    }

    // Extract numeric values from the right side
    const numbers: { value: string; hasStar: boolean; raw: string }[] = [];
    let work = remaining.trim();

    // Repeatedly pop strictly numeric tokens from the end
    // Use a loop that consumes one number at a time from the end
    let sanityLimit = 5;
    while (sanityLimit-- > 0) {
        // Match numbers like 1,234.56 or 1234.56 or 1234.56* or 1234.56 *
        // Be careful not to consume parts of description
        const numMatch = work.match(/\s+([\d,.]+\.\d{2})\s*(\*?)$/);
        if (!numMatch) break;

        numbers.unshift({ value: numMatch[1], hasStar: numMatch[2] === '*', raw: numMatch[0] });
        work = work.substring(0, work.length - numMatch[0].length).trim();
    }

    // What's left is the description
    if (descCol) rescued[descCol] = work.trim();

    // Assign numbers to columns (rightmost = balance, then work left)
    if (numbers.length >= 1 && balanceCol) {
        rescued[balanceCol] = numbers[numbers.length - 1].value;
    }
    if (numbers.length >= 2) {
        const amountEntry = numbers[numbers.length - 2];
        if ((amountEntry.hasStar || amountEntry.value.includes('*')) && feeCol) {
            rescued[feeCol] = amountEntry.value;
        } else if (debitCol) {
            rescued[debitCol] = amountEntry.value;
        } else if (feeCol) {
            // If we have a fee col, but no explicit star, ambiguous. 
            // Usually Nedbank implies debit if unsigned.
            rescued[debitCol || 'Amount'] = amountEntry.value;
        }
    }
    if (numbers.length >= 3) {
        const extraEntry = numbers[numbers.length - 3];
        if (creditCol) {
            rescued[creditCol] = extraEntry.value;
        } else if (debitCol && !rescued[debitCol]) {
            rescued[debitCol] = extraEntry.value;
        }
    }

    if (rescued[dateCol || ''] && rescued[balanceCol || '']) return rescued;
    return null;
}

function assignAmountToColumn(
    row: DeterministicRow,
    amountStr: string,
    balanceStr: string,
    feeCol: string | null,
    debitCol: string | null,
    balanceCol: string | null
) {
    if (balanceCol) row[balanceCol] = balanceStr;
    // If the original text had a *, it's a fee
    if (feeCol && (amountStr.includes('*') || row.Description?.toLowerCase().includes('fee'))) {
        row[feeCol] = amountStr.replace('*', '').trim();
    } else if (debitCol) {
        row[debitCol] = amountStr;
    } else {
        // fallback
        row['Amount'] = amountStr;
    }
}

function findColByHint(colNames: string[], hints: string[]): string | null {
    return colNames.find(c => {
        const lower = c.toLowerCase().replace(/[^a-z]/g, '');
        return hints.some(h => lower.includes(h));
    }) || null;
}

function buildBoundaries(cols: any[]): [number, number][] {
    return cols.map((col, i) => [
        (i === 0 ? 0 : (cols[i - 1].x_right + col.x_left) / 2),
        (i === cols.length - 1 ? 9999 : (col.x_right + (cols[i + 1]?.x_left || 9999)) / 2)
    ]);
}

function assignToColumn(centerX: number, bounds: [number, number][]): number {
    return bounds.findIndex(([l, r]) => centerX >= l && centerX <= r);
}

export async function extractTableDeterministically(file: File): Promise<DeterministicResult> {
    const bytes = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    const allRows: DeterministicRow[] = [];
    let totalTextItems = 0;
    let activeColumns: any[] | null = null;
    let boundaries: [number, number][] = [];

    // Metadata tracking
    let collapsedRows = 0;
    let dataRows = 0;

    for (let i = 1; i <= Math.min(pdf.numPages, 20); i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        totalTextItems += textContent.items.length;
        if (textContent.items.length === 0) continue;

        const items = textContent.items.map((item: any) => ({
            str: item.str,
            x0: item.transform[4],
            x1: item.transform[4] + (item.width || 0),
            y: item.transform[5],
            center: item.transform[4] + ((item.width || 0) / 2)
        }));

        // Group items into lines by Y-coordinate
        const lines: any[] = [];
        const sortedY = [...items].sort((a, b) => b.y - a.y);
        if (sortedY.length > 0) {
            let cur = [sortedY[0]];
            for (let j = 1; j < sortedY.length; j++) {
                if (Math.abs(cur[0].y - sortedY[j].y) < 6) {
                    cur.push(sortedY[j]);
                } else {
                    lines.push({ items: cur.sort((a: any, b: any) => a.x0 - b.x0) });
                    cur = [sortedY[j]];
                }
            }
            lines.push({ items: cur.sort((a: any, b: any) => a.x0 - b.x0) });
        }

        let startLineIdx = 0;

        // Look for the header row
        const headIdx = lines.findIndex(l => {
            const t = l.items.map((it: any) => it.str).join(' ').toLowerCase();
            return t.includes('balance') && (t.includes('date') || t.includes('debit') || t.includes('description') || t.includes('details'));
        });

        if (headIdx !== -1) {

            // PRE-PROCESS HEADER: Remove "Page X of Y" or generic bank details from header line if merged
            // (Skipping complex pre-process for now, relying on mergeHeaderWords)

            activeColumns = mergeHeaderWords(lines[headIdx].items);

            // Validate: if we only got 1-2 columns but the header text clearly
            // has more fields, force re-split
            if (activeColumns.length < 3) {
                activeColumns = forceHeaderSplit(lines[headIdx].items);
            }

            boundaries = buildBoundaries(activeColumns);
            startLineIdx = headIdx + 1;
        }

        if (!activeColumns) continue;

        for (let j = startLineIdx; j < lines.length; j++) {
            const line = lines[j];
            const lineText = line.items.map((it: any) => it.str).join(' ').toLowerCase();

            // Filter Noise
            if (NOISE_PHRASES.some(phrase => lineText.includes(phrase))) continue;

            const rowObj: DeterministicRow = {};
            activeColumns.forEach(col => rowObj[col.name] = '');

            line.items.forEach((item: any) => {
                const colIdx = assignToColumn(item.center, boundaries);
                if (colIdx !== -1) {
                    rowObj[activeColumns![colIdx].name] =
                        (rowObj[activeColumns![colIdx].name] + ' ' + item.str).trim();
                }
            });

            // Check if this row looks collapsed (most columns empty, one overstuffed)
            const populatedCount = Object.values(rowObj).filter(v => v.trim().length > 0).length;
            const hasNumericContent = Object.values(rowObj).some(v => v.match(/\d/));

            if (!hasNumericContent) {
                // Skip noise lines without numbers
                continue;
            }

            dataRows++;

            if (populatedCount <= 2 && activeColumns.length >= 4) {
                // Attempt rescue
                const rescued = tryRescueRow(rowObj, activeColumns);
                if (rescued) {
                    allRows.push(rescued);
                    continue;
                }
                collapsedRows++;
            }

            allRows.push(rowObj);
        }
    }

    const collapsedRatio = dataRows > 0 ? collapsedRows / dataRows : 0;

    return {
        rows: allRows,
        metadata: {
            rowCount: allRows.length,
            columnCount: activeColumns?.length || 0,
            columns: activeColumns?.map(c => c.name) || [],
            collapsedRatio,
            strategy: 'deterministic'
        },
        hasTextLayer: totalTextItems > 20
    };
}

/**
 * Fallback: if mergeHeaderWords collapsed everything, force split by
 * finding known keywords in the concatenated text and reconstructing columns
 * from their positions.
 */
function forceHeaderSplit(items: any[]): any[] {
    const knownHeaders = [
        { pattern: /tran\s*list\s*no/i, name: 'Tran list no' },
        { pattern: /date/i, name: 'Date' },
        { pattern: /description|narrative|particular|details/i, name: 'Description' },
        { pattern: /fees?\s*(\(r\))?/i, name: 'Fees' },
        { pattern: /debits?\s*(\(r\))?/i, name: 'Debits' },
        { pattern: /credits?\s*(\(r\))?/i, name: 'Credits' },
        { pattern: /balance\s*(\(r\))?/i, name: 'Balance' },
    ];

    const found: any[] = [];

    for (const item of items) {
        for (const kh of knownHeaders) {
            if (item.str.match(kh.pattern) && !found.some(f => f.name === kh.name)) {
                found.push({
                    name: kh.name,
                    x_left: item.x0,
                    x_right: item.x1,
                    x_center: item.center
                });
            }
        }
    }

    // Sort by x position
    found.sort((a, b) => a.x_left - b.x_left);

    return found.length >= 3 ? found : mergeHeaderWords(items);
}
