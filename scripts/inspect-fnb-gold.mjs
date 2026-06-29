import fs from 'fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// Show data lines from the FNB Gold Business Account statement
async function inspect() {
    // 02 Feb file - known FNB Gold
    const fpath = 'C:/Users/Philander/Downloads/Test accounts/02 Feb 2026 - (Free)..BAV1VFMDBgJVSR1xE1dTEAVQfwRRAAUCDkgdfkRUBhtWV3IDAAYGUAcZEH4UVlQZUwQjBwMEVQIPSxx3S1JXHA.WkJfXW51cnE8JXRoUgUOCQFQClIDA2oACFUFCAYBUwJWVQRQUQUGVwgBAA9UAW4BVg.pdf';
    const bytes = fs.readFileSync(fpath);
    const pdf = await pdfjs.getDocument({data: new Uint8Array(bytes)}).promise;

    // Check pages 1 and 2 for actual transaction lines
    for (let pg = 1; pg <= 2; pg++) {
        const page = await pdf.getPage(pg);
        const content = await page.getTextContent();
        
        const lineMap = new Map();
        for (const item of content.items) {
            const y = Math.round(item.transform[5] / 3) * 3;
            if (!lineMap.has(y)) lineMap.set(y, []);
            lineMap.get(y).push({ str: item.str, x: Math.round(item.transform[4]) });
        }
        
        const sortedY = Array.from(lineMap.keys()).sort((a, b) => b - a);
        console.log(`\n--- Page ${pg} transaction lines ---`);
        
        for (const y of sortedY) {
            const items = lineMap.get(y).sort((a, b) => a.x - b.x);
            const fullLine = items.map(i => i.str).join(' ').trim();
            // Look for lines that start with a day number (transaction date)
            const firstItem = items[0];
            if (firstItem && /^\d{2}\s/.test(firstItem.str.trim())) {
                const line = items.map(i => `[x=${i.x}]"${i.str}"`).join('  ');
                console.log(`  Y=${y}: ${line}`);
            }
        }
    }
    
    // Also check 26 Jan file
    const fpath2 = 'C:/Users/Philander/Downloads/Test accounts/26 Jan 2026 - (Free)..UANyAFoHUgUPGB12EVEDEFMBK1IPA1RXBxlNc0pUUx4BBX8DXgsAV1AYGnERAQQaCgd_WAhTBAoAT00iQF1SHA.DEBUDWtxJnZmdHRvUAdeDVEHUAdRADtVAQRVBQgBBgcDAwVUAgADVlcBBQFQVD4CDQ.pdf';
    const bytes2 = fs.readFileSync(fpath2);
    const pdf2 = await pdfjs.getDocument({data: new Uint8Array(bytes2)}).promise;
    
    console.log(`\n=== 26 Jan file - first data lines ===`);
    // Check if "capitec" is really in this file or if it's FNB
    const p1 = await pdf2.getPage(1);
    const c1 = await p1.getTextContent();
    const allText = c1.items.map(i => i.str).join(' ').toLowerCase();
    console.log('Contains "capitec":', allText.includes('capitec'));
    console.log('Contains "fnb":', allText.includes('fnb'));
    console.log('Contains "first national":', allText.includes('first national'));
}

inspect().catch(console.error);
