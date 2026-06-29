import * as pdfjs from 'pdfjs-dist';
import { ocrPdfToTextItems } from './ocrService';

// --- Types ---
export interface ExtractedTable {
  headers: string[];
  rows: string[][];
  rawLines: { page: number; y: number; text: string; kind: 'data' | 'header' | 'footer' | 'unknown' }[];
  metadata: {
    pageCount: number;
    rowCount: number;
    confidence: number;
    method: 'type-alignment' | 'ocr-type-alignment';
    pattern: string; // e.g., "D-T-M-M" for debugging
    anomalies: string[];
  };
}

type TokenType = 'D' | 'M' | 'N' | 'T'; // Date, Money, Number(ID), Text
interface Token { text: string; type: TokenType; x: number; }
interface Line { page: number; y: number; tokens: Token[]; raw: string; }

// --- Main Entry ---

/**
 * Universal "Set and Forget" Extractor (Refined)
 * Logic:
 * 1. Tokenize all lines and classify each token (Date, Money, ID, Text).
 * 2. Fuse related tokens (Multi-part dates, CR/DR suffixes).
 * 3. Find the Consensus Pattern based on frequent signatures.
 * 4. Align all lines to that pattern, handling wrapped text and noise.
 */
export async function extractTable(file: File, password?: string): Promise<ExtractedTable> {
  const bytes = await file.arrayBuffer();
  let pdf;
  try {
    // @ts-ignore
    const loadingTask = pdfjs.getDocument({ data: bytes, password });
    pdf = await loadingTask.promise;
  } catch (error: any) {
    if (error.name === 'PasswordException') {
      throw new Error(`This PDF is password-protected. Please provide the password in the Advanced Configuration menu.`);
    }
    throw new Error(`PDF Load Error: ${error.message}`);
  }
  const pageCount = Math.min(pdf.numPages, 100);

  // Phase 1: Extract and tokenize all lines
  let lines: Line[] = [];
  let method: 'type-alignment' | 'ocr-type-alignment' = 'type-alignment';

  for (let p = 1; p <= pageCount; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    // Group by line (Y-coordinate)
    const lineMap = new Map<number, { items: any[], y: number }>();

    for (const item of content.items as any[]) {
      if (!item.str?.trim()) continue;
      // Use raw transform[5] for Y, snap to 3px grid for jitter
      const y = Math.round(item.transform[5] / 3) * 3;
      if (!lineMap.has(y)) lineMap.set(y, { items: [], y });
      lineMap.get(y)!.items.push(item);
    }

    const sortedLines = Array.from(lineMap.values())
      .sort((a, b) => b.y - a.y)
      .map(l => ({
        items: l.items.sort((a: any, b: any) => a.transform[4] - b.transform[4]),
        y: l.y
      }));

    for (const line of sortedLines) {
      let tokens: Token[] = line.items.map((item: any) => ({
        text: item.str,
        x: item.transform[4],
        type: classifyToken(item.str)
      }));

      // --- TOKEN REFINEMENT (Hard Law) ---
      tokens = mergeDateTokens(tokens);
      tokens = mergeAmountSuffixes(tokens);

      lines.push({
        page: p,
        y: line.y,
        tokens,
        raw: line.items.map((i: any) => i.str).join(' ')
      });
    }
  }

  // Fallback to OCR if no lines found
  if (lines.length < 5) {
    try {
      const ocrItems = await ocrPdfToTextItems(file);
      if (ocrItems.length > 0) {
        const ocrLineMap = new Map<string, { items: any[], y: number, page: number }>();
        ocrItems.forEach(it => {
          const key = `${it.page}_${Math.round(it.y / 5) * 5}`;
          if (!ocrLineMap.has(key)) ocrLineMap.set(key, { items: [], y: it.y, page: it.page });
          ocrLineMap.get(key)!.items.push(it);
        });

        lines = Array.from(ocrLineMap.values())
          .sort((a, b) => a.page !== b.page ? a.page - b.page : b.y - a.y)
          .map(l => {
            let tokens: Token[] = l.items.sort((a, b) => a.x - b.x).map(it => ({
              text: it.str,
              x: it.x,
              type: classifyToken(it.str)
            }));

            tokens = mergeDateTokens(tokens);
            tokens = mergeAmountSuffixes(tokens);

            return {
              page: l.page,
              y: l.y,
              tokens,
              raw: l.items.map(it => it.str).join(' ')
            };
          });
        method = 'ocr-type-alignment';
      }
    } catch (e) {
      console.log('OCR fallback failed, continuing without OCR:', e);
    }
  }

  if (lines.length === 0) return emptyResult(pageCount, 'No data found');

  // Diagnostic: Log tokenization results
  console.log(`[TableExtractor] Tokenized ${lines.length} lines from ${pageCount} pages (method: ${method})`);
  const sampleSignatures = lines.slice(0, 10).map(l => ({
    raw: l.raw.substring(0, 80),
    tokens: l.tokens.map(t => `${t.text}(${t.type})`).join(' | ')
  }));
  console.log('[TableExtractor] Sample line signatures:', JSON.stringify(sampleSignatures, null, 2));

  // Phase 2: Find the Consensus Pattern
  const signatures = lines.map(l => l.tokens.map(t => t.type).join(''));
  const consensus = findConsensusPattern(signatures);

  // Diagnostic: Log pattern analysis
  const sigCounts: Record<string, number> = {};
  signatures.forEach(s => { sigCounts[s] = (sigCounts[s] || 0) + 1; });
  const topPatterns = Object.entries(sigCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log('[TableExtractor] Top patterns:', JSON.stringify(topPatterns, null, 2));
  console.log('[TableExtractor] Consensus pattern:', consensus);

  if (!consensus) {
    // No consistent table pattern — still return raw lines for fallback display
    const rawLines = lines.map(l => ({
      page: l.page,
      y: l.y,
      text: l.raw,
      kind: 'unknown' as const
    }));
    return {
      headers: [],
      rows: [],
      rawLines,
      metadata: {
        pageCount,
        rowCount: 0,
        confidence: 0,
        method,
        pattern: 'none',
        anomalies: ['No consistent table pattern found']
      }
    };
  }

  // Phase 3: Align lines to the consensus pattern
  const { rows, anomalies, headers, lineKinds } = alignToPattern(lines, consensus);

  // Phase 4: Build output
  const confidence = calculatePatternConfidence(lines, consensus, rows.length);
  const rawLines = lines.map((l, i) => ({
    page: l.page,
    y: l.y,
    text: l.raw,
    kind: lineKinds[i] || 'unknown'
  }));

  return {
    headers,
    rows,
    rawLines,
    metadata: {
      pageCount,
      rowCount: rows.length,
      confidence,
      method,
      pattern: consensus,
      anomalies: anomalies.length > 0 ? anomalies : ['None']
    }
  };
}

// --- Classification & Fusion ---

function classifyToken(text: string): TokenType {
  const t = text.trim();
  if (!t) return 'T';

  // Date detection (Universal)
  if (/^\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4}$/.test(t) ||
    /^\d{4}[\/\.\-]\d{1,2}[\/\.\-]\d{1,2}$/.test(t) ||
    /^\d{1,2}\s+[A-Za-z]{3,}/.test(t) ||
    /^[A-Za-z]{3,}\s+\d{1,2}/.test(t)) return 'D';

  // ID / Long Reference detection
  if (/^\d{8,}$/.test(t.replace(/\s/g, ''))) return 'N';

  // Money detection
  const clean = t.replace(/[R$€£¥\s\*\(\)]/g, '');
  if (/^-?[\d,]+(\.\d+)?(Cr|Dr|CR|DR|c|d)?$/i.test(clean) && /\d/.test(t)) {
    // Money usually has decimals OR is a larger number with suffix
    if (t.includes('.') || t.includes(',') || t.length > 6 || /(Cr|Dr)/i.test(t)) return 'M';
    return 'N';
  }

  // Solo suffix (Cr/Dr)
  if (/^(Cr|Dr|CR|DR)$/i.test(t)) return 'M';

  return 'T';
}

