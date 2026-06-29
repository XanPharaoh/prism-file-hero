import fs from 'fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// Deep inspect the failing Capitec: 26 Jan 2026 file
async function inspect() {
    const files = [
        'C:/Users/Philander/Downloads/Test accounts/26 Jan 2026 - (Free)..UANyAFoHUgUPGB12EVEDEFMBK1IPA1RXBxlNc0pUUx4BBX8DXgsAV1AYGnERAQQaCgd_WAhTBAoAT00iQF1SHA.DEBUDWtxJnZmdHRvUAdeDVEHUAdRADtVAQRVBQgBBgcDAwVUAgADVlcBBQFQVD4CDQ.pdf',
        'C:/Users/Philander/Downloads/Test accounts/02 Feb 2026 - (Free)..BAV1VFMDBgJVSR1xE1dTEAVQfwRRAAUCDkgdfkRUBhtWV3IDAAYGUAcZEH4UVlQZUwQjBwMEVQIPSxx3S1JXHA.WkJfXW51cnE8JXRoUgUOCQFQClIDA2oACFUFCAYBUwJWVQRQUQUGVwgBAA9UAW4BVg.pdf',
    ];

    for (const p of files) {
        const name = p.split('/').pop().substring(0, 40);
        console.log(`\n=== ${name} ===`);
        const bytes = fs.readFileSync(p);
        const pdf = await pdfjs.getDocument({data: new Uint8Array(bytes)}).promise;
        
        // Show page 1 lines
        const page = await pdf.getPage(1);
        const content = await page.getTextContent();
        
        const lineMap = new Map();
        for (const item of content.items) {
            const y = Math.round(item.transform[5] / 3) * 3;
            if (!lineMap.has(y)) lineMap.set(y, []);
            lineMap.get(y).push({ str: item.str, x: Math.round(item.transform[4]) });
        }
        
        const sortedY = Array.from(lineMap.keys()).sort((a, b) => b - a);
        let lineCount = 0;
        for (const y of sortedY) {
            if (lineCount++ > 30) break;
            const items = lineMap.get(y).sort((a, b) => a.x - b.x);
            const line = items.map(i => `[x=${i.x}]"${i.str}"`).join('  ');
            console.log(`  Y=${y}: ${line}`);
        }
    }
}

inspect().catch(console.error);
