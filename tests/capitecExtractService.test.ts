import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { extractCapitecStatement, convertCapitecToExcelRows } from '../services/capitecExtractService';

describe('Capitec Extraction Service', () => {
    it('extracts real Capitec Business statement from PDF with 100% precision', async () => {
        const filePath = '/home/philander/Downloads/1) March - May 2024.pdf';
        if (!fs.existsSync(filePath)) {
            // Skip if user file not present in environment
            return;
        }

        const buf = fs.readFileSync(filePath);
        const file = new File([buf], '1) March - May 2024.pdf', { type: 'application/pdf' });
        const result = await extractCapitecStatement(file);

        expect(result.format).toBe('business');
        expect(result.transactions.length).toBe(90);
        expect(result.openingBalance).toBe('0.00');
        expect(result.closingBalance).toBe('10815.65');
        expect(result.feeTotal).toBe('-310.00');
        expect(result.accountNumber).toBe('1051982650');
        expect(result.statementPeriod).toContain('01 March 2024');

        const excelRows = convertCapitecToExcelRows(result.transactions);
        expect(excelRows).toHaveLength(90);
        expect(Object.keys(excelRows[0])).toEqual([
            'Date', 'Description', 'Reference', 'Money In', 'Money Out', 'Fees', 'Balance'
        ]);

        // Verify multi-line reference merge
        const crTrfTx = excelRows.find(r => r.Date === '04/04/2024' && r.Description === 'Cr Trf');
        expect(crTrfTx?.Reference).toContain('Malibu Metals THEO Payment');
        expect(crTrfTx?.Reference).toContain('1051330076');
        expect(crTrfTx?.['Money In']).toBe(6408);
        expect(crTrfTx?.Balance).toBe(6436);
    });

    it('converts personal Capitec transactions into legacy 7-column schema', () => {
        const sampleTx = [
            {
                PostDate: '02/01/2026',
                TransDate: '02/01/2026',
                Description: 'Debit Order',
                Reference: 'Insurance',
                Fees: '-5.00',
                Amount: '-500.00',
                Balance: '4500.00',
                _raw: '',
                _page: 1
            }
        ];

        const rows = convertCapitecToExcelRows(sampleTx);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({
            'Post Date': '02/01/2026',
            'Trans Date': '02/01/2026',
            'Description': 'Debit Order',
            'Reference': 'Insurance',
            'Fees': '-5.00',
            'Amount': '-500.00',
            'Balance': '4500.00',
        });
    });
});
