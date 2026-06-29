/**
 * Universal Financial Document Extraction Service
 * Multi-strategy pipeline with document type detection and confidence scoring
 */

import { extractTable } from './tableExtractor';
import { extractCapitecStatement, convertCapitecToExcelRows } from './capitecExtractService';
import { extractFNBStatement, convertToExcelRows as convertFNBToExcelRows } from './fnbExtractService';
import { extractNedbankStatement, convertNedbankToExcelRows } from './nedbankExtractService';
import { detectBank as registryDetectBank } from './bankRegistry';
import { ocrPdfToTextItems } from './ocrService';
import { extractWithDocling } from './doclingService';
import { extractDocument, type ExtractionOptions } from './extractionPipeline';
import { reconcileRows, type ReconciliationResult } from './reconciliationService';
import { calculateConfidence } from './confidenceScoring';
import * as pdfjs from 'pdfjs-dist';

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
    openingBalance?: string | null;
    closingBalance?: string | null;
    documentType?: string;
    extractionMethod?: string;
    ledgerHealth?: any;
    confidenceMetrics?: any;
    warnings?: string[];
  };
}

/**
 * Extract first-page text and detect bank via the canonical registry.
 */
async function detectBank(file: File): Promise<{ bankCode: string; bankName: string; confidence: number; textItemCount: number }> {
    try {
        const bytes = await file.arrayBuffer();
        // @ts-ignore
        const pdf = await pdfjs.getDocument({ data: bytes }).promise;
        const page = await pdf.getPage(1);
        const content = await page.getTextContent();
        const textItems = content.items.filter((i: any) => i.str && i.str.trim());
        const text = textItems.map((i: any) => i.str).join(' ');

        const result = registryDetectBank(text);
        return { bankCode: result.bankCode, bankName: result.bankName, confidence: result.confidence, textItemCount: textItems.length };
    } catch {
        return { bankCode: 'UNKNOWN', bankName: 'Unknown Bank', confidence: 0, textItemCount: 0 };
    }
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
    
    // Phase 1: Bank detection (legacy - for backward compatibility)
    const detection = await detectBank(file);
    let bankCode = detection.bankCode;

    // Scanned / image-only PDF: try OCR to get text for bank detection
    const isScannedPdf = detection.textItemCount < 10;
    if (isScannedPdf && bankCode === 'UNKNOWN') {
        console.log('[DocumentService] Scanned PDF detected, trying OCR for bank detection...');
        try {
            const ocrItems = await ocrPdfToTextItems(file, 2);
            if (ocrItems.length > 0) {
                const ocrText = ocrItems.map(it => it.str).join(' ');
                const ocrDetection = registryDetectBank(ocrText);
                if (ocrDetection.confidence > 0) {
                    bankCode = ocrDetection.bankCode;
                }
            }
        } catch (e: any) {
            console.log('OCR bank detection failed:', e);
        }
    }

    // Phase 2: Try bank-specific extractors (optimized for known formats)
    let result = null;

    // Route to FNB-specific extractor
    if (bankCode === 'FNB_SA') {
        console.log('[DocumentService] Using FNB-specific extractor...');
        try {
            const fnbResult = await extractFNBStatement(file);
            if (fnbResult.transactions.length > 0) {
                const rows = convertFNBToExcelRows(fnbResult.transactions);
                result = {
                    rows,
                    metadata: {
                        pageCount: 0, // Not provided by FNB extractor
                        rowCount: rows.length,
                        confidence: 0.95,
                        columnCount: 6,
                        columns: ['Date', 'Description', 'Amount', 'Balance', 'Charges', 'Direction'],
                        source: 'fnb-position-extraction',
                        bankCode,
                        openingBalance: fnbResult.openingBalance,
                        closingBalance: fnbResult.closingBalance,
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
            const capitecResult = await extractCapitecStatement(file);
            if (capitecResult.transactions.length > 0) {
                const rows = convertCapitecToExcelRows(capitecResult.transactions);
                result = {
                    rows,
                    metadata: {
                        pageCount: capitecResult.metadata.pageCount,
                        rowCount: rows.length,
                        confidence: 0.90,
                        columnCount: 7,
                        columns: ['Post Date', 'Trans Date', 'Description', 'Reference', 'Fees', 'Amount', 'Balance'],
                        source: 'capitec-position-extraction',
                        bankCode,
                        openingBalance: capitecResult.openingBalance,
                        closingBalance: capitecResult.closingBalance,
                        feeTotal: capitecResult.feeTotal,
                    },
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
            const nedbankResult = await extractNedbankStatement(file);
            if (nedbankResult.transactions.length > 0) {
                const rows = convertNedbankToExcelRows(nedbankResult.transactions);
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

    // Phase 3: Universal multi-strategy extraction pipeline (for all document types)
    if (!result) {
        console.log('[DocumentService] Using universal extraction pipeline...');
        
        try {
            const extractionOptions: ExtractionOptions = {
                password: options?.password,
                enhanceForOcr: true,
            };

            const extractionResult = await extractDocument(file, extractionOptions);
            
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
        const table = await extractTable(file, options?.password);
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
                const doclingResult = await extractWithDocling(file);
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

    return result;
}