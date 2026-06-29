/**
 * Comprehensive extraction test for all test account PDFs.
 * Tests the same logic used by the browser extractors via Node.js.
 */
import fs from 'fs';
import path from 'path';
import * as pdfjsLib from 'pdfjs-dist';

const TEST_DIR = 'C:/Users/Philander/Downloads/Test accounts';

// ===================== BANK DETECTION =====================
function detectBank(text) {
    const checks = [
        { code: 'FNB_SA', name: 'FNB', patterns: [/First National Bank/i, /FNB/i], footers: [/No\. Credit Transactions/i, /No\. Debit Transactions/i, /Total Debits/i, /Opening Balance/i] },
        { code: 'CAPITEC_SA', name: 'Capitec', patterns: [/Capitec Bank/i, /Capitec/i], footers: [/Capitec Bank is an authorised/i] },
        { code: 'NEDBANK_SA', name: 'Nedbank', patterns: [/Nedbank/i], footers: [/Total Debits/i] },
        { code: 'TYMEBANK_SA', name: 'TymeBank', patterns: [/TymeBank/i, /Tyme Bank/i], footers: [] },
    ];
    let best = { code: 'UNKNOWN', name: 'Unknown', conf: 0 };
    for (const c of checks) {
        let score = 0;
        for (const p of c.patterns) { if (p.test(text)) score += 2; }
        for (const f of c.footers) { if (f.test(text)) score += 1; }
        if (score > best.conf) best = { code: c.code, name: c.name, conf: score };
    }
    return best;
}

// ===================== CAPITEC EXTRACTOR =====================
const DATE_PREFIX_RE = /^(\d{2}\/\d{2}\/\d{2,4})\s+(\d{2}\/\d{2}\/\d{2,4})\s*(.*)/;
const SINGLE_DATE_PREFIX_RE = /^(\d{2}\/\d{2}\/\d{2,4})\s+(.*)/;
const MONEY_RE = /^[+-]?[\d\s]+\.\d{2}$/;
const CAP_NOISE = [
    /^capitec bank/i, /^business account statement/i, /^account no/i, /^account type/i,
    /^branch/i, /^telephone/i, /^business reg/i, /^client vat/i, /^statement no/i,
    /^page:/i, /^fee total/i, /^vat @/i, /^vat total/i, /all fees charged/i,
    /prime lending rate/i, /statements are accepted/i, /banking client care/i,
    /capitec bank is an authorised/i, /vat reg/i, /neutron road/i, /interest rate @/i,
    /no limit.*rate/i, /overdraft/i, /stamp placeholder/i, /^date\s*$/i, /^post\s*$/i,
    /^trans\.\s*$/i, /^capitec bank$/i, /^\d{2}\/\d{2}\/\d{4}$/, /^branch:\s/i, /^device:\s/i, /^tel:\s/i,
];
function capIsNoise(text) { return CAP_NOISE.some(p => p.test(text.trim())); }
function isMoney(str) { return MONEY_RE.test(str.trim()); }
function parseDateDesc(text) {
    const m2 = DATE_PREFIX_RE.exec(text.trim());
    if (m2) return { postDate: m2[1], transDate: m2[2], description: m2[3].trim() };
    const m1 = SINGLE_DATE_PREFIX_RE.exec(text.trim());
    if (m1) return { postDate: m1[1], transDate: '', description: m1[2].trim() };
    return null;
}

