import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';

vi.mock('../services/authService', () => ({
    getAuthToken: vi.fn().mockResolvedValue('test-token'),
}));

vi.mock('../services/internalDeviceAuth', () => ({
    getInternalAiHeaders: vi.fn().mockResolvedValue({
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-internal-token',
    }),
}));

// ──────────────────────────────────────────────────
// Mock pdfjs-dist (canvas-dependent)
// ──────────────────────────────────────────────────
vi.mock('pdfjs-dist', () => ({
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: vi.fn().mockReturnValue({
        promise: Promise.resolve({
            numPages: 1,
            getPage: vi.fn().mockResolvedValue({
                getViewport: vi.fn().mockReturnValue({ width: 612, height: 792 }),
                render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
            }),
        }),
    }),
}));

// Mock encryptPDF
vi.mock('@pdfsmaller/pdf-encrypt-lite', () => ({
    encryptPDF: vi.fn().mockImplementation(async (bytes: Uint8Array) => bytes),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { createTextPdf } from '../services/pdfService';
import { processWithAI } from '../services/geminiService';

// Helper: create a Groq-like API response
function groqResponse(content: any) {
    return {
        ok: true,
        json: () => Promise.resolve({
            choices: [{ message: { content: JSON.stringify(content) } }],
        }),
    };
}

// ──────────────────────────────────────────────────
// INTEGRATION TESTS: OCR Pipeline & Recent Fixes
// ──────────────────────────────────────────────────

describe('Integration: OCR Pipeline', () => {
    beforeEach(() => {
        mockFetch.mockReset();
    });

    // ─── createTextPdf ─────────────────────────────
    describe('createTextPdf', () => {
        it('should create a valid PDF from plain text', async () => {
            // Arrange
            const text = 'Hello World\nLine two\nLine three';

            // Act
            const blob = await createTextPdf(text);

            // Assert
            expect(blob).toBeInstanceOf(Blob);
            expect(blob.type).toBe('application/pdf');
            expect(blob.size).toBeGreaterThan(0);

            // Verify it's a valid PDF by loading it
            const doc = await PDFDocument.load(await blob.arrayBuffer());
            expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
        });

        it('should include title when provided', async () => {
            // Arrange
            const text = 'Some transaction data';

            // Act
            const blob = await createTextPdf(text, 'OCR: November Statement.pdf');

            // Assert
            const doc = await PDFDocument.load(await blob.arrayBuffer());
            expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
            expect(blob.size).toBeGreaterThan(100);
        });

        it('should handle empty text without crashing', async () => {
            // Act
            const blob = await createTextPdf('');

            // Assert
            expect(blob).toBeInstanceOf(Blob);
            const doc = await PDFDocument.load(await blob.arrayBuffer());
            expect(doc.getPageCount()).toBe(1);
        });

        it('should paginate long text into multiple pages', async () => {
            // Arrange: 200 lines should exceed one A4 page
            const lines = Array.from({ length: 200 }, (_, i) => `Transaction ${i + 1}: R${(Math.random() * 1000).toFixed(2)}`);
            const text = lines.join('\n');

            // Act
            const blob = await createTextPdf(text, 'Bank Statement');

            // Assert: should have more than 1 page
            const doc = await PDFDocument.load(await blob.arrayBuffer());
            expect(doc.getPageCount()).toBeGreaterThan(1);
        });

        it('should handle Markdown headers and separators', async () => {
            // Arrange
            const text = [
                '# Statement Summary',
                '## Account Details',
                'Account: 123456789',
                '---',
                '### Transactions',
                '| Date | Description | Amount |',
                '| 2024-11-01 | Groceries | R150.00 |',
                '| 2024-11-02 | Fuel | R850.00 |',
            ].join('\n');

            // Act
            const blob = await createTextPdf(text, 'November Statement OCR');

            // Assert
            expect(blob).toBeInstanceOf(Blob);
            const doc = await PDFDocument.load(await blob.arrayBuffer());
            expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
        });

        it('should handle very long lines with word wrapping', async () => {
            // Arrange: a single line with 500+ characters
            const longLine = 'This is a very long transaction description that includes extensive details about the purchase including the merchant name, location, reference number, and various other metadata fields that would normally be truncated '.repeat(5);

            // Act
            const blob = await createTextPdf(longLine);

            // Assert: should not crash, should produce valid PDF
            expect(blob).toBeInstanceOf(Blob);
            const doc = await PDFDocument.load(await blob.arrayBuffer());
            expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
        });
    });

    // ─── mergeResults (via processWithAI batching) ──
    describe('Batch merging', () => {
        it('should batch 4+ images into groups of 3', async () => {
            // Arrange: 4 images → 2 metered batches (2 + 2)
            const response = { data: 'Page text here', summary: 'Extracted text' };
            mockFetch.mockResolvedValue(groqResponse(response));

            const images = [
                { base64: 'a', pageNumber: 1 },
                { base64: 'b', pageNumber: 2 },
                { base64: 'c', pageNumber: 3 },
                { base64: 'd', pageNumber: 4 },
            ];

            // Act
            const result = await processWithAI('ocr', images);

            // Assert: 2 API calls (batch of 3 + batch of 1)
            expect(mockFetch).toHaveBeenCalledTimes(2);
            // Result should contain merged data
            expect(result.text).toContain('Page text here');
        });

        it('splits more than two images into metered batches', async () => {
            // Arrange
            mockFetch.mockResolvedValue(groqResponse({ data: 'ok' }));

            // Act
            await processWithAI('ocr', [
                { base64: 'a', pageNumber: 1 },
                { base64: 'b', pageNumber: 2 },
                { base64: 'c', pageNumber: 3 },
            ]);

            // The server allocation permits two images per request.
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });

        it('should merge text data from multiple batches with separator', async () => {
            // Arrange
            mockFetch
                .mockResolvedValueOnce(groqResponse({ data: 'Batch 1 text', summary: 'Batch 1' }))
                .mockResolvedValueOnce(groqResponse({ data: 'Batch 2 text', summary: 'Batch 2' }));

            const images = Array.from({ length: 4 }, (_, i) => ({ base64: `img${i}`, pageNumber: i + 1 }));

            // Act
            const result = await processWithAI('ocr', images);

            // Assert
            expect(result.text).toContain('Batch 1 text');
            expect(result.text).toContain('Batch 2 text');
            expect(result.text).toContain('---'); // Separator between batches
        });

        it('should handle object data in merge without crashing (the [object Object] fix)', async () => {
            // Arrange: AI returns data as object (not string) — this was the bug
            mockFetch
                .mockResolvedValueOnce(groqResponse({ data: { text: 'page 1 content' }, summary: 'Batch 1' }))
                .mockResolvedValueOnce(groqResponse({ data: { text: 'page 2 content' }, summary: 'Batch 2' }));

            const images = Array.from({ length: 4 }, (_, i) => ({ base64: `img${i}`, pageNumber: i + 1 }));

            // Act
            const result = await processWithAI('ocr', images);

            // Assert: should NOT contain [object Object]
            expect(result.text).not.toContain('[object Object]');
            expect(result.text).toContain('page 1 content');
            expect(result.text).toContain('page 2 content');
        });

        it('should merge pdf-to-excel rows from multiple batches', async () => {
            // Arrange: each batch returns structured row data
            mockFetch
                .mockResolvedValueOnce(groqResponse({
                    rows: [{ date: '2024-11-01', desc: 'Groceries', amount: 150 }],
                    summary: 'Batch 1',
                }))
                .mockResolvedValueOnce(groqResponse({
                    rows: [{ date: '2024-11-15', desc: 'Fuel', amount: 850 }],
                    summary: 'Batch 2',
                }));

            const images = Array.from({ length: 4 }, (_, i) => ({ base64: `img${i}`, pageNumber: i + 1 }));

            // Act
            const result = await processWithAI('pdf-to-excel', images);

            // Assert: rows should be merged into single array
            expect(result.rows).toHaveLength(2);
            expect(result.rows[0].desc).toBe('Groceries');
            expect(result.rows[1].desc).toBe('Fuel');
        });

        it('should merge redact PII regions from multiple batches', async () => {
            // Arrange
            mockFetch
                .mockResolvedValueOnce(groqResponse({
                    regions: [{ page: 1, x: 10, y: 20, width: 30, height: 5, text: 'John', category: 'name' }],
                    summary: 'Found name',
                }))
                .mockResolvedValueOnce(groqResponse({
                    regions: [{ page: 4, x: 50, y: 60, width: 40, height: 5, text: '123456', category: 'id' }],
                    summary: 'Found ID',
                }));

            const images = Array.from({ length: 4 }, (_, i) => ({ base64: `img${i}`, pageNumber: i + 1 }));

            // Act
            const result = await processWithAI('redact', images);

            // Assert: PII regions merged into flat array
            expect(result.regions).toHaveLength(2);
            expect(result.regions[0].text).toBe('John');
            expect(result.regions[1].text).toBe('123456');
        });
    });

    // ─── OCR prompt verification ───────────────────
    describe('OCR prompt completeness', () => {
        it('should include completeness instructions in OCR prompt', async () => {
            // Arrange
            mockFetch.mockResolvedValue(groqResponse({ data: 'text' }));

            // Act
            await processWithAI('ocr', [{ base64: 'x', pageNumber: 1 }]);

            // Assert
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            const sysMsg = body.messages.find((m: any) => m.role === 'system');
            expect(sysMsg.content).toContain('COMPLETE, exhaustive, word-for-word transcript');
        });

        it('sends the requested tool identifier to the metered worker', async () => {
            // Arrange
            mockFetch.mockResolvedValue(groqResponse({ data: 'text' }));

            // Act
            await processWithAI('ocr', [{ base64: 'x', pageNumber: 1 }]);

            // Assert
            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.toolId).toBe('ocr');
        });
    });
});
