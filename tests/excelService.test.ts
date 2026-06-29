import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock exceljs module
const mockAddRow = vi.fn();
const mockWriteBuffer = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
const mockAddWorksheet = vi.fn().mockReturnValue({ columns: [], addRow: mockAddRow });

vi.mock('exceljs', () => {
    return {
        Workbook: class MockWorkbook {
            worksheets: any[] = [];
            xlsx = { writeBuffer: mockWriteBuffer };
            addWorksheet = mockAddWorksheet;
        },
    };
});

import { downloadAsExcel, getExcelBlob } from '../services/excelService';

describe('excelService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockAddWorksheet.mockReturnValue({ columns: [], addRow: mockAddRow });
    });

    describe('downloadAsExcel', () => {
        it('should create a workbook and write to a blob', async () => {
            const data = [
                { Name: 'Alice', Amount: 100 },
                { Name: 'Bob', Amount: 200 },
            ];

            await downloadAsExcel(data, 'test_output.xlsx');

            expect(mockAddWorksheet).toHaveBeenCalledWith('Transactions');
            expect(mockAddRow).toHaveBeenCalled();
            expect(mockWriteBuffer).toHaveBeenCalled();
        });

        it('should use default filename when none provided', async () => {
            const data = [{ col: 1 }];

            await downloadAsExcel(data);

            expect(mockWriteBuffer).toHaveBeenCalled();
        });

        it('should handle empty data array gracefully', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            await downloadAsExcel([]);

            expect(consoleSpy).toHaveBeenCalledWith('No data to export.');
            expect(mockWriteBuffer).not.toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    describe('getExcelBlob', () => {
        it('should return a Blob for valid rows', async () => {
            const rows = [{ A: '1', B: '2' }];
            const blob = await getExcelBlob(rows);
            expect(blob).toBeInstanceOf(Blob);
            expect(mockAddWorksheet).toHaveBeenCalledWith('Transactions');
        });

        it('should create an Empty sheet for no rows', async () => {
            const blob = await getExcelBlob([]);
            expect(blob).toBeInstanceOf(Blob);
            expect(mockAddWorksheet).toHaveBeenCalledWith('Empty');
        });
    });
});
