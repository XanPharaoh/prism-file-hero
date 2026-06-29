
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pdfjsPkg = require.resolve('pdfjs-dist/package.json');
const pdfjsDir = path.dirname(pdfjsPkg);
const standardFontDataUrl = pathToFileURL(path.join(pdfjsDir, 'standard_fonts/')).toString();

/**
 * Deterministic Grid Parser
 * Reconstructs tables from PDF text layers without AI intervention.
 */
async function deterministicExtract(pdfPath) {
    try {
        const data = new Uint8Array(await readFile(pdfPath));
        const loadingTask = pdfjs.getDocument({ data, standardFontDataUrl });
        const pdf = await loadingTask.promise;

        console.log(`\n=== DETERMINISTIC EXTRACTION: ${pdfPath} ===`);

        for (let i = 1; i <= Math.min(pdf.numPages, 2); i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();

            // Items are in random order in the PDF stream often
            const items = textContent.items.map(item => ({
                str: item.str,
                x: item.transform[4],
                y: item.transform[5],
                width: item.width,
                height: item.height
            }));

            // 1. Group by Y coordinate (Row Detection)
            // We use a tolerance (e.g., 5 points) because letters might be slightly offset
            const rows = [];
            const sortedByY = [...items].sort((a, b) => b.y - a.y); // Top to bottom

            if (sortedByY.length === 0) continue;

            let currentRow = [sortedByY[0]];
            for (let j = 1; j < sortedByY.length; j++) {
                const lastY = currentRow[0].y;
                const currentY = sortedByY[j].y;

                if (Math.abs(lastY - currentY) < 5) {
                    currentRow.push(sortedByY[j]);
                } else {
                    rows.push(currentRow.sort((a, b) => a.x - b.x));
                    currentRow = [sortedByY[j]];
                }
            }
            rows.push(currentRow.sort((a, b) => a.x - b.x));

            // 2. Display the 'Hardcoded' result
            console.log(`PAGE ${i} GRID:`);
            rows.slice(0, 30).forEach((row, idx) => {
                const line = row.map(cell => cell.str).join(' | ');
                if (line.trim().length > 5) {
                    console.log(`[R${idx}] ${line}`);
                }
            });
        }
    } catch (err) {
        console.error(`Error: ${err.message}`);
    }
}

const files = process.argv.slice(2).length
    ? process.argv.slice(2)
    : [
        'd:/prism-file-hero/Robbie Accountants 2026-01.pdf',
        'c:/Users/Philander/Downloads/Test accounts/January 2026.pdf'
    ];

for (const file of files) {
    await deterministicExtract(file);
}
