/**
 * Bank Pattern Registry & Detection System
 * 
 * Purpose:
 * - Central registry of bank-specific extraction patterns
 * - Detects which bank a statement belongs to
 * - Provides bank-specific extraction strategies
 * 
 * Supported Banks:
 * - FNB (South Africa) [PRIORITY]
 * - ABSA (South Africa)
 * - Nedbank (South Africa)
 * - ICICI (India)
 * - Standard Bank (South Africa)
 * - Capitec (South Africa)
 * - TymeBank (South Africa)
 * - Investec (South Africa)
 * - Discovery Bank (South Africa)
 * - African Bank (South Africa)
 */

export interface BankPattern {
  code: string;
  name: string;
  country: string;
  language: string;
  headerPatterns: RegExp[];
  footerPatterns: RegExp[];
  columnHints: string[];
  balanceIndicators: string[];
  dateFormat: string;
  currencySymbol: string;
  decimalSeparator: string;
  thousandsSeparator: string;
}

export interface DetectionResult {
  bankCode: string;
  bankName: string;
  confidence: number; // 0-100
  matchedPatterns: string[];
}

/**
 * Bank Pattern Definitions
 */
const BANK_PATTERNS: Record<string, BankPattern> = {
  FNB_SA: {
    code: 'FNB_SA',
    name: 'FNB South Africa',
    country: 'ZA',
    language: 'en',
    headerPatterns: [
      /First National Bank/i,
      /FNB/i,
      /Account Statement/i,
      /Statement of Account/i,
    ],
    footerPatterns: [
      /Delivery Method/i,
      /No\. Credit Transactions/i,
      /No\. Debit Transactions/i,
      /Total Debits/i,
      /Total Credits/i,
      /Closing Balance/i,
      /Opening Balance/i,
    ],
    columnHints: ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
    balanceIndicators: ['Balance', 'Bal'],
    dateFormat: 'DD MMM',
    currencySymbol: 'R',
    decimalSeparator: '.',
    thousandsSeparator: ',',
  },

  ABSA_SA: {
    code: 'ABSA_SA',
    name: 'ABSA South Africa',
    country: 'ZA',
    language: 'en',
    headerPatterns: [
      /ABSA/i,
      /Barclays/i,
      /Account Statement/i,
      /Cheque Account/i,
      /Absa Bank Limited/i,
    ],
    footerPatterns: [
      /Total Debits/i,
      /Total Credits/i,
      /Closing Balance/i,
      /Bal brought forward/i,
      /Authorised Financial Services/i,
    ],
    columnHints: ['Date', 'Description', 'Narrative', 'Charge', 'Debit', 'Credit', 'Balance'],
    balanceIndicators: ['Balance', 'Bal'],
    dateFormat: 'DD/MM/YYYY',
    currencySymbol: 'R',
    decimalSeparator: '.',
    thousandsSeparator: ',',
  },

  NEDBANK_SA: {
    code: 'NEDBANK_SA',
    name: 'Nedbank South Africa',
    country: 'ZA',
    language: 'en',
    headerPatterns: [
      /Nedbank/i,
      /Account Statement/i,
    ],
    footerPatterns: [
      /Total Debits/i,
      /Total Credits/i,
      /Closing Balance/i,
    ],
    columnHints: ['Date', 'Particulars', 'Withdrawn', 'Deposited', 'Balance'],
    balanceIndicators: ['Balance', 'Bal'],
    dateFormat: 'DD MMM YYYY',
    currencySymbol: 'R',
    decimalSeparator: '.',
    thousandsSeparator: ',',
  },

  ICICI_IN: {
    code: 'ICICI_IN',
    name: 'ICICI Bank India',
    country: 'IN',
    language: 'en',
    headerPatterns: [
      /ICICI/i,
      /Industrial Credit and Investment/i,
      /Account Statement/i,
    ],
    footerPatterns: [
      /Total Debits/i,
      /Total Credits/i,
      /Closing Balance/i,
    ],
    columnHints: ['Date', 'Particulars', 'Debit', 'Credit', 'Balance'],
    balanceIndicators: ['Balance', 'Bal'],
    dateFormat: 'DD-MM-YYYY',
    currencySymbol: '₹',
    decimalSeparator: '.',
    thousandsSeparator: ',',
  },

  STANDARD_BANK_SA: {
    code: 'STANDARD_BANK_SA',
    name: 'Standard Bank South Africa',
    country: 'ZA',
    language: 'en',
    headerPatterns: [
      /Standard Bank/i,
      /SBSA/i,
      /Account Statement/i,
      /Statement Opening Balance/i,
      /Standard Bank of South Africa/i,
    ],
    footerPatterns: [
      /Total Debits/i,
      /Total Credits/i,
      /Total Payments/i,
      /Total Deposits/i,
      /Statement Closing Balance/i,
      /Closing Balance/i,
      /Standard Bank is a licensed/i,
    ],
    columnHints: ['Date', 'Description', 'Debit', 'Credit', 'Payments', 'Deposits', 'Balance'],
    balanceIndicators: ['Balance', 'Bal'],
    dateFormat: 'DD MMM YYYY',
    currencySymbol: 'R',
    decimalSeparator: '.',
    thousandsSeparator: ',',
  },

  OLD_MUTUAL_SA: {
    code: 'OLD_MUTUAL_SA',
    name: 'Old Mutual South Africa',
    country: 'ZA',
    language: 'en',
    headerPatterns: [
      /Old Mutual/i,
      /Max Investments/i,
      /Old Mutual Wealth/i,
      /Old Mutual Unit Trusts/i,
      /Old Mutual Life/i,
    ],
    footerPatterns: [
      /Old Mutual Life Assurance/i,
      /Licensed Financial Services/i,
      /Total Market Value/i,
      /Closing Portfolio Value/i,
    ],
    columnHints: ['Fund Name', 'Asset Class', 'Units', 'Unit Price', 'Market Value', 'Portfolio %'],
    balanceIndicators: ['Market Value', 'Portfolio Value', 'Current Value', 'Closing Value'],
    dateFormat: 'DD/MM/YYYY',
    currencySymbol: 'R',
    decimalSeparator: '.',
    thousandsSeparator: ',',
  },

  SANLAM_SA: {
    code: 'SANLAM_SA',
    name: 'Sanlam South Africa',
    country: 'ZA',
    language: 'en',
    headerPatterns: [
      /Sanlam/i,
      /Glacier by Sanlam/i,
      /Sanlam Investments/i,
      /Sanlam Collective Investments/i,
      /Sanlam Life/i,
    ],
    footerPatterns: [
      /Sanlam Life Insurance/i,
      /Licensed Financial Services/i,
      /Glacier Financial Solutions/i,
      /Total Market Value/i,
    ],
    columnHints: ['Fund Name', 'Portfolio', 'Units', 'Price per unit', 'Market Value', 'Total Value'],
    balanceIndicators: ['Market Value', 'Portfolio Value', 'Total Value', 'Closing Value'],
    dateFormat: 'DD/MM/YYYY',
    currencySymbol: 'R',
    decimalSeparator: '.',
    thousandsSeparator: ',',
  },

  INVESTMENT_PORTFOLIO_SA: {
    code: 'INVESTMENT_PORTFOLIO_SA',
    name: 'Investment Portfolio South Africa',
    country: 'ZA',
    language: 'en',
    headerPatterns: [
      /Allan Gray/i,
      /Coronation/i,
      /Ninety One/i,
      /Stanlib/i,
      /Portfolio Valuation/i,
      /Portfolio Statement/i,
      /Investment Statement/i,
      /Unit Trust Statement/i,
    ],
    footerPatterns: [
      /Total Market Value/i,
      /Licensed Financial Services/i,
      /Authorised Financial Services/i,
    ],
    columnHints: ['Fund Name', 'Asset Class', 'Units', 'Unit Price', 'Market Value', 'Portfolio %'],
    balanceIndicators: ['Market Value', 'Portfolio Value', 'Closing Value'],
    dateFormat: 'DD/MM/YYYY',
    currencySymbol: 'R',
    decimalSeparator: '.',
    thousandsSeparator: ',',
  },

  CAPITEC_SA: {
    code: 'CAPITEC_SA',
    name: 'Capitec Bank South Africa',
    country: 'ZA',
    language: 'en',
    headerPatterns: [
      /Capitec Bank/i,
      /Capitec/i,
      /Transaction History/i,
      /Global One/i,
      /Business Account Statement/i,
      /Capitec Business Account/i,
      /Capitec Bank Limited/i,
    ],
    footerPatterns: [
      /Capitec Bank is an authorised/i,
      /Capitec Bank Limited/i,
      /Page \d+ of \d+/i,
      /Total Debits/i,
      /Total Credits/i,
      /Total fees/i,
    ],
    columnHints: ['Date', 'Description', 'Reference', 'Money in', 'Money out', 'Fees', 'Balance', 'Post Date', 'Trans. Date', 'Amount'],
    balanceIndicators: ['Balance', 'Bal'],
    dateFormat: 'DD/MM/YYYY',
    currencySymbol: 'R',
    decimalSeparator: '.',
    thousandsSeparator: ',',
  },

  TYMEBANK_SA: {
    code: 'TYMEBANK_SA',
    name: 'TymeBank South Africa',
    country: 'ZA',
    language: 'en',
    headerPatterns: [
      /TymeBank/i,
      /Tyme Bank/i,
      /TymeDigital/i,
      /Account Statement/i,
    ],
    footerPatterns: [
      /TymeBank is a licensed/i,
      /Tyme Technologies/i,
      /Total Debits/i,
      /Total Credits/i,
      /Closing Balance/i,
    ],
    columnHints: ['Date', 'Description', 'Amount', 'Balance'],
    balanceIndicators: ['Balance', 'Bal', 'Available Balance'],
    dateFormat: 'DD MMM YYYY',
    currencySymbol: 'R',
    decimalSeparator: '.',
    thousandsSeparator: ',',
  },

  INVESTEC_SA: {
    code: 'INVESTEC_SA',
    name: 'Investec South Africa',
    country: 'ZA',
    language: 'en',
    headerPatterns: [
      /Investec/i,
      /Investec Bank/i,
      /Investec Private Bank/i,
      /Account Statement/i,
    ],
    footerPatterns: [
      /Investec Bank Limited/i,
      /Member of the Investec Group/i,
      /Total Debits/i,
      /Total Credits/i,
      /Closing Balance/i,
    ],
    columnHints: ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
    balanceIndicators: ['Balance', 'Bal'],
    dateFormat: 'DD MMM YYYY',
    currencySymbol: 'R',
    decimalSeparator: '.',
    thousandsSeparator: ',',
  },

  DISCOVERY_BANK_SA: {
    code: 'DISCOVERY_BANK_SA',
    name: 'Discovery Bank South Africa',
    country: 'ZA',
    language: 'en',
    headerPatterns: [
      /Discovery Bank/i,
      /Discovery/i,
      /Account Statement/i,
    ],
    footerPatterns: [
      /Discovery Bank Limited/i,
      /Discovery Ltd/i,
      /Total Debits/i,
      /Total Credits/i,
      /Closing Balance/i,
    ],
    columnHints: ['Date', 'Description', 'Amount', 'Balance'],
    balanceIndicators: ['Balance', 'Bal', 'Available Balance'],
    dateFormat: 'DD MMM YYYY',
    currencySymbol: 'R',
    decimalSeparator: '.',
    thousandsSeparator: ',',
  },

  AFRICAN_BANK_SA: {
    code: 'AFRICAN_BANK_SA',
    name: 'African Bank South Africa',
    country: 'ZA',
    language: 'en',
    headerPatterns: [
      /African Bank/i,
      /Account Statement/i,
      /MyWORLD/i,
    ],
    footerPatterns: [
      /African Bank Limited/i,
      /Total Debits/i,
      /Total Credits/i,
      /Closing Balance/i,
      /Total Deposits/i,
      /Total Payments/i,
      /Bank Charges/i,
    ],
    // Single Amount column + separate Bank Charges column. Date format is ambiguous.
    columnHints: ['Transaction Date', 'Transaction Details', 'Bank Charges', 'Amount', 'Balance'],
    balanceIndicators: ['Balance', 'Running Balance'],
    // African Bank uses BOTH YYYY/MM/DD and DD/MM/YYYY depending on account type — auto-detect
    dateFormat: 'AUTO',
    currencySymbol: 'R',
    decimalSeparator: '.',
    thousandsSeparator: ',',
  },

  BIDVEST_BANK_SA: {
    code: 'BIDVEST_BANK_SA',
    name: 'Bidvest Bank South Africa',
    country: 'ZA',
    language: 'en',
    headerPatterns: [
      /Bidvest Bank/i,
      /Bidvest/i,
      /Account Statement/i,
    ],
    footerPatterns: [
      /Bidvest Bank Limited/i,
      /Total Debits/i,
      /Total Credits/i,
      /Closing Balance/i,
      /Overdraft Limit/i,
    ],
    // Extra Transaction Reference column between Description and Amount
    columnHints: ['Date', 'Transaction Description', 'Transaction Reference', 'Amount', 'Balance'],
    balanceIndicators: ['Balance', 'Bal'],
    dateFormat: 'DD/MM/YYYY',
    currencySymbol: 'R',
    decimalSeparator: '.',
    thousandsSeparator: ',',
  },

  // ── United States banks (Batch 08 / Item G2 — US locale region) ──────────────
  CHASE_US: {
    code: 'CHASE_US', name: 'Chase (JPMorgan) United States', country: 'US', language: 'en',
    headerPatterns: [/\bCHASE\b/i, /JPMorgan Chase/i, /Checking Account Statement/i, /Chase Account/i],
    footerPatterns: [/Direct Deposit/i, /Total Deposits/i, /Total Withdrawals/i, /Beginning Balance/i, /Ending Balance/i],
    columnHints: ['Date', 'Description', 'Payment', 'Deposit', 'Balance'],
    balanceIndicators: ['Balance', 'Ending Balance'],
    dateFormat: 'MM/DD/YYYY', currencySymbol: '$', decimalSeparator: '.', thousandsSeparator: ',',
  },

  BOA_US: {
    code: 'BOA_US', name: 'Bank of America United States', country: 'US', language: 'en',
    headerPatterns: [/Bank of America/i, /\bBOA\b/i, /Statement Period/i],
    footerPatterns: [/Previous Balance/i, /New Balance/i, /Total Credits/i, /Total Debits/i],
    columnHints: ['Date', 'Description', 'Amount', 'Balance'],
    balanceIndicators: ['Balance', 'New Balance'],
    dateFormat: 'MM/DD/YYYY', currencySymbol: '$', decimalSeparator: '.', thousandsSeparator: ',',
  },

  WELLSFARGO_US: {
    code: 'WELLSFARGO_US', name: 'Wells Fargo United States', country: 'US', language: 'en',
    headerPatterns: [/Wells Fargo/i, /Account Transactions/i],
    footerPatterns: [/Beginning Ledger Balance/i, /Ending Ledger Balance/i, /Total Credits/i, /Total Debits/i],
    columnHints: ['Date', 'Description', 'Withdrawal', 'Deposit', 'Balance'],
    balanceIndicators: ['Balance', 'Ending Ledger Balance'],
    dateFormat: 'MM/DD/YYYY', currencySymbol: '$', decimalSeparator: '.', thousandsSeparator: ',',
  },

  CITIBANK_US: {
    code: 'CITIBANK_US', name: 'Citibank United States', country: 'US', language: 'en',
    headerPatterns: [/Citibank/i, /\bCITI\b/i, /Account Activity/i],
    footerPatterns: [/Opening Balance/i, /Closing Balance/i, /Total Deposits/i, /Total Withdrawals/i],
    columnHints: ['Date', 'Description', 'Debit', 'Credit', 'Balance'],
    balanceIndicators: ['Balance', 'Closing Balance'],
    dateFormat: 'MM/DD/YYYY', currencySymbol: '$', decimalSeparator: '.', thousandsSeparator: ',',
  },
};