function mergeDateTokens(tokens: Token[]): Token[] {
  const merged: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const current = tokens[i];
    if (current.type === 'D' && tokens[i + 1]?.type === 'D') {
      const next = tokens[i + 1];
      // Check if tokens are horizontally close
      const close = Math.abs(next.x - (current.x + current.text.length * 4)) < 30;
      if (close) {
        merged.push({ text: `${current.text} ${next.text}`, type: 'D', x: current.x });
        i++;
        continue;
      }
    }
    merged.push(current);
  }
  return merged;
}

function mergeAmountSuffixes(tokens: Token[]): Token[] {
  const merged: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const current = tokens[i];
    const next = tokens[i + 1];
    if (current.type === 'M' && next && /^cr|dr|c|d$/i.test(next.text.trim().replace(/\*/g, ''))) {
      merged.push({ text: `${current.text}${next.text}`, type: 'M', x: current.x });
      i++;
    } else {
      merged.push(current);
    }
  }
  return merged;
}

// --- Pattern Logic ---

function findConsensusPattern(signatures: string[]): string | null {
  if (!signatures.length) return null;
  const tableLike = signatures.filter(s => s.includes('D') && s.includes('M'));
  if (tableLike.length < 3) return null;

  const counts = new Map<string, number>();
  for (const s of tableLike) {
    // Normalize T and N to T to simplify pattern finding
    const normalized = s.replace(/([TN])+/g, 'T');
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }

  let bestPattern = '';
  let bestCount = 0;
  for (const [pattern, count] of counts) {
    if (count > bestCount) {
      bestPattern = pattern;
      bestCount = count;
    }
  }

  // Pattern is valid if it represents at least 20% of table-like lines
  return bestCount >= Math.max(2, tableLike.length * 0.2) ? bestPattern : null;
}

