/**
 * TymeBank Statement Extractor
 *
 * Layout (typical TymeBank Everyday Account statements):
 *   Date | Description | Fees | Money Out | Money In | Balance
 *
 * Supports:
 * - Space-separated thousands (1 234.56) and comma thousands (1,234.56)
 * - Multi-line description continuations
 * - Direction: Money Out = DEBIT, Money In = CREDIT, Fees-only = FEE
 * - Opening/closing balance extraction and simple reconciliation
 */

export interface TymeBankTransaction {
  date: string;
  description: string;
  fees: number | null;
  moneyOut: number | null;
  moneyIn: number | null;
  balance: number | null;
  direction: 'DEBIT' | 'CREDIT' | 'FEE' | 'UNKNOWN';
  amount: number | null;
  rawText: string;
  page: number;
  confidence: number;
}

export interface TymeBankMetadata {
  bankCode: 'TYMEBANK_SA';
  bankName: string;
  accountNumber: string | null;
  branchCode: string | null;
  statementPeriod: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  pagesProcessed: number;
  rowCount: number;
  reconciles: boolean;
  parseErrors: number;
}

export interface TymeBankExtractResult {
  transactions: TymeBankTransaction[];
  metadata: TymeBankMetadata;
}

export const TYMEBANK_RECONCILIATION_TOLERANCE = 0.05;

const DATE_RE = /(\d{2}[-/]\d{2}[-/]\d{2,4}|\d{2}\s+[A-Za-z]{3}\s+\d{2,4})/;
const MONEY_TOKEN_RE = /([+-]?(?:R\s*)?(?:\d{1,3}(?:[,\s]\d{3})*|\d+)\.\d{2})/g;

const NOISE_PATTERNS = [
  /^tymebank/i,
  /^tyme\s+bank/i,
  /^everyday\s+account/i,
  /^account\s+statement/i,
  /^statement\s+(period|date|number)/i,
  /^page\s+\d+/i,
  /^opening\s+balance/i,
  /^closing\s+balance/i,
  /^available\s+balance/i,
  /^total\s+(debits?|credits?|fees?)/i,
  /^date\s+description/i,
  /^money\s+out/i,
  /^money\s+in/i,
  /^fees?\s*$/i,
  /^balance\s*$/i,
  /tymebank is a licensed/i,
  /tyme technologies/i,
  /client care/i,
  /vat reg/i,
];

function isNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length < 2) return true;
  return NOISE_PATTERNS.some((p) => p.test(t));
}

