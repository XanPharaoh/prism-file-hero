/**
 * Locale-aware money parser. Handles ZA (R 1 234.56), EU (1.234,56), US (1,234.56).
 * Locale hint comes from bankRegistry (ZA banks → 'za-ZAR', etc.)
 */

import { moneyToNumber } from '../shared/finance/locale';

export type MoneyLocale = 'za-ZAR' | 'en-US' | 'de-DE' | 'auto';

export interface ParsedMoney {
  value: number;
  sign: 1 | -1;
  hasCreditMarker: boolean;  // 'CR', 'Cr', '+'
  hasDebitMarker: boolean;   // 'DR', 'Dr', '-', '(…)'
  currencyHint: string | null;
}

/**
 * Parse a money string with locale awareness.
 * Returns null if unparseable (do NOT silently return 0).
 */
export function parseMoney(raw: string | null | undefined, locale: MoneyLocale = 'auto'): ParsedMoney | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (s.length === 0 || s === '-') return null;

  // Detect sign/markers BEFORE stripping
  let sign: 1 | -1 = 1;
  let hasCreditMarker = false;
  let hasDebitMarker = false;

  const wrappedNeg = /^\((.+)\)$/.exec(s);
  if (wrappedNeg) { sign = -1; hasDebitMarker = true; }

  let working = s;
  if (/\bCR\b|\bCr\b/i.test(working)) { hasCreditMarker = true; working = working.replace(/\bCR\b|\bCr\b/gi, ''); }
  if (/\bDR\b|\bDr\b/i.test(working)) { hasDebitMarker = true; sign = -1; working = working.replace(/\bDR\b|\bDr\b/gi, ''); }

  // Strip currency symbols + capture hint
  let currencyHint: string | null = null;
  const currMatch = working.match(/\b(ZAR|USD|EUR|GBP|R|€|\$|£)\b/i);
  if (currMatch) currencyHint = currMatch[1].toUpperCase();
  working = working.replace(/[R$€£]/g, '').trim();

  // Determine decimal convention based on locale + string shape
  const lastComma = working.lastIndexOf(',');
  const lastDot = working.lastIndexOf('.');

  let normalized: string;
  if (locale === 'de-DE' || (locale === 'auto' && lastComma > lastDot && /\d{1,2}$/.test(working.slice(lastComma + 1)))) {
    // EU style: 1.234,56
    normalized = working.replace(/\./g, '').replace(',', '.');
  } else if (locale === 'za-ZAR' || locale === 'en-US' || locale === 'auto') {
    // ZA/US style: 1,234.56 OR 1 234.56 (space as thousands)
    normalized = working.replace(/[\s,]/g, '');
  } else {
    normalized = working.replace(/[\s,]/g, '');
  }

  // Handle leading sign
  if (normalized.startsWith('-')) { sign = -1; hasDebitMarker = true; normalized = normalized.slice(1); }
  else if (normalized.startsWith('+')) { normalized = normalized.slice(1); }

  const value = moneyToNumber(normalized, { locale: 'en-US', allowForeignCurrency: true });
  if (value === null) return null;
  if (value === 0 && !/0(\.0+)?$/.test(normalized)) return null;  // reject garbage zeros

  return { value, sign, hasCreditMarker, hasDebitMarker, currencyHint };
}

/**
 * Convenience: parse to a signed number or null.
 */
export function parseMoneySigned(raw: string | null | undefined, locale: MoneyLocale = 'auto'): number | null {
  const p = parseMoney(raw, locale);
  return p ? p.sign * p.value : null;
}