async function extractCapitec(pdfDoc) {
    const transactions = [];
    let openingBalance = '', closingBalance = '';
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const content = await page.getTextContent();
        const lineMap = new Map();
        for (const item of content.items) {
            const str = item.str?.trim();
            if (!str) continue;
            const y = Math.round(item.transform[5] / 3) * 3;
            if (!lineMap.has(y)) lineMap.set(y, []);
            lineMap.get(y).push({ str, x: Math.round(item.transform[4]) });
        }
        const sortedY = Array.from(lineMap.keys()).sort((a, b) => b - a);
        let foundDataZone = false;
        for (let i = 0; i < sortedY.length; i++) {
            const y = sortedY[i];
            const lineItems = lineMap.get(y).sort((a, b) => a.x - b.x);
            const lineText = lineItems.map(it => it.str).join(' ').trim();
            if (capIsNoise(lineText)) continue;
            if (!foundDataZone) {
                const lower = lineText.toLowerCase();
                if (lower.includes('post') && (lower.includes('description') || lower.includes('trans'))) { foundDataZone = true; continue; }
                if (lower === 'date' || lower === 'date date') { foundDataZone = true; continue; }
                continue;
            }
            if (/balance brought forward/i.test(lineText)) {
                for (let j = lineItems.length - 1; j >= 0; j--) {
                    if (isMoney(lineItems[j].str)) { openingBalance = lineItems[j].str.replace(/[+\s]/g, ''); break; }
                }
                continue;
            }
            if (/fee total/i.test(lineText) || /vat\s*@/i.test(lineText) || /vat\s*total/i.test(lineText) || /all fees charged/i.test(lineText)) continue;

            const leftItems = [], refItems = [], moneyItems = [];
            for (const item of lineItems) {
                if (item.x < 200) leftItems.push(item.str);
                else if (item.x < 370) refItems.push(item.str);
                else moneyItems.push({ str: item.str, x: item.x });
            }
            const leftText = leftItems.join(' ').trim();
            const parsed = parseDateDesc(leftText);
            moneyItems.sort((a, b) => b.x - a.x);
            let balance = moneyItems.length >= 1 ? moneyItems[0].str.trim() : '';
            let amount = moneyItems.length >= 2 ? moneyItems[1].str.trim() : '';
            let fees = moneyItems.length >= 3 ? moneyItems[2].str.trim() : '';

            if (parsed && (balance || amount)) {
                transactions.push({ postDate: parsed.postDate, transDate: parsed.transDate, desc: parsed.description, ref: refItems.join(' '), fees, amount, balance });
            } else if (parsed && parsed.description) {
                transactions.push({ postDate: parsed.postDate, transDate: parsed.transDate, desc: parsed.description, ref: refItems.join(' '), fees, amount, balance });
            } else if (!parsed && transactions.length > 0) {
                const last = transactions[transactions.length - 1];
                if (refItems.length) last.ref = (last.ref + ' ' + refItems.join(' ')).trim();
                if (leftText && !isMoney(leftText)) last.ref = (last.ref + ' ' + leftText).trim();
            }
        }
    }
    if (transactions.length > 0) closingBalance = transactions[transactions.length - 1].balance;
    return { transactions, openingBalance, closingBalance };
}

// ===================== FNB EXTRACTOR (simplified) =====================
const FNB_NOISE = [
    /^Opening Balance/i, /^Closing Balance/i, /^Statement No/i, /^Statement Period/i,
    /^Account Number/i, /^Account No/i, /^Account Type/i, /^Branch Code/i,
    /^VAT Reg/i, /^Page \d/i, /^Delivery Method/i, /^No\. Credit/i, /^No\. Debit/i,
    /^Total Debits/i, /^Total Credits/i, /^Available Balance/i, /^\s*$/,
    /Registration Number/i, /authorised financial/i, /first national bank/i,
];
function fnbIsNoise(text) { return FNB_NOISE.some(p => p.test(text.trim())); }

function parseMoney(str) {
    if (!str) return 0;
    let s = String(str).trim();
    let neg = false;
    if (/(Cr|CR)$/i.test(s)) { s = s.replace(/(Cr|CR)\s*$/i, '').trim(); }
    else if (/(Dr|DR)$/i.test(s)) { neg = true; s = s.replace(/(Dr|DR)\s*$/i, '').trim(); }
    if (s.startsWith('-')) { neg = true; s = s.slice(1).trim(); }
    s = s.replace(/[R$£€\s]/g, '').replace(/,/g, '');
    const val = parseFloat(s);
    if (isNaN(val)) return 0;
    return neg ? -val : val;
}

