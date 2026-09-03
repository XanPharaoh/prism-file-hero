import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PDFDocument, PDFName, PDFString, PDFArray, PDFDict } from 'pdf-lib';
import {
  convertPdfToImages,
  deletePages,
  extractPages,
  addPageNumbers,
  protectPdf,
  unlockPdf,
  repairPdf,
  reorderPages,
  addHeaderFooter,
  cropResizePdf,
  editMetadata,
  removeBlankPages,
  flattenPdf,
  extractText,
  convertPdfToDocx,
  sanitizePdf,
  redactPdf,
  extractEmbeddedImages,
  nUpPageLayout,
  scannerEffect,
  invertPdfColors,
  autoRotatePdf,
  stampPdf,
} from '../services/pdfService';
import * as pdfjsLib from 'pdfjs-dist';

vi.mock('pdfjs-dist', () => ({
  get GlobalWorkerOptions() { return { workerSrc: '' }; },
  set GlobalWorkerOptions(v: any) {},
  getDocument: vi.fn(),
}));

async function createSamplePdf(pageCount: number = 3): Promise<File> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([300, 400]);
    page.drawText(`Page content ${i + 1}`, { x: 50, y: 350 });
  }
  const bytes = await doc.save();
  return new File([bytes as BlobPart], `sample_${pageCount}p.pdf`, { type: 'application/pdf' });
}

