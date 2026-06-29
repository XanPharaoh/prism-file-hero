import fs from 'fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Batch evaluation: run all test PDFs through the same extraction logic
 * that the app uses, and report results.
 */

const TEST_DIR = 'C:/Users/Philander/Downloads/Test accounts';

async function evaluate() {
    const files = fs.readdirSync(TEST_DIR).filter(f => f.endsWith('.pdf'));
    
    console.log(`\n============================================`);
    console.log(`  EXTRACTION EVALUATION - ${files.length} PDFs`);
    console.log(`============================================\n`);

    const results = [];
    
    for (const fname of files) {
        const fpath = `${TEST_DIR}/${fname}`;
        const shortName = fname.length > 50 ? fname.substring(0, 47) + '...' : fname;
        
        try {
            const bytes = fs.readFileSync(fpath);
            let pdf;
            try {
                pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
            } catch (e) {
                if (e.message?.includes('password') || e.message?.includes('Password') || e.name === 'PasswordException') {
                    results.push({ file: shortName, status: 'PASSWORD', bank: '?', textItems: 0, note: 'Password-protected' });
                    console.log(`  [LOCKED]  ${shortName} -- Password-protected`);
                    continue;
                }
                throw e;
            }

            const page1 = await pdf.getPage(1);
            const content = await page1.getTextContent();
            const textCount = content.items.length;
            const allText = content.items.map(i => i.str).join(' ').toLowerCase();
            
            // Detect bank
            let bank = 'UNKNOWN';
            if (allText.includes('first national') || allText.includes('fnb.co.za') || allText.includes('fnb app') || allText.includes('fnb ob')) bank = 'FNB';
            else if (allText.includes('capitec bank')) bank = 'CAPITEC';
            else if (allText.includes('nedbank')) bank = 'NEDBANK';
            else if (allText.includes('standard bank')) bank = 'STANDARD';
            else if (allText.includes('absa')) bank = 'ABSA';
            else if (allText.includes('tymebank') || allText.includes('tyme')) bank = 'TYMEBANK';

            if (textCount === 0) {
                results.push({ file: shortName, status: 'SCAN', bank, textItems: 0, note: 'Scanned image - needs OCR' });
                console.log(`  [SCAN]    ${shortName} -- Scanned image (0 text items)`);
                continue;
            }

            // For Capitec: simulate extraction
            if (bank === 'CAPITEC') {
                const txCount = await countCapitecTransactions(pdf);
                const status = txCount > 0 ? 'OK' : 'FAIL';
                results.push({ file: shortName, status, bank, textItems: textCount, rows: txCount });
                console.log(`  [${status.padEnd(7)}] ${shortName} -- ${bank} | ${textCount} items | ${txCount} tx rows`);
            } else if (bank === 'FNB') {
                // Count data lines with date patterns
                const txCount = await countDateLines(pdf);
                results.push({ file: shortName, status: txCount > 0 ? 'OK' : 'WARN', bank, textItems: textCount, rows: txCount });
                console.log(`  [${txCount > 0 ? 'OK     ' : 'WARN   '}] ${shortName} -- ${bank} | ${textCount} items | ~${txCount} date lines`);
            } else {
                const txCount = await countDateLines(pdf);
                results.push({ file: shortName, status: txCount > 0 ? 'OK' : 'WARN', bank, textItems: textCount, rows: txCount });
                console.log(`  [${txCount > 0 ? 'OK     ' : 'WARN   '}] ${shortName} -- ${bank} | ${textCount} items | ~${txCount} date lines`);
            }
        } catch (e) {
            results.push({ file: shortName, status: 'ERROR', note: e.message });
            console.log(`  [ERROR]   ${shortName} -- ${e.message}`);
        }
    }

    // Summary
    const ok = results.filter(r => r.status === 'OK').length;
    const warn = results.filter(r => r.status === 'WARN').length;
    const fail = results.filter(r => r.status === 'FAIL').length;
    const locked = results.filter(r => r.status === 'PASSWORD').length;
    const scan = results.filter(r => r.status === 'SCAN').length;
    const err = results.filter(r => r.status === 'ERROR').length;

    console.log(`\n--------------------------------------------`);
    console.log(`  SUMMARY: ${ok} OK | ${warn} WARN | ${fail} FAIL | ${locked} LOCKED | ${scan} SCAN | ${err} ERROR`);
    console.log(`--------------------------------------------\n`);
}

async function countCapitecTransactions(pdf) {
    let count = 0;
    const pageCount = Math.min(pdf.numPages, 10);
    for (let p = 1; p <= pageCount; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const lineMap = new Map();
        for (const item of content.items) {
            const y = Math.round(item.transform[5] / 3) * 3;
            if (!lineMap.has(y)) lineMap.set(y, []);
            lineMap.get(y).push({ str: item.str, x: Math.round(item.transform[4]) });
        }
        for (const [, items] of lineMap) {
            const sorted = items.sort((a, b) => a.x - b.x);
            // A Capitec transaction line starts with a date at x~38
            const first = sorted[0];
            if (first && first.x < 50 && /^\d{2}\/\d{2}\/\d{2}/.test(first.str.trim())) {
                count++;
            }
        }
    }
    return count;
}

async function countDateLines(pdf) {
    let count = 0;
    const pageCount = Math.min(pdf.numPages, 10);
    for (let p = 1; p <= pageCount; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        for (const item of content.items) {
            const str = item.str.trim();
            if (/^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(str) ||
                /^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}$/.test(str) ||
                /^\d{2}\/\d{2}\/\d{2}/.test(str) ||
                /^\d{2}\s+[A-Za-z]{3}$/.test(str)) {
                count++;
            }
        }
    }
    return count;
}

evaluate().catch(console.error);