async function extractFNB(pdfDoc) {
    const transactions = [];
    let openingBalance = '', closingBalance = '';
    
    // Pre-scan page 1 for opening/closing balance
    const page1 = await pdfDoc.getPage(1);
    const content1 = await page1.getTextContent();
    const lineMap1 = new Map();
    for (const item of content1.items) {
        const str = item.str?.trim();
        if (!str) continue;
        const y = Math.round(item.transform[5] / 3) * 3;
        if (!lineMap1.has(y)) lineMap1.set(y, []);
        lineMap1.get(y).push({ str, x: Math.round(item.transform[4]) });
    }
    for (const [y, items] of lineMap1.entries()) {
        const sorted = items.sort((a, b) => a.x - b.x);
        const lineText = sorted.map(i => i.str).join(' ');
        if (/opening balance/i.test(lineText)) {
            for (const it of sorted) {
                const m = it.str.match(/([\d,]+\.\d{2})\s*(Cr|Dr)?$/i);
                if (m) { openingBalance = it.str; break; }
            }
        }
        if (/closing balance/i.test(lineText)) {
            for (const it of sorted) {
                const m = it.str.match(/([\d,]+\.\d{2})\s*(Cr|Dr)?$/i);
                if (m) { closingBalance = it.str; break; }
            }
        }
    }

    // Main extraction
    const DATE_RE = /^\d{2}\s+[A-Za-z]{3}/;
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const content = await page.getTextContent();
        const lineMap = new Map();
        for (const item of content.items) {
            const str = item.str?.trim();
            if (!str) continue;
            const y = Math.round(item.transform[5] / 3) * 3;
            if (!lineMap.has(y)) lineMap.set(y, []);
            lineMap.get(y).push({ str, x: Math.round(item.transform[4]) });
        }
        const sortedY = Array.from(lineMap.keys()).sort((a, b) => b - a);
        
        // Detect if this is a gold format or standard
        let isGold = false;
        let dateXLeft = 999, descXLeft = 999;
        for (const [y, items] of lineMap.entries()) {
            for (const it of items) {
                if (/^date$/i.test(it.str)) dateXLeft = Math.min(dateXLeft, it.x);
                if (/^description$/i.test(it.str)) descXLeft = Math.min(descXLeft, it.x);
            }
        }
        if (dateXLeft < 30 && descXLeft > 150) isGold = true;

        let foundHeaders = false;
        for (const y of sortedY) {
            const lineItems = lineMap.get(y).sort((a, b) => a.x - b.x);
            const lineText = lineItems.map(it => it.str).join(' ').trim();
            
            if (fnbIsNoise(lineText)) continue;
            
            if (!foundHeaders) {
                const lower = lineText.toLowerCase();
                if (lower.includes('date') && lower.includes('description') && (lower.includes('amount') || lower.includes('balance'))) {
                    foundHeaders = true;
                }
                continue;
            }

            // Extract date from leftmost item
            let date = '';
            let desc = '';
            let amount = '';
            let balance = '';
            let charges = '';

            if (isGold) {
                // Gold format boundaries: Date(0-35), Description(35-430), Amount(430-485), Balance(485-548), Charges(548-620)
                for (const it of lineItems) {
                    if (it.x < 35) { date = (date + ' ' + it.str).trim(); }
                    else if (it.x < 430) { desc = (desc + ' ' + it.str).trim(); }
                    else if (it.x < 485) { amount = (amount + ' ' + it.str).trim(); }
                    else if (it.x < 548) { balance = (balance + ' ' + it.str).trim(); }
                    else { charges = (charges + ' ' + it.str).trim(); }
                }
            } else {
                // Standard format: Date(0-60), Description(60-350), Amount(350-430), Balance(430+)
                for (const it of lineItems) {
                    if (it.x < 60) { date = (date + ' ' + it.str).trim(); }
                    else if (it.x < 350) { desc = (desc + ' ' + it.str).trim(); }
                    else if (it.x < 430) { amount = (amount + ' ' + it.str).trim(); }
                    else { balance = (balance + ' ' + it.str).trim(); }
                }
            }

            if (DATE_RE.test(date.trim()) && (amount || balance)) {
                transactions.push({ date: date.trim(), desc, amount, balance, charges });
            } else if (!DATE_RE.test(date.trim()) && transactions.length > 0 && desc) {
                // Continuation line
                transactions[transactions.length - 1].desc += ' ' + (date + ' ' + desc).trim();
            }
        }
    }

    return { transactions, openingBalance, closingBalance };
}

