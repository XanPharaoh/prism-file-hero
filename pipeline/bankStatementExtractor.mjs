/**
 * Bank Statement Extractor
 * Uses qwen2.5vl:7b vision to extract a structured transaction table
 * from bank statement PDFs (scanned or digital, any SA bank).
 *
 * Pipeline:
 *   PDF → pdftoppm → base64 PNG pages → qwen2.5vl vision → JSON rows
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { promisify } from 'node:util';
import { ollamaVision } from './ollamaVision.mjs';
import { extractPageBBoxes } from './pdfBboxExtractor.mjs';

const execFileAsync = promisify(execFile);

// ─── Prompts ──────────────────────────────────────────────────────────────────

const EXTRACTION_SYSTEM = `You are a specialist in South African bank statement parsing.
Your job is to extract ALL transactions from the bank statement image(s) provided and return them as a JSON array.

South African banks you may encounter: ABSA, FNB (First National Bank), Standard Bank, Nedbank, Capitec, TymeBank, Discovery Bank, African Bank, Investec.

RULES:
1. Extract EVERY transaction row — do not skip any.
2. Dates are typically DD/MM/YYYY or DD Mon YYYY format in SA statements.
3. Amount columns: some banks use Dr/Cr columns, others use a single Amount column with signs.
4. Always include the running balance if visible.
5. Return ONLY a JSON array, no markdown fences, no explanation.

Each transaction object must have these exact keys:
{
  "date": "YYYY-MM-DD",         // ISO date, infer year from statement header if needed
  "description": "...",          // Raw transaction description as printed
  "debit": "0.00",              // Amount debited (money out), "0.00" if not applicable
  "credit": "0.00",             // Amount credited (money in), "0.00" if not applicable
  "balance": "0.00",            // Running balance after this transaction, or "" if not visible
  "reference": ""               // Reference number if visible, else ""
}

If a row is a balance-brought-forward or opening balance, include it with description "Opening Balance" or similar.
If you cannot determine debit vs credit, put the amount in "debit" for negative values and "credit" for positive values.`;

const EXTRACTION_PROMPT = `${EXTRACTION_SYSTEM}\n\nExtract ALL transactions from this bank statement page and return a JSON array of transaction objects. 
Include every single row visible. Do not omit any. Return raw JSON only, no markdown.`;

// ─── PDF to Images ────────────────────────────────────────────────────────────

/**
 * Convert a PDF file to an array of base64-encoded PNG images (one per page).
 * Uses pdftoppm from poppler-utils (available on Arch Linux).
 *
 * @param {string} pdfPath - Absolute path to the PDF file
 * @param {number} dpi     - Render DPI (150 is good for OCR, 200 for dense tables)
 * @returns {Promise<string[]>} Array of base64 PNG strings
 */
