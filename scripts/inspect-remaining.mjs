import fs from 'fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Quick check on under-explored files: "Br Terence" (3 date lines) and "2026-01" (FNB).
 */

const TEST_DIR = 'C:/Users/Philander/Downloads/Test accounts';

async function inspectFile(fname) {
    const fpath = `${TEST_DIR}/${fname}`;
    const bytes = fs.readFileSync(fpath);
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`FILE: ${fname} (${pdf.numPages} pages)`);
    
    for (let p = 1; p <= Math.min(pdf.numPages, 2); p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        
        const items = content.items.map(item => ({
            str: item.str,
            x: Math.round(item.transform[4]),
            y: Math.round(item.transform[5]),
        }));
        
        // Group by Y
        const lineMap = new Map();
        for (const item of items) {
            const yKey = Math.round(item.y / 3) * 3;
            if (!lineMap.has(yKey)) lineMap.set(yKey, []);
            lineMap.get(yKey).push(item);
        }
        
        const sortedYs = Array.from(lineMap.keys()).sort((a, b) => b - a);
        
        console.log(`\n  --- Page ${p}: ${items.length} items, ${sortedYs.length} lines ---`);
        
        // Show first 20 lines
        for (const y of sortedYs.slice(0, 25)) {
            const lineItems = lineMap.get(y).sort((a, b) => a.x - b.x);
            const parts = lineItems.map(i => `[x=${i.x}]"${i.str}"`).join('  ');
            console.log(`  Y=${y}: ${parts}`);
        }
    }
}

async function main() {
    await inspectFile('Br Terence 2026-01.pdf');
    await inspectFile('2026-01.pdf');
}

main().catch(console.error);
