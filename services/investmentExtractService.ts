import { pdfjsLib } from './pdfjsClient';

/**
 * Investment Portfolio Statement Extractor
 * 
 * Supports:
 * - Old Mutual (Max Investments, Wealth, Unit Trust, Retirement Annuity)
 * - Sanlam & Glacier (Glacier by Sanlam, Sanlam Investments, Collective Investments)
 * - General SA Investment Portfolios (Allan Gray, Coronation, Ninety One, Stanlib)
 * 
 * Extracts:
 * 1. Portfolio Holdings (Fund Name, Units, Unit Price/NAV, Market Value, Portfolio %)
 * 2. Investment Transactions (Date, Type, Fund Name, Units, Price, Amount, Direction)
 * 3. Portfolio Valuation Summary (Opening Value, Contributions, Withdrawals, Growth, Fees, Closing Value)
 * 4. Policy/Account Metadata (Policy Number, Investor Name, Valuation Date, Advisor)
 */

export interface InvestmentHolding {
  fundName: string;
  fundCode?: string | null;
  assetClass?: string | null;
  units: number | null;
  unitPrice: number | null;
  marketValue: number | null;
  portfolioPercentage?: number | null;
  currency?: string;
}

export interface InvestmentTransaction {
  date: string | null; // ISO 'YYYY-MM-DD'
  transactionType: string; // 'Debit Order', 'Lump Sum', 'Management Fee', 'Advice Fee', 'Switch In', etc.
  fundName?: string | null;
  description: string;
  units?: number | null;
  unitPrice?: number | null;
  amount: number | null;
  fee?: number | null;
  balance?: number | null;
  direction: 'INFLOW' | 'OUTFLOW' | 'FEE' | 'SWITCH' | 'UNKNOWN';
  rawText?: string;
}

export interface InvestmentSummary {
  openingValue: number | null;
  closingValue: number | null;
  contributions: number | null;
  withdrawals: number | null;
  growth: number | null;
  fees: number | null;
  netCashFlow?: number | null;
}

export interface InvestmentMetadata {
  institutionCode: 'OLD_MUTUAL_SA' | 'SANLAM_SA' | 'INVESTMENT_PORTFOLIO_SA';
  institutionName: string;
  policyNumber: string | null;
  accountNumber: string | null;
  investorName: string | null;
  productType: string | null;
  valuationDate: string | null;
  statementPeriod: string | null;
  advisorName?: string | null;
  totalMarketValue: number | null;
  pagesProcessed: number;
  rowCount: number;
  holdingsCount: number;
  transactionsCount: number;
  method: string;
  confidence: number;
}

export interface InvestmentExtractResult {
  summary: InvestmentSummary;
  holdings: InvestmentHolding[];
  transactions: InvestmentTransaction[];
  metadata: InvestmentMetadata;
  rows: Record<string, any>[];
}

const MONTH_MAP: Record<string, string> = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

export function parseInvestmentMoney(str: string | null | undefined): number | null {
  if (!str) return null;
  let clean = String(str).trim();
  clean = clean.replace(/^R\s*/i, '').replace(/\s+/g, '').replace(/,/g, '');
  if (/^\(.*\)$/.test(clean)) {
    clean = '-' + clean.slice(1, -1);
  }
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

function parseInvestmentDate(str: string): string | null {
  if (!str) return null;
  const trimmed = str.trim();

  // DD/MM/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (slashMatch) {
    const [, d, m, y] = slashMatch;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // DD Mon YYYY
  const wordMatch = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{2,4})/);
  if (wordMatch) {
    const [, d, mStr, y] = wordMatch;
    const m = MONTH_MAP[mStr.toLowerCase()];
    if (m) {
      const year = y.length === 2 ? `20${y}` : y;
      return `${year}-${m}-${d.padStart(2, '0')}`;
    }
  }

  // YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return null;
}

function detectInstitution(text: string): {
  code: 'OLD_MUTUAL_SA' | 'SANLAM_SA' | 'INVESTMENT_PORTFOLIO_SA';
  name: string;
} {
  const lower = text.toLowerCase();
  if (lower.includes('old mutual') || lower.includes('max investments')) {
    return { code: 'OLD_MUTUAL_SA', name: 'Old Mutual South Africa' };
  }
  if (lower.includes('sanlam') || lower.includes('glacier')) {
    return { code: 'SANLAM_SA', name: 'Sanlam South Africa' };
  }
  return { code: 'INVESTMENT_PORTFOLIO_SA', name: 'Investment Portfolio' };
}