export async function pdfToImages(pdfPath, dpi = 180) {
  const workDir = await fs.mkdtemp(join(tmpdir(), 'fiscal-fox-extract-'));

  try {
    // pdftoppm converts each page to a PNG: prefix-01.png, prefix-02.png, ...
    await execFileAsync('pdftoppm', [
      '-r', String(dpi),
      '-png',
      pdfPath,
      join(workDir, 'page'),
    ]);

    // Read all generated pages in order
    const files = (await fs.readdir(workDir))
      .filter((f) => f.endsWith('.png'))
      .sort();

    const images = await Promise.all(
      files.map(async (file) => {
        const buf = await fs.readFile(join(workDir, file));
        return buf.toString('base64');
      })
    );

    return images;
  } finally {
    // Cleanup temp files
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── JSON parsing with fallback ───────────────────────────────────────────────

/**
 * Parse the model's raw text response into a transaction array.
 * Handles cases where the model wraps JSON in markdown fences.
 */
function parseTransactionJson(raw) {
  // Strip markdown fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  // Try to find the JSON array in the response
  const startIdx = cleaned.indexOf('[');
  const endIdx   = cleaned.lastIndexOf(']');
  if (startIdx !== -1 && endIdx !== -1) {
    cleaned = cleaned.slice(startIdx, endIdx + 1);
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (err) {
    console.warn('[bankStatementExtractor] JSON parse failed:', err.message);
    console.warn('[bankStatementExtractor] Raw response snippet:', raw.slice(0, 400));
    return [];
  }
}

// ─── Normalize and validate rows ──────────────────────────────────────────────

function normalizeAmount(val) {
  if (val === null || val === undefined || val === '') return '0.00';
  const str = String(val).replace(/[^0-9.\-]/g, '');
  const num = parseFloat(str);
  if (isNaN(num)) return '0.00';
  return Math.abs(num).toFixed(2);
}

function normalizeDate(val) {
  if (!val) return '';
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  // DD/MM/YYYY
  const m1 = val.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2].padStart(2,'0')}-${m1[1].padStart(2,'0')}`;
  // DD Mon YYYY
  const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const m2 = val.toLowerCase().match(/^(\d{1,2})\s+([a-z]{3})\s+(\d{4})$/);
  if (m2) {
    const mo = months[m2[2]];
    if (mo) return `${m2[3]}-${String(mo).padStart(2,'0')}-${m2[1].padStart(2,'0')}`;
  }
  return val; // Return as-is if we can't parse
}

function normalizeRow(row) {
  return {
    date:        normalizeDate(row.date        ?? row.Date        ?? ''),
    description: String(row.description ?? row.Description ?? row.narrative ?? row.Narrative ?? '').trim(),
    debit:       normalizeAmount(row.debit  ?? row.Debit  ?? row.dr ?? row.Dr),
    credit:      normalizeAmount(row.credit ?? row.Credit ?? row.cr ?? row.Cr),
    balance:     normalizeAmount(row.balance ?? row.Balance ?? row.runningBalance),
    reference:   String(row.reference ?? row.Reference ?? row.ref ?? '').trim(),
  };
}

// ─── Main extraction function ─────────────────────────────────────────────────

/**
 * Extract all transactions from a bank statement PDF using qwen2.5vl vision.
 *
 * @param {string} pdfPath  - Absolute path to the bank statement PDF
 * @param {object} opts
 * @param {number} [opts.dpi=180]           - PDF render DPI
 * @param {number} [opts.maxPages]          - Limit pages processed (undefined = all)
 * @param {function} [opts.onPageProgress]  - Callback(pageNum, total) for progress
 * @returns {Promise<{
 *   transactions: Array,
 *   pageCount: number,
 *   rawResponses: string[],
 *   bank: string
 * }>}
 */
export async function extractBankStatement(pdfPath, opts = {}) {
  const { dpi = 180, maxPages, onPageProgress } = opts;

  console.log(`[bankStatementExtractor] Rendering PDF: ${basename(pdfPath)}`);
  const allImages = await pdfToImages(pdfPath, dpi);
  const images = maxPages ? allImages.slice(0, maxPages) : allImages;
  const total  = images.length;

  console.log(`[bankStatementExtractor] Processing ${total} page(s) with ${(await import('./ollamaVision.mjs')).VISION_MODEL}`);

  const allTransactions = [];
  const rawResponses    = [];

  for (let i = 0; i < images.length; i++) {
    const pageNum = i + 1;
    if (onPageProgress) onPageProgress(pageNum, total);
    console.log(`[bankStatementExtractor] Page ${pageNum}/${total}…`);

    try {
      const bboxesText = await extractPageBBoxes(pdfPath, pageNum);
      const promptWithLayout = bboxesText
        ? `${EXTRACTION_PROMPT}\n\n[AGENTIC STRUCTURAL AWARENESS]\nHere is the exact layout of text elements and their bounding boxes [xMin, yMin, xMax, yMax] on this page to help you precisely orient tables:\n${bboxesText}`
        : EXTRACTION_PROMPT;
        
      const raw = await ollamaVision(promptWithLayout, [images[i]], {
        options: { temperature: 0, num_ctx: 16384 },
      });

      rawResponses.push(raw);
      const rows = parseTransactionJson(raw);
      console.log(`  → Found ${rows.length} transaction(s) on page ${pageNum}`);
      allTransactions.push(...rows.map(normalizeRow));
    } catch (err) {
      console.error(`[bankStatementExtractor] Page ${pageNum} failed: ${err.message}`);
    }
  }

  // Deduplicate rows that appear on multiple pages (same date+description+amount)
  const seen = new Set();
  const unique = allTransactions.filter((row) => {
    const key = `${row.date}|${row.description}|${row.debit}|${row.credit}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Infer bank from first description patterns (best-effort)
  const bank = inferBank(unique);

  return { transactions: unique, pageCount: total, rawResponses, bank };
}

function inferBank(transactions) {
  const text = transactions.slice(0, 5).map((t) => t.description).join(' ').toUpperCase();
  if (text.includes('CAPITEC')) return 'Capitec';
  if (text.includes('FNB') || text.includes('FIRST NATIONAL')) return 'FNB';
  if (text.includes('ABSA')) return 'ABSA';
  if (text.includes('STANDARD BANK') || text.includes('SBSA')) return 'Standard Bank';
  if (text.includes('NEDBANK')) return 'Nedbank';
  if (text.includes('TYMEBANK') || text.includes('TYME')) return 'TymeBank';
  if (text.includes('DISCOVERY')) return 'Discovery Bank';
  return 'Unknown';
}
