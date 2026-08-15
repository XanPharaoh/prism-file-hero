/**
 * Multi-Currency Parser
 * 
 * Purpose:
 * - Parse amounts in multiple currencies (R, $, €, £, ₹, etc.)
 * - Handle different number formats (1,000 vs 1.000)
 * - Normalize grouping and decimal separators
 * - Strip Cr/Dr/Dr suffixes
 * - Return normalized numeric value with currency code
 * 
 * Supported Currencies:
 * - ZAR (R, ZAR)
 * - USD ($, USD)
 * - EUR (€, EUR)
 * - GBP (£, GBP)
 * - INR (₹, INR)
 * - Many more...
 */

export interface ParsedAmount {
  value: number | null;
  currency: string;
  format: string;
  isNegative: boolean;
  isCr: boolean; // Credit indicator
  isDr: boolean; // Debit indicator
  raw: string;
  confidence: number; // 0-100
}

/**
 * Currency symbol to code mapping
 */
const CURRENCY_MAP: Record<string, string> = {
  r: 'ZAR',
  'r ': 'ZAR',
  zar: 'ZAR',
  '$': 'USD',
  'usd': 'USD',
  '€': 'EUR',
  'eur': 'EUR',
  '£': 'GBP',
  'gbp': 'GBP',
  '₹': 'INR',
  'inr': 'INR',
  '¥': 'CNY',
  'cny': 'CNY',
  '₽': 'RUB',
  'rub': 'RUB',
  '₩': 'KRW',
  'krw': 'KRW',
  '฿': 'THB',
  'thb': 'THB',
  '₴': 'UAH',
  'uah': 'UAH',
  '₪': 'ILS',
  'ils': 'ILS',
  'chf': 'CHF',
  'cad': 'CAD',
  'aud': 'AUD',
  'nzd': 'NZD',
  'sgd': 'SGD',
  'hkd': 'HKD',
  'jpy': 'JPY',
  'mxn': 'MXN',
  'php': 'PHP',
  'idr': 'IDR',
  'myr': 'MYR',
  'vnd': 'VND',
};

/**
 * Detect currency from amount string
 */
export function detectCurrency(text: string): string {
  const normalized = text.toLowerCase().trim();

  // Check for currency symbols first
  for (const [key, code] of Object.entries(CURRENCY_MAP)) {
    if (normalized.includes(key)) {
      return code;
    }
  }

  // Default to ZAR for South African context
  return 'ZAR';
}

/**
 * Remove currency symbol and suffix indicators
 */
function stripCurrencySymbols(text: string): string {
  let cleaned = text.trim();

  // Remove leading/trailing currency symbols
  // CRITICAL: Use word-boundary or lookahead to avoid stripping 'r' from 'Dr' suffix.
  // Only strip 'R' when followed by a digit, space, or end-of-string (i.e., the Rand symbol, not a suffix letter).
  cleaned = cleaned.replace(/^R(?=[\d\s]|$)/i, '').trim();
  cleaned = cleaned.replace(/R(?=[\s\d]|$)$/i, '').trim();
  // Strip actual symbols (€, £, etc.) — these never appear in Cr/Dr suffixes
  cleaned = cleaned.replace(/^[€£₹₽¥฿₴₪$]/, '').trim();
  cleaned = cleaned.replace(/[€£₹₽¥฿₴₪$]$/, '').trim();

  // Remove currency codes (USD, EUR, etc.)
  cleaned = cleaned.replace(/^(usd|eur|gbp|zar|inr|cny|rub|krw|thb|uah|ils|chf|cad|aud|nzd|sgd|hkd|jpy|mxn|php|idr|myr|vnd)\s*/i, '').trim();
  cleaned = cleaned.replace(/\s*(usd|eur|gbp|zar|inr|cny|rub|krw|thb|uah|ils|chf|cad|aud|nzd|sgd|hkd|jpy|mxn|php|idr|myr|vnd)$/i, '').trim();

  return cleaned;
}

/**
 * Check if amount has Cr (Credit) indicator
 */
function hasCrIndicator(text: string): boolean {
  return /\bcr\b|\(cr\)/i.test(text);
}

/**
 * Check if amount has Dr (Debit) indicator
 */
function hasDrIndicator(text: string): boolean {
  return /\bdr\b|\(dr\)/i.test(text);
}

/**
 * Normalize number format to standard decimal
 * Handles: 1,000.00 and 1.000,00 formats
 */
