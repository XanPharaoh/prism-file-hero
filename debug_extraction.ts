
import { extractTable } from './services/tableExtractor';
import * as fs from 'fs';
import * as path from 'path';

async function debugExtraction() {
    const downloadsDir = 'c:/Users/Philander/Downloads/Test accounts';
    const filename = '02 Feb 2026 - (Free)..BAV1VFMDBgJVSR1xE1dTEAVQfwRRAAUCDkgdfkRUBhtWV3IDAAYGUAcZEH4UVlQZUwQjBwMEVQIPSxx3S1JXHA.WkJfXW51cnE8JXRoUgUOCQFQClIDA2oACFUFCAYBUwJWVQRQUQUGVwgBAA9UAW4BVg.pdf';
    const filePath = path.join(downloadsDir, filename);

    console.log(`Analyzing: ${filePath}`);

    try {
        const buffer = fs.readFileSync(filePath);
        const file = new File([buffer], filename, { type: 'application/pdf' });

        const result = await extractTable(file);

        console.log('\n--- Metadata ---');
        console.log(JSON.stringify(result.metadata, null, 2));

        console.log('\n--- Detected Headers ---');
        console.log(result.headers);

        console.log('\n--- First 20 Raw Lines (Token Stream) ---');
        // We need to expose raw tokens for debugging, but extractTable returns processed rows.
        // I will rely on the rawLines output if available, or just infer from the table structure.

        result.rawLines.slice(0, 100).forEach((l, i) => {
            const status = l.kind === 'unknown' ? '???' : l.kind.toUpperCase();
            console.log(`[${status}] Page ${l.page} | ${l.text}`);
        });

        console.log('\n--- First 5 Extracted Rows ---');
        result.rows.slice(0, 5).forEach(row => console.log(JSON.stringify(row)));

        console.log('\n--- Problematic Rows (with massive text) ---');
        result.rows.filter(r => r.some(c => c.length > 200)).forEach(r => {
            console.log('LONG ROW:', JSON.stringify(r));
        });

    } catch (err) {
        console.error('Error:', err);
    }
}

debugExtraction();
