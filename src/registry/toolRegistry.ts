import type { ToolID, ToolCategory, ToolHandler, ToolExecutionPayload, ToolResult } from '../types';
import {
  mergePdfs, splitPdf, compressPdf, convertPdfToImages,
  convertImagesToPdf, protectPdf, redactPdf, watermarkPdf,
  createTextPdf, rotatePdf, deletePages, extractPages,
  addPageNumbers, unlockPdf, repairPdf, reorderPages,
  addHeaderFooter, cropResizePdf, editMetadata, removeBlankPages,
  flattenPdf, extractText, convertPdfToDocx,
  sanitizePdf, extractEmbeddedImages, nUpPageLayout,
  scannerEffect, invertPdfColors, autoRotatePdf, stampPdf,
} from '../../services/pdfService';
import { processWithAI } from '../../services/geminiService';
import { processDocumentExcel } from '../../services/documentService';
import { getExcelBlob, downloadAsExcel } from '../../services/excelService';
import { extractInvestmentStatement } from '../../services/investmentExtractService';

export const TOOL_REGISTRY: ToolHandler[] = [
  {
    id: 'merge',
    category: 'Organize',
    name: 'Merge PDF',
    description: 'Combine multiple PDFs into one document.',
    icon: 'Merge',
    color: 'bg-blue-500',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 0,
    supportsBatchProcessing: true,
    handler: async ({ files, options, signal }: ToolExecutionPayload): Promise<ToolResult> => {
      // mergePdfs statically imported
      const blob = await mergePdfs(files, options?.mergePages as string | undefined);
      return { blob, filename: `Merged_${Date.now()}.pdf` };
    },
  },
  {
    id: 'split',
    category: 'Organize',
    name: 'Split PDF',
    description: 'Extract pages into separate files.',
    icon: 'Scissors',
    color: 'bg-cyan-500',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options }: ToolExecutionPayload): Promise<ToolResult> => {
      // splitPdf statically imported
      const JSZip = (await import('jszip')).default;
      const pages = await splitPdf(files[0], options?.splitPages as string | undefined);
      const zip = new JSZip();
      pages.forEach((res) => {
        const name = res.label || `Page_${res.pageNum || 1}.pdf`;
        zip.file(name, res.blob);
      });
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      return { blob: zipBlob, filename: `Split_${Date.now()}.zip` };
    },
  },
  {
    id: 'compress',
    category: 'Optimize',
    name: 'Compress PDF',
    description: 'Reduce file size by optimizing embedded images while preserving page dimensions.',
    icon: 'FileArchive',
    color: 'bg-emerald-500',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options, onProgress }: ToolExecutionPayload): Promise<ToolResult> => {
      // Determine compression quality from level or slider
      let quality = 0.60;
      if (options?.compressionLevel === 'extreme') quality = 0.40;
      else if (options?.compressionLevel === 'low') quality = 0.75;
      else if (typeof options?.compressionQuality === 'number') quality = options.compressionQuality;

      // 'images' re-encodes the embedded JPEGs and leaves the rest of the document alone, so text
      // stays selectable. 'rasterize' is the aggressive one and must be chosen deliberately: it turns
      // each page into a single picture, which discards any text layer the page had.
      const mode = options?.compressionMode === 'rasterize' ? 'rasterize' as const : 'images' as const;
      const blob = await compressPdf(files[0], quality, onProgress, undefined, mode);
      return { blob, filename: `Compressed_${Date.now()}.pdf` };
    },
  },
  {
    id: 'pdf-to-word',
    category: 'Convert',
    name: 'PDF to Markdown',
    description: 'AI-powered document reconstruction with formatting preserved as Markdown.',
    icon: 'FileText',
    color: 'bg-blue-600',
    requiresAuth: true,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, onProgress }: ToolExecutionPayload): Promise<ToolResult> => {
      // convertPdfToImages statically imported
      const images = await convertPdfToImages(files[0], (p: number) => onProgress?.(Math.round(p * 0.5)), 20, true);
      onProgress?.(50);
      const result = await processWithAI('pdf-to-word', images);
      const mdContent = (result.data ?? result.summary ?? 'No content extracted.') as string;
      const blob = new Blob([mdContent], { type: 'text/markdown' });
      return { blob, filename: `Document_${Date.now()}.md` };
    },
  },
  {
    id: 'pdf-to-excel',
    category: 'Convert',
    name: 'PDF to Excel',
    description: 'Intelligent table extraction to XLSX from scans or digital files.',
    icon: 'FileSpreadsheet',
    color: 'bg-green-600',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options, onProgress }: ToolExecutionPayload): Promise<ToolResult> => {
      let result: { rows: Record<string, unknown>[]; metadata?: Record<string, unknown> } | undefined;
      let lastError: Error | null = null;

      try {
        const docResult = await processDocumentExcel(files[0], options);
        if (docResult?.rows?.length > 0 && (docResult.metadata?.confidence ?? 1) >= 0.3) {
          result = docResult;
        }
      } catch (err: any) {
        const msg = err?.message || String(err || '');
        const code = err?.code || '';

        // Password-protected PDFs cannot be fixed by AI — throw immediately
        if (msg.toLowerCase().includes('password')) {
          throw err instanceof Error ? err : new Error(msg);
        }

        // For compression / blank / unreadable PDFs, fall through to AI vision
        const isCompressionError =
          code === 'COMPRESSION_UNREADABLE' ||
          msg.includes('unusual compression') ||
          msg.includes('blank pages') ||
          msg.includes('AI vision extraction may be able to help');

        if (isCompressionError) {
          console.warn('[pdf-to-excel] Compression/blank error — routing to AI vision fallback:', msg);
        } else {
          console.warn('[pdf-to-excel] Local extraction failed, trying AI fallback:', msg);
        }
        lastError = err instanceof Error ? err : new Error(msg);
      }

      if (!result?.rows?.length) {
        // AI Vision fallback: convert PDF pages to images and send to AI
        try {
          // First try normalizing the PDF to fix compression issues before rendering
          let fileForAI = files[0];
          try {
            const { normalizePdf } = await import('../../services/pdfNormalizer');
            const normResult = await normalizePdf(files[0]);
            if (normResult.wasNormalized) {
              fileForAI = normResult.file;
              console.log('[pdf-to-excel] Using normalized PDF for AI vision fallback.');
            }
          } catch (normErr) {
            console.warn('[pdf-to-excel] PDF normalization for AI failed, using original:', normErr);
          }

          const images = await convertPdfToImages(fileForAI, undefined, 20, true);
          if (!images.length) {
            throw new Error('NO_IMAGES');
          }
          const aiResult = await processWithAI('pdf-to-excel', images);
          const tableData = aiResult?.data as { rows?: Record<string, unknown>[]; document_metadata?: Record<string, unknown> } | undefined;
          const aiRows =
            tableData?.rows ||
            (aiResult?.rows as Record<string, unknown>[] | undefined);
          if (aiRows?.length) {
            const meta = (tableData?.document_metadata ||
              aiResult?.document_metadata ||
              {}) as Record<string, unknown>;
            result = {
              rows: aiRows,
              metadata: {
                pageCount: images.length,
                rowCount: aiRows.length,
                confidence: 0.70,
                columnCount: Object.keys(aiRows[0] || {}).length,
                columns: Object.keys(aiRows[0] || {}),
                source: 'ai-vision',
                openingBalance: meta.OpeningBalance ?? meta.openingBalance,
                closingBalance: meta.ClosingBalance ?? meta.closingBalance,
              },
            };
          }
        } catch (aiErr: any) {
          const aiMsg = aiErr?.message || String(aiErr || '');
          console.warn('[pdf-to-excel] AI vision fallback failed:', aiMsg);

          // Handle auth errors gracefully
          if (aiMsg.includes('Sign in required') || aiMsg.includes('401')) {
            throw new Error(
              'This PDF requires AI-powered extraction, but you need to sign in first. ' +
              'Please sign in and try again.'
            );
          }

          // If AI also can't render the pages
          if (aiMsg === 'NO_IMAGES') {
            throw new Error(
              'This PDF has unsupported compression and could not be rendered. ' +
              'Please try re-saving the PDF from the original application (e.g. Adobe Acrobat "Save As") and try again.'
            );
          }

          // If we had a previous error from local extraction, throw that context
          if (lastError) {
            throw new Error(
              'Extraction failed. Local extraction and AI vision both could not process this PDF. ' +
              'The document may use unsupported compression or be corrupted.'
            );
          }
          throw aiErr instanceof Error ? aiErr : new Error(aiMsg);
        }
      }

      if (!result?.rows?.length) {
        throw new Error(
          'No table data found in this document. ' +
          'If this is a scanned PDF, sign in to use AI-powered extraction.'
        );
      }

      const mapped: Record<string, unknown>[] = (result.rows || []).map((r: Record<string, unknown>) => {
        const debit = (r.Debit ?? r.debit ?? null) as string | null;
        const credit = (r.Credit ?? r.credit ?? null) as string | null;
        const explicitAmount = r.Amount ?? r.amount;
        const explicitDirection = String(r.Direction ?? r.direction ?? '').toUpperCase();
        let amount = 0;
        let direction: 'DEBIT' | 'CREDIT' | 'UNKNOWN' = 'UNKNOWN';

        if (debit !== null && debit !== undefined && String(debit).trim() !== '') {
          amount = -Math.abs(Number(String(debit).replace(/[^0-9.-]/g, '')) || 0);
          direction = 'DEBIT';
        } else if (credit !== null && credit !== undefined && String(credit).trim() !== '') {
          amount = Math.abs(Number(String(credit).replace(/[^0-9.-]/g, '')) || 0);
          direction = 'CREDIT';
        } else {
          const a = Number(String(explicitAmount ?? '').replace(/[^0-9.-]/g, '')) || 0;
          amount = a;
          direction = explicitDirection === 'DEBIT' || explicitDirection === 'CREDIT' || explicitDirection === 'UNKNOWN'
            ? explicitDirection
            : a < 0 ? 'DEBIT' : a > 0 ? 'CREDIT' : 'UNKNOWN';
        }

        return {
          date: r.Date ?? r.date ?? '',
          description: r.Description ?? r.description ?? '',
          amount,
          balance: Number(String(r.Balance ?? r.balance ?? '').replace(/[^0-9.-]/g, '')) || undefined,
          charges: Number(String(r.Charges ?? r.charges ?? 0)) || undefined,
          direction,
          bankCode: (result?.metadata?.bankCode as string) ?? 'UNKNOWN',
          confidence: Math.round(((result?.metadata?.confidence as number) ?? 0.9) * 100),
          metadata: result?.metadata ?? {},
        };
      });

      onProgress?.(90);
      // Keep the extractor's complete source schema in the workbook. The
      // normalized rows above are strictly for the cross-bank review UI.
      const blob = await getExcelBlob(result.rows, result?.metadata);
      if (!blob) throw new Error('Failed to generate Excel data.');

      return {
        blob,
        filename: `${files[0].name.replace(/\.pdf$/i, '')}_Extracted.xlsx`,
        data: { rows: mapped, metadata: result?.metadata },
      };
    },
  },
  {
    id: 'pdf-to-jpg',
    category: 'Convert',
    name: 'PDF to JPG',
    description: 'Convert each PDF page into high-quality JPG images.',
    icon: 'FileImage',
    color: 'bg-orange-500',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options, onProgress }: ToolExecutionPayload): Promise<ToolResult> => {
      // convertPdfToImages statically imported
      const JSZip = (await import('jszip')).default;
      const images = await convertPdfToImages(
        files[0],
        onProgress,
        50,
        false,
        undefined,
        undefined,
        options?.jpgPages as string | undefined
      );
      const zip = new JSZip();
      images.forEach((img: { base64: string; pageNumber: number }) => {
        const binStr = atob(img.base64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
        zip.file(`Page_${img.pageNumber}.jpg`, bytes);
      });
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      return { blob: zipBlob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_Images.zip` };
    },
  },
  {
    id: 'jpg-to-pdf',
    category: 'Convert',
    name: 'JPG to PDF',
    description: 'Convert and combine multiple images into a single, professional PDF document.',
    icon: 'FileImage',
    color: 'bg-rose-500',
    requiresAuth: false,
    allowedFileTypes: ['image/jpeg', 'image/png'],
    maxFiles: 0,
    supportsBatchProcessing: true,
    handler: async ({ files }: ToolExecutionPayload): Promise<ToolResult> => {
      // convertImagesToPdf statically imported
      const blob = await convertImagesToPdf(files);
      return { blob, filename: `Converted_Images_${Date.now()}.pdf` };
    },
  },
  {
    id: 'protect',
    category: 'Security',
    name: 'Protect PDF',
    description: 'Encrypt files with a password.',
    icon: 'Lock',
    color: 'bg-slate-800',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options }: ToolExecutionPayload): Promise<ToolResult> => {
      const password = options?.password as string;
      if (!password) throw new Error('Encryption key required.');
      // protectPdf statically imported
      const blob = await protectPdf(files[0], password);
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_Protected.pdf` };
    },
  },
  {
    id: 'redact',
    category: 'Security',
    name: 'Redact PDF',
    description: 'Smart detection and permanent removal of sensitive PII data & custom keywords.',
    icon: 'Eraser',
    color: 'bg-red-500',
    requiresAuth: true,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options, onProgress, signal }: ToolExecutionPayload): Promise<ToolResult> => {
      let piiRegions: Array<{ page: number; text: string; category: string; x: number; y: number; width: number; height: number }> = [];
      const customKeywords = typeof options?.redactKeywords === 'string'
        ? options.redactKeywords.split(/[,;\n]+/).map((k: string) => k.trim()).filter((k: string) => k.length > 1)
        : [];

      try {
        const pdfjsLib = await import('pdfjs-dist');
        const arrayBuf = await files[0].arrayBuffer();
        const pdfjsDoc = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
        const pageCount = pdfjsDoc.numPages;

        // Precise regexes that do NOT accidentally match resume date ranges (e.g. 2018 - 2022)
        const piiRegexes = [
          { category: 'Email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
          { category: 'Credit Card', regex: /\b(?:\d{4}[- ]?){3}\d{4}\b/g },
          // Phone: requires 8 to 15 digits total, avoiding simple 4-digit year ranges like "2018 - 2022"
          { category: 'Phone', regex: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g },
          // South African ID / 13-digit ID numbers
          { category: 'ID Number', regex: /\b\d{6}[0-9]{4}[0-8][89]\d\b/g },
        ];

        for (let pNum = 1; pNum <= pageCount; pNum++) {
          const jsPage = await pdfjsDoc.getPage(pNum);
          const textContent = await jsPage.getTextContent();
          const items = textContent.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>;

          // Match custom user keywords
          for (const keyword of customKeywords) {
            const kwLower = keyword.toLowerCase();
            for (const item of items) {
              const str = item.str ?? '';
              if (str.toLowerCase().includes(kwLower)) {
                piiRegions.push({ page: pNum, text: keyword, category: 'Custom Keyword', x: 0, y: 0, width: 0, height: 0 });
              }
            }
          }

          // Match PII regexes across individual text items or concatenated line chunks
          for (const item of items) {
            const itemStr = (item.str ?? '').trim();
            if (!itemStr) continue;

            for (const { category, regex } of piiRegexes) {
              regex.lastIndex = 0;
              let match: RegExpExecArray | null;
              while ((match = regex.exec(itemStr)) !== null) {
                const matchedText = match[0].trim();
                const digitsCount = (matchedText.match(/\d/g) || []).length;
                
                // Guard: Discard false positives like year ranges (2018 - 2022) or plain numbers with < 7 digits
                if (category === 'Phone') {
                  if (digitsCount < 8 || /^(19|20)\d{2}\s*[-–—]\s*(19|20)\d{2}$/.test(matchedText)) {
                    continue;
                  }
                }
                
                if (matchedText.length > 2) {
                  piiRegions.push({ page: pNum, text: matchedText, category, x: 0, y: 0, width: 0, height: 0 });
                }
              }
            }
          }
        }
      } catch {
        // Fall through to AI detection
      }

      if (piiRegions.length === 0 && customKeywords.length === 0) {
        onProgress?.(20);
        const images = await convertPdfToImages(files[0], undefined, 20, true);
        onProgress?.(50);
        const aiResult = await processWithAI('redact', images);
        piiRegions = (aiResult.data ?? []) as Array<{ page: number; text: string; category: string; x: number; y: number; width: number; height: number }>;
      }

      if (piiRegions.length === 0) {
        throw new Error('No sensitive data or matching keywords detected in this document.');
      }

      onProgress?.(70);
      const { PDFDocument } = await import('pdf-lib');
      const arrayBuf2 = await files[0].arrayBuffer();
      const pdfForDims = await PDFDocument.load(arrayBuf2, { ignoreEncryption: true });
      const pdfPages = pdfForDims.getPages();

      const absoluteRegions = piiRegions.map((r) => {
        const pageIdx = Math.min(r.page - 1, pdfPages.length - 1);
        const { width, height } = pdfPages[pageIdx].getSize();
        return {
          page: r.page,
          x: (r.x / 100) * width,
          y: (r.y / 100) * height,
          width: (r.width / 100) * width,
          height: (r.height / 100) * height,
          text: r.text,
        };
      });

      const redactedBlob = await redactPdf(files[0], absoluteRegions, { signal });
      return {
        blob: redactedBlob,
        filename: `${files[0].name.replace(/\.pdf$/i, '')}_Redacted.pdf`,
        // Redaction rasterizes every page: the output has no selectable/searchable
        // text and loses interactive form fields; a digitally signed document will
        // NOT retain its original valid signature. This caveat is surfaced to the UI.
        data: 'Rasterized redaction: searchable text and form fields are removed; any original digital signature is no longer valid.',
      };
    },
  },
  {
    id: 'watermark',
    category: 'Security',
    name: 'Watermark',
    description: 'Stamp images or repeating text patterns across pages.',
    icon: 'PenTool',
    color: 'bg-brand-500',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options }: ToolExecutionPayload): Promise<ToolResult> => {
      // watermarkPdf statically imported
      const text = (options?.watermarkText as string) ?? 'CONFIDENTIAL';
      const mode = (options?.watermarkMode as 'tiled' | 'single') ?? 'tiled';
      const blob = await watermarkPdf(files[0], text, { mode });
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_Watermarked.pdf` };
    },
  },
  {
    id: 'ocr',
    category: 'AI Labs',
    name: 'OCR to PDF',
    description: 'Convert scanned PDFs into high-fidelity searchable PDF documents.',
    icon: 'Zap',
    color: 'bg-amber-500',
    requiresAuth: true,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options, onProgress, signal }: ToolExecutionPayload): Promise<ToolResult> => {
      // Batch 07: the default is a GENUINE searchable PDF — the scanned page images are
      // preserved and a positioned invisible text layer is added (local OCR). A plain
      // transcript is opt-in and clearly labelled so it is never mistaken for the scan.
      const mode = (options?.ocrMode as string) || 'searchable';
      if (mode === 'transcript') {
        const images = await convertPdfToImages(files[0], (p: number) => onProgress?.(Math.round(p * 0.4)), 50, true);
        onProgress?.(40);
        const result = await processWithAI('ocr', images);
        const rawData = result.data ?? result.summary ?? 'No text extracted.';
        const ocrText = typeof rawData === 'string' ? rawData : JSON.stringify(rawData, null, 2);
        const blob = await createTextPdf(ocrText, `OCR TRANSCRIPT (not searchable overlay): ${files[0].name}`);
        return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_OCR_Transcript.pdf`, data: ocrText };
      }
      // buildSearchablePdf aborts (throws) on any page failure or invalid geometry; it never
      // emits a partial document, and a returned Blob is treated as unverified until the
      // browser run confirms image preservation + text placement.
      const { buildSearchablePdf } = await import('../../services/ocrService');
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const blob = await buildSearchablePdf(files[0], { onProgress: (p) => onProgress?.(p) });
      return {
        blob,
        filename: `${files[0].name.replace(/\.pdf$/i, '')}_Searchable.pdf`,
        data: 'Searchable overlay: original scanned pages preserved; an invisible text layer is positioned over each word.',
      };
    },
  },
  {
    id: 'compare',
    category: 'AI Labs',
    name: 'Compare PDF',
    description: 'Spot changes between versions.',
    icon: 'Layers',
    color: 'bg-pink-500',
    requiresAuth: true,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 2,
    supportsBatchProcessing: false,
    handler: async ({ files, onProgress }: ToolExecutionPayload): Promise<ToolResult> => {
      if (files.length !== 2) throw new Error('Comparison requires exactly 2 PDF files.');
      // convertPdfToImages statically imported
      // processWithAI statically imported
      const docAImages = (await convertPdfToImages(files[0], undefined, 20, true)).map(im => ({ ...im, docLabel: 'A' }));
      const docBImages = (await convertPdfToImages(files[1], undefined, 20, true)).map(im => ({ ...im, docLabel: 'B' }));
      onProgress?.(40);
      const aiResult = await processWithAI('compare', [...docAImages, ...docBImages]);
      const report = (aiResult.data as string) || 'Comparison failed to generate details.';
      const finalReport = aiResult.notice ? `${report}\n\nNOTE: ${aiResult.notice}` : report;
      const blob = new Blob([finalReport], { type: 'text/plain' });
      return { blob, filename: `Comparison_Report_${Date.now()}.txt`, data: finalReport };
    },
  },
  {
    id: 'rotate',
    category: 'Organize',
    name: 'Rotate PDF',
    description: 'Fix orientation for all pages — choose 90°, 180°, or 270°.',
    icon: 'RotateCw',
    color: 'bg-brand-500',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options }: ToolExecutionPayload): Promise<ToolResult> => {
      // rotatePdf statically imported
      const angle = parseInt((options?.rotationAngle as string) ?? '90', 10) || 90;
      const blob = await rotatePdf(files[0], angle);
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_Rotated.pdf` };
    },
  },
  {
    id: 'ocr-to-md',
    category: 'AI Labs',
    name: 'OCR to Markdown',
    description: 'Extract text from scanned PDFs as cleanly structured Markdown files.',
    icon: 'FileText',
    color: 'bg-amber-600',
    requiresAuth: true,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, onProgress }: ToolExecutionPayload): Promise<ToolResult> => {
      // convertPdfToImages statically imported
      // processWithAI statically imported
      const images = await convertPdfToImages(files[0], (p: number) => onProgress?.(Math.round(p * 0.4)), 50, true);
      onProgress?.(40);
      const result = await processWithAI('ocr', images);
      onProgress?.(80);
      const rawData = result.data ?? result.summary ?? 'No text extracted.';
      const mdContent = typeof rawData === 'string' ? rawData : JSON.stringify(rawData, null, 2);
      const blob = new Blob([mdContent], { type: 'text/markdown' });
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_OCR.md`, data: mdContent };
    },
  },
  {
    id: 'grammar-check',
    category: 'AI Labs',
    name: 'Grammar & Spell Check',
    description: 'AI-powered grammar, spelling, and style analysis of documents.',
    icon: 'CheckCircle2',
    color: 'bg-teal-500',
    requiresAuth: true,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, onProgress }: ToolExecutionPayload): Promise<ToolResult> => {
      // convertPdfToImages statically imported
      // processWithAI statically imported
      const images = await convertPdfToImages(files[0], (p: number) => onProgress?.(Math.round(p * 0.5)), 20, true);
      onProgress?.(50);
      const result = await processWithAI('grammar-check', images);
      const reportContent = (result.data ?? result.summary ?? 'Grammar analysis completed with no errors.') as string;
      const blob = new Blob([reportContent], { type: 'text/markdown' });
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_GrammarCheck.md`, data: reportContent };
    },
  },
  {
    id: 'delete-pages',
    category: 'Organize',
    name: 'Delete Pages',
    description: 'Remove unwanted pages or page ranges from your PDF document.',
    icon: 'Trash2',
    color: 'bg-rose-500',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options }: ToolExecutionPayload): Promise<ToolResult> => {
      const pagesToDelete = (options?.deletePages as string) || '';
      const blob = await deletePages(files[0], pagesToDelete);
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_Deleted.pdf` };
    },
  },
  {
    id: 'extract-pages',
    category: 'Organize',
    name: 'Extract Pages',
    description: 'Extract specific pages or page ranges into a dedicated new PDF.',
    icon: 'FileUp',
    color: 'bg-teal-500',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options }: ToolExecutionPayload): Promise<ToolResult> => {
      const pagesToExtract = (options?.extractPages as string) || '1';
      const blob = await extractPages(files[0], pagesToExtract);
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_Extracted.pdf` };
    },
  },
  {
    id: 'page-numbers',
    category: 'Organize',
    name: 'Add Page Numbers',
    description: 'Insert dynamic page numbers with customizable format and positioning.',
    icon: 'FileType',
    color: 'bg-brand-600',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options }: ToolExecutionPayload): Promise<ToolResult> => {
      const blob = await addPageNumbers(files[0], {
        position: options?.pageNumberPosition as string | undefined,
        format: options?.pageNumberFormat as string | undefined,
        startNum: options?.pageNumberStart as number | undefined,
      });
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_Numbered.pdf` };
    },
  },
  {
    id: 'unlock-pdf',
    category: 'Security',
    name: 'Unlock PDF',
    description: 'Remove password encryption and editing restrictions from PDF files.',
    icon: 'Lock',
    color: 'bg-emerald-600',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options }: ToolExecutionPayload): Promise<ToolResult> => {
      const password = (options?.unlockPassword as string) || (options?.password as string) || undefined;
      const blob = await unlockPdf(files[0], password);
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_Unlocked.pdf` };
    },
  },
  {
    id: 'pdf-to-text',
    category: 'Convert',
    name: 'PDF to Plain Text',
    description: 'Extract pure readable text from PDF documents instantly.',
    icon: 'FileText',
    color: 'bg-amber-600',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files }: ToolExecutionPayload): Promise<ToolResult> => {
      const blob = await extractText(files[0]);
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_Text.txt` };
    },
  },
  {
    id: 'pdf-repair',
    category: 'Optimize',
    name: 'Repair PDF',
    description: 'Recover corrupted, unreadable, or malformed PDF streams and syntax.',
    icon: 'Wand2',
    color: 'bg-brand-600',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files }: ToolExecutionPayload): Promise<ToolResult> => {
      const blob = await repairPdf(files[0]);
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_Repaired.pdf` };
    },
  },
  {
    id: 'reorder-pages',
    category: 'Organize',
    name: 'Reorder Pages',
    description: 'Rearrange and reorganize page sequence across your PDF document.',
    icon: 'Layers',
    color: 'bg-blue-500',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options }: ToolExecutionPayload): Promise<ToolResult> => {
      const order = (options?.reorderPages as string | number[]) || [];
      const blob = await reorderPages(files[0], order);
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_Reordered.pdf` };
    },
  },
  {
    id: 'header-footer',
    category: 'Organize',
    name: 'Header & Footer',
    description: 'Stamp custom headers, footers, page counts, and dates onto every page.',
    icon: 'Layout',
    color: 'bg-sky-500',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options }: ToolExecutionPayload): Promise<ToolResult> => {
      const blob = await addHeaderFooter(files[0], {
        header: options?.headerText as string | undefined,
        footer: options?.footerText as string | undefined,
      });
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_HeaderFooter.pdf` };
    },
  },
  {
    id: 'crop-resize',
    category: 'Optimize',
    name: 'Crop & Resize',
    description: 'Trim margins or resize pages to standard sizes (A4, Letter, Legal, etc.).',
    icon: 'Scissors',
    color: 'bg-pink-600',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options }: ToolExecutionPayload): Promise<ToolResult> => {
      const margins = options?.cropMargins as { top?: number } | undefined;
      const cropMarginMm = typeof margins?.top === 'number' ? margins.top : 0;
      const targetSize = options?.targetSize ? String(options.targetSize) : undefined;
      const blob = await cropResizePdf(files[0], { cropMarginMm, targetSize });
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_Cropped.pdf` };
    },
  },
  {
    id: 'metadata-edit',
    category: 'Security',
    name: 'Edit Metadata',
    description: 'Modify or completely sanitize PDF metadata (author, title, producer, etc.).',
    icon: 'PenTool',
    color: 'bg-brand-600',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options }: ToolExecutionPayload): Promise<ToolResult> => {
      const blob = await editMetadata(files[0], {
        title: options?.metaTitle as string | undefined,
        author: options?.metaAuthor as string | undefined,
        subject: options?.metaSubject as string | undefined,
        stripAll: Boolean(options?.stripMetadata),
        creator: options?.metaCreator as string | undefined,
        producer: options?.metaProducer as string | undefined,
      });
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_Metadata.pdf` };
    },
  },
  {
    id: 'remove-blank-pages',
    category: 'Optimize',
    name: 'Remove Blank Pages',
    description: 'Automatically scan and eliminate empty or white pages from documents.',
    icon: 'Eraser',
    color: 'bg-orange-600',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options }: ToolExecutionPayload): Promise<ToolResult> => {
      // No UI control sets this, so the default is the safe one: only a page with zero ink is blank.
      const threshold = typeof options?.blankPageThreshold === 'number' ? options.blankPageThreshold : 0;
      const blob = await removeBlankPages(files[0], threshold);
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_NoBlankPages.pdf` };
    },
  },
  {
    id: 'flatten-pdf',
    category: 'Security',
    name: 'Flatten PDF',
    description: 'Lock interactive form fields, checkmarks, and annotations into static pages.',
    icon: 'ShieldCheck',
    color: 'bg-stone-700',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files }: ToolExecutionPayload): Promise<ToolResult> => {
      const blob = await flattenPdf(files[0]);
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_Flattened.pdf` };
    },
  },
  {
    id: 'pdf-to-docx',
    category: 'Convert',
    name: 'PDF to Word (DOCX)',
    description: 'Convert PDF into editable Microsoft Word (.docx) document format.',
    icon: 'FileText',
    color: 'bg-blue-700',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files }: ToolExecutionPayload): Promise<ToolResult> => {
      const blob = await convertPdfToDocx(files[0]);
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}.docx` };
    },
  },
  {
    id: 'pdf-qa',
    category: 'AI Labs',
    name: 'PDF Q&A Assistant',
    description: 'Ask questions and receive instant, source-grounded answers about your document.',
    icon: 'Sparkles',
    color: 'bg-brand-600',
    requiresAuth: true,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options, onProgress }: ToolExecutionPayload): Promise<ToolResult> => {
      const images = await convertPdfToImages(files[0], (p: number) => onProgress?.(Math.round(p * 0.5)), 20, true);
      onProgress?.(50);
      const result = await processWithAI('pdf-qa', images, options);
      const answer = (result.data ?? result.summary ?? (typeof result === 'string' ? result : 'No answer could be generated.')) as string;
      const blob = new Blob([answer], { type: 'text/markdown' });
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_QA_Answer.md`, data: answer };
    },
  },
  {
    id: 'pdf-summary',
    category: 'AI Labs',
    name: 'PDF Summary',
    description: 'Generate structured executive summaries, key takeaways, and action items.',
    icon: 'Zap',
    color: 'bg-brand-600',
    requiresAuth: true,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options, onProgress }: ToolExecutionPayload): Promise<ToolResult> => {
      const images = await convertPdfToImages(files[0], (p: number) => onProgress?.(Math.round(p * 0.5)), 20, true);
      onProgress?.(50);
      const result = await processWithAI('pdf-summary', images, options);
      const summaryText = (result.data ?? result.summary ?? (typeof result === 'string' ? result : 'Summary generation completed.')) as string;
      const blob = new Blob([summaryText], { type: 'text/markdown' });
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_Summary.md`, data: summaryText };
    },
  },
  {
    id: 'sanitize',
    category: 'Security',
    name: 'Sanitize PDF',
    description: 'Strip embedded JavaScript actions, hidden launch triggers, attachments, and sensitive metadata.',
    icon: 'Shield',
    color: 'bg-emerald-700',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options }: ToolExecutionPayload): Promise<ToolResult> => {
      const blob = await sanitizePdf(files[0], {
        removeJs: options?.sanitizeRemoveJs !== false,
        removeAttachments: options?.sanitizeRemoveAttachments !== false,
        removeLinks: options?.sanitizeRemoveLinks !== false,
        removeMetadata: options?.sanitizeRemoveMetadata !== false,
      });
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_Sanitized.pdf` };
    },
  },
  {
    id: 'extract-images',
    category: 'Convert',
    name: 'Extract Images',
    description: 'Extract all embedded graphics, photos, diagrams, and figures into a single ZIP file.',
    icon: 'Image',
    color: 'bg-teal-600',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files }: ToolExecutionPayload): Promise<ToolResult> => {
      const { zipBlob } = await extractEmbeddedImages(files[0]);
      return { blob: zipBlob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_Images.zip` };
    },
  },
  {
    id: 'n-up',
    category: 'Organize',
    name: 'Multi-Page Layout (N-Up)',
    description: 'Combine multiple pages (2-in-1, 4-in-1, 9-in-1) onto single physical sheets.',
    icon: 'Grid',
    color: 'bg-blue-600',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options }: ToolExecutionPayload): Promise<ToolResult> => {
      const grid = (options?.nUpGrid as 2 | 4 | 9) || 2;
      const blob = await nUpPageLayout(files[0], grid);
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_${grid}up.pdf` };
    },
  },
  {
    id: 'scan-effect',
    category: 'Optimize',
    name: 'Scanner / Paper Look',
    description: 'Add authentic physical paper grain, photocopy toner contrast, and realistic scanner deskew.',
    icon: 'Printer',
    color: 'bg-amber-700',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options }: ToolExecutionPayload): Promise<ToolResult> => {
      const contrast = typeof options?.scannerContrast === 'number' ? options.scannerContrast : 1.2;
      const noise = typeof options?.scannerNoise === 'number' ? options.scannerNoise : 15;
      const tilt = options?.scannerTilt !== false;
      const blob = await scannerEffect(files[0], { contrast, noise, tilt });
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_Scanned.pdf` };
    },
  },
  {
    id: 'invert-colors',
    category: 'Optimize',
    name: 'Invert Colors / Dark PDF',
    description: 'Invert page color spectrum for dark-mode reading and eye-strain reduction.',
    icon: 'Moon',
    color: 'bg-slate-800',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files }: ToolExecutionPayload): Promise<ToolResult> => {
      const blob = await invertPdfColors(files[0]);
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_Inverted.pdf` };
    },
  },
  {
    id: 'auto-rotate',
    category: 'Organize',
    name: 'Auto-Rotate Pages',
    description: 'Smart auto-detection to standardize mixed landscape and portrait pages into uniform layout.',
    icon: 'RotateCw',
    color: 'bg-cyan-600',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files }: ToolExecutionPayload): Promise<ToolResult> => {
      const blob = await autoRotatePdf(files[0]);
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_AutoRotated.pdf` };
    },
  },
  {
    id: 'stamp',
    category: 'Organize',
    name: 'Add Stamp Badge',
    description: 'Stamp bold rubber badges (APPROVED, CONFIDENTIAL, RECEIVED, FINAL) with dates.',
    icon: 'Award',
    color: 'bg-rose-600',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options }: ToolExecutionPayload): Promise<ToolResult> => {
      const stampText = (options?.stampText as string) || 'APPROVED';
      const color = (options?.stampColor as 'red' | 'green' | 'blue') || 'red';
      const dateStamp = options?.stampDate !== false;
      const blob = await stampPdf(files[0], stampText, { color, dateStamp });
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_Stamped.pdf` };
    },
  },
  {
    id: 'portfolio-statements',
    category: 'Convert',
    name: 'Portfolio Statements',
    description: 'Extract holdings, units and values from unit-trust / investment statements into a workbook.',
    icon: 'TrendingUp',
    color: 'bg-emerald-600',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files }: ToolExecutionPayload): Promise<ToolResult> => {
      const result = await extractInvestmentStatement(files[0]);
      const blob = await getExcelBlob(result.rows, result.metadata);
      return {
        blob,
        filename: `${files[0].name.replace(/\.pdf$/i, '')}_Portfolio.xlsx`,
        data: { holdings: result.holdings, transactions: result.transactions, metadata: result.metadata },
      } as ToolResult;
    },
  },
];

export function getToolById(id: ToolID): ToolHandler | undefined {
  return TOOL_REGISTRY.find(t => t.id === id);
}

export function getToolsByCategory(category: ToolCategory): ToolHandler[] {
  if (category === 'All') return TOOL_REGISTRY;
  return TOOL_REGISTRY.filter(t => t.category === category);
}