function extractMetadata(text: string): {
  policyNumber: string | null;
  accountNumber: string | null;
  investorName: string | null;
  productType: string | null;
  valuationDate: string | null;
  statementPeriod: string | null;
  advisorName: string | null;
} {
  let policyNumber: string | null = null;
  let accountNumber: string | null = null;
  let investorName: string | null = null;
  let productType: string | null = null;
  let valuationDate: string | null = null;
  let statementPeriod: string | null = null;
  let advisorName: string | null = null;

  // Policy / Contract / Plan Number
  const polMatch = text.match(/(?:policy|contract|plan)\s*(?:number|no\.?)[:\s]+([A-Za-z0-9\/-]{4,25})/i);
  if (polMatch) policyNumber = polMatch[1].trim();

  // Account / Investor Number
  const accMatch = text.match(/(?:account|investor|client)\s*(?:number|no\.?)[:\s]+([A-Za-z0-9-]{4,25})/i);
  if (accMatch) accountNumber = accMatch[1].trim();

  // Investor Name
  const nameMatch = text.match(/(?:investor|client|policyholder|member)\s*(?:name)?[:\s]+([A-Za-z\s,.'-]{3,40})(?:\n|\r|\s{2,}|$)/i);
  if (nameMatch) investorName = nameMatch[1].trim();

  // Product Type
  const prodMatch = text.match(/(?:product|plan\s+type|contract\s+type)[:\s]+([A-Za-z0-9\s()&'-]{3,50})(?:\n|\r|$)/i);
  if (prodMatch) {
    productType = prodMatch[1].trim();
  } else if (/retirement\s+annuity/i.test(text)) {
    productType = 'Retirement Annuity';
  } else if (/living\s+annuity/i.test(text)) {
    productType = 'Living Annuity';
  } else if (/unit\s+trust/i.test(text)) {
    productType = 'Unit Trust Portfolio';
  } else if (/tax\s+free/i.test(text)) {
    productType = 'Tax Free Investment';
  } else if (/max\s+investments/i.test(text)) {
    productType = 'Max Investments';
  }

  // Valuation Date
  const valMatch = text.match(/(?:valuation\s+date|value\s+as\s+at|statement\s+date|effective\s+date)[:\s]+([^,\n\r]+?)(?:\n|\r|\s{2,}|$)/i);
  if (valMatch) valuationDate = parseInvestmentDate(valMatch[1]) || valMatch[1].trim();

  // Statement Period
  const perMatch = text.match(/(?:statement\s+period|period)[:\s]+([^.\n\r]+?)(?:\n|\r|$)/i);
  if (perMatch) statementPeriod = perMatch[1].trim();

  // Advisor / Intermediary
  const advMatch = text.match(/(?:financial\s+adviser|financial\s+advisor|intermediary|broker)[:\s]+([A-Za-z\s,.'-]{3,40})(?:\n|\r|\s{2,}|$)/i);
  if (advMatch) advisorName = advMatch[1].trim();

  return {
    policyNumber,
    accountNumber,
    investorName,
    productType,
    valuationDate,
    statementPeriod,
    advisorName,
  };
}

function extractSummary(text: string): InvestmentSummary {
  let openingValue: number | null = null;
  let closingValue: number | null = null;
  let contributions: number | null = null;
  let withdrawals: number | null = null;
  let growth: number | null = null;
  let fees: number | null = null;

  const openMatch = text.match(/\b(?:opening\s+(?:portfolio\s+)?value|value\s+at\s+start|balance\s+brought\s+forward)[:\s]*R?\s*([+-]?[\d\s,]+\.\d{2})/i);
  if (openMatch) openingValue = parseInvestmentMoney(openMatch[1]);

  const closeMatch = text.match(/\b(?:closing\s+(?:portfolio\s+)?value|statement\s+closing\s+value|value\s+at\s+end|total\s+market\s+value|closing\s+market\s+value|current\s+(?:portfolio\s+)?value)[:\s]*R?\s*([+-]?[\d\s,]+\.\d{2})/i);
  if (closeMatch) closingValue = parseInvestmentMoney(closeMatch[1]);

  const contMatch = text.match(/(?:total\s+contributions|premiums\s+received|deposits|inflows|additions)[:\s]*R?\s*([+-]?[\d\s,]+\.\d{2})/i);
  if (contMatch) contributions = parseInvestmentMoney(contMatch[1]);

  const withMatch = text.match(/(?:total\s+withdrawals|disinvestments|outflows|deductions)[:\s]*R?\s*([+-]?[\d\s,]+\.\d{2})/i);
  if (withMatch) withdrawals = parseInvestmentMoney(withMatch[1]);

  const growMatch = text.match(/(?:investment\s+return|market\s+movement|capital\s+growth|growth)[:\s]*R?\s*([+-]?[\d\s,]+\.\d{2})/i);
  if (growMatch) growth = parseInvestmentMoney(growMatch[1]);

  const feeMatch = text.match(/(?:total\s+fees|fees\s+and\s+charges|management\s+fees|admin\s+fees)[:\s]*R?\s*([+-]?[\d\s,]+\.\d{2})/i);
  if (feeMatch) fees = parseInvestmentMoney(feeMatch[1]);

  return {
    openingValue,
    closingValue,
    contributions,
    withdrawals,
    growth,
    fees,
    netCashFlow: contributions != null && withdrawals != null ? contributions - withdrawals : null,
  };
}

/**
 * Parses portfolio holdings lines:
 * e.g. "Old Mutual Albaraka Equity Fund 1245.5000 350.25 436236.38 45.20%"
 * or "SIM Balanced Fund 500.1234 125.00 62515.43"
 */
function extractHoldingsFromLines(lines: string[]): InvestmentHolding[] {
  const holdings: InvestmentHolding[] = [];

  for (const line of lines) {
    // Skip obvious header or non-fund lines
    if (/^(?:date|fund|portfolio|asset|total|opening|closing|statement|policy|investor|summary|valuation)/i.test(line)) {
      continue;
    }

    // Match Fund Name followed by numbers (units, price, market value, optional %)
    // e.g. "Old Mutual Top 40 Fund 1,234.5678 250.00 308,641.95 35.00%"
    const fundPattern = /^([A-Za-z0-9\s()&'-]{4,60}?)\s+([\d\s,]+\.\d{2,6})\s+([\d\s,]+\.\d{2,4})\s+([\d\s,]+\.\d{2})(?:\s+([\d.,]+)\s*%)?$/;
    const match = line.match(fundPattern);

    if (match) {
      const [, fundNameRaw, unitsStr, priceStr, valueStr, pctStr] = match;
      const fundName = fundNameRaw.trim();
      const units = parseInvestmentMoney(unitsStr);
      const unitPrice = parseInvestmentMoney(priceStr);
      const marketValue = parseInvestmentMoney(valueStr);
      const portfolioPercentage = pctStr ? parseFloat(pctStr) : null;

      // Classify asset class
      let assetClass = 'Equity';
      const fLower = fundName.toLowerCase();
      if (fLower.includes('balanced') || fLower.includes('multi asset')) assetClass = 'Multi Asset / Balanced';
      else if (fLower.includes('bond') || fLower.includes('income') || fLower.includes('fixed')) assetClass = 'Fixed Interest';
      else if (fLower.includes('cash') || fLower.includes('money market')) assetClass = 'Money Market / Cash';
      else if (fLower.includes('property') || fLower.includes('real estate')) assetClass = 'Property';
      else if (fLower.includes('global') || fLower.includes('offshore') || fLower.includes('world')) assetClass = 'Global / Offshore';

      if (marketValue != null && marketValue > 0) {
        holdings.push({
          fundName,
          assetClass,
          units,
          unitPrice,
          marketValue,
          portfolioPercentage,
          currency: 'ZAR',
        });
      }
    }
  }

  return holdings;
}

/**
 * Parses transaction lines:
 * e.g. "15/06/2026 Monthly Debit Order Old Mutual Equity 125.4000 350.25 43921.35"
 * or "01 Jul 2026 Management Fee - - 450.00 854000.00"
 */
function extractTransactionsFromLines(lines: string[]): InvestmentTransaction[] {
  const transactions: InvestmentTransaction[] = [];
  const dateRe = /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4})\s+(.+)$/;

  for (const line of lines) {
    const match = line.match(dateRe);
    if (!match) continue;

    const [, dateStr, rest] = match;
    const isoDate = parseInvestmentDate(dateStr);
    const moneyTokens = [...rest.matchAll(/-?[\d,]+\.\d{2}/g)].map((m) =>
      Number(m[0].replace(/,/g, ''))
    );

    if (!moneyTokens.length) continue;

    const amount = moneyTokens[0];
    const balance = moneyTokens.length > 1 ? moneyTokens[moneyTokens.length - 1] : null;
    const description = rest.replace(/-?[\d,]+\.\d{2}/g, '').trim();

    let direction: InvestmentTransaction['direction'] = 'UNKNOWN';
    const dLower = description.toLowerCase();
    if (/fee|charge|admin|advice|tax/i.test(dLower)) {
      direction = 'FEE';
    } else if (/debit order|premium|deposit|contribution|lump sum|inflow|reinvest/i.test(dLower)) {
      direction = 'INFLOW';
    } else if (/withdrawal|disinvest|outflow|pension|annuity payment/i.test(dLower)) {
      direction = 'OUTFLOW';
    } else if (/switch/i.test(dLower)) {
      direction = 'SWITCH';
    } else if (amount > 0) {
      direction = 'INFLOW';
    } else if (amount < 0) {
      direction = 'OUTFLOW';
    }

    transactions.push({
      date: isoDate,
      transactionType: description,
      description,
      amount: direction === 'OUTFLOW' || direction === 'FEE' ? -Math.abs(amount) : Math.abs(amount),
      balance,
      direction,
      rawText: line,
    });
  }

  return transactions;
}

/**
 * Extract Investment statement from text
 */
export function extractInvestmentStatementFromText(
  fullText: string,
  pageCount = 1
): InvestmentExtractResult {
  const inst = detectInstitution(fullText);
  const meta = extractMetadata(fullText);
  const summary = extractSummary(fullText);
  const lines = fullText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const holdings = extractHoldingsFromLines(lines);
  const transactions = extractTransactionsFromLines(lines);

  // If summary closing value is not explicitly found, sum holdings market values
  let totalMarketValue = summary.closingValue;
  if (totalMarketValue == null && holdings.length > 0) {
    totalMarketValue = holdings.reduce((sum, h) => sum + (h.marketValue || 0), 0);
  }

  const result: InvestmentExtractResult = {
    summary: {
      ...summary,
      closingValue: totalMarketValue,
    },
    holdings,
    transactions,
    metadata: {
      institutionCode: inst.code,
      institutionName: inst.name,
      policyNumber: meta.policyNumber,
      accountNumber: meta.accountNumber,
      investorName: meta.investorName,
      productType: meta.productType,
      valuationDate: meta.valuationDate,
      statementPeriod: meta.statementPeriod,
      advisorName: meta.advisorName,
      totalMarketValue,
      pagesProcessed: pageCount,
      rowCount: holdings.length + transactions.length,
      holdingsCount: holdings.length,
      transactionsCount: transactions.length,
      method: 'investment-portfolio-extraction',
      confidence: holdings.length > 0 || transactions.length > 0 ? 0.92 : 0.7,
    },
    rows: [],
  };

  result.rows = convertInvestmentToExcelRows(result);
  return result;
}

/**
 * Extract Investment statement from PDF File or ArrayBuffer
 */
export async function extractInvestmentStatement(
  file: File | ArrayBuffer | Uint8Array,
  options?: any
): Promise<InvestmentExtractResult> {
  const bytes = file instanceof Uint8Array
    ? file
    : file instanceof ArrayBuffer
    ? new Uint8Array(file)
    : new Uint8Array(await file.arrayBuffer());

  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pageCount = pdf.numPages;
  const lines: string[] = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const items = content.items as any[];

    // Group items by Y coordinate
    const linesMap = new Map<number, any[]>();
    for (const item of items) {
      if (item.str?.trim()) {
        const y = Math.round(item.transform[5] / 3) * 3;
        linesMap.set(y, [...(linesMap.get(y) ?? []), item]);
      }
    }

    const sortedLines = [...linesMap.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, lineItems]) =>
        lineItems
          .sort((a, b) => a.transform[4] - b.transform[4])
          .map((item) => item.str.trim())
          .join(' ')
      );

    lines.push(...sortedLines);
  }

  const fullText = lines.join('\n');
  return extractInvestmentStatementFromText(fullText, pageCount);
}

/**
 * Convert investment extract result to Excel rows
 */
export function convertInvestmentToExcelRows(
  result: InvestmentExtractResult
): Record<string, any>[] {
  const rows: Record<string, any>[] = [];

  // 1. If we have holdings, export them with standard investment columns
  if (result.holdings.length > 0) {
    for (const h of result.holdings) {
      rows.push({
        'Fund Name': h.fundName,
        'Asset Class': h.assetClass || '',
        Units: h.units,
        'Unit Price': h.unitPrice,
        'Market Value': h.marketValue,
        'Portfolio %': h.portfolioPercentage != null ? `${h.portfolioPercentage}%` : '',
        Currency: h.currency || 'ZAR',
      });
    }
  }

  // 2. If we also have transactions, export transactions
  if (result.transactions.length > 0) {
    for (const tx of result.transactions) {
      rows.push({
        Date: tx.date,
        Description: tx.description,
        'Transaction Type': tx.transactionType,
        Amount: tx.amount,
        Balance: tx.balance,
        Direction: tx.direction,
      });
    }
  }

  return rows;
}

/**
 * Detect if a PDF or text is from an investment institution
 */
export async function isInvestmentStatement(file: File | string): Promise<boolean> {
  try {
    if (typeof file === 'string') {
      return /old\s+mutual|sanlam|glacier|allan\s+gray|coronation|ninety\s+one|stanlib|portfolio\s+valuation|unit\s+trust/i.test(file);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map((i: any) => i.str).join(' ').toLowerCase();
    return (
      text.includes('old mutual') ||
      text.includes('sanlam') ||
      text.includes('glacier') ||
      text.includes('allan gray') ||
      text.includes('coronation') ||
      text.includes('portfolio valuation') ||
      text.includes('investment horizon')
    );
  } catch {
    return false;
  }
}
