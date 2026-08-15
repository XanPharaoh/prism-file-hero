import type { ToolID, ToolCategory, ToolHandler, ToolExecutionPayload, ToolResult } from '../types';
import {
  mergePdfs, splitPdf, compressPdf, convertPdfToImages,
  convertImagesToPdf, protectPdf, redactPdf, watermarkPdf,
  createTextPdf, rotatePdf,
} from '../../services/pdfService';
import { processWithAI } from '../../services/geminiService';
import { processDocumentExcel } from '../../services/documentService';
import { getExcelBlob, downloadAsExcel } from '../../services/excelService';

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
      pages.forEach(({ blob, pageNum }: { blob: Blob; pageNum: number }) => {
        zip.file(`Page_${pageNum}.pdf`, blob);
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
    handler: async ({ files, onProgress }: ToolExecutionPayload): Promise<ToolResult> => {
      // compressPdf statically imported
      const blob = await compressPdf(files[0], 0.65, onProgress);
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
          const aiRows =
            (aiResult?.data?.rows as Record<string, unknown>[] | undefined) ||
            (aiResult?.rows as Record<string, unknown>[] | undefined);
          if (aiRows?.length) {
            const meta = (aiResult?.data?.document_metadata ||
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
    handler: async ({ files, onProgress }: ToolExecutionPayload): Promise<ToolResult> => {
      // convertPdfToImages statically imported
      const JSZip = (await import('jszip')).default;
      const images = await convertPdfToImages(files[0], onProgress);
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
    description: 'AI-powered detection and permanent removal of sensitive PII data.',
    icon: 'Eraser',
    color: 'bg-red-500',
    requiresAuth: true,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, onProgress }: ToolExecutionPayload): Promise<ToolResult> => {
      // Scan for PII using regex
      let piiRegions: Array<{ page: number; text: string; category: string; x: number; y: number; width: number; height: number }> = [];
      try {
        const pdfjsLib = await import('pdfjs-dist');
        const arrayBuf = await files[0].arrayBuffer();
        const pdfjsDoc = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
        const pageCount = pdfjsDoc.numPages;
        const piiRegexes = [
          { category: 'Email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
          { category: 'Credit Card', regex: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g },
          { category: 'Phone', regex: /\b\+?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g },
        ];
        for (let pNum = 1; pNum <= pageCount; pNum++) {
          const jsPage = await pdfjsDoc.getPage(pNum);
          const textContent = await jsPage.getTextContent();
          const pageText = textContent.items.map((it: Record<string, unknown>) => (it as { str?: string }).str ?? '').join(' ');
          for (const { category, regex } of piiRegexes) {
            let match: RegExpExecArray | null;
            regex.lastIndex = 0;
            while ((match = regex.exec(pageText)) !== null) {
              const matchedText = match[0].trim();
              if (matchedText.length > 2) {
                piiRegions.push({ page: pNum, text: matchedText, category, x: 0, y: 0, width: 0, height: 0 });
              }
            }
          }
        }
      } catch {
        // Fall through to AI detection
      }

      if (piiRegions.length === 0) {
        onProgress?.(20);
        const images = await convertPdfToImages(files[0], undefined, 20, true);
        onProgress?.(50);
        const aiResult = await processWithAI('redact', images);
        piiRegions = (aiResult.data ?? []) as Array<{ page: number; text: string; category: string; x: number; y: number; width: number; height: number }>;
      }

      if (piiRegions.length === 0) {
        throw new Error('No sensitive data detected in this document.');
      }

      onProgress?.(70);
      const { PDFDocument } = await import('pdf-lib');
      const arrayBuf2 = await files[0].arrayBuffer();
      const pdfForDims = await PDFDocument.load(arrayBuf2);
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

      const redactedBlob = await redactPdf(files[0], absoluteRegions);
      return { blob: redactedBlob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_Redacted.pdf` };
    },
  },
  {
    id: 'watermark',
    category: 'Security',
    name: 'Watermark',
    description: 'Stamp images or text over pages.',
    icon: 'PenTool',
    color: 'bg-indigo-500',
    requiresAuth: false,
    allowedFileTypes: ['application/pdf'],
    maxFiles: 1,
    supportsBatchProcessing: false,
    handler: async ({ files, options }: ToolExecutionPayload): Promise<ToolResult> => {
      // watermarkPdf statically imported
      const text = (options?.watermarkText as string) ?? 'CONFIDENTIAL';
      const blob = await watermarkPdf(files[0], text);
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
    handler: async ({ files, onProgress }: ToolExecutionPayload): Promise<ToolResult> => {
      // convertPdfToImages + createTextPdf statically imported
      // processWithAI statically imported
      const images = await convertPdfToImages(files[0], (p: number) => onProgress?.(Math.round(p * 0.4)), 50, true);
      onProgress?.(40);
      const result = await processWithAI('ocr', images);
      onProgress?.(80);
      const rawData = result.data ?? result.summary ?? 'No text extracted.';
      const ocrText = typeof rawData === 'string' ? rawData : JSON.stringify(rawData, null, 2);
      const blob = await createTextPdf(ocrText, `OCR: ${files[0].name}`);
      return { blob, filename: `${files[0].name.replace(/\.pdf$/i, '')}_OCR.pdf`, data: ocrText };
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
      const docAImages = await convertPdfToImages(files[0], undefined, 20, true);
      const docBImages = await convertPdfToImages(files[1], undefined, 20, true);
      onProgress?.(40);
      const combinedImages = [...docAImages, ...docBImages];
      const aiResult = await processWithAI('compare', combinedImages);
      const report = (aiResult.data ?? 'Comparison failed to generate details.') as string;
      const blob = new Blob([report], { type: 'text/plain' });
      return { blob, filename: `Comparison_Report_${Date.now()}.txt`, data: report };
    },
  },
  {
    id: 'rotate',
    category: 'Organize',
    name: 'Rotate PDF',
    description: 'Fix orientation for all pages — choose 90°, 180°, or 270°.',
    icon: 'RotateCw',
    color: 'bg-purple-500',
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
];

export function getToolById(id: ToolID): ToolHandler | undefined {
  return TOOL_REGISTRY.find(t => t.id === id);
}

export function getToolsByCategory(category: ToolCategory): ToolHandler[] {
  if (category === 'All') return TOOL_REGISTRY;
  return TOOL_REGISTRY.filter(t => t.category === category);
}
