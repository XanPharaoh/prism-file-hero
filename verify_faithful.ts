import { extractTable } from './services/tableExtractor.ts';
import pkg from 'fs';
const { readFileSync, writeFileSync } = pkg;
// Note: In an actual environment, extractTable expects a Browser File object.
// For Node.js testing, we'll mock the necessary parts.

async function testExtraction() {
    const pdfPath = 'C:/Users/Philander/Downloads/Test accounts/10. January 2026.pdf';
    console.log(`Loading PDF from: ${pdfPath}`);

    try {
        const data = readFileSync(pdfPath);
        // Mock File object
        const file = {
            arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
            name: '10. January 2026.pdf'
        } as unknown as File;

        console.log("Starting extraction...");
        const result = await extractTable(file);

        console.log("Extraction Complete.");
        console.log(`Headers: ${JSON.stringify(result.headers)}`);
        console.log(`Rows Found: ${result.rows.length}`);
        console.log(`Confidence: ${(result.metadata.confidence * 100).toFixed(1)}%`);

        // Sample lines if extraction failed to find table
        if (result.headers[0] === 'Content') {
            console.log("\nTable header not detected. First 50 raw lines:");
            result.rows.slice(0, 50).forEach((row, i) => {
                console.log(`${i + 1}: ${row[0]}`);
            });
        }

        // Sample Rows
        console.log("\nSample Rows (First 5):");
        result.rows.slice(0, 5).forEach((row, i) => {
            console.log(`${i + 1}: ${JSON.stringify(row)}`);
        });

        // Verification Logic
        const expectedHeaders = ['Tran list no', 'Date', 'Description', 'Fees (R)', 'Debits (R)', 'Credits (R)', 'Balance (R)'];
        const matchedHeaders = expectedHeaders.filter(h =>
            result.headers.some(rh => rh.toLowerCase().includes(h.toLowerCase().split(' ')[0]))
        );

        console.log(`\nHeader Match: ${matchedHeaders.length}/${expectedHeaders.length}`);

        if (result.rows.length > 20) {
            console.log("✅ Success: Significant number of rows extracted.");
        } else {
            console.log("❌ Failure: Too few rows extracted.");
        }

        if (result.metadata.confidence > 0.8) {
            console.log("✅ Success: High confidence score.");
        } else {
            console.log("⚠️ Warning: Confidence score below 80%.");
        }

    } catch (err) {
        console.error("Extraction Failed:", err);
    }
}

testExtraction();