// ===================== NEDBANK EXTRACTOR =====================
async function extractNedbank(pdfDoc) {
    const transactions = [];
    let openingBalance = '', closingBalance = '';
    const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const content = await page.getTextContent();
        const lineMap = new Map();
        for (const item of content.items) {
            const str = item.str?.trim();
            if (!str) continue;
            const y = Math.round(item.transform[5] / 3) * 3;
            if (!lineMap.has(y)) lineMap.set(y, []);
            lineMap.get(y).push({ str, x: Math.round(item.transform[4]) });
        }
        const sortedY = Array.from(lineMap.keys()).sort((a, b) => b - a);

        for (const y of sortedY) {
            const lineItems = lineMap.get(y).sort((a, b) => a.x - b.x);

            let tranListNo = '', date = '', desc = '', debit = '', credit = '', balance = '';
            for (const it of lineItems) {
                if (it.x < 90) { tranListNo = (tranListNo + ' ' + it.str).trim(); }
                else if (it.x < 140) { date = (date + ' ' + it.str).trim(); }
                else if (it.x < 360) { desc = (desc + ' ' + it.str).trim(); }
                else if (it.x < 430) { debit = (debit + ' ' + it.str).trim(); }
                else if (it.x < 520) { credit = (credit + ' ' + it.str).trim(); }
                else { balance = (balance + ' ' + it.str).trim(); }
            }

            // Check for opening/closing balance
            const lineText = lineItems.map(i => i.str).join(' ');
            if (/opening balance|beginsaldo/i.test(lineText)) {
                openingBalance = balance || credit || debit || '';
                continue;
            }
            if (/closing balance|eindsaldo/i.test(lineText)) {
                closingBalance = balance || credit || debit || '';
                continue;
            }

            if (!DATE_RE.test(date)) continue;

            transactions.push({ tranListNo, date, desc, debit, credit, balance });
        }
    }

    return { transactions, openingBalance, closingBalance };
}

// ===================== MAIN TEST RUNNER =====================
async function testFile(filePath, fileName) {
    const data = new Uint8Array(fs.readFileSync(filePath));
    let pdfDoc;
    try {
        pdfDoc = await pdfjsLib.getDocument({ data }).promise;
    } catch (e) {
        return { fileName, bank: 'ERROR', error: e.message, txCount: 0 };
    }

    const page1 = await pdfDoc.getPage(1);
    const content = await page1.getTextContent();
    const textItems = content.items.filter(i => i.str && i.str.trim());
    const text = textItems.map(i => i.str).join(' ');
    const bank = detectBank(text);

    if (textItems.length < 5) {
        return { fileName, bank: bank.code, textItems: textItems.length, txCount: 0, note: 'SCANNED/IMAGE PDF - no machine-readable text' };
    }

    let result;
    try {
        switch (bank.code) {
            case 'CAPITEC_SA':
                result = await extractCapitec(pdfDoc);
                return {
                    fileName, bank: 'CAPITEC', txCount: result.transactions.length,
                    openBal: result.openingBalance, closeBal: result.closingBalance,
                    firstTx: result.transactions[0] ? `${result.transactions[0].postDate} ${result.transactions[0].desc} ${result.transactions[0].amount}` : 'none',
                    lastTx: result.transactions.length > 0 ? `${result.transactions[result.transactions.length-1].postDate} ${result.transactions[result.transactions.length-1].desc} ${result.transactions[result.transactions.length-1].amount}` : 'none',
                };

            case 'FNB_SA':
                result = await extractFNB(pdfDoc);
                return {
                    fileName, bank: 'FNB', txCount: result.transactions.length,
                    openBal: result.openingBalance, closeBal: result.closingBalance,
                    firstTx: result.transactions[0] ? `${result.transactions[0].date} ${result.transactions[0].desc} amt=${result.transactions[0].amount}` : 'none',
                    lastTx: result.transactions.length > 0 ? (() => { const t = result.transactions[result.transactions.length-1]; return `${t.date} ${t.desc} amt=${t.amount}`; })() : 'none',
                };

            case 'NEDBANK_SA':
                result = await extractNedbank(pdfDoc);
                return {
                    fileName, bank: 'NEDBANK', txCount: result.transactions.length,
                    openBal: result.openingBalance, closeBal: result.closingBalance,
                    firstTx: result.transactions[0] ? `${result.transactions[0].date} ${result.transactions[0].desc}` : 'none',
                    lastTx: result.transactions.length > 0 ? (() => { const t = result.transactions[result.transactions.length-1]; return `${t.date} ${t.desc}`; })() : 'none',
                };

            default:
                return { fileName, bank: bank.code, txCount: 0, note: 'No specific extractor - would use generic table extraction' };
        }
    } catch (e) {
        return { fileName, bank: bank.code, error: e.message, txCount: 0 };
    }
}