/**
 * Detect actual column header names from the PDF's header row.
 * Returns money column names (in left-to-right order) to replace auto-generated ones.
 */
function inferMoneyColumnNames(lines: Line[], consensus: string): string[] | null {
  const mCount = consensus.split('').filter(c => c === 'M').length;
  if (mCount < 2) return null;

  const MONEY_KEYWORDS: Record<string, string> = {
    'debit': 'Debit', 'debits': 'Debit', 'debiete': 'Debit',
    'withdrawal': 'Withdrawal', 'withdrawals': 'Withdrawal',
    'credit': 'Credit', 'credits': 'Credit', 'krediete': 'Credit',
    'deposit': 'Deposit', 'deposits': 'Deposit',
    'amount': 'Amount', 'bedrag': 'Amount',
    'balance': 'Balance', 'saldo': 'Balance',
    'charges': 'Charges', 'fees': 'Fees', 'fee': 'Fees',
  };

  for (const line of lines) {
    const lower = line.raw.toLowerCase();
    if (!/\bdate\b|\bdatum\b/i.test(lower)) continue;

    // Extract money-related column names from tokens, in left-to-right order
    const detected: { name: string; x: number }[] = [];
    for (const token of line.tokens) {
      const word = token.text.trim().toLowerCase().replace(/[^a-z]/g, '');
      if (MONEY_KEYWORDS[word]) {
        detected.push({ name: MONEY_KEYWORDS[word], x: token.x });
      }
    }

    if (detected.length >= mCount) {
      detected.sort((a, b) => a.x - b.x);
      return detected.slice(0, mCount).map(d => d.name);
    }
  }

  return null;
}


