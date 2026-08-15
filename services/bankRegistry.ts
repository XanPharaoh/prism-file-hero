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
    ],
    footerPatterns: [
      /Total Debits/i,
      /Total Credits/i,
      /Closing Balance/i,
    ],
    columnHints: ['Date', 'Particulars', 'Debit', 'Credit', 'Balance'],
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
    ],
    footerPatterns: [
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
    ],
    footerPatterns: [
      /African Bank Limited/i,
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
};

/**
 * Detect which bank a statement belongs to
 * @param text Full statement text
 * @returns DetectionResult with bank info and confidence
 */
export function detectBank(text: string): DetectionResult {
  const brandKeywords: Array<{ code: string; name: string; pattern: RegExp }> = [
    { code: 'CAPITEC_SA', name: 'Capitec Bank South Africa', pattern: /\bCapitec\b/i },
    { code: 'FNB_SA', name: 'FNB South Africa', pattern: /First\s+National\s+Bank|\bFNB\b/i },
    { code: 'NEDBANK_SA', name: 'Nedbank South Africa', pattern: /\bNedbank\b/i },
    { code: 'ABSA_SA', name: 'ABSA South Africa', pattern: /\bABSA\b/i },
    { code: 'STANDARD_BANK_SA', name: 'Standard Bank South Africa', pattern: /Standard\s+Bank|\bSBSA\b/i },
    { code: 'TYMEBANK_SA', name: 'TymeBank South Africa', pattern: /Tyme\s*Bank|TymeBank|\b678910\b/i },
    { code: 'INVESTEC_SA', name: 'Investec South Africa', pattern: /\bInvestec\b/i },
    { code: 'DISCOVERY_BANK_SA', name: 'Discovery Bank South Africa', pattern: /Discovery\s+Bank/i },
    { code: 'AFRICAN_BANK_SA', name: 'African Bank South Africa', pattern: /African\s+Bank/i },
    { code: 'ICICI_IN', name: 'ICICI Bank India', pattern: /\bICICI\b/i },
  ];

  // Restrict brand search to the header portion (first 4KB) and prefer the earliest hit
  const headerSlice = text.slice(0, 4096);
  const brandMatches = brandKeywords
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
  isFooterLine,
  BANK_PATTERNS,
};