// Expected results from manual verification
const EXPECTED = {
    'Account Statement_5121': { bank: 'CAPITEC', txCount: 6 },
    'Account Statement_8699': { bank: 'CAPITEC', txCount: 42 },
    'Account Statement_8892': { bank: 'CAPITEC', txCount: 159 },
    '02 Feb 2026': { bank: 'FNB', txMin: 85 },
    '2026-01': { bank: 'FNB', txMin: 45 },
    '26 Jan 2026': { bank: 'FNB', txMin: 100 },
    '31 Jan 2026': { bank: 'FNB', txMin: 80 },
    'Br Terence': { bank: 'FNB', txCount: 3 },
    '10. January 2026': { bank: 'NEDBANK', txMin: 28 },
    'January 2026': { bank: 'NEDBANK', txMin: 18 },
};

async function main() {
    const testDir = TEST_DIR;
    const files = fs.readdirSync(testDir).filter(f => f.endsWith('.pdf'));

    console.log('=' .repeat(80));
    console.log('PRISM FILE HERO - COMPREHENSIVE EXTRACTION TEST');
    console.log('=' .repeat(80));
    console.log(`Testing ${files.length} PDF files from: ${testDir}\n`);

    let passed = 0, failed = 0, skipped = 0;

    for (const file of files) {
        const filePath = path.join(testDir, file);
        const result = await testFile(filePath, file);

        // Find matching expected result
        let expected = null;
        for (const [key, exp] of Object.entries(EXPECTED)) {
            if (file.includes(key)) { expected = exp; break; }
        }

        let status = '?';
        if (result.error) {
            status = '! ERROR';
            failed++;
        } else if (result.note?.includes('SCANNED')) {
            status = '~ SCANNED';
            skipped++;
        } else if (!expected) {
            status = '- NO EXPECTED';
            skipped++;
        } else if (expected.txCount && result.txCount === expected.txCount) {
            status = 'PASS';
            passed++;
        } else if (expected.txMin && result.txCount >= expected.txMin) {
            status = 'PASS';
            passed++;
        } else {
            status = 'FAIL';
            failed++;
        }

        const shortName = file.length > 45 ? file.substring(0, 42) + '...' : file;
        console.log(`[${status.padEnd(12)}] ${shortName.padEnd(48)} | Bank: ${(result.bank || '?').padEnd(10)} | Tx: ${String(result.txCount).padEnd(4)} ${expected ? `(expected: ${expected.txCount || '>=' + expected.txMin})` : ''}`);

        if (result.openBal) console.log(`${''.padEnd(16)} Opening: ${result.openBal}  Closing: ${result.closeBal}`);
        if (result.firstTx) console.log(`${''.padEnd(16)} First: ${result.firstTx}`);
        if (result.lastTx && result.txCount > 1) console.log(`${''.padEnd(16)} Last:  ${result.lastTx}`);
        if (result.note) console.log(`${''.padEnd(16)} Note: ${result.note}`);
        if (result.error) console.log(`${''.padEnd(16)} Error: ${result.error}`);
        console.log('');
    }

    console.log('=' .repeat(80));
    console.log(`RESULTS: ${passed} passed, ${failed} failed, ${skipped} skipped out of ${files.length} files`);
    console.log('=' .repeat(80));
}

main().catch(console.error);