/** Parse money strings with R prefix, spaces, or commas as thousands separators. */
export function parseTymeMoney(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/^R\s*/i, '').replace(/\s+/g, '').replace(/,/g, '');
  if (!/^[+-]?\d+(\.\d{2})?$/.test(s) && !/^[+-]?\d+\.\d{2}$/.test(s)) {
    const m = s.match(/[+-]?\d+\.\d{2}/);
    if (!m) return null;
    s = m[0];
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function extractMoneyTokens(line: string): string[] {
  const tokens: string[] = [];
  const re = new RegExp(MONEY_TOKEN_RE.source, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    tokens.push(m[1]);
  }
  return tokens;
}

function lineStartsWithDate(line: string): RegExpMatchArray | null {
  return line.trim().match(new RegExp(`^${DATE_RE.source}`));
}

function extractMetaField(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function classifyDirection(
  fees: number | null,
  moneyOut: number | null,
  moneyIn: number | null
): { direction: TymeBankTransaction['direction']; amount: number | null } {
  if (moneyOut != null && moneyOut !== 0) {
    return { direction: 'DEBIT', amount: -Math.abs(moneyOut) };
  }
  if (moneyIn != null && moneyIn !== 0) {
    return { direction: 'CREDIT', amount: Math.abs(moneyIn) };
  }
  if (fees != null && fees !== 0) {
    return { direction: 'FEE', amount: -Math.abs(fees) };
  }
  return { direction: 'UNKNOWN', amount: null };
}

/**
 * Parse TymeBank statement text into structured transactions.
 * Works for both digital text-layer dumps and OCR raw text.
 */
export function extractTymeBankStatementFromText(
  fullText: string,
  pageCount = 1
): TymeBankExtractResult {
  const lines = fullText
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const openingBalance = parseTymeMoney(
    extractMetaField(fullText, [
      /opening\s+balance[:\s.]*?(?:R\s*)?([+-]?[\d\s,]+\.\d{2})/i,
      /balance\s+brought\s+forward[:\s]+(?:R\s*)?([+-]?[\d\s,]+\.\d{2})/i,
    ])
  );
  const closingBalance = parseTymeMoney(
    extractMetaField(fullText, [
      /closing\s+balance[:\s.]*?(?:R\s*)?([+-]?[\d\s,]+\.\d{2})/i,
      /balance\s+carried\s+forward[:\s]+(?:R\s*)?([+-]?[\d\s,]+\.\d{2})/i,
    ])
  );
  const accountNumber = extractMetaField(fullText, [
    /account\s*(?:num\.?|no\.?|number|#)[:\s.]*([0-9\s-]{6,})/i,
  ]);
  const branchCode = extractMetaField(fullText, [
    /branch\s*(?:code)?[:\s.]*([0-9]{3,8})/i,
    /\b(678910)\b/,
  ]);
  const statementPeriod = extractMetaField(fullText, [
    /statement\s+period[:\s]*([^\n]+)/i,
    /period[:\s]*(\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4}\s*[-–to]+\s*\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4})/i,
    /period[:\s]*(\d{2}[-/]\d{2}[-/]\d{2,4}\s*[-–to]+\s*\d{2}[-/]\d{2}[-/]\d{2,4})/i,
  ]);

  const transactions: TymeBankTransaction[] = [];
  let parseErrors = 0;
  let current: TymeBankTransaction | null = null;
  let page = 1;
  let lastBalance: number | null = openingBalance;

  for (const line of lines) {
    if (/^---PAGE BREAK---$/i.test(line) || /^page\s+\d+/i.test(line)) {
      const pm = line.match(/page\s+(\d+)/i);
      if (pm) page = Number(pm[1]) || page;
      continue;
    }

    if (isNoiseLine(line) && !lineStartsWithDate(line)) {
      continue;
    }

    const dateMatch = lineStartsWithDate(line);
    if (dateMatch) {
      if (current) {
        transactions.push(current);
        if (current.balance != null) lastBalance = current.balance;
      }

      const date = dateMatch[1];
      const rest = line.slice(dateMatch[0].length).trim();
      const moneyTokens = extractMoneyTokens(rest);
      const moneyValues = moneyTokens.map(parseTymeMoney);

      // Drop money tokens from description
      let description = rest;
      for (const tok of moneyTokens) {
        description = description.replace(tok, ' ');
      }
      description = description.replace(/\s+/g, ' ').trim();

      // TymeBank columns trailing right: [Fees?] [Money Out?] [Money In?] Balance
      let fees: number | null = null;
      let moneyOut: number | null = null;
      let moneyIn: number | null = null;
      let balance: number | null = null;

      if (moneyValues.length === 1) {
        balance = moneyValues[0];
      } else if (moneyValues.length === 2) {
        // Single movement amount + Balance — resolve direction via balance delta when possible
        const amt = moneyValues[0];
        balance = moneyValues[1];
        if (amt != null && amt < 0) {
          moneyOut = Math.abs(amt);
        } else if (amt != null && lastBalance != null && balance != null) {
          const delta = balance - lastBalance;
          if (delta < -TYMEBANK_RECONCILIATION_TOLERANCE) moneyOut = Math.abs(amt);
          else if (delta > TYMEBANK_RECONCILIATION_TOLERANCE) moneyIn = Math.abs(amt);
          else if (/fee|charge|interest/i.test(description)) fees = Math.abs(amt);
          else moneyOut = Math.abs(amt);
        } else if (amt != null) {
          // No prior balance: prefer DEBIT for purchases/POS/ATM, else CREDIT for salary/deposit keywords
          if (/salary|deposit|credit|refund|interest earned|payment received/i.test(description)) {
            moneyIn = Math.abs(amt);
          } else {
            moneyOut = Math.abs(amt);
          }
        }
      } else if (moneyValues.length === 3) {
        // Fees + Money Out + Balance (fee rows) OR Money Out + Money In + Balance
        const a = moneyValues[0];
        const b = moneyValues[1];
        balance = moneyValues[2];
        if (/fee|charge/i.test(description)) {
          // e.g. "Fee: Unsuccessful Purchase 3.00 3.00 0.00"
          fees = a;
          moneyOut = b != null && b !== 0 ? b : a;
          moneyIn = null;
        } else if (a != null && b != null && a > 0 && b > 0 && lastBalance != null && balance != null) {
          // Both positive — use balance delta to decide which column is active
          const delta = balance - lastBalance;
          if (delta < 0) {
            moneyOut = a;
            moneyIn = null;
          } else {
            moneyOut = null;
            moneyIn = b;
          }
        } else if (
          a != null &&
          b != null &&
          a > 0 &&
          b > 0 &&
          /payshap|salary|deposit|credit|refund|payment received|domain money/i.test(description)
        ) {
          moneyOut = null;
          moneyIn = b;
        } else if (
          a != null &&
          b != null &&
          a > 0 &&
          b > 0 &&
          /debit|order|purchase|pos|atm|withdrawal/i.test(description)
        ) {
          moneyOut = a;
          moneyIn = null;
        } else {
          moneyOut = a;
          moneyIn = b;
        }
      } else if (moneyValues.length >= 4) {
        fees = moneyValues[moneyValues.length - 4];
        moneyOut = moneyValues[moneyValues.length - 3];
        moneyIn = moneyValues[moneyValues.length - 2];
        balance = moneyValues[moneyValues.length - 1];
      }

      // Zero out empty columns
      if (fees === 0) fees = null;
      if (moneyOut === 0) moneyOut = null;
      if (moneyIn === 0) moneyIn = null;

      // Prefer single active movement column
      if (moneyOut != null && moneyIn != null) {
        if (moneyOut > 0 && moneyIn === 0) moneyIn = null;
        else if (moneyIn > 0 && moneyOut === 0) moneyOut = null;
        else if (lastBalance != null && balance != null) {
          const delta = balance - lastBalance;
          if (delta < 0) moneyIn = null;
          else if (delta > 0) moneyOut = null;
        }
      }

      // Fee keyword forces FEE direction even when Money Out also filled
      let { direction, amount } = classifyDirection(fees, moneyOut, moneyIn);
      if (/fee|charge/i.test(description) && (fees != null || moneyOut != null)) {
        direction = 'FEE';
        const feeAmt = fees ?? moneyOut ?? 0;
        amount = -Math.abs(feeAmt);
        if (fees == null && moneyOut != null) fees = moneyOut;
      }

      let conf = 0.75;
      if (!date) {
        conf -= 0.2;
        parseErrors++;
      }
      if (amount == null && balance == null) {
        conf -= 0.25;
        parseErrors++;
      }

      current = {
        date,
        description,
        fees,
        moneyOut,
        moneyIn,
        balance,
        direction,
        amount,
        rawText: line,
        page,
        confidence: Math.max(0.3, conf),
      };
      continue;
    }

    // Continuation line: append up to 3 continuation segments to previous description
    if (current && !isNoiseLine(line)) {
      const contMoney = extractMoneyTokens(line);
      const continuationCount = (current.rawText.match(/\n/g) || []).length;
      if (contMoney.length === 0 && continuationCount < 3) {
        current.description = `${current.description} ${line}`.replace(/\s+/g, ' ').trim();
        current.rawText = `${current.rawText}\n${line}`;
      } else if (contMoney.length === 1 && current.balance == null) {
        current.balance = parseTymeMoney(contMoney[0]);
      }
    }
  }

  if (current) transactions.push(current);

  // Reconciliation: opening + sum(signed amounts) ~= closing
  let running = openingBalance ?? 0;
  for (const tx of transactions) {
    if (tx.amount != null) running += tx.amount;
    else if (tx.fees != null) running -= Math.abs(tx.fees);
  }
  const reconciles =
    openingBalance != null &&
    closingBalance != null &&
    Math.abs(running - closingBalance) <= TYMEBANK_RECONCILIATION_TOLERANCE;

  return {
    transactions,
    metadata: {
      bankCode: 'TYMEBANK_SA',
      bankName: 'TymeBank',
      accountNumber,
      branchCode,
      statementPeriod,
      openingBalance,
      closingBalance,
      pagesProcessed: pageCount,
      rowCount: transactions.length,
      reconciles,
      parseErrors,
    },
  };
}

export function convertTymeBankToExcelRows(
  transactions: TymeBankTransaction[]
): Record<string, unknown>[] {
  return transactions.map((tx) => ({
    Date: tx.date,
    Description: tx.description,
    Fees: tx.fees ?? null,
    'Money Out': tx.moneyOut ?? null,
    'Money In': tx.moneyIn ?? null,
    Balance: tx.balance ?? null,
    Amount: tx.amount ?? null,
    Direction: tx.direction,
    Confidence: tx.confidence,
    Page: tx.page,
  }));
}

/**
 * Extract TymeBank statement from a PDF file (text layer).
 * For scanned PDFs, prefer extractTymeBankStatementFromText with OCR text.
 */
export async function extractTymeBankStatementFromFile(file: File): Promise<TymeBankExtractResult> {
  const pdfjs = await import('pdfjs-dist');
  const bytes = await file.arrayBuffer();
  // @ts-ignore
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const pageCount = Math.min(pdf.numPages, 50);
  const pageTexts: string[] = [];

  for (let p = 1; p <= pageCount; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as Array<{ str?: string; transform?: number[] }>)
      .filter((i) => i.str && i.str.trim())
      .map((i) => ({
        str: i.str!.trim(),
        x: i.transform?.[4] ?? 0,
        y: Math.round((i.transform?.[5] ?? 0) / 3) * 3,
      }));

    const lineMap = new Map<number, Array<{ str: string; x: number }>>();
    for (const it of items) {
      if (!lineMap.has(it.y)) lineMap.set(it.y, []);
      lineMap.get(it.y)!.push({ str: it.str, x: it.x });
    }
    const sortedY = Array.from(lineMap.keys()).sort((a, b) => b - a);
    const lines = sortedY.map((y) =>
      lineMap
        .get(y)!
        .sort((a, b) => a.x - b.x)
        .map((t) => t.str)
        .join(' ')
    );
    pageTexts.push(lines.join('\n'));
  }

  return extractTymeBankStatementFromText(pageTexts.join('\n\n---PAGE BREAK---\n\n'), pageCount);
}

/**
 * Direct TymeBank extraction from statement text (plan API).
 * Also accepts a File for PDF text-layer extraction.
 */
export async function extractTymeBankStatement(
  textOrFile: string | File,
  pageCount = 1
): Promise<TymeBankExtractResult> {
  if (typeof textOrFile === 'string') {
    return extractTymeBankStatementFromText(textOrFile, pageCount);
  }
  return extractTymeBankStatementFromFile(textOrFile);
}

/** Orchestrator alias used by documentService. */
export async function extractTymeBank(
  file: File,
  fullText?: string,
  pageCount?: number
): Promise<TymeBankExtractResult> {
  if (fullText && fullText.trim().length > 0) {
    return extractTymeBankStatementFromText(fullText, pageCount ?? 1);
  }
  return extractTymeBankStatementFromFile(file);
}
