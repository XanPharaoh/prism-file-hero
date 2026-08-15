/**
 * Universal Financial Document Extraction Service
 * Multi-strategy pipeline with document type detection and confidence scoring
 */

import { extractTable } from './tableExtractor';
import { extractCapitecStatement, convertCapitecToExcelRows } from './capitecExtractService';
import { extractFNBStatement, convertToExcelRows as convertFNBToExcelRows } from './fnbExtractService';
import { extractNedbankStatement, convertNedbankToExcelRows } from './nedbankExtractService';
import {
  convertTymeBankToExcelRows,
  extractTymeBank,
} from './tymebankExtractService';
import { detectBank as registryDetectBank } from './bankRegistry';
import { ocrPdfToTextItems } from './ocrService';
import { extractWithDocling } from './doclingService';
import { extractDocument, type ExtractionOptions } from './extractionPipeline';
import { reconcileRows, type ReconciliationResult } from './reconciliationService';
import { calculateConfidence } from './confidenceScoring';
import { validatePDF, hasCompressionIssues } from './pdfValidator';
import { extractGenericStatement } from './genericStatementExtractor';
import { toExcelRows } from './statementSchema';
import { detectColumns } from './normalizer';
import {
    alignmentToRows,
    extractSpatialAlignment,
    type TableAlignmentResult,
} from './spatialTableExtractor';
import { pdfjsLib as pdfjs } from './pdfjsClient';

export interface DocumentServiceResult {
  rows: Record<string, any>[];
  metadata: {
    pageCount: number;
    rowCount: number;
    confidence: number;
    columnCount: number;
    columns: string[];
    source: string;
    bankCode: string;
    bankName?: string;
    openingBalance?: string | number | null;
    closingBalance?: string | number | null;
    accountNumber?: string | null;
    branchCode?: string | null;
    statementPeriod?: string | null;
    reconciles?: boolean;
    parseErrors?: number;
    documentType?: string;
    extractionMethod?: string;
    ledgerHealth?: any;
    confidenceMetrics?: any;
    warnings?: string[];
    validationIssues?: string[];
    requiresReview?: boolean;
    reviewReasons?: string[];
    parserDisagreement?: boolean;
    alignment?: TableAlignmentResult;
  };
}

/**
 * Extract native PDF text without relying on canvas rendering. Some valid PDFs
 * render blank in a browser canvas while their text layer remains available.
 */
async function extractNativePdfText(file: File, maxPages = 3): Promise<{ fullText: string; textItemCount: number }> {
    // PDF.js may transfer its input to a worker, so retain no shared File buffer.
    const bytes = new Uint8Array(new Uint8Array(await file.arrayBuffer()));
    const pdf = await pdfjs.getDocument({ data: bytes }).promise;
    const pageCount = Math.min(pdf.numPages, maxPages);
    const parts: string[] = [];
    let textItemCount = 0;

    for (let p = 1; p <= pageCount; p++) {
        try {
            const page = await pdf.getPage(p);
            const content = await page.getTextContent();
            const items = content.items.filter((i: any) => i.str && String(i.str).trim());
            textItemCount += items.length;
            parts.push(items.map((i: any) => i.str).join(' '));
        } catch (error) {
            // A damaged page must not hide native text from later pages.
            console.warn(`[DocumentService] Native text extraction failed on page ${p}:`, error);
        }
    }

    return { fullText: parts.join('\n'), textItemCount };
}

/**
 * Detect a bank from native text across the opening pages.
 */
async function detectBank(file: File): Promise<{ bankCode: string; bankName: string; confidence: number; textItemCount: number }> {
    try {
        const { fullText, textItemCount } = await extractNativePdfText(file);
        const result = registryDetectBank(fullText);
        return { bankCode: result.bankCode, bankName: result.bankName, confidence: result.confidence, textItemCount };
    } catch (error) {
        console.warn('[DocumentService] Native text bank detection failed:', error);
        return { bankCode: 'UNKNOWN', bankName: 'Unknown Bank', confidence: 0, textItemCount: 0 };
    }
}

/**
 * Extract text layer from up to maxPages for the generic statement rescue path.
 */
async function extractPdfTextLayer(file: File, maxPages = 10): Promise<{ fullText: string; textItemCount: number }> {
    try {
        return await extractNativePdfText(file, maxPages);
    } catch (error) {
        console.warn('[DocumentService] Native text rescue failed:', error);
        return { fullText: '', textItemCount: 0 };
    }
}

/**
 * Lightweight normalization pass for object-based Excel rows.
 * Uses the normalizer's column detection to identify date/amount columns,
 * then standardises dates to ISO format and amounts to numbers.
 */