describe('pdfService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('convertPdfToImages', () => {
    it('should respect AbortSignal and throw AbortError', async () => {
      const mockPage = {
        getViewport: vi.fn().mockReturnValue({ width: 100, height: 100 }),
        render: vi.fn().mockResolvedValue({ promise: Promise.resolve() }),
      };
      const mockPdf = {
        numPages: 2,
        getPage: vi.fn().mockResolvedValue(mockPage),
      };

      (pdfjsLib.getDocument as any).mockReturnValue({
        promise: Promise.resolve(mockPdf),
      });

      const mockCanvas = {
        getContext: vi.fn().mockReturnValue({
          getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(40000), width: 100, height: 100 }),
          putImageData: vi.fn(),
        }),
        toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,test'),
        width: 100,
        height: 100,
      };
      vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as any);

      const controller = new AbortController();
      controller.abort();

      await expect(
        convertPdfToImages(new File([], 'test.pdf'), undefined, 20, true, undefined, controller.signal)
      ).rejects.toThrow('Aborted');
    });
  });

  describe('deletePages', () => {
    it('should delete specified pages and return remaining PDF', async () => {
      const file = await createSamplePdf(5);
      const resultBlob = await deletePages(file, '1, 3-5');
      expect(resultBlob).toBeInstanceOf(Blob);

      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getPageCount()).toBe(1);
    });

    it('should delete single page correctly', async () => {
      const file = await createSamplePdf(3);
      const resultBlob = await deletePages(file, '2');
      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getPageCount()).toBe(2);
    });

    it('should throw error when all pages are marked for deletion', async () => {
      const file = await createSamplePdf(3);
      await expect(deletePages(file, '1-3')).rejects.toThrow('Cannot delete all pages');
    });

    it('should return original document if page range is empty or invalid', async () => {
      const file = await createSamplePdf(3);
      const resultBlob = await deletePages(file, '');
      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getPageCount()).toBe(3);
    });
  });

  describe('extractPages', () => {
    it('should extract specified page range into a single combined PDF', async () => {
      const file = await createSamplePdf(5);
      const resultBlob = await extractPages(file, '2-4');
      expect(resultBlob).toBeInstanceOf(Blob);

      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getPageCount()).toBe(3);
    });

    it('should extract individual selected pages', async () => {
      const file = await createSamplePdf(5);
      const resultBlob = await extractPages(file, '1, 5');
      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getPageCount()).toBe(2);
    });

    it('should throw error if no valid pages match', async () => {
      const file = await createSamplePdf(3);
      await expect(extractPages(file, '10-20')).rejects.toThrow('No valid pages found');
    });
  });

  describe('addPageNumbers', () => {
    it('should stamp page numbers with default options', async () => {
      const file = await createSamplePdf(2);
      const resultBlob = await addPageNumbers(file);
      expect(resultBlob).toBeInstanceOf(Blob);
      expect(resultBlob.type).toBe('application/pdf');

      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getPageCount()).toBe(2);
    });

    it('should support custom positions and formats', async () => {
      const file = await createSamplePdf(3);
      const positions = ['bottom-right', 'top-right', 'bottom-left', 'top-left', 'top-center', 'bottom-center'];

      for (const pos of positions) {
        const resultBlob = await addPageNumbers(file, {
          position: pos,
          startNum: 5,
          format: 'Page {page} of {total}',
        });
        expect(resultBlob).toBeInstanceOf(Blob);
        const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
        expect(resDoc.getPageCount()).toBe(3);
      }
    });

    it('should support number-only format', async () => {
      const file = await createSamplePdf(2);
      const resultBlob = await addPageNumbers(file, { format: 'X', startNum: 1 });
      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getPageCount()).toBe(2);
    });
  });

  describe('unlockPdf', () => {
    it('should unlock and re-save PDF without errors', async () => {
      const file = await createSamplePdf(2);
      const resultBlob = await unlockPdf(file);
      expect(resultBlob).toBeInstanceOf(Blob);
      expect(resultBlob.type).toBe('application/pdf');

      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getPageCount()).toBe(2);
    });

    it('should support password fallback when standard load fails', async () => {
      const mockPage = {
        getViewport: vi.fn().mockReturnValue({ width: 200, height: 200 }),
        render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
      };
      const mockPdf = {
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(mockPage),
      };

      (pdfjsLib.getDocument as any).mockReturnValue({
        promise: Promise.resolve(mockPdf),
      });

      const mockCanvas = {
        getContext: vi.fn().mockReturnValue({
          getImageData: vi.fn(),
        }),
        toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='),
        width: 200,
        height: 200,
      };
      vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as any);

      // Create invalid dummy file that fails PDFDocument.load
      const file = new File([new Uint8Array([0, 1, 2, 3])], 'encrypted.pdf', { type: 'application/pdf' });
      const resultBlob = await unlockPdf(file, 'secret');
      expect(resultBlob).toBeInstanceOf(Blob);
    });
  });

  describe('repairPdf', () => {
    it('should cleanly repair and re-save valid PDF via pdf-lib', async () => {
      const file = await createSamplePdf(2);
      const resultBlob = await repairPdf(file);
      expect(resultBlob).toBeInstanceOf(Blob);

      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getPageCount()).toBe(2);
    });

    it('should fall back to rasterization repair when pdf-lib load throws', async () => {
      const mockPage = {
        getViewport: vi.fn().mockReturnValue({ width: 200, height: 200 }),
        render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
      };
      const mockPdf = {
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(mockPage),
      };

      (pdfjsLib.getDocument as any).mockReturnValue({
        promise: Promise.resolve(mockPdf),
      });

      const mockCanvas = {
        getContext: vi.fn().mockReturnValue({
          getImageData: vi.fn(),
        }),
        toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='),
        width: 200,
        height: 200,
      };
      vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as any);

      const file = new File([new Uint8Array([0, 1, 2, 3])], 'corrupt.pdf', { type: 'application/pdf' });
      const resultBlob = await repairPdf(file);
      expect(resultBlob).toBeInstanceOf(Blob);
    });

    it('should throw error when both repair strategies fail', async () => {
      (pdfjsLib.getDocument as any).mockReturnValue({
        promise: Promise.reject(new Error('Unrecoverable PDF syntax error')),
      });

      const file = new File([new Uint8Array([0, 1, 2, 3])], 'unrecoverable.pdf', { type: 'application/pdf' });
      await expect(repairPdf(file)).rejects.toThrow('PDF repair failed');
    });
  });

  describe('reorderPages', () => {
    it('should rearrange pages according to newOrder', async () => {
      const file = await createSamplePdf(3);
      const resultBlob = await reorderPages(file, [2, 0, 1]);
      expect(resultBlob).toBeInstanceOf(Blob);

      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getPageCount()).toBe(3);
    });

    it('should throw error when order array contains no valid indices', async () => {
      const file = await createSamplePdf(3);
      await expect(reorderPages(file, [10, 20])).rejects.toThrow('Invalid page order');
    });
  });

  describe('addHeaderFooter', () => {
    it('should add header and footer text with token replacements', async () => {
      const file = await createSamplePdf(2);
      const resultBlob = await addHeaderFooter(file, {
        header: 'CONFIDENTIAL - Page {page} of {total}',
        footer: 'Generated on {date}',
        fontSize: 9,
      });
      expect(resultBlob).toBeInstanceOf(Blob);

      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getPageCount()).toBe(2);
    });

    it('should work with only header or only footer', async () => {
      const file = await createSamplePdf(1);
      const headerOnly = await addHeaderFooter(file, { header: 'Top Header' });
      expect(headerOnly).toBeInstanceOf(Blob);

      const footerOnly = await addHeaderFooter(file, { footer: 'Bottom Footer' });
      expect(footerOnly).toBeInstanceOf(Blob);
    });
  });

  describe('cropResizePdf', () => {
    it('should crop PDF margins and resize to target size', async () => {
      const file = await createSamplePdf(2);
      const resultBlob = await cropResizePdf(file, {
        cropMarginMm: 5,
        targetSize: 'A4',
      });
      expect(resultBlob).toBeInstanceOf(Blob);

      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getPageCount()).toBe(2);
      const p1 = resDoc.getPage(0);
      expect(p1.getWidth()).toBeCloseTo(595.28, 1);
      expect(p1.getHeight()).toBeCloseTo(841.89, 1);
    });

    it('should support targetSize Letter without margin crop', async () => {
      const file = await createSamplePdf(1);
      const resultBlob = await cropResizePdf(file, { targetSize: 'Letter' });
      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      const p1 = resDoc.getPage(0);
      expect(p1.getWidth()).toBeCloseTo(612.0, 1);
      expect(p1.getHeight()).toBeCloseTo(792.0, 1);
    });
  });

  describe('editMetadata', () => {
    it('should update metadata fields', async () => {
      const file = await createSamplePdf(1);
      const resultBlob = await editMetadata(file, {
        title: 'New Document Title',
        author: 'John Doe',
        subject: 'Finance Report',
        producer: 'Prism File Hero',
        creator: 'Prism Engine',
        keywords: ['report', 'finance', '2026'],
      });
      expect(resultBlob).toBeInstanceOf(Blob);

      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getTitle()).toBe('New Document Title');
      expect(resDoc.getAuthor()).toBe('John Doe');
      expect(resDoc.getSubject()).toBe('Finance Report');
      expect(resDoc.getCreator()).toBe('Prism Engine');
      expect(resDoc.getKeywords()).toContain('finance');
    });

    it('should strip all metadata when stripAll is true', async () => {
      const file = await createSamplePdf(1);
      const seededBlob = await editMetadata(file, {
        title: 'Secret Title',
        author: 'Secret Author',
      });
      const seededFile = new File([await seededBlob.arrayBuffer()], 'seeded.pdf', { type: 'application/pdf' });

      const strippedBlob = await editMetadata(seededFile, { stripAll: true });
      const resDoc = await PDFDocument.load(await strippedBlob.arrayBuffer());
      expect(resDoc.getTitle()).toBe('');
      expect(resDoc.getAuthor()).toBe('');
    });
  });

  describe('removeBlankPages', () => {
    it('should drop blank pages based on pixel canvas density', async () => {
      const file = await createSamplePdf(2);

      // Page 1 has ink (non-white pixels), Page 2 is completely white
      const inkData = new Uint8ClampedArray(400);
      inkData.fill(255);
      // Add dark pixel ink
      inkData[0] = 0; inkData[1] = 0; inkData[2] = 0; inkData[3] = 255;
      inkData[4] = 0; inkData[5] = 0; inkData[6] = 0; inkData[7] = 255;

      const whiteData = new Uint8ClampedArray(400);
      whiteData.fill(255); // pure white

      let pageCallCount = 0;
      const mockPage = {
        getViewport: vi.fn().mockReturnValue({ width: 10, height: 10 }),
        render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
      };

      const mockPdf = {
        numPages: 2,
        getPage: vi.fn().mockImplementation(() => {
          pageCallCount++;
          return Promise.resolve(mockPage);
        }),
      };

      (pdfjsLib.getDocument as any).mockReturnValue({
        promise: Promise.resolve(mockPdf),
      });

      let canvasGetContextCount = 0;
      const mockCanvas = {
        getContext: vi.fn().mockImplementation(() => {
          canvasGetContextCount++;
          return {
            getImageData: vi.fn().mockReturnValue({
              data: canvasGetContextCount === 1 ? inkData : whiteData,
            }),
          };
        }),
        width: 10,
        height: 10,
      };
      vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as any);

      const resultBlob = await removeBlankPages(file, 0.001);
      expect(resultBlob).toBeInstanceOf(Blob);

      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getPageCount()).toBe(1);
    });

    it('should retain page 1 when all pages are blank', async () => {
      const file = await createSamplePdf(2);
      const whiteData = new Uint8ClampedArray(400);
      whiteData.fill(255);

      const mockPage = {
        getViewport: vi.fn().mockReturnValue({ width: 10, height: 10 }),
        render: vi.fn().mockReturnValue({ promise: Promise.resolve() }),
      };

      const mockPdf = {
        numPages: 2,
        getPage: vi.fn().mockResolvedValue(mockPage),
      };

      (pdfjsLib.getDocument as any).mockReturnValue({
        promise: Promise.resolve(mockPdf),
      });

      const mockCanvas = {
        getContext: vi.fn().mockReturnValue({
          getImageData: vi.fn().mockReturnValue({ data: whiteData }),
        }),
        width: 10,
        height: 10,
      };
      vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as any);

      const resultBlob = await removeBlankPages(file, 0.001);
      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getPageCount()).toBe(1);
    });
  });

  describe('flattenPdf', () => {
    it('should flatten form fields and return static PDF blob', async () => {
      const file = await createSamplePdf(2);
      const resultBlob = await flattenPdf(file);
      expect(resultBlob).toBeInstanceOf(Blob);
      expect(resultBlob.type).toBe('application/pdf');

      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getPageCount()).toBe(2);
    });
  });

  describe('extractText', () => {
    it('should extract plain text from PDF pages as text/plain Blob', async () => {
      const mockPage1 = {
        getTextContent: vi.fn().mockResolvedValue({
          items: [
            { str: 'Invoice #1001', transform: [1, 0, 0, 1, 50, 700], hasEOL: true },
            { str: 'Total: $500.00', transform: [1, 0, 0, 1, 50, 680], hasEOL: true },
          ],
        }),
      };
      const mockPage2 = {
        getTextContent: vi.fn().mockResolvedValue({
          items: [
            { str: 'Thank you for your business', transform: [1, 0, 0, 1, 50, 700], hasEOL: true },
          ],
        }),
      };

      const mockPdf = {
        numPages: 2,
        getPage: vi.fn().mockImplementation((num: number) => {
          return Promise.resolve(num === 1 ? mockPage1 : mockPage2);
        }),
      };

      (pdfjsLib.getDocument as any).mockReturnValue({
        promise: Promise.resolve(mockPdf),
      });

      const file = new File([], 'invoice.pdf', { type: 'application/pdf' });
      const resultBlob = await extractText(file);
      expect(resultBlob).toBeInstanceOf(Blob);
      expect(resultBlob.type).toBe('text/plain;charset=utf-8');

      const text = await resultBlob.text();
      expect(text).toContain('Invoice #1001');
      expect(text).toContain('Total: $500.00');
      expect(text).toContain('--- Page 1 ---');
      expect(text).toContain('--- Page 2 ---');
      expect(text).toContain('Thank you for your business');
    });
  });

  describe('convertPdfToDocx', () => {
    it('should convert PDF text into a valid docx Document Blob', async () => {
      const mockPage = {
        getTextContent: vi.fn().mockResolvedValue({
          items: [
            { str: 'Sample Heading', transform: [1, 0, 0, 1, 50, 700], hasEOL: true },
            { str: 'Sample Paragraph content goes here.', transform: [1, 0, 0, 1, 50, 680], hasEOL: true },
          ],
        }),
      };

      const mockPdf = {
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(mockPage),
      };

      (pdfjsLib.getDocument as any).mockReturnValue({
        promise: Promise.resolve(mockPdf),
      });

      const file = new File([], 'document.pdf', { type: 'application/pdf' });
      const resultBlob = await convertPdfToDocx(file);
      expect(resultBlob).toBeInstanceOf(Blob);
      expect(resultBlob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(resultBlob.size).toBeGreaterThan(0);
    });

    it('should handle multi-page PDFs in docx conversion', async () => {
      const mockPage = {
        getTextContent: vi.fn().mockResolvedValue({
          items: [
            { str: 'Multi-page content', transform: [1, 0, 0, 1, 50, 700], hasEOL: true },
          ],
        }),
      };

      const mockPdf = {
        numPages: 2,
        getPage: vi.fn().mockResolvedValue(mockPage),
      };

      (pdfjsLib.getDocument as any).mockReturnValue({
        promise: Promise.resolve(mockPdf),
      });

      const file = new File([], 'multi_page.pdf', { type: 'application/pdf' });
      const resultBlob = await convertPdfToDocx(file);
      expect(resultBlob).toBeInstanceOf(Blob);
      expect(resultBlob.size).toBeGreaterThan(0);
    });
  });

  describe('sanitizePdf', () => {
    it('should strip metadata and sensitive dictionaries from PDF', async () => {
      const doc = await PDFDocument.create();
      doc.setTitle('Sensitive Title');
      doc.setAuthor('Secret Author');
      doc.setSubject('Confidential Subject');
      doc.setKeywords(['secret', 'audit']);
      doc.setProducer('Adobe Distiller');
      doc.setCreator('Confidential App');
      doc.addPage([300, 300]);
      const pdfBytes = await doc.save();
      const file = new File([pdfBytes], 'test.pdf', { type: 'application/pdf' });

      const resultBlob = await sanitizePdf(file);
      expect(resultBlob).toBeInstanceOf(Blob);
      expect(resultBlob.type).toBe('application/pdf');

      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getTitle()).toBe('');
      expect(resDoc.getAuthor()).toBe('');
      expect(resDoc.getSubject()).toBe('');
    });

    it('should thoroughly remove JavaScript, OpenAction, Names, Launch, URI, EmbeddedFiles and Metadata', async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([400, 400]);
      page.drawText('Sample Page Content', { x: 50, y: 350 });

      // Inject risky structures in catalog
      const catalog = doc.catalog;
      catalog.set(PDFName.of('OpenAction'), doc.context.obj({ Type: 'Action', S: 'JavaScript' }));
      catalog.set(PDFName.of('AA'), doc.context.obj({ O: { S: 'JavaScript' } }));
      catalog.set(PDFName.of('JavaScript'), doc.context.obj({ JS: 'app.alert(1);' }));
      catalog.set(PDFName.of('Launch'), doc.context.obj({ S: 'Launch', F: 'malware.exe' }));
      catalog.set(PDFName.of('URI'), doc.context.obj({ Base: 'http://malicious.example' }));
      catalog.set(PDFName.of('EmbeddedFiles'), doc.context.obj({ Names: [] }));
      catalog.set(PDFName.of('AF'), doc.context.obj([]));
      catalog.set(PDFName.of('Metadata'), doc.context.obj({}));
      catalog.set(PDFName.of('PieceInfo'), doc.context.obj({}));

      // Inject Names dictionary
      const namesDict = doc.context.obj({
        JavaScript: doc.context.obj({ Names: [] }),
        EmbeddedFiles: doc.context.obj({ Names: [] }),
      });
      catalog.set(PDFName.of('Names'), namesDict);

      // Inject Page-level AA, AF, and Annotations
      page.node.set(PDFName.of('AA'), doc.context.obj({ O: { S: 'JavaScript' } }));
      page.node.set(PDFName.of('AF'), doc.context.obj([]));
      page.node.set(PDFName.of('Metadata'), doc.context.obj({}));

      const linkAnnot = doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [50, 50, 100, 100],
        A: { S: 'URI', URI: 'http://example.com' },
      });
      const stampAnnot = doc.context.obj({
        Type: 'Annot',
        Subtype: 'Stamp',
        Rect: [150, 150, 200, 200],
      });
      page.node.set(PDFName.of('Annots'), doc.context.obj([linkAnnot, stampAnnot]));

      const pdfBytes = await doc.save();
      const file = new File([pdfBytes], 'unsafe.pdf', { type: 'application/pdf' });

      const sanitizedBlob = await sanitizePdf(file, {
        removeJs: true,
        removeAttachments: true,
        removeLinks: true,
        removeMetadata: true,
      });

      const sanitizedDoc = await PDFDocument.load(await sanitizedBlob.arrayBuffer());
      const resCatalog = sanitizedDoc.catalog;

      // Verify catalog clean
      expect(resCatalog.has(PDFName.of('OpenAction'))).toBe(false);
      expect(resCatalog.has(PDFName.of('AA'))).toBe(false);
      expect(resCatalog.has(PDFName.of('JavaScript'))).toBe(false);
      expect(resCatalog.has(PDFName.of('JS'))).toBe(false);
      expect(resCatalog.has(PDFName.of('Launch'))).toBe(false);
      expect(resCatalog.has(PDFName.of('URI'))).toBe(false);
      expect(resCatalog.has(PDFName.of('EmbeddedFiles'))).toBe(false);
      expect(resCatalog.has(PDFName.of('AF'))).toBe(false);
      expect(resCatalog.has(PDFName.of('Metadata'))).toBe(false);
      expect(resCatalog.has(PDFName.of('PieceInfo'))).toBe(false);
      expect(resCatalog.has(PDFName.of('Names'))).toBe(false);

      // Verify page tree integrity intact
      expect(sanitizedDoc.getPageCount()).toBe(1);
      const resPage = sanitizedDoc.getPage(0);
      expect(resPage.getWidth()).toBe(400);
      expect(resPage.getHeight()).toBe(400);
      expect(resPage.node.has(PDFName.of('AA'))).toBe(false);
      expect(resPage.node.has(PDFName.of('AF'))).toBe(false);
      expect(resPage.node.has(PDFName.of('Metadata'))).toBe(false);

      // Verify link annotation removed while non-link stamp annotation preserved
      const annots = resPage.node.Annots();
      expect(annots).toBeDefined();
      expect(annots?.size()).toBe(1);
    });

    it('should support selective sanitization options', async () => {
      const doc = await PDFDocument.create();
      doc.setTitle('Keep Title');
      const page = doc.addPage([300, 300]);
      page.node.set(PDFName.of('AA'), doc.context.obj({ O: { S: 'JavaScript' } }));
      const pdfBytes = await doc.save();
      const file = new File([pdfBytes], 'test.pdf', { type: 'application/pdf' });

      const sanitizedBlob = await sanitizePdf(file, {
        removeJs: true,
        removeMetadata: false,
        removeAttachments: false,
        removeLinks: false,
      });

      const resDoc = await PDFDocument.load(await sanitizedBlob.arrayBuffer());
      expect(resDoc.getTitle()).toBe('Keep Title');
      const resPage = resDoc.getPage(0);
      expect(resPage.node.has(PDFName.of('AA'))).toBe(false);
    });
  });

  describe('redactPdf', () => {
    it('should permanently apply coordinate-based blackout boxes', async () => {
      const file = await createSamplePdf(2);
      const resultBlob = await redactPdf(file, [
        { page: 1, x: 50, y: 50, width: 100, height: 20 },
      ]);
      expect(resultBlob).toBeInstanceOf(Blob);
      expect(resultBlob.type).toBe('application/pdf');

      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getPageCount()).toBe(2);
    });

    it('should redact sensitive text matches with pdfjs text inspection', async () => {
      const mockPage = {
        getTextContent: vi.fn().mockResolvedValue({
          items: [
            { str: 'Confidential Account: 123456789', transform: [12, 0, 0, 12, 50, 300], width: 180, height: 12 },
            { str: 'Public Information', transform: [12, 0, 0, 12, 50, 200], width: 120, height: 12 },
          ],
        }),
        cleanup: vi.fn(),
      };
      const mockPdf = {
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(mockPage),
        destroy: vi.fn().mockResolvedValue(undefined),
      };

      (pdfjsLib.getDocument as any).mockReturnValue({
        promise: Promise.resolve(mockPdf),
      });

      const file = await createSamplePdf(1);
      const resultBlob = await redactPdf(file, [
        { page: 1, x: 0, y: 0, width: 0, height: 0, text: '123456789' },
      ]);
      expect(resultBlob).toBeInstanceOf(Blob);
      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getPageCount()).toBe(1);
      expect(mockPdf.destroy).toHaveBeenCalled();
    });

    it('should handle multi-word phrase matching across items', async () => {
      const mockPage = {
        getTextContent: vi.fn().mockResolvedValue({
          items: [
            { str: 'Patient', transform: [12, 0, 0, 12, 50, 300], width: 45, height: 12 },
            { str: 'John', transform: [12, 0, 0, 12, 100, 300], width: 30, height: 12 },
            { str: 'Doe', transform: [12, 0, 0, 12, 135, 300], width: 25, height: 12 },
          ],
        }),
        cleanup: vi.fn(),
      };
      const mockPdf = {
        numPages: 1,
        getPage: vi.fn().mockResolvedValue(mockPage),
        destroy: vi.fn().mockResolvedValue(undefined),
      };

      (pdfjsLib.getDocument as any).mockReturnValue({
        promise: Promise.resolve(mockPdf),
      });

      const file = await createSamplePdf(1);
      const resultBlob = await redactPdf(file, [
        { page: 1, x: 0, y: 0, width: 0, height: 0, text: 'John Doe' },
      ]);
      expect(resultBlob).toBeInstanceOf(Blob);
      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getPageCount()).toBe(1);
    });
  });

  describe('protectPdf', () => {
    it('should protect a valid PDF with password encryption', async () => {
      const file = await createSamplePdf(1);
      const resultBlob = await protectPdf(file, 'TestPassword123');
      expect(resultBlob).toBeInstanceOf(Blob);
      expect(resultBlob.type).toBe('application/pdf');
      expect(resultBlob.size).toBeGreaterThan(0);
    });

    it('should reject empty passwords', async () => {
      const file = await createSamplePdf(1);
      await expect(protectPdf(file, '')).rejects.toThrow('Password must not be empty');
    });

    it('should reject invalid non-PDF input files', async () => {
      const file = new File(['not a real pdf content'], 'invalid.pdf', { type: 'application/pdf' });
      await expect(protectPdf(file, 'password')).rejects.toThrow('Failed to parse PDF document');
    });
  });

  describe('flattenPdf', () => {
    it('should flatten form fields and remove AcroForm dictionary', async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([400, 400]);
      const form = doc.getForm();
      const textField = form.createTextField('username');
      textField.setText('John Doe');
      textField.addToPage(page, { x: 50, y: 300, width: 200, height: 30 });

      const pdfBytes = await doc.save();
      const file = new File([pdfBytes], 'form.pdf', { type: 'application/pdf' });

      const flattenedBlob = await flattenPdf(file);
      expect(flattenedBlob).toBeInstanceOf(Blob);
      expect(flattenedBlob.type).toBe('application/pdf');

      const resDoc = await PDFDocument.load(await flattenedBlob.arrayBuffer());
      expect(resDoc.catalog.has(PDFName.of('AcroForm'))).toBe(false);
      expect(resDoc.getPageCount()).toBe(1);
    });
  });

  describe('autoRotatePdf', () => {
    it('should rotate landscape pages into portrait', async () => {
      const doc = await PDFDocument.create();
      doc.addPage([800, 400]); // Landscape page
      const pdfBytes = await doc.save();
      const file = new File([pdfBytes], 'landscape.pdf', { type: 'application/pdf' });

      const resultBlob = await autoRotatePdf(file);
      expect(resultBlob).toBeInstanceOf(Blob);
      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      const page = resDoc.getPage(0);
      expect(page.getRotation().angle).toBe(90);
    });
  });

  describe('stampPdf', () => {
    it('should stamp custom badge on PDF pages', async () => {
      const doc = await PDFDocument.create();
      doc.addPage([400, 600]);
      const pdfBytes = await doc.save();
      const file = new File([pdfBytes], 'doc.pdf', { type: 'application/pdf' });

      const resultBlob = await stampPdf(file, 'APPROVED', { color: 'green', dateStamp: true });
      expect(resultBlob).toBeInstanceOf(Blob);
      expect(resultBlob.type).toBe('application/pdf');

      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getPageCount()).toBe(1);
    });
  });

  describe('nUpPageLayout', () => {
    it('should combine multiple pages into a 2-in-1 layout', async () => {
      const doc = await PDFDocument.create();
      const p1 = doc.addPage([300, 400]);
      p1.drawText('Page 1');
      const p2 = doc.addPage([300, 400]);
      p2.drawText('Page 2');
      const pdfBytes = await doc.save();
      const file = new File([pdfBytes], 'two_pages.pdf', { type: 'application/pdf' });

      const resultBlob = await nUpPageLayout(file, 2);
      expect(resultBlob).toBeInstanceOf(Blob);
      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getPageCount()).toBe(1);
    });

    it('should combine 4 pages into a 4-in-1 layout', async () => {
      const doc = await PDFDocument.create();
      for (let i = 0; i < 4; i++) {
        const page = doc.addPage([300, 400]);
        page.drawText(`Page ${i + 1}`);
      }
      const pdfBytes = await doc.save();
      const file = new File([pdfBytes], 'four_pages.pdf', { type: 'application/pdf' });

      const resultBlob = await nUpPageLayout(file, 4);
      expect(resultBlob).toBeInstanceOf(Blob);
      const resDoc = await PDFDocument.load(await resultBlob.arrayBuffer());
      expect(resDoc.getPageCount()).toBe(1);
    });
  });
});