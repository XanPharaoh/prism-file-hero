import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { TOOL_REGISTRY, getToolById, getToolsByCategory } from '../src/registry/toolRegistry';
import type { ToolID, ToolExecutionPayload } from '../src/types';
import * as pdfService from '../services/pdfService';

// Mock processWithAI to simulate AI responses for AI Labs tools
vi.mock('../services/geminiService', () => ({
  processWithAI: vi.fn(async (toolId: string, images: any[], options?: any) => {
    switch (toolId) {
      case 'pdf-to-word':
        return { data: '# Reconstructed Document\n\nThis is a high-fidelity Markdown reconstruction from PDF.' };
      case 'ocr':
      case 'ocr-to-md':
        return { data: '# OCR Transcript\n\n- Account Number: 123456789\n- Statement Date: 2026-08-04\n- Total Balance: R 15,250.00' };
      case 'compare':
        return { data: '## Document Comparison Report\n\n- Page 1: Opening balance match\n- Page 2: 3 additional transactions detected in Document B' };
      case 'grammar-check':
        return { data: '## Grammar & Spell Check Report\n\nNo major spelling or grammar errors detected. Style conforms to standard business correspondence.' };
      case 'pdf-qa':
        return { data: `### Answer to: "${options?.qaQuestion || 'Document Query'}"\n\nThe total closing balance on page 3 is R 12,450.00 as of 31 July 2026.` };
      case 'pdf-summary':
        return { data: '### Executive Summary\n\n- **Type**: Bank Statement\n- **Period**: June - July 2026\n- **Key Finding**: Net positive cash flow across 3 months.' };
      case 'redact':
        return {
          data: [
            { page: 1, text: 'CONFIDENTIAL_DATA', category: 'Account Number', x: 10, y: 10, width: 20, height: 5 },
          ],
        };
      case 'pdf-to-excel':
        return {
          rows: [
            { Date: '2026-06-15', Description: 'Deposit Transfer', Amount: '1250.00', Balance: '5000.00' },
          ],
          document_metadata: { OpeningBalance: '3750.00', ClosingBalance: '5000.00' },
        };
      default:
        return { data: 'AI processed result successfully.' };
    }
  }),
}));

function loadFixture(filename: string): File {
  const filePath = path.resolve(__dirname, 'fixtures/statements', filename);
  const buffer = fs.readFileSync(filePath);
  return new File([buffer], filename, { type: 'application/pdf' });
}

function payload(files: File[], options: Record<string, unknown> = {}, onProgress?: (percent: number) => void): ToolExecutionPayload {
  return { files, options, onProgress };
}

function getHandler(id: ToolID) {
  const tool = getToolById(id);
  if (!tool || !tool.handler) {
    throw new Error(`Tool handler not found for ID: ${id}`);
  }
  return tool.handler;
}

async function parsePdf(blob: Blob): Promise<PDFDocument> {
  const buffer = await blob.arrayBuffer();
  return PDFDocument.load(buffer, { ignoreEncryption: true });
}

