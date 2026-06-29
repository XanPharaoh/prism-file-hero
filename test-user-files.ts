import { processDocumentExcel } from './services/documentService';
import { extractFNBStatement } from './services/fnbExtractService';
import fs from 'fs';
import path from 'path';

async function testFiles() {
    const testAccountsDir = 'c:/Users/Philander/Downloads/Test accounts';
    if (!fs.existsSync(testAccountsDir)) {
        console.error('Test accounts directory not found:', testAccountsDir);
        return;
    }

    const files = fs.readdirSync(testAccountsDir).filter(f => f.endsWith('.pdf'));
    console.log('Found PDF files:', files);

    for (const file of files) {
        const filePath = path.join(testAccountsDir, file);
        console.log(`\n--- Testing ${file} ---`);
        try {
            const buffer = fs.readFileSync(filePath);
            const fileObj = new File([buffer], file, { type: 'application/pdf' });

            const result = await processDocumentExcel(fileObj, {});
            console.log(`Extracted metadata:`, result.metadata);
            console.log(`Extracted rows (first 5):`, result.rows.slice(0, 5));
        } catch (e) {
            console.error(`Error processing ${file}:`, e);
        }
    }
}

testFiles();