/**
 * Detect which bank a statement belongs to
 * @param text Full statement text
 * @returns DetectionResult with bank info and confidence
 */
export function detectBank(text: string, opts?: { region?: string }): DetectionResult {
  const region = opts?.region;
  const brandKeywords: Array<{ code: string; name: string; pattern: RegExp }> = [
    { code: 'CAPITEC_SA', name: 'Capitec Bank South Africa', pattern: /\bCapitec\b/i },
    { code: 'FNB_SA', name: 'FNB South Africa', pattern: /First\s+National\s+Bank|\bFNB\b/i },
    { code: 'NEDBANK_SA', name: 'Nedbank South Africa', pattern: /\bNedbank\b/i },
    { code: 'ABSA_SA', name: 'ABSA South Africa', pattern: /\bABSA\b/i },
    { code: 'STANDARD_BANK_SA', name: 'Standard Bank South Africa', pattern: /Standard\s+Bank|\bSBSA\b/i },
    { code: 'TYMEBANK_SA', name: 'TymeBank South Africa', pattern: /Tyme\s*Bank|TymeBank|\b678910\b/i },
    { code: 'INVESTEC_SA', name: 'Investec South Africa', pattern: /\bInvestec\b/i },
    { code: 'DISCOVERY_BANK_SA', name: 'Discovery Bank South Africa', pattern: /Discovery\s+Bank/i },
    // African Bank absorbs Grindrod Bank (Section 54 asset transfer completed ~March 2024)
    { code: 'AFRICAN_BANK_SA', name: 'African Bank South Africa', pattern: /African\s+Bank|MyWORLD|Grindrod\s+Bank/i },
    { code: 'BIDVEST_BANK_SA', name: 'Bidvest Bank South Africa', pattern: /Bidvest\s+Bank|\bBidvest\b/i },
    { code: 'OLD_MUTUAL_SA', name: 'Old Mutual South Africa', pattern: /Old\s+Mutual|Max\s+Investments/i },
    { code: 'SANLAM_SA', name: 'Sanlam South Africa', pattern: /Sanlam|Glacier\s+by\s+Sanlam/i },
    { code: 'INVESTMENT_PORTFOLIO_SA', name: 'Investment Portfolio South Africa', pattern: /Allan\s+Gray|Coronation|Ninety\s+One|Stanlib|Portfolio\s+Valuation|Portfolio\s+Statement|Investment\s+Statement|Unit\s+Trust\s+Statement/i },
    { code: 'ICICI_IN', name: 'ICICI Bank India', pattern: /\bICICI\b/i },
    { code: 'CHASE_US', name: 'Chase (JPMorgan) United States', pattern: /\bCHASE\b|JPMorgan Chase/i },
    { code: 'BOA_US', name: 'Bank of America United States', pattern: /Bank of America/i },
    { code: 'WELLSFARGO_US', name: 'Wells Fargo United States', pattern: /Wells Fargo/i },
    { code: 'CITIBANK_US', name: 'Citibank United States', pattern: /\bCITIBANK\b|\bCITI\b/i },
  ];


  // Restrict brand search to the header portion (first 4KB) and prefer the earliest hit
  const headerSlice = text.slice(0, 4096);
  const brandMatches = brandKeywords
    .filter((b) => !region || BANK_PATTERNS[b.code]?.country === region)
    .map(b => ({ brand: b, index: headerSlice.search(b.pattern) }))
    .filter(m => m.index >= 0)
    .sort((a, b) => a.index - b.index);

  if (brandMatches.length > 0) {
    const top = brandMatches[0].brand;
    return {
      bankCode: top.code,
      bankName: top.name,
      confidence: 98,
      matchedPatterns: [`brand: ${top.pattern.source}`],
    };
  }

  const normalizedText = text.toUpperCase();
  let bestMatch: DetectionResult | null = null;
  let highestScore = 0;

  for (const [, pattern] of Object.entries(BANK_PATTERNS)) {
    if (region && pattern.country !== region) continue; // region-filter the candidate banks
    let score = 0;
    const matchedPatterns: string[] = [];

    // Check header patterns
    for (const headerPattern of pattern.headerPatterns) {
      if (headerPattern.test(normalizedText)) {
        score += 2;
        matchedPatterns.push(`header: ${headerPattern.source.substring(0, 20)}`);
      }
    }

    // Check footer patterns
    for (const footerPattern of pattern.footerPatterns) {
      if (footerPattern.test(normalizedText)) {
        score += 1;
        matchedPatterns.push(`footer: ${footerPattern.source.substring(0, 20)}`);
      }
    }

    const confidence = Math.min(100, (score / 4) * 100);

    if (score > highestScore) {
      highestScore = score;
      bestMatch = {
        bankCode: pattern.code,
        bankName: pattern.name,
        confidence,
        matchedPatterns,
      };
    }
  }

  if (!bestMatch || highestScore < 2) {
    return {
      bankCode: 'UNKNOWN',
      bankName: 'Unknown Bank',
      confidence: 0,
      matchedPatterns: [],
    };
  }

  return bestMatch;
}