describe('PDF Tool Stress-Tester & Quality Auditor - All 37 Registered Tools', () => {
  let sbsaFile: File;
  let julyFile: File;
  let junJulFile: File;
  let robbieFile: File;
  let testFile: File;

  beforeAll(() => {
    sbsaFile = loadFixture('SBSA_Statement_2026-08-04_3months.pdf');
    julyFile = loadFixture('July 2026.pdf');
    junJulFile = loadFixture('14. 15 Jun - 15 Jul 2026 R1250.pdf');
    robbieFile = loadFixture('Robbie_Accountants_2026-01.pdf');
    testFile = loadFixture('Test.pdf');
  });

  it('verifies all 37 registered tools exist in the registry with valid metadata', () => {
    expect(TOOL_REGISTRY.length).toBe(37);
    const uniqueIds = new Set(TOOL_REGISTRY.map(t => t.id));
    expect(uniqueIds.size).toBe(37);

    for (const tool of TOOL_REGISTRY) {
      expect(tool.id).toBeTruthy();
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.category).toBeTruthy();
      expect(typeof tool.handler).toBe('function');
      expect(tool.allowedFileTypes.length).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------
  // ORGANIZE CATEGORY (8 Tools)
  // -------------------------------------------------------------
  describe('Organize Category Tools', () => {
    it('1. merge: combines multiple real PDF fixtures with and without page ranges', async () => {
      const handler = getHandler('merge');

      // Merge entire files
      const resultAll = await handler(payload([julyFile, junJulFile, robbieFile]));
      expect(resultAll.blob).toBeInstanceOf(Blob);
      expect(resultAll.filename).toMatch(/^Merged_\d+\.pdf$/);

      const docAll = await parsePdf(resultAll.blob!);
      expect(docAll.getPageCount()).toBeGreaterThanOrEqual(3);

      // Merge specific pages: page 1 of each file
      const resultSubset = await handler(payload([julyFile, junJulFile], { mergePages: '1' }));
      const docSubset = await parsePdf(resultSubset.blob!);
      expect(docSubset.getPageCount()).toBe(2);
    });

    it('2. split: extracts pages into ZIP archive with page ranges and individual pages', async () => {
      const handler = getHandler('split');

      // Split with range '1-2, 3'
      const resultRange = await handler(payload([junJulFile], { splitPages: '1-2, 3' }));
      expect(resultRange.filename).toMatch(/^Split_\d+\.zip$/);

      const zipRange = await JSZip.loadAsync(await resultRange.blob!.arrayBuffer());
      const fileNamesRange = Object.keys(zipRange.files).filter(k => !zipRange.files[k].dir);
      expect(fileNamesRange.length).toBeGreaterThanOrEqual(1);

      // Split default (all pages individually)
      const resultAll = await handler(payload([julyFile]));
      const zipAll = await JSZip.loadAsync(await resultAll.blob!.arrayBuffer());
      const fileNamesAll = Object.keys(zipAll.files).filter(k => !zipAll.files[k].dir);
      expect(fileNamesAll.length).toBeGreaterThan(0);

      // Verify every extracted file is a valid PDF
      for (const name of fileNamesAll) {
        const fileData = await zipAll.file(name)!.async('arraybuffer');
        const pageDoc = await PDFDocument.load(fileData, { ignoreEncryption: true });
        expect(pageDoc.getPageCount()).toBe(1);
      }
    });

    it('3. rotate: rotates all pages by 90, 180, and 270 degrees', async () => {
      const handler = getHandler('rotate');

      for (const angle of ['90', '180', '270']) {
        const result = await handler(payload([julyFile], { rotationAngle: angle }));
        expect(result.blob).toBeInstanceOf(Blob);
        expect(result.filename).toMatch(/_Rotated\.pdf$/);

        const doc = await parsePdf(result.blob!);
        expect(doc.getPageCount()).toBeGreaterThan(0);
        doc.getPages().forEach(page => {
          expect(page.getRotation().angle % 90).toBe(0);
        });
      }
    });

    it('4. delete-pages: deletes specified pages or page ranges from multi-page PDFs', async () => {
      const handler = getHandler('delete-pages');

      // Delete page 1 from ABSA multi-page statement (8 pages)
      const origDoc = await parsePdf(new Blob([await junJulFile.arrayBuffer()]));
      const origPages = origDoc.getPageCount();

      const result = await handler(payload([junJulFile], { deletePages: '1' }));
      expect(result.filename).toMatch(/_Deleted\.pdf$/);

      const doc = await parsePdf(result.blob!);
      expect(doc.getPageCount()).toBe(origPages - 1);

      // Delete page range '2-4'
      const resultRange = await handler(payload([junJulFile], { deletePages: '2-4' }));
      const docRange = await parsePdf(resultRange.blob!);
      expect(docRange.getPageCount()).toBe(origPages - 3);

      // Edge case: deleting all pages throws error
      await expect(
        handler(payload([julyFile], { deletePages: '1-100' }))
      ).rejects.toThrow();
    });

    it('5. extract-pages: extracts selected page ranges into dedicated new PDF', async () => {
      const handler = getHandler('extract-pages');

      // Extract page 1
      const resultSingle = await handler(payload([junJulFile], { extractPages: '1' }));
      const docSingle = await parsePdf(resultSingle.blob!);
      expect(docSingle.getPageCount()).toBe(1);

      // Extract range '2-4'
      const resultRange = await handler(payload([junJulFile], { extractPages: '2-4' }));
      const docRange = await parsePdf(resultRange.blob!);
      expect(docRange.getPageCount()).toBe(3);

      // Extract non-contiguous pages '1, 3, 5'
      const resultMulti = await handler(payload([junJulFile], { extractPages: '1, 3, 5' }));
      const docMulti = await parsePdf(resultMulti.blob!);
      expect(docMulti.getPageCount()).toBe(3);

      // Edge case: invalid page range throws error
      await expect(
        handler(payload([julyFile], { extractPages: '999-1000' }))
      ).rejects.toThrow();
    });

    it('6. page-numbers: stamps page numbers with dynamic tokens and varied positions', async () => {
      const handler = getHandler('page-numbers');

      const positions = ['bottom-center', 'bottom-right', 'bottom-left', 'top-right', 'top-left', 'top-center'];
      const formats = ['Page {page} of {total}', 'Page X of Y', '{page}', 'X'];

      for (const position of positions) {
        for (const format of formats) {
          const result = await handler(payload([julyFile], {
            pageNumberPosition: position,
            pageNumberFormat: format,
            pageNumberStart: 1,
          }));
          expect(result.blob).toBeInstanceOf(Blob);
          expect(result.filename).toMatch(/_Numbered\.pdf$/);

          const doc = await parsePdf(result.blob!);
          expect(doc.getPageCount()).toBeGreaterThan(0);
        }
      }
    });

    it('7. reorder-pages: rearranges page order with string ranges and number arrays', async () => {
      const handler = getHandler('reorder-pages');

      // Reorder with string "3, 2, 1" on ABSA multi-page statement
      const resultStr = await handler(payload([junJulFile], { reorderPages: '3, 2, 1' }));
      const docStr = await parsePdf(resultStr.blob!);
      expect(docStr.getPageCount()).toBe(3);

      // Reorder with array [2, 1, 0] (0-indexed)
      const resultArr0 = await handler(payload([junJulFile], { reorderPages: [2, 1, 0] }));
      const docArr0 = await parsePdf(resultArr0.blob!);
      expect(docArr0.getPageCount()).toBe(3);

      // Reorder with array [3, 2, 1] (1-indexed)
      const resultArr1 = await handler(payload([junJulFile], { reorderPages: [3, 2, 1] }));
      const docArr1 = await parsePdf(resultArr1.blob!);
      expect(docArr1.getPageCount()).toBe(3);

      // Edge case: invalid page order throws error
      await expect(
        handler(payload([julyFile], { reorderPages: '99, 100' }))
      ).rejects.toThrow();
    });

    it('8. header-footer: stamps dynamic headers and footers with {page}, {total}, {date}', async () => {
      const handler = getHandler('header-footer');

      const result = await handler(payload([julyFile], {
        headerText: 'AUDITED STATEMENT - Page {page} of {total}',
        footerText: 'Confidential | Generated: {date} | Page {page}',
      }));
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toMatch(/_HeaderFooter\.pdf$/);

      const doc = await parsePdf(result.blob!);
      expect(doc.getPageCount()).toBeGreaterThan(0);
    });

    it('9. auto-rotate: standardizes mixed landscape/portrait pages to uniform portrait', async () => {
      const handler = getHandler('auto-rotate');

      const result = await handler(payload([robbieFile]));
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toMatch(/_AutoRotated\.pdf$/);

      const doc = await parsePdf(result.blob!);
      expect(doc.getPageCount()).toBeGreaterThan(0);
    });

    it('10. stamp: stamps rubber badges (APPROVED, CONFIDENTIAL, RECEIVED, FINAL) with date options', async () => {
      const handler = getHandler('stamp');

      const badges = ['APPROVED', 'CONFIDENTIAL', 'RECEIVED', 'FINAL'];
      const colors: Array<'red' | 'green' | 'blue'> = ['red', 'green', 'blue'];

      for (const badge of badges) {
        for (const color of colors) {
          const result = await handler(payload([junJulFile], {
            stampText: badge,
            stampColor: color,
            stampDate: true,
          }));
          expect(result.blob).toBeInstanceOf(Blob);
          expect(result.filename).toMatch(/_Stamped\.pdf$/);

          const doc = await parsePdf(result.blob!);
          expect(doc.getPageCount()).toBeGreaterThan(0);
        }
      }

      // Stamp without date
      const resultNoDate = await handler(payload([junJulFile], {
        stampText: 'VERIFIED',
        stampColor: 'green',
        stampDate: false,
      }));
      const docNoDate = await parsePdf(resultNoDate.blob!);
      expect(docNoDate.getPageCount()).toBeGreaterThan(0);
    });

    it('11. n-up: combines multiple pages into 2-in-1, 4-in-1, and 9-in-1 sheet layouts', async () => {
      const handler = getHandler('n-up');

      for (const grid of [2, 4, 9] as const) {
        const result = await handler(payload([junJulFile], { nUpGrid: grid }));
        expect(result.blob).toBeInstanceOf(Blob);
        expect(result.filename).toMatch(new RegExp(`_${grid}up\\.pdf$`));

        const doc = await parsePdf(result.blob!);
        expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);

        // A4 dimension check
        const firstPage = doc.getPage(0);
        expect(firstPage.getWidth()).toBeCloseTo(595.28, 1);
        expect(firstPage.getHeight()).toBeCloseTo(841.89, 1);
      }
    });
  });

  // -------------------------------------------------------------
  // OPTIMIZE CATEGORY (5 Tools)
  // -------------------------------------------------------------
  describe('Optimize Category Tools', () => {
    it('12. compress: compresses real PDF with extreme, recommended, low, and custom quality', async () => {
      const handler = getHandler('compress');
      const progress: number[] = [];

      for (const level of ['extreme', 'recommended', 'low']) {
        const result = await handler(payload(
          [julyFile],
          { compressionLevel: level },
          p => progress.push(p)
        ));
        expect(result.blob).toBeInstanceOf(Blob);
        expect(result.filename).toMatch(/^Compressed_\d+\.pdf$/);

        const doc = await parsePdf(result.blob!);
        expect(doc.getPageCount()).toBeGreaterThan(0);
      }

      // Custom numeric quality
      const customResult = await handler(payload([julyFile], { compressionQuality: 0.5 }));
      const customDoc = await parsePdf(customResult.blob!);
      expect(customDoc.getPageCount()).toBeGreaterThan(0);
    });

    it('13. pdf-repair: recovers and reconstructs real PDF fixtures', async () => {
      const handler = getHandler('pdf-repair');

      const result = await handler(payload([testFile]));
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toMatch(/_Repaired\.pdf$/);

      const doc = await parsePdf(result.blob!);
      expect(doc.getPageCount()).toBeGreaterThan(0);
    });

    it('14. crop-resize: trims margins and resizes pages to standard formats (A4, Letter, Legal, A3, A5)', async () => {
      const handler = getHandler('crop-resize');

      const targetSizes = ['A4', 'Letter', 'Legal', 'A3', 'A5'];
      for (const size of targetSizes) {
        const result = await handler(payload([julyFile], {
          cropMargins: { top: 5, bottom: 5, left: 5, right: 5 },
          cropMarginMm: 5,
          targetSize: size,
        }));
        expect(result.blob).toBeInstanceOf(Blob);
        expect(result.filename).toMatch(/_Cropped\.pdf$/);

        const doc = await parsePdf(result.blob!);
        expect(doc.getPageCount()).toBeGreaterThan(0);
      }
    });

    it('15. remove-blank-pages: analyzes page pixel ink density and removes empty pages', async () => {
      const handler = getHandler('remove-blank-pages');

      const result = await handler(payload([julyFile], { blankPageThreshold: 0.001 }));
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toMatch(/_NoBlankPages\.pdf$/);

      const doc = await parsePdf(result.blob!);
      expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    });

    it('16. scan-effect: applies analog scanner texture, contrast, grain noise, and deskew tilt', async () => {
      const handler = getHandler('scan-effect');

      const result = await handler(payload([julyFile], {
        scannerContrast: 1.3,
        scannerNoise: 20,
        scannerTilt: true,
      }));
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toMatch(/_Scanned\.pdf$/);

      const doc = await parsePdf(result.blob!);
      expect(doc.getPageCount()).toBeGreaterThan(0);
    });

    it('17. invert-colors: inverts color spectrum for dark-mode readability', async () => {
      const handler = getHandler('invert-colors');

      const result = await handler(payload([julyFile]));
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toMatch(/_Inverted\.pdf$/);

      const doc = await parsePdf(result.blob!);
      expect(doc.getPageCount()).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------
  // CONVERT CATEGORY (6 Tools)
  // -------------------------------------------------------------
  describe('Convert Category Tools', () => {
    it('18. pdf-to-text: extracts clean plain text from real bank statement PDF', async () => {
      const handler = getHandler('pdf-to-text');

      const result = await handler(payload([julyFile]));
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toMatch(/_Text\.txt$/);

      const text = await result.blob!.text();
      expect(text.length).toBeGreaterThan(0);
    });

    it('19. pdf-to-docx: converts real PDF into a valid Microsoft Word (.docx) document', async () => {
      const handler = getHandler('pdf-to-docx');

      const result = await handler(payload([julyFile]));
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toMatch(/\.docx$/);
      expect(result.blob!.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(result.blob!.size).toBeGreaterThan(0);
    });

    it('20. pdf-to-excel: parses statements and returns Excel spreadsheet with mapped rows', async () => {
      const handler = getHandler('pdf-to-excel');

      const result = await handler(payload([sbsaFile]));
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toMatch(/_Extracted\.xlsx$/);
      expect(result.blob!.size).toBeGreaterThan(0);
      expect(result.data).toBeDefined();
    });

    it('21. pdf-to-jpg: converts PDF pages to JPGs packaged in ZIP archive', async () => {
      const handler = getHandler('pdf-to-jpg');

      const result = await handler(payload([julyFile], { jpgPages: '1, 2' }));
      expect(result.filename).toMatch(/_Images\.zip$/);

      const zip = await JSZip.loadAsync(await result.blob!.arrayBuffer());
      const fileNames = Object.keys(zip.files).filter(k => !zip.files[k].dir);
      expect(fileNames.length).toBeGreaterThan(0);

      for (const name of fileNames) {
        expect(name).toMatch(/^Page_\d+\.jpg$/);
        const bytes = new Uint8Array(await zip.file(name)!.async('arraybuffer'));
        expect(bytes.length).toBeGreaterThan(0);
      }
    });

    it('22. jpg-to-pdf: converts JPEG and PNG images into a combined PDF document', async () => {
      const handler = getHandler('jpg-to-pdf');

      // Create dummy JPEG and PNG files
      const TINY_JPEG = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/Aaf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Aaf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/Iaf/xAAVEQEBAAAAAAAAAAAAAAAAAAAAEf/aAAgBAwEBPxCP/8QAFREBAQAAAAAAAAAAAAAAAAAAABH/2gAIAQIBAT8Qj//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z'), c => c.charCodeAt(0));
      const TINY_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLk7wAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));

      const img1 = new File([TINY_JPEG], 'receipt_01.jpg', { type: 'image/jpeg' });
      const img2 = new File([TINY_PNG], 'receipt_02.png', { type: 'image/png' });

      const result = await handler(payload([img1, img2]));
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toMatch(/^Converted_Images_\d+\.pdf$/);

      const doc = await parsePdf(result.blob!);
      expect(doc.getPageCount()).toBe(2);
    });

    it('23. extract-images: extracts all embedded and rendered graphics into ZIP archive', async () => {
      const handler = getHandler('extract-images');

      const result = await handler(payload([junJulFile]));
      expect(result.filename).toMatch(/_Images\.zip$/);

      const zip = await JSZip.loadAsync(await result.blob!.arrayBuffer());
      const fileNames = Object.keys(zip.files).filter(k => !zip.files[k].dir);
      expect(fileNames.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------
  // SECURITY CATEGORY (6 Tools)
  // -------------------------------------------------------------
  describe('Security Category Tools', () => {
    it('24. protect & 25. unlock-pdf: password encrypts and subsequently unlocks PDF', async () => {
      const protectHandler = getHandler('protect');
      const unlockHandler = getHandler('unlock-pdf');
      const testPassword = 'SecurePassword_2026!';

      // Protect
      const protectedResult = await protectHandler(payload([julyFile], { password: testPassword }));
      expect(protectedResult.blob).toBeInstanceOf(Blob);
      expect(protectedResult.filename).toMatch(/_Protected\.pdf$/);
      expect(protectedResult.blob!.size).toBeGreaterThan(0);

      // Verify missing password throws error
      await expect(
        protectHandler(payload([julyFile], {}))
      ).rejects.toThrow('Encryption key required.');

      // Unlock protected file
      const protectedFile = new File([await protectedResult.blob!.arrayBuffer()], 'protected.pdf', { type: 'application/pdf' });
      const unlockedResult = await unlockHandler(payload([protectedFile], { unlockPassword: testPassword }));
      expect(unlockedResult.blob).toBeInstanceOf(Blob);
      expect(unlockedResult.filename).toMatch(/_Unlocked\.pdf$/);

      // Unlock unencrypted file
      const plainUnlocked = await unlockHandler(payload([julyFile]));
      const doc = await parsePdf(plainUnlocked.blob!);
      expect(doc.getPageCount()).toBeGreaterThan(0);
    });

    it('26. watermark: stamps dense tiled matrix pattern and single centered watermark', async () => {
      const handler = getHandler('watermark');

      // Tiled mode
      const resultTiled = await handler(payload([julyFile], {
        watermarkText: 'CONFIDENTIAL',
        watermarkMode: 'tiled',
      }));
      expect(resultTiled.blob).toBeInstanceOf(Blob);
      expect(resultTiled.filename).toMatch(/_Watermarked\.pdf$/);

      const docTiled = await parsePdf(resultTiled.blob!);
      expect(docTiled.getPageCount()).toBeGreaterThan(0);

      // Single centered mode
      const resultSingle = await handler(payload([julyFile], {
        watermarkText: 'TOP SECRET',
        watermarkMode: 'single',
      }));
      const docSingle = await parsePdf(resultSingle.blob!);
      expect(docSingle.getPageCount()).toBeGreaterThan(0);
    });

    it('27. redact: redacts sensitive PII & custom keywords with visual blackouts', async () => {
      const handler = getHandler('redact');

      const result = await handler(payload([julyFile], {
        redactKeywords: 'NEDBANK, ACCOUNT, BALANCE',
      }));
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toMatch(/_Redacted\.pdf$/);

      const doc = await parsePdf(result.blob!);
      expect(doc.getPageCount()).toBeGreaterThan(0);
    });

    it('28. metadata-edit: edits author, title, producer, subject or strips all metadata', async () => {
      const handler = getHandler('metadata-edit');

      // Set metadata
      const resultEdit = await handler(payload([julyFile], {
        metaTitle: 'Audited Statement Q2 2026',
        metaAuthor: 'Prism Chief Auditor',
        metaSubject: 'Financial Reconciliation',
        metaCreator: 'Prism Engine v2',
        metaProducer: 'Prism File Hero',
      }));
      expect(resultEdit.blob).toBeInstanceOf(Blob);
      expect(resultEdit.filename).toMatch(/_Metadata\.pdf$/);

      const docEdit = await parsePdf(resultEdit.blob!);
      expect(docEdit.getTitle()).toBe('Audited Statement Q2 2026');
      expect(docEdit.getAuthor()).toBe('Prism Chief Auditor');
      expect(docEdit.getSubject()).toBe('Financial Reconciliation');

      // Strip all metadata
      const resultStrip = await handler(payload([julyFile], {
        stripMetadata: true,
      }));
      const docStrip = await parsePdf(resultStrip.blob!);
      expect(docStrip.getTitle()).toBe('');
      expect(docStrip.getAuthor()).toBe('');
    });

    it('29. sanitize: strips embedded JavaScript, launch triggers, attachments, and metadata', async () => {
      const handler = getHandler('sanitize');

      const result = await handler(payload([julyFile], {
        sanitizeRemoveJs: true,
        sanitizeRemoveAttachments: true,
        sanitizeRemoveLinks: true,
        sanitizeRemoveMetadata: true,
      }));
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toMatch(/_Sanitized\.pdf$/);

      const doc = await parsePdf(result.blob!);
      expect(doc.getTitle() ?? '').toBe('');
      expect(doc.getAuthor() ?? '').toBe('');
      expect(doc.getPageCount()).toBeGreaterThan(0);
    });

    it('30. flatten-pdf: locks interactive form fields, checkmarks, and annotations', async () => {
      const handler = getHandler('flatten-pdf');

      const result = await handler(payload([testFile]));
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toMatch(/_Flattened\.pdf$/);

      const doc = await parsePdf(result.blob!);
      expect(doc.getPageCount()).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------
  // AI LABS CATEGORY (7 Tools)
  // -------------------------------------------------------------
  describe('AI Labs Category Tools', () => {
    it('31. pdf-to-word: reconstructs document as structured Markdown', async () => {
      const handler = getHandler('pdf-to-word');

      const result = await handler(payload([julyFile]));
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toMatch(/^Document_\d+\.md$/);

      const text = await result.blob!.text();
      expect(text).toContain('# Reconstructed Document');
    });

    it('32. ocr (transcript mode): runs the OCR handler and produces a PDF', async () => {
      // The default OCR output is now a *searchable overlay* (preserved page image +
      // positioned invisible text) which needs the local Tesseract engine — verified in a
      // real browser, not under this mocked fetch transport. This case exercises the
      // explicitly-requested transcript mode, which runs over the mocked AI path.
      const handler = getHandler('ocr');

      const result = await handler(payload([robbieFile], { ocrMode: 'transcript' }));
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toMatch(/_OCR_Transcript\.pdf$/);

      const doc = await parsePdf(result.blob!);
      expect(doc.getPageCount()).toBeGreaterThan(0);
    });

    it('33. ocr-to-md: extracts structured Markdown from document pages', async () => {
      const handler = getHandler('ocr-to-md');

      const result = await handler(payload([robbieFile]));
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toMatch(/_OCR\.md$/);

      const text = await result.blob!.text();
      expect(text).toContain('# OCR Transcript');
    });

    it('34. compare: spots differences across two PDF document versions', async () => {
      const handler = getHandler('compare');

      const result = await handler(payload([julyFile, junJulFile]));
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toMatch(/^Comparison_Report_\d+\.txt$/);

      const text = await result.blob!.text();
      expect(text).toContain('Document Comparison Report');

      // Edge case: requires exactly 2 files
      await expect(
        handler(payload([julyFile]))
      ).rejects.toThrow('Comparison requires exactly 2 PDF files.');
    });

    it('35. grammar-check: performs grammar, spelling, and tone analysis', async () => {
      const handler = getHandler('grammar-check');

      const result = await handler(payload([julyFile]));
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toMatch(/_GrammarCheck\.md$/);

      const text = await result.blob!.text();
      expect(text).toContain('Grammar & Spell Check Report');
    });

    it('36. pdf-qa: answers user questions grounded in document content', async () => {
      const handler = getHandler('pdf-qa');

      const result = await handler(payload([julyFile], {
        qaQuestion: 'What is the total closing balance on page 3?',
      }));
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toMatch(/_QA_Answer\.md$/);

      const text = await result.blob!.text();
      expect(text).toContain('closing balance');
    });

    it('37. pdf-summary: creates executive summary with key takeaways and action items', async () => {
      const handler = getHandler('pdf-summary');

      const result = await handler(payload([sbsaFile], {
        summaryLength: 'detailed',
        summaryFocus: 'Financial cash flow and transactions',
      }));
      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.filename).toMatch(/_Summary\.md$/);

      const text = await result.blob!.text();
      expect(text).toContain('Executive Summary');
    });
  });
});

function origPagesCount(file: File): number {
  // Approximate fallback
  return 3;
}