function alignToPattern(lines: Line[], consensus: string) {
  const rows: string[][] = [];
  const anomalies: string[] = [];
  const lineKinds: ('data' | 'header' | 'footer' | 'unknown')[] = Array(lines.length).fill('unknown');

  // Try to detect actual column names from the PDF's header row
  const actualMoneyNames = inferMoneyColumnNames(lines, consensus);

  const headerCounts = { D: 0, T: 0, M: 0, N: 0 };
  const totalM = consensus.split('').filter(c => c === 'M').length;
  let mIndex = 0;

  const headers = consensus.split('').map(type => {
    headerCounts[type as keyof typeof headerCounts]++;
    const names: Record<string, string> = { D: 'Date', T: 'Description', M: 'Amount', N: 'Reference' };

    if (type === 'M') {
      let name: string;
      if (actualMoneyNames && mIndex < actualMoneyNames.length) {
        // Use actual column names detected from the PDF header
        name = actualMoneyNames[mIndex];
      } else {
        name = totalM === 3
          ? (mIndex === 0 ? 'Amount' : mIndex === 1 ? 'Balance' : 'Charges')
          : (totalM === 2 && mIndex === 1 ? 'Balance' : 'Amount');
      }
      mIndex++;
      return name;
    }

    return headerCounts[type as keyof typeof headerCounts] > 1
      ? `${names[type]} ${headerCounts[type as keyof typeof headerCounts]}`
      : names[type];
  });

  lines.forEach((line, i) => {
    const sig = line.tokens.map(t => t.type).join('');
    const normalized = sig.replace(/([TN])+/g, 'T');

    // Strict footer check applied to RAW text
    const footerKeywords = [
      'Delivery Method', 'Branch Number', 'Account Number', 'Opening Balance', 'Closing Balance',
      'Page \\d', 'Statement Date', 'VAT', 'Registration Number', 'Authorised Financial',
      'FNB App', 'Total VAT', 'Balance Brought Forward', 'Interest Rate', 'Service Fees',
      'Cash Deposit Fees', 'Turnover', 'Credit Transactions', 'Debit Transactions',
      'Please contact us', 'Pricing Option', 'Prime Lending Rate', 'FNB Insure',
      'Lost Cards', 'Account Enquiries', 'Fraud', 'Relationship Manager',
      'statement period', 'not yet reflecting', 'received the statement', 'Credit Rates',
      'credit facilities', 'IBT No', 'ABSA Bank'
    ];
    const footerRegex = new RegExp(footerKeywords.join('|'), 'i');
    const isFooter = footerRegex.test(line.raw);

    // Flexible Match: Allow mapping if the line is a prefix of consensus or a full match
    // E.g., if consensus is DTMMM (5) and line is DTMM (4), map it.
    const isFlexibleMatch = consensus.startsWith(normalized) && normalized.length >= 3 && normalized.includes('D') && normalized.includes('M');

    if (normalized === consensus || isFlexibleMatch) {
      const row: string[] = [];
      let tokenIdx = 0;

      for (let j = 0; j < consensus.length; j++) {
        const expected = consensus[j];
        const isLastInLine = tokenIdx >= line.tokens.length;

        if (isLastInLine) {
          row.push('');
          continue;
        }

        if (expected === 'T') {
          const textParts: string[] = [];
          while (tokenIdx < line.tokens.length && (['T', 'N'].includes(line.tokens[tokenIdx].type))) {
            textParts.push(line.tokens[tokenIdx].text);
            tokenIdx++;
          }
          row.push(textParts.join(' ').trim());
        } else {
          row.push(line.tokens[tokenIdx].text);
          tokenIdx++;
        }
      }
      rows.push(row);
      lineKinds[i] = 'data';

    } else if (rows.length > 0 && !sig.includes('D') && (sig.startsWith('T') || sig.startsWith('N'))) {

      const prevLine = lines[i - 1];
      // Vertical proximity check:
      // 1. Must be on same page
      // 2. Must be within 30 units (tightened from 45)
      const isSamePage = prevLine && prevLine.page === line.page;
      const isVerticallyClose = isSamePage ? Math.abs(prevLine.y - line.y) < 45 : false;

      if (!isFooter && isSamePage && isVerticallyClose) {
        const descIdx = consensus.indexOf('T');
        if (descIdx !== -1) {
          const lastRow = rows[rows.length - 1];
          lastRow[descIdx] = (lastRow[descIdx] + ' ' + line.tokens.map(t => t.text).join(' ')).trim();
          lineKinds[i] = 'data';
        }
      } else {
        lineKinds[i] = 'footer';
      }

    } else if (sig.includes('D') && sig.includes('M')) {
      anomalies.push(`Structural mismatch near: "${line.raw.substring(0, 60)}..."`);
      lineKinds[i] = 'unknown';
    } else {
      const lower = line.raw.toLowerCase();
      if (lower.includes('date') && lower.includes('description')) {
        lineKinds[i] = 'header';
      } else {
        lineKinds[i] = 'footer';
      }
    }
  });

  return { rows, anomalies, headers, lineKinds };
}

function calculatePatternConfidence(lines: Line[], consensus: string, rowCount: number): number {
  if (!lines.length || rowCount === 0) return 0;
  // Patterns with Date and Money are high confidence by default
  const baseConfidence = consensus.includes('D') && consensus.includes('M') ? 0.7 : 0.4;

  // Bonus for row count relative to line count (ignoring likely noise)
  const reasonableLines = lines.filter(l => l.raw.trim().length > 5).length;
  const coverage = rowCount / reasonableLines;

  return Math.min(0.99, Math.round((baseConfidence + coverage * 0.3) * 100) / 100);
}

function emptyResult(pageCount: number, reason: string): ExtractedTable {
  return {
    headers: [],
    rows: [],
    rawLines: [],
    metadata: {
      pageCount,
      rowCount: 0,
      confidence: 0,
      method: 'type-alignment',
      pattern: 'none',
      anomalies: [reason]
    }
  };
}