/**
 * Get bank pattern by code
 * @param bankCode Bank code (e.g., 'FNB_SA')
 * @returns Bank pattern or undefined
 */
export function getBankPattern(bankCode: string): BankPattern | undefined {
  return BANK_PATTERNS[bankCode];
}

/**
 * Get all registered bank codes
 */
export function getAllBankCodes(): string[] {
  return Object.keys(BANK_PATTERNS);
}

/**
 * Get all bank patterns
 */
export function getAllBankPatterns(): Record<string, BankPattern> {
  return BANK_PATTERNS;
}

/** Patterns restricted to one country/region (e.g. 'US') — powers region-scoped detection. */
export function getBankPatternsForRegion(country: string): BankPattern[] {
  return Object.values(BANK_PATTERNS).filter((p) => p.country === country);
}

/** The country/region a bank code belongs to, or undefined for UNKNOWN. */
export function getBankRegion(bankCode: string): string | undefined {
  return getBankPattern(bankCode)?.country;
}

/** Map a detected region to the strict money/date profile used by the finance parser. */
export function getFinanceLocaleForCountry(country: string | undefined): 'en-US' | 'en-ZA' | 'de-DE' {
  switch (country) {
    case 'ZA': return 'en-ZA';
    case 'DE': return 'de-DE';
    default: return 'en-US'; // US + anything else defaults to the US profile
  }
}

/**
 * Check if a line matches footer patterns for a bank
 * @param line Line to check
 * @param bankCode Bank code
 * @returns true if line is footer/metadata
 */
export function isFooterLine(line: string, bankCode: string): boolean {
  const pattern = getBankPattern(bankCode);
  if (!pattern) return false;

  return pattern.footerPatterns.some((footerPattern) =>
    footerPattern.test(line),
  );
}

export default {
  detectBank,
  getBankPattern,
  getAllBankCodes,
  getAllBankPatterns,
  getBankPatternsForRegion,
  getBankRegion,
  getFinanceLocaleForCountry,
  isFooterLine,
  BANK_PATTERNS,
};
