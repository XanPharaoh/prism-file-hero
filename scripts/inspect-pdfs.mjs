import fs from 'fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// Check ALL test account PDFs for their characteristics
async function inspect() {
    const dir = 'C:/Users/Philander/Downloads/Test accounts';
    const allFiles = fs.readdirSync(dir).filter(f => f.endsWith('.pdf'));
    
    for (const fname of allFiles) {
        const p = `${dir}/${fname}`;
        console.log(`\n=== ${fname} ===`);
        try {
            const bytes = fs.readFileSync(p);
            const pdf = await pdfjs.getDocument({data: new Uint8Array(bytes)}).promise;
            const page = await pdf.getPage(1);
            const content = await page.getTextContent();
            const textCount = content.items.length;
            
            // Detect bank from first page text
            const allText = content.items.map(i => i.str).join(' ').toLowerCase();
            let bank = 'UNKNOWN';
            if (allText.includes('capitec')) bank = 'CAPITEC';
            else if (allText.includes('first national') || allText.includes('fnb')) bank = 'FNB';
            else if (allText.includes('nedbank')) bank = 'NEDBANK';
            else if (allText.includes('standard bank')) bank = 'STANDARD';
            else if (allText.includes('absa')) bank = 'ABSA';
            else if (allText.includes('tymebank') || allText.includes('tyme')) bank = 'TYMEBANK';
            
            console.log(`  Bank: ${bank} | Pages: ${pdf.numPages} | Text items page1: ${textCount}`);
            
            if (textCount === 0) {
                console.log(`  ** SCANNED IMAGE - needs OCR **`);
            }
        } catch (e) {
            if (e.message.includes('password') || e.message.includes('Password')) {
                console.log(`  ** PASSWORD PROTECTED **`);
            } else {
                console.log(`  ERROR: ${e.message}`);
            }
        }
    }
}

inspect().catch(console.error);