function normalizeNumber(text: string): string {
  let cleaned = stripCurrencySymbols(text);

  // Remove indicators (Cr, Dr)
  cleaned = cleaned.replace(/\b(cr|dr)\b/gi, '').trim();
  cleaned = cleaned.replace(/\((cr|dr)\)/gi, '').trim();

  // Handle negative (either leading minus or parentheses)
  const isNegative = /^-|^\(|^\[/.test(cleaned);

  // Remove parentheses/brackets
  cleaned = cleaned.replace(/^[\(\[\-]/, '').replace(/[\)\]\-]$/, '').trim();

  // Now determine decimal separator
  // Strategy: rightmost separator is decimal (usually), count digits after it
  const lastCommaPos = cleaned.lastIndexOf(',');
  const lastDotPos = cleaned.lastIndexOf('.');

  let result = cleaned;

  if (lastCommaPos > lastDotPos) {
    // Comma is decimal separator (European: 1.000,00)
    // Remove dots, replace comma with dot
    result = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDotPos > lastCommaPos) {
    // Dot is decimal separator (US: 1,000.00)
    // Remove commas, keep dot
    result = cleaned.replace(/,/g, '');
  } else if (lastCommaPos > -1) {
    // Only comma exists, check if it's thousands or decimal
    const afterComma = cleaned.substring(lastCommaPos + 1);
    if (afterComma.length !== 2) {
      // Not a decimal (not 2 digits), so it's thousands
      result = cleaned.replace(/,/g, '');
    } else {
      // Likely decimal
      result = cleaned.replace(/,/g, '.');
    }
  }

  // Add back negative sign if needed
  if (isNegative && !result.startsWith('-')) {
    result = '-' + result;
  }

  return result;
}

/**
 * Parse amount from string
 * @param amountStr Raw amount string (e.g., "1,234.56", "1.234,56", "R 1000")
 * @returns ParsedAmount with numeric value, currency, and indicators
 */
export function parseAmount(amountStr: string): ParsedAmount {
  const raw = amountStr.trim();

  if (!raw) {
    return {
      value: null,
      currency: 'ZAR',
      format: 'EMPTY',
      isNegative: false,
      isCr: false,
      isDr: false,
      raw,
      confidence: 0,
    };
  }

  // Detect currency
  const currency = detectCurrency(raw);

  // Check for Cr/Dr indicators
  const isCr = hasCrIndicator(raw);
  const isDr = hasDrIndicator(raw);

  // Normalize number
  const normalized = normalizeNumber(raw);

  // Parse numeric value
  const numericValue = parseFloat(normalized);

  if (isNaN(numericValue)) {
    return {
      value: null,
      currency,
      format: 'INVALID',
      isNegative: false,
      isCr,
      isDr,
      raw,
      confidence: 0,
    };
  }

  // Check if negative
  const isNegative = numericValue < 0;

  // Return absolute value (sign determined by isCr/isDr/isNegative)
  const value = Math.abs(numericValue);

  return {
    value,
    currency,
    format: 'NUMERIC',
    isNegative,
    isCr,
    isDr,
    raw,
    confidence: 95,
  };
}

/**
 * Parse amount and return signed numeric value
 * Cr = positive, Dr = negative (accounting convention)
 */
export function parseAmountSigned(amountStr: string): number | null {
  const parsed = parseAmount(amountStr);

  if (!parsed.value) return null;

  let signedValue = parsed.value;

  // Apply sign logic (accounting: Cr = positive, Dr = negative)
  if (parsed.isCr) {
    signedValue = Math.abs(signedValue); // Ensure positive
  } else if (parsed.isDr) {
    signedValue = -Math.abs(signedValue); // Make negative
  } else if (parsed.isNegative) {
    signedValue = -Math.abs(signedValue); // Use negative indicator
  }

  return signedValue;
}

/**
 * Format amount to standard string
 */
export function formatAmount(
  value: number,
  currency: string = 'ZAR',
  decimals: number = 2,
): string {
  if (!value && value !== 0) return '';

  const formatted = Math.abs(value).toFixed(decimals);
  const sign = value < 0 ? '-' : '';
  const currencySymbol = Object.keys(CURRENCY_MAP).find(
    (k) => CURRENCY_MAP[k] === currency,
  ) || currency;

  return `${sign}${currencySymbol} ${formatted}`;
}

export default {
  parseAmount,
  parseAmountSigned,
  formatAmount,
  detectCurrency,
};