function normalizeExcelRows(
    rows: Record<string, any>[],
    bankCode: string,
): Record<string, any>[] {
    if (rows.length === 0) return rows;
    const columns = Object.keys(rows[0]);
    const colMapping = detectColumns(columns);

    // If we couldn't detect any columns, return as-is
    if (Object.keys(colMapping).length === 0) return rows;

    return rows.map(row => {
        const normalized = { ...row };

        // Normalize date columns to ISO format
        if (colMapping.date !== undefined) {
            const dateCol = columns[colMapping.date];
            const raw = String(normalized[dateCol] || '').trim();
            if (raw) {
                // Try basic dd/mm/yy or dd/mm/yyyy → yyyy-mm-dd
                const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
                if (m) {
                    const [, d, mo, y] = m;
                    const year = y.length === 2 ? `20${y}` : y;
                    normalized[dateCol] = `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
                }
            }
        }

        // Normalize amount columns to numbers
        for (const field of ['debit', 'credit', 'balance'] as const) {
            if (colMapping[field] !== undefined) {
                const col = columns[colMapping[field]];
                const raw = String(normalized[col] || '').trim();
                if (raw) {
                    const cleaned = raw.replace(/[R$,\s]/g, '');
                    const num = parseFloat(cleaned);
                    if (!isNaN(num)) normalized[col] = num;
                }
            }
        }

        // Trim description whitespace
        if (colMapping.description !== undefined) {
            const descCol = columns[colMapping.description];
            if (typeof normalized[descCol] === 'string') {
                normalized[descCol] = normalized[descCol].replace(/\s+/g, ' ').trim();
            }
        }

        return normalized;
    });
}

function buildGenericResult(
    generic: ReturnType<typeof extractGenericStatement>,
    source: string
): DocumentServiceResult {
    const rawRows = toExcelRows(generic);
    // Apply normalization pass to standardise dates, amounts, descriptions
    const rows = normalizeExcelRows(rawRows, generic.bankCode ?? 'UNKNOWN');
    return {
        rows,
        metadata: {
            pageCount: generic.pagesProcessed,
            rowCount: rows.length,
            confidence: generic.computedConfidence,
            columnCount: rows.length > 0 ? Object.keys(rows[0]).length : 0,
            columns: rows.length > 0 ? Object.keys(rows[0]) : [],
            source,
            bankCode: generic.bankCode ?? 'UNKNOWN',
            bankName: generic.bankName ?? undefined,
            openingBalance: generic.openingBalance,
            closingBalance: generic.closingBalance,
            accountNumber: generic.accountNumber ?? undefined,
            branchCode: generic.branchCode ?? undefined,
            statementPeriod: generic.statementPeriod ?? undefined,
            reconciles: generic.reconcile.isValid,
            parseErrors: generic.parseErrors,
            documentType: 'bank-statement',
            extractionMethod: 'generic-text',
            layoutProfile: generic.layoutProfile,
            genericConfidence: generic.computedConfidence,
            rowsWithValidDate: generic.rowsWithValidDate,
            rowsWithValidMoney: generic.rowsWithValidMoney,
        } as DocumentServiceResult['metadata'] & {
            layoutProfile?: string;
            genericConfidence?: number;
            rowsWithValidDate?: number;
            rowsWithValidMoney?: number;
        },
    };
}

function hasReconciliationFailure(metadata: DocumentServiceResult['metadata']): boolean {
    return metadata.reconciles === false && metadata.openingBalance != null && metadata.closingBalance != null;
}

function needsSpatialRescue(result: DocumentServiceResult | null): boolean {
    return !result || result.rows.length === 0 || result.metadata.confidence < 0.75;
}

function isStandardBankLedgerRow(row: Record<string, unknown>): boolean {
    const values = Object.values(row).map((value) => String(value).trim());
    const dateAndDescription = values[1] ?? '';
    const isHeaderOrBalance = values.some((value) => /\b(?:payments|deposits|available balance|statement opening balance)\b/i.test(value));
    return /^\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{2,4}\b/i.test(dateAndDescription) && !isHeaderOrBalance;
}

async function extractStandardBankStatement(file: File): Promise<Record<string, any>[]> {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const rows: Record<string, any>[] = [];
    let pending: Record<string, any> | null = null;
    const dateRe = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2,4})\s+(.+)$/i;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const items = (await (await pdf.getPage(pageNumber)).getTextContent()).items as any[];
        const lines = new Map<number, any[]>();
        for (const item of items) { if (item.str?.trim()) { const y = Math.round(item.transform[5] / 3) * 3; lines.set(y, [...(lines.get(y) ?? []), item]); } }
        for (const line of [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, value]) => value.sort((a, b) => a.transform[4] - b.transform[4]).map((item) => item.str.trim()).join(' '))) {
            const match = line.match(dateRe);
            if (match) {
                const money = [...line.matchAll(/-?[\d,]+\.\d{2}/g)].map((value) => Number(value[0].replace(/,/g, '')));
                if (money.length < 2) continue;
                const [, day, month, year, descriptionWithMoney] = match;
                const description = descriptionWithMoney.replace(/-?[\d,]+\.\d{2}/g, '').trim();
                const amount = money[money.length - 2];
                pending = { Date: `${year.length === 2 ? '20' : ''}${year}-${String(['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(month.toLowerCase()) + 1).padStart(2, '0')}-${day.padStart(2, '0')}`, Description: description, Debit: amount < 0 ? Math.abs(amount) : null, Credit: amount >= 0 ? amount : null, Balance: money[money.length - 1], Direction: amount < 0 ? 'DEBIT' : 'CREDIT' };
                rows.push(pending);
            } else if (pending && !/statement|transaction details|opening balance|available balance|payments|deposits|balance|from:|to:/i.test(line) && !/^-?[\d,]+\.\d{2}$/.test(line)) {
                pending.Description = `${pending.Description} ${line}`.trim();
            }
        }
    }
    return rows;
}

async function extractAbsaStatement(file: File): Promise<{ rows: Record<string, any>[]; openingBalance: number | null; closingBalance: number | null }> {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const rows: Record<string, any>[] = [];
    let pending: Record<string, any> | null = null;
    let openingBalance: number | null = null;
    let previousBalance: number | null = null;
    const dateRe = /^(\d{1,2}\/\d{2}\/\d{4})\s+(.+)$/;
    const money = (text: string) => [...text.matchAll(/\d[\d ]*\.\d{2}/g)].map((match) => Number(match[0].replace(/ /g, '')));
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const items = (await (await pdf.getPage(pageNumber)).getTextContent()).items as any[];
        const lines = new Map<number, any[]>();
        for (const item of items) { if (item.str?.trim()) { const y = Math.round(item.transform[5] / 3) * 3; lines.set(y, [...(lines.get(y) ?? []), item]); } }
        for (const line of [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, value]) => value.sort((a, b) => a.transform[4] - b.transform[4]).map((item) => item.str.trim()).join(' '))) {
            const match = line.match(dateRe);
            if (match) {
                const values = money(line);
                if (!values.length) continue;
                const [, date, description] = match;
                const balance = values.at(-1)!;
                if (/^bal brought forward/i.test(description)) { openingBalance = balance; previousBalance = balance; pending = null; continue; }
                const delta = previousBalance === null ? 0 : Number((balance - previousBalance).toFixed(2));
                const charge = /\b[AT]\b/.test(line) && values.length >= 2 ? values[values.length - 2] : null;
                const amount = charge === null ? Math.abs(delta) : 0;
                pending = { Date: date.split('/').reverse().join('-'), Description: description.replace(/\d[\d ]*\.\d{2}/g, '').replace(/\b[AT]\b/g, '').trim(), Charge: charge, Debit: charge === null && delta < 0 ? amount : null, Credit: charge === null && delta > 0 ? amount : null, Balance: balance, Direction: charge !== null ? 'FEE' : delta < 0 ? 'DEBIT' : 'CREDIT' };
                rows.push(pending); previousBalance = balance;
            } else if (pending && !/^(?:date|cheque account|your transactions|page \d|absa bank|authorised|registration|tax invoice|effective|estamp|general enquiries|return address|your pricing|credit interest|vat r|charge:|our privacy|private|oxford house|sedghill|ottery|cape town|p o box|daily grocer)/i.test(line) && !/^\(effective\b/i.test(line) && !/^[\d\s.,-]+$/.test(line)) {
                pending.Description = `${pending.Description} ${line}`.trim();
            }
        }
    }
    const ABSA_NOISE_RE = /\s*(?:eStamp|General Enquiries|Return address:.*?|Our Privacy Notice[^.]*\.|CSP\d+\S+|DGROCER\d+|\d{6,}\s+\d{4}\s+\d{2}\/\d{2}\/\d{4}\s*|\(Effective\s+\d{2}\/\d{2}\/\d{4}\)|YOUR PRICING PLAN[^.]*|CREDIT INTEREST RATE[^.]*|\*\s*=\s*VAT[^.]*(?:INCLUDED)?|CHARGE:\s+[A-Z][^.]*|Absa Bank Ltd[^.]*|Private Bag[^.]*|Cheque Account Number[^.]*|Authorised Financial[^.]*)\s*/gi;
    for (const row of rows) {
        row.Description = row.Description.replace(ABSA_NOISE_RE, ' ').replace(/\s+/g, ' ').trim();
    }
    return { rows, openingBalance, closingBalance: previousBalance };
}

async function buildSpatialRescue(
    file: File,
    bankCode: string,
    bankName: string,
    previous: DocumentServiceResult | null,
): Promise<DocumentServiceResult | null> {
    const alignment = await extractSpatialAlignment(file);
    const rawRows = alignmentToRows(alignment);
    const ledgerRows = bankCode === 'STANDARD_BANK_SA'
        ? rawRows.filter(isStandardBankLedgerRow)
        : rawRows;
    if (!ledgerRows.length) return null;
    const rows = normalizeExcelRows(ledgerRows, bankCode);
    return {
        rows,
        metadata: {
            pageCount: alignment.pages.length,
            rowCount: rows.length,
            confidence: alignment.confidence,
            columnCount: alignment.headers.length,
            columns: alignment.headers,
            source: 'spatial-alignment-rescue',
            bankCode,
            bankName,
            documentType: 'bank-statement',
            extractionMethod: alignment.coordinateSource,
            alignment,
            parserDisagreement: Boolean(previous?.rows.length),
            warnings: alignment.diagnostics.length ? alignment.diagnostics : undefined,
        },
    };
}

function applyReviewGate(result: DocumentServiceResult): DocumentServiceResult {
    const reasons: string[] = [];
    if (hasReconciliationFailure(result.metadata)) reasons.push('Opening, transaction, and closing balances do not reconcile.');
    if (result.metadata.parserDisagreement) reasons.push('The specialized parser and spatial alignment result disagree.');
    if (result.metadata.confidence < 0.75) reasons.push(`Extraction confidence is ${(result.metadata.confidence * 100).toFixed(0)}%, below the 75% review threshold.`);
    if (reasons.length) {
        result.metadata.requiresReview = true;
        result.metadata.reviewReasons = reasons;
        result.metadata.warnings = [...(result.metadata.warnings ?? []), ...reasons];
    }
    return result;
}

/**
 * Smart PDF-to-Excel Document Processing Router
 * 
 * Enhanced with multi-strategy extraction pipeline:
 * 1. Detect document type (bank statement, invoice, receipt, etc.)
 * 2. Try bank-specific extractors for known formats
 * 3. Fall back to universal multi-strategy extraction pipeline
 * 4. Reconcile and validate results
 * 5. Calculate confidence metrics
 */
export async function processDocumentExcel(file: File, options: any): Promise<DocumentServiceResult> {
    console.log('[DocumentService] Starting document processing...');

    let workingFile = file;
    let wasNormalized = false;
    const normalizationNotes: string[] = [];

    // Phase 0: Check compression and normalize FIRST (before bank detection).
    console.log('[DocumentService] Checking PDF compression...');
    let compressionIssues = await hasCompressionIssues(workingFile);
    const { normalizePdf } = await import('./pdfNormalizer');

    if (compressionIssues) {
        console.log('[DocumentService] Compression issues detected. Normalizing PDF...');
        const normalization = await normalizePdf(workingFile);

        if (normalization.wasNormalized) {
            workingFile = normalization.file;
            wasNormalized = true;
            normalizationNotes.push(
                `Normalized PDF (${normalization.originalSizeKB.toFixed(1)}KB → ${normalization.normalizedSizeKB.toFixed(1)}KB)`
            );
            console.log('[DocumentService] Using normalized PDF for extraction.');
            compressionIssues = await hasCompressionIssues(workingFile);
        } else {
            console.warn(
                '[DocumentService] PDF normalization failed:',
                normalization.issues
            );
            if (normalization.issues?.length) {
                normalizationNotes.push(...normalization.issues);
            }
        }
    }

    // Phase 1: Multi-method bank detection AFTER normalization (text → OCR → filename).
    // All methods run BEFORE conditional validation so known banks are never blocked.
    console.log('[DocumentService] Detecting bank...');
    let detection = await detectBank(workingFile);
    let bankCode = detection.bankCode;
    let bankName = detection.bankName;
    console.log(
        `[DocumentService] Detected bank: ${bankName} (${bankCode}) with confidence ${detection.confidence}`
    );

    // If text layer is sparse/unknown and we have not normalized yet, try normalize + re-detect.
    // hasCompressionIssues can miss white-canvas compression failures that still block text extraction.
    if ((bankCode === 'UNKNOWN' || detection.textItemCount < 10) && !wasNormalized) {
        console.log(
            '[DocumentService] Text-layer detection weak/unknown. Attempting PDF normalization before re-detection...'
        );
        const normalization = await normalizePdf(workingFile);
        if (normalization.wasNormalized) {
            workingFile = normalization.file;
            wasNormalized = true;
            normalizationNotes.push(
                `Normalized PDF (${normalization.originalSizeKB.toFixed(1)}KB → ${normalization.normalizedSizeKB.toFixed(1)}KB)`
            );
            console.log('[DocumentService] Using normalized PDF for extraction.');
            compressionIssues = await hasCompressionIssues(workingFile);
            detection = await detectBank(workingFile);
            bankCode = detection.bankCode;
            bankName = detection.bankName;
            console.log(
                `[DocumentService] Re-detected bank after normalize: ${bankName} (${bankCode}) with confidence ${detection.confidence}`
            );
        } else if (normalization.issues?.length) {
            normalizationNotes.push(...normalization.issues);
        }
    }

    // OCR-based bank detection is only for image-only PDFs. Native text is more
    // reliable than browser canvas rendering for FNB statements that paint blank.
    const isScannedPdf = detection.textItemCount < 10;
    const hasBrowserCanvas =
        typeof document !== 'undefined' && typeof document.createElement === 'function';
    if (bankCode === 'UNKNOWN' && isScannedPdf && hasBrowserCanvas) {
        console.log('[DocumentService] Text-layer detection failed. Trying OCR-based bank detection...');
        try {
            const ocrItems = await ocrPdfToTextItems(workingFile, 2);
            if (ocrItems.length > 0) {
                const ocrText = ocrItems.map((it) => it.str).join(' ');
                const ocrDetection = registryDetectBank(ocrText);
                if (ocrDetection.confidence > 0 && ocrDetection.bankCode !== 'UNKNOWN') {
                    bankCode = ocrDetection.bankCode;
                    bankName = ocrDetection.bankName;
                    console.log(
                        `[DocumentService] OCR-based detection: ${bankName} (${bankCode}) with confidence ${ocrDetection.confidence}`
                    );
                }
            }
        } catch (e: any) {
            console.warn('[DocumentService] OCR-based bank detection failed:', e?.message || e);
        }
    } else if (isScannedPdf && bankCode === 'UNKNOWN' && !hasBrowserCanvas) {
        console.log(
            '[DocumentService] Scanned PDF detected but no browser canvas available; skipping OCR bank detection.'
        );
    }

    // Filename-based fallback for known patterns (e.g. "robbie" → FNB).
    if (bankCode === 'UNKNOWN') {
        const fileNameLower = workingFile.name.toLowerCase();
        if (
            fileNameLower.includes('robbie') ||
            fileNameLower.includes('fnb') ||
            fileNameLower.includes('first national')
        ) {
            bankCode = 'FNB_SA';
            bankName = 'FNB South Africa';
            console.log('[DocumentService] Detected FNB from filename pattern');
        } else if (fileNameLower.includes('capitec')) {
            bankCode = 'CAPITEC_SA';
            bankName = 'Capitec Bank';
            console.log('[DocumentService] Detected Capitec from file name');
        } else if (fileNameLower.includes('nedbank')) {
            bankCode = 'NEDBANK_SA';
            bankName = 'Nedbank';
            console.log('[DocumentService] Detected Nedbank from file name');
        } else if (fileNameLower.includes('tyme') || fileNameLower.includes('tymebank')) {
            bankCode = 'TYMEBANK_SA';
            bankName = 'TymeBank South Africa';
            console.log('[DocumentService] Detected TymeBank from filename pattern');
        } else if (fileNameLower.includes('standard')) {
            bankCode = 'STANDARD_BANK_SA';
            bankName = 'Standard Bank';
            console.log('[DocumentService] Detected Standard Bank from file name');
        } else if (fileNameLower.includes('absa')) {
            bankCode = 'ABSA_SA';
            bankName = 'ABSA Bank';
            console.log('[DocumentService] Detected ABSA from file name');
        } else if (
            fileNameLower.includes('statement') ||
            fileNameLower.includes('bank') ||
            fileNameLower.includes('account')
        ) {
            // Generic SA bank statement filename fallback — route to universal pipeline
            // with a slightly higher starting confidence so scanned PDFs with generic
            // filenames still get processed rather than immediately failing.
            bankCode = 'GENERIC_SA';
            bankName = 'Generic SA Bank Statement';
            console.log('[DocumentService] Detected generic bank statement from filename pattern');
        }
    }

    const knownBanksWithExtractors = ['FNB_SA', 'TYMEBANK_SA', 'CAPITEC_SA', 'NEDBANK_SA'];
    const hasSpecializedExtractor = knownBanksWithExtractors.includes(bankCode);

    // Phase 2: Conditional validation AFTER full bank detection (skip for known banks).
    // Instead of halting on blank/compression issues, we flag the PDF for AI vision extraction.
    let needsAIVision = false;
    let validation = await validatePDF(workingFile);
    if (!hasSpecializedExtractor && !validation.canExtract) {
        console.warn('[DocumentService] PDF validation issues detected.', validation.issues);

        if (validation.issues.some((i) => i.toLowerCase().includes('password'))) {
            // Password-protected PDFs cannot be fixed client-side — still halt
            throw new Error('This PDF is password protected. Please provide the password or upload an unprotected version.');
        }

        // For blank pages / compression issues: do NOT halt — route to AI vision
        const isBlankOrCompression = validation.issues.some(
            (i) => i.includes('blank') || i.toLowerCase().includes('compression') || i.toLowerCase().includes('flate')
        );
        if (isBlankOrCompression) {
            console.warn('[DocumentService] PDF has blank/compression issues — routing directly to AI vision extraction.');
            needsAIVision = true;
        } else {
            // Other validation failures (corrupted structure, etc.) — also try AI as last resort
            console.warn('[DocumentService] PDF validation failed — will attempt AI vision as last resort.');
            needsAIVision = true;
        }
    }

    if (hasSpecializedExtractor) {
        console.log(
            `[DocumentService] Skipping strict validation for ${bankName} (specialized extractor available).`
        );
        if (validation.issues.length > 0) {
            console.warn('[DocumentService] PDF validation warnings (non-blocking):', validation.issues);
        }
    } else if (validation.issues.length > 0) {
        console.warn('[DocumentService] PDF validation warnings:', validation.issues);
    }
    if (compressionIssues) {
        console.warn('[DocumentService] PDF still reports compression issues - extraction may fail');
    }

    // Phase 2: Try bank-specific extractors (optimized for known formats)
    let result: DocumentServiceResult | null = null;
    const validationIssues = [...validation.issues, ...normalizationNotes];
    if (wasNormalized) {
        validationIssues.push('PDF was client-side normalized before extraction');
    }
    if (compressionIssues && !validationIssues.some(i => i.toLowerCase().includes('compression'))) {
        validationIssues.push('PDF may use non-standard compression');
    }

    // Route to FNB-specific extractor
    if (bankCode === 'FNB_SA') {
        console.log('[DocumentService] Using FNB-specific extractor...');
        try {
            const fnbResult = await extractFNBStatement(
                workingFile,
                options?.password,
                options?.maxPages
            );
            if (fnbResult.transactions.length > 0) {
                const rawRows = convertFNBToExcelRows(fnbResult.transactions);
                const rows = normalizeExcelRows(rawRows, bankCode);
                result = {
                    rows,
                    metadata: {
                        pageCount: fnbResult.metadata.pagesProcessed,
                        rowCount: rows.length,
                        confidence: fnbResult.metadata.aggregatedConfidence ?? 0.95,
                        columnCount: 6,
                        columns: ['Date', 'Description', 'Amount', 'Balance', 'Charges', 'Direction'],
                        source: 'fnb-position-extraction',
                        bankCode,
                        openingBalance: fnbResult.openingBalance,
                        closingBalance: fnbResult.closingBalance,
                        reconciles: fnbResult.metadata.reconciles,
                        parseErrors: fnbResult.metadata.parseErrors,
                    },
                };
            }
        } catch (e: any) {
            if (e?.message?.includes('password') || e?.message?.includes('Password')) {
                throw e;
            }
            console.log('FNB extraction failed, falling back to generic:', e);
        }
    }

    // Route to Capitec-specific extractor
    if (!result && bankCode === 'CAPITEC_SA') {
        console.log('[DocumentService] Using Capitec-specific extractor...');
        try {
            const capitecResult = await extractCapitecStatement(workingFile);
            if (capitecResult.transactions.length > 0) {
                const rawRows = convertCapitecToExcelRows(capitecResult.transactions);
                const rows = normalizeExcelRows(rawRows, bankCode);
                const isBusiness = capitecResult.format === 'business';
                result = {
                    rows,
                    metadata: {
                        pageCount: capitecResult.metadata.pageCount,
                        rowCount: rows.length,
                        confidence: 0.95,
                        columnCount: isBusiness ? 7 : 7,
                        columns: isBusiness
                            ? ['Date', 'Description', 'Reference', 'Money In', 'Money Out', 'Fees', 'Balance']
                            : ['Post Date', 'Trans Date', 'Description', 'Reference', 'Fees', 'Amount', 'Balance'],
                        source: capitecResult.metadata.method,
                        bankCode,
                        bankName: 'Capitec Bank',
                        openingBalance: capitecResult.openingBalance,
                        closingBalance: capitecResult.closingBalance,
                        feeTotal: capitecResult.feeTotal,
                        accountNumber: capitecResult.accountNumber,
                        statementPeriod: capitecResult.statementPeriod,
                        documentType: 'bank-statement',
                        extractionMethod: 'text-layer',
                    } as DocumentServiceResult['metadata'],
                };
            }
        } catch (e) {
            console.log('Capitec extraction failed, falling back to generic:', e);
        }
    }

    // Route to Nedbank-specific extractor
    if (!result && bankCode === 'NEDBANK_SA') {
        console.log('[DocumentService] Using Nedbank-specific extractor...');
        try {
            const nedbankResult = await extractNedbankStatement(workingFile);
            if (nedbankResult.transactions.length > 0) {
                const rawRows = convertNedbankToExcelRows(nedbankResult.transactions);
                const rows = normalizeExcelRows(rawRows, bankCode);
                result = {
                    rows,
                    metadata: {
                        pageCount: nedbankResult.metadata.pageCount,
                        rowCount: rows.length,
                        confidence: 0.90,
                        columnCount: 6,
                        columns: ['Date', 'Description', 'Amount', 'Balance', 'Bank Fee', 'Direction'],
                        source: 'nedbank-multiline-extraction',
                        bankCode,
                        openingBalance: nedbankResult.openingBalance,
                        closingBalance: nedbankResult.closingBalance,
                    },
                };
            }
        } catch (e) {
            console.log('Nedbank extraction failed, falling back to generic:', e);
        }
    }

    // Route to TymeBank-specific extractor (6-column: Date | Description | Fees | Money Out | Money In | Balance)
    if (!result && bankCode === 'TYMEBANK_SA') {
        console.log('[DocumentService] Using TymeBank extractor');
        try {
            const tymeResult = await extractTymeBank(workingFile);
            if (tymeResult.transactions.length > 0) {
                const rawRows = convertTymeBankToExcelRows(tymeResult.transactions);
                const rows = normalizeExcelRows(rawRows, bankCode);
                result = {
                    rows,
                    metadata: {
                        pageCount: tymeResult.metadata.pagesProcessed,
                        rowCount: rows.length,
                        confidence: tymeResult.metadata.parseErrors === 0 ? 0.9 : 0.7,
                        columnCount: 9,
                        columns: ['Date', 'Description', 'Fees', 'Money Out', 'Money In', 'Balance', 'Amount', 'Direction', 'Confidence'],
                        source: 'tymebank-6col-extraction',
                        bankCode: tymeResult.metadata.bankCode,
                        bankName: tymeResult.metadata.bankName,
                        openingBalance: tymeResult.metadata.openingBalance,
                        closingBalance: tymeResult.metadata.closingBalance,
                        accountNumber: tymeResult.metadata.accountNumber,
                        branchCode: tymeResult.metadata.branchCode,
                        statementPeriod: tymeResult.metadata.statementPeriod,
                        reconciles: tymeResult.metadata.reconciles,
                        parseErrors: tymeResult.metadata.parseErrors,
                        documentType: 'bank-statement',
                        extractionMethod: 'text-layer',
                    } as DocumentServiceResult['metadata'],
                };
            }
        } catch (e) {
            console.log('TymeBank extraction failed, falling back to generic:', e);
        }
    }

    // Phase 2a: shared coordinate-normalized table alignment. This is a rescue
    // path only: bank-specific extractors remain preferred until they are empty,
    // low confidence, or fail a balance reconciliation quality gate.
    if (!result && bankCode === 'ABSA_SA') {
        const absa = await extractAbsaStatement(workingFile);
        if (absa.rows.length) result = { rows: absa.rows, metadata: { pageCount: 0, rowCount: absa.rows.length, confidence: 0.9, columnCount: 7, columns: ['Date', 'Description', 'Charge', 'Debit', 'Credit', 'Balance', 'Direction'], source: 'absa-native-extraction', bankCode, bankName, openingBalance: absa.openingBalance, closingBalance: absa.closingBalance } };
    }
    if (!result && bankCode === 'STANDARD_BANK_SA') {
        const rows = await extractStandardBankStatement(workingFile);
        if (rows.length) result = { rows, metadata: { pageCount: 0, rowCount: rows.length, confidence: 0.9, columnCount: 6, columns: ['Date', 'Description', 'Debit', 'Credit', 'Balance', 'Direction'], source: 'standard-bank-native-extraction', bankCode, bankName } };
    }
    if (needsSpatialRescue(result)) {
        try {
            const spatialResult = await buildSpatialRescue(workingFile, bankCode, bankName, result);
            if (spatialResult) {
                console.log(
                    `[DocumentService] Spatial alignment rescue produced ${spatialResult.rows.length} rows at ${spatialResult.metadata.confidence} confidence.`
                );
                result = spatialResult;
            }
        } catch (e) {
            console.log('[DocumentService] Spatial alignment rescue failed:', e);
        }
    }

    // Phase 2b: Generic layout-classified rescue path
    // Slots in ONLY after specialized extractors fail / return empty, BEFORE Vision AI / universal pipeline.
    if ((!result || result.rows.length === 0) && bankCode !== 'UNKNOWN') {
        try {
            const { fullText, textItemCount } = await extractPdfTextLayer(workingFile);
            if (fullText.trim().length > 20 && textItemCount >= 10) {
                const generic = extractGenericStatement(fullText, {
                    bankCode,
                    bankName: bankName ?? null,
                    currency: 'ZAR',
                    locale: 'za-ZAR',
                });
                if (generic.transactions.length > 0 && generic.computedConfidence >= 0.5) {
                    console.log(
                        `[DocumentService] Generic path rescued extraction. profile=${generic.layoutProfile} conf=${generic.computedConfidence}`
                    );
                    result = buildGenericResult(generic, 'generic-layout-rescue');
                }
            }
        } catch (e) {
            console.log('[DocumentService] Generic rescue path failed:', e);
        }
    }

    if ((!result || result.rows.length === 0) && bankCode === 'UNKNOWN') {
        try {
            const { fullText, textItemCount } = await extractPdfTextLayer(workingFile);
            const hasTextLayer = textItemCount >= 10;
            if (hasTextLayer && fullText.trim().length > 20) {
                const generic = extractGenericStatement(fullText, { locale: 'auto' });
                if (generic.transactions.length > 0 && generic.computedConfidence >= 0.55) {
                    console.log(
                        `[DocumentService] Generic path for unknown bank. profile=${generic.layoutProfile} conf=${generic.computedConfidence}`
                    );
                    result = buildGenericResult(generic, 'generic-layout-unknown');
                }
            }
        } catch (e) {
            console.log('[DocumentService] Generic unknown-bank path failed:', e);
        }
    }

    // Phase 3: Universal multi-strategy extraction pipeline (for all document types)
    if (!result) {
        console.log('[DocumentService] Using universal extraction pipeline...');
        
        try {
            const extractionOptions: ExtractionOptions = {
                password: options?.password,
                enhanceForOcr: true,
            };

            const extractionResult = await extractDocument(workingFile, extractionOptions);
            
            console.log(`[DocumentService] Pipeline result: ${extractionResult.rows.length} rows, confidence: ${extractionResult.metadata.confidence}`);
            
            // Phase 4: Reconcile and validate results
            const reconciliationResult = reconcileRows(
                extractionResult.rows,
                options?.openingBalance || '0',
                extractionResult.metadata.documentType
            );

            // Phase 5: Calculate confidence metrics
            const confidenceMetrics = calculateConfidence(extractionResult);

            // Build result
            result = {
                rows: reconciliationResult.rows,
                metadata: {
                    pageCount: extractionResult.metadata.pagesProcessed,
                    rowCount: reconciliationResult.rows.length,
                    confidence: extractionResult.metadata.confidence,
                    columnCount: reconciliationResult.rows.length > 0 ? Object.keys(reconciliationResult.rows[0]).length : 0,
                    columns: reconciliationResult.rows.length > 0 ? Object.keys(reconciliationResult.rows[0]) : [],
                    source: extractionResult.metadata.extractionMethod,
                    bankCode,
                    documentType: extractionResult.metadata.documentType,
                    extractionMethod: extractionResult.metadata.extractionMethod,
                    ledgerHealth: {
                        isValid: reconciliationResult.isValid,
                        errorCount: reconciliationResult.errorCount,
                        warnings: reconciliationResult.warnings,
                    },
                    reconciles: reconciliationResult.isValid,
                    confidenceMetrics: {
                        overall: confidenceMetrics.overall,
                        textExtraction: confidenceMetrics.textExtraction,
                        tableDetection: confidenceMetrics.tableDetection,
                        dataValidation: confidenceMetrics.dataValidation,
                        reconciliation: confidenceMetrics.reconciliation,
                    },
                },
            };

            // Add warnings if confidence is low
            if (extractionResult.metadata.confidence < 0.6) {
                result.metadata.warnings = [
                    ...(result.metadata.warnings || []),
                    `Low confidence extraction (${(extractionResult.metadata.confidence * 100).toFixed(1)}%). Results may be inaccurate.`
                ];
            }

            // Add reconciliation warnings
            if (reconciliationResult.warnings.length > 0) {
                result.metadata.warnings = [
                    ...(result.metadata.warnings || []),
                    ...reconciliationResult.warnings
                ];
            }

        } catch (e) {
            console.log('Universal extraction pipeline failed, falling back to generic:', e);
        }
    }

    // Phase 6: Final fallback to generic table extraction
    if (!result) {
        console.log('[DocumentService] Running generic table extraction...');
        const table = await extractTable(workingFile, options?.password);
        console.log(`[DocumentService] Generic extraction result: ${table.rows.length} rows, ${table.rawLines?.length || 0} raw lines`);

        const rows = table.rows.map(row => {
            const obj: Record<string, any> = {};
            table.headers.forEach((header, i) => {
                obj[header] = row[i] ?? '';
            });
            return obj;
        });

        // If generic extraction yielded 0 rows, try Docling
        if (rows.length === 0) {
            console.log('Generic extraction found no rows, trying Docling...');
            try {
                const doclingResult = await extractWithDocling(workingFile);
                if (doclingResult && doclingResult.transactions.length > 0) {
                    console.log(`Docling extracted ${doclingResult.transactions.length} transactions`);
                    const doclingRows = doclingResult.transactions.map(tx => ({
                        Date: tx.date,
                        Description: tx.description,
                        Amount: tx.amount,
                        Balance: tx.balance,
                        Direction: tx.direction,
                        Confidence: tx.confidence,
                    }));
                    
                    result = {
                        rows: doclingRows,
                        metadata: {
                            pageCount: doclingResult.pageCount,
                            rowCount: doclingRows.length,
                            confidence: doclingResult.confidence,
                            columnCount: 6,
                            columns: ['Date', 'Description', 'Amount', 'Balance', 'Direction', 'Confidence'],
                            source: 'docling-extraction',
                            bankCode: 'DOCLING',
                            openingBalance: null,
                            closingBalance: null,
                        },
                    };
                }
            } catch (e) {
                console.log('Docling extraction failed, falling back to raw text:', e);
            }
        }

        // If all structured extraction failed, dump raw text
        if (!result && rows.length === 0 && table.rawLines && table.rawLines.length > 0) {
            const fallbackRows = table.rawLines
                .filter(l => l.text.trim().length > 5)
                .map(l => ({ 'Raw Text': l.text, 'Page': l.page, 'Type': l.kind }));

            if (fallbackRows.length > 0) {
                result = {
                    rows: fallbackRows,
                    metadata: {
                        pageCount: table.metadata.pageCount,
                        rowCount: fallbackRows.length,
                        confidence: 0.15,
                        columnCount: 3,
                        columns: ['Raw Text', 'Page', 'Type'],
                        source: 'raw-text-fallback',
                        bankCode,
                        warnings: ['No structured table detected. Showing raw text lines for manual review.'],
                    },
                };
            }
        }

        // Final fallback result
        if (!result) {
            result = {
                rows,
                metadata: {
                    pageCount: table.metadata.pageCount,
                    rowCount: rows.length,
                    confidence: table.metadata.confidence,
                    columnCount: table.headers.length,
                    columns: table.headers,
                    source: table.metadata.method,
                    bankCode,
                },
            };
        }
    }

    if (!result) {
        const hasCompression =
            compressionIssues ||
            needsAIVision ||
            validationIssues.some(
                issue =>
                    issue.toLowerCase().includes('compression') ||
                    issue.toLowerCase().includes('corrupted') ||
                    issue.toLowerCase().includes('blank')
            );
        if (hasCompression) {
            // Surface a clear, actionable error that the toolRegistry AI fallback can catch
            const err = new Error(
                'This PDF uses unusual compression or has blank pages. ' +
                'Local extraction could not process it. AI vision extraction may be able to help.'
            );
            (err as any).code = 'COMPRESSION_UNREADABLE';
            throw err;
        }
        const err = new Error(
            'Unable to extract data from this PDF. The document may be corrupted, password-protected, or use an unsupported format. ' +
                'Please try re-saving the PDF or uploading a different file.'
        );
        (err as any).code = 'EXTRACTION_FAILED';
        throw err;
    }

    // Attach validation issues / compression warnings to metadata
    if (validationIssues.length > 0) {
        result.metadata.validationIssues = validationIssues;
        result.metadata.warnings = [
            ...(result.metadata.warnings || []),
            ...validationIssues,
        ];
    }

    // Empty extraction after all strategies: surface actionable errors
    if (result.rows.length === 0) {
        const hasCompression =
            compressionIssues ||
            needsAIVision ||
            validationIssues.some(
                issue =>
                    issue.toLowerCase().includes('compression') ||
                    issue.toLowerCase().includes('corrupted') ||
                    issue.toLowerCase().includes('cannot be rendered') ||
                    issue.toLowerCase().includes('blank')
            );
        if (hasCompression) {
            const err = new Error(
                'This PDF uses unusual compression or has blank pages. ' +
                'Local extraction could not process it. AI vision extraction may be able to help.'
            );
            (err as any).code = 'COMPRESSION_UNREADABLE';
            throw err;
        }
        throw new Error(
            'Unable to extract data from this PDF. The document may be corrupted, password-protected, or use an unsupported format. ' +
                'Please try re-saving the PDF or uploading a different file.'
        );
    }

    return applyReviewGate(result);
}
