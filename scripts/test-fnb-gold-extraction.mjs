import fs from 'fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Test FNB Gold extraction by simulating the FNB extractor logic
 * for the "02 Feb" and "26 Jan" Gold Business Account PDFs.
 */

const TEST_DIR = 'C:/Users/Philander/Downloads/Test accounts';
const GOLD_PREFIXES = ['02 Feb 2026', '26 Jan 2026', '31 Jan 2026', '2026-01', 'Br Terence'];

const FNB_GOLD_COLUMNS = [
    { name: 'Date', xLeft: 0, xRight: 35 },
    { name: 'Description', xLeft: 35, xRight: 430 },
    { name: 'Amount', xLeft: 430, xRight: 485 },
    { name: 'Balance', xLeft: 485, xRight: 548 },
    { name: 'Charges', xLeft: 548, xRight: 620 },
];

async function testExtraction() {
    const allFiles = fs.readdirSync(TEST_DIR).filter(f => f.endsWith('.pdf'));
    for (const prefix of GOLD_PREFIXES) {
        const fname = allFiles.find(f => f.startsWith(prefix));
        if (!fname) { console.log(`NOT FOUND: ${prefix}*`); continue; }
        const fpath = `${TEST_DIR}/${fname}`;
        
        const bytes = fs.readFileSync(fpath);
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
        
        console.log(`\n${'='.repeat(70)}`);
        console.log(`FILE: ${fname.substring(0, 50)}`);
        console.log(`Pages: ${pdf.numPages}`);
        
        let totalRows = 0;
        const sampleRows = [];
        
        for (let p = 1; p <= Math.min(pdf.numPages, 3); p++) {
            const page = await pdf.getPage(p);
            const content = await page.getTextContent();
            
            const items = content.items.map(item => ({
                str: item.str,
                x: item.transform[4],
                y: item.transform[5],
            }));
            
            // Group by Y
            const lineMap = new Map();
            for (const item of items) {
                const yKey = Math.round(item.y / 5) * 5;
                if (!lineMap.has(yKey)) lineMap.set(yKey, []);
                lineMap.get(yKey).push(item);
            }
            
            const sortedY = Array.from(lineMap.keys()).sort((a, b) => b - a);
            let pageRows = 0;
            
            for (const y of sortedY) {
                const lineItems = lineMap.get(y).sort((a, b) => a.x - b.x);
                
                // Assign to columns using range matching
                const row = { Date: '', Description: '', Amount: '', Balance: '', Charges: '' };
                for (const item of lineItems) {
                    for (const col of FNB_GOLD_COLUMNS) {
                        if (item.x >= col.xLeft && item.x < col.xRight) {
                            row[col.name] = row[col.name] 
                                ? row[col.name] + ' ' + item.str 
                                : item.str;
                            break;
                        }
                    }
                }
                
                // Clean up
                for (const key of Object.keys(row)) row[key] = row[key].trim();
                
                // Check if it's a transaction (has date + amount or balance)
                const isDate = /^\d{1,2}\s+[A-Za-z]{3}$/.test(row.Date);
                const hasNumbers = row.Amount || row.Balance;
                
                if (isDate && hasNumbers) {
                    pageRows++;
                    if (totalRows + pageRows <= 5 || (totalRows + pageRows) % 20 === 0) {
                        sampleRows.push(row);
                    }
                }
            }
            totalRows += pageRows;
            console.log(`  Page ${p}: ${pageRows} transactions`);
        }
        
        console.log(`  TOTAL: ${totalRows} transactions (first ${Math.min(pdf.numPages, 3)} pages)`);
        console.log(`  Sample rows:`);
        for (const r of sampleRows.slice(0, 8)) {
            console.log(`    ${r.Date.padEnd(8)} | ${r.Description.substring(0, 40).padEnd(40)} | ${r.Amount.padEnd(15)} | ${r.Balance.padEnd(15)} | ${r.Charges}`);
        }
    }
}

testExtraction().catch(console.error);
