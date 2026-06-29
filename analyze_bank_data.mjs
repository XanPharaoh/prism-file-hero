
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pdfjsPkg = require.resolve('pdfjs-dist/package.json');
const pdfjsDir = path.dirname(pdfjsPkg);
const standardFontDataUrl = pathToFileURL(path.join(pdfjsDir, 'standard_fonts/')).toString();

async function extractText(pdfPath) {
    try {
        const data = new Uint8Array(await readFile(pdfPath));
        const loadingTask = pdfjs.getDocument({ data, standardFontDataUrl });
        const pdf = await loadingTask.promise;

        console.log(`--- Analyzing: ${pdfPath} ---`);
        for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const text = textContent.items.map(item => item.str).join(' ');
            console.log(`\n[PAGE ${i}]: ${text.substring(0, 3000)}`);
        }
    } catch (err) {
        console.error(`Error: ${pdfPath} - ${err.message}`);
    }
}

async function run() {
    const testDir = 'c:/Users/Philander/Downloads/Test accounts';
    const files = (await readdir(testDir))
        .filter(f => f.toLowerCase().endsWith('.pdf'))
        .map(f => join(testDir, f));

    for (const file of files) {
        await extractText(file);
    }
}

await run();
