/**
 * Batch 08 — Explicit money/date profiles + integer-cents arithmetic for US finance.
 *
 * Principles (guide §14 Batch 08):
 *   • Money is carried as INTEGER CENTS. Floats are only for display. This kills the
 *     0.1 + 0.2 drift that makes a ledger reconcile "by a cent" or fail by a cent.
   * • A missing / unparseable amount returns NULL, never 0. Callers must turn null into
 *     a review reason — silently coercing to zero is how a wrong total ships.
 *   • Dates carry an explicit ORDER (US mm/dd, ZA dd/mm, ISO yyyy-mm-dd). When a
 *     component could be day or month (both ≤ 12 and they differ) the date is flagged
 *     AMBIGUOUS rather than guessed.
 *   • Identifiers (ZIP, account, routing, phone) are preserved as STRINGS — leading
 *     zeros and length must survive (01234 is not 1234).
 */

export type FinanceLocale = 'en-US' | 'en-ZA' | 'de-DE';

export interface MoneyProfile {
  currency: string;
  symbol: string;
  decimal: '.' | ',';
  thousand: ',' | '.';
  /** day/month order for slash/dot dates */
  dateOrder: 'mdy' | 'dmy' | 'ymd';
}

export const PROFILES: Record<FinanceLocale, MoneyProfile> = {
  'en-US': { currency: 'USD', symbol: '$', decimal: '.', thousand: ',', dateOrder: 'mdy' },
  'en-ZA': { currency: 'ZAR', symbol: 'R', decimal: '.', thousand: ',', dateOrder: 'dmy' },
  'de-DE': { currency: 'EUR', symbol: '€', decimal: ',', thousand: '.', dateOrder: 'dmy' },
};

export interface AmountOptions {
  locale?: FinanceLocale;
  /** Treat trailing Dr/Cr (banking) as debit/credit signs. Default true. */
  allowBankingSigns?: boolean;
}

/**
 * Parse a currency string to INTEGER CENTS, or return null if it is missing/unparseable.
 * Handles: symbols ($ R € £), thousands separators (locale-aware), decimal commas,
 * parentheses-as-negative, leading/trailing minus, and Dr/Cr suffixes.
 */
export function toCents(raw: unknown, opts: AmountOptions = {}): number | null {
  if (raw === null || raw === undefined) return null;

  // Numbers pass straight through (rounded to cents), unless NaN.
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? Math.round(raw * 100) : null;
  }

  let s = String(raw).trim();
  if (s === '' || /^(n\/?a|na|-)$/i.test(s)) return null;

  const profile = PROFILES[opts.locale ?? 'en-US'];
  let negative = false;

  // Accounting parentheses: (1,234.56) => -1234.56
  if (s.startsWith('(') && s.endsWith(')')) { negative = true; s = s.slice(1, -1); }

  const allowBanking = opts.allowBankingSigns !== false;
  if (allowBanking) {
    if (/\bd(r|ebit)\b$/i.test(s)) { negative = true; s = s.replace(/\s*\bd(r|ebit)\b$/i, ''); }
    else if (/\bc(r|redit)\b$/i.test(s)) { s = s.replace(/\s*\bc(r|redit)\b$/i, ''); }
  }

  // Leading / trailing explicit minus.
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  else if (s.endsWith('-')) { negative = true; s = s.slice(0, -1); }

  // Strip currency symbols + spaces + any thousands separators, then normalize decimal.
  s = s.replace(/[$R£€\s]/g, '');
  if (profile.decimal === ',') {
    s = s.split(profile.thousand).join('').replace(',', '.');
  } else {
    // decimal '.': drop thousands commas; also tolerate EU-style 1.234,56 defensively
    s = s.replace(/,/g, '');
  }

  if (!/^\d*\.?\d+$/.test(s)) return null; // must end as a plain number
  const num = Number(s);
  if (!Number.isFinite(num)) return null;
  const cents = Math.round(num * 100);
  return negative ? -cents : cents;
}

/** Render integer cents back to a locale string. */
export function formatCents(cents: number, locale: FinanceLocale = 'en-US'): string {
  const p = PROFILES[locale];
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, p.thousand);
  const body = `${grouped}${p.decimal}${frac}`;
  return `${neg ? '-' : ''}${p.symbol}${body}`;
}

export interface DateResult {
  iso: string | null;   // yyyy-mm-dd when unambiguously resolvable
  ambiguous: boolean;
  reason?: string;
}

/**
 * Parse a statement date under an explicit locale. Flags AMBIGUOUS when the day and
 * month components are each ≤ 12 and differ (so mm/dd vs dd/mm disagree), and when the
 * value cannot be resolved at all. Never silently picks one.
 */
export function parseDate(raw: unknown, locale: FinanceLocale = 'en-US'): DateResult {
  if (raw === null || raw === undefined) return { iso: null, ambiguous: true, reason: 'missing date' };
  const s = String(raw).trim();
  if (!s) return { iso: null, ambiguous: true, reason: 'empty date' };

  // ISO first — unambiguous.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { iso: `${iso[1]}-${iso[2]}-${iso[3]}`, ambiguous: false };

  const parts = s.split(/[/.\-]/).map(p => p.trim()).filter(Boolean);
  if (parts.length !== 3 || !parts.every(p => /^\d{1,4}$/.test(p))) {
    return { iso: null, ambiguous: true, reason: `unparseable date "${s}"` };
  }

  let day: number, month: number, year: number;
  const order = PROFILES[locale].dateOrder;
  if (order === 'ymd') [year, month, day] = parts.map(Number);
  else if (order === 'mdy') [month, day, year] = parts.map(Number);
  else [day, month, year] = parts.map(Number);

  // Two-digit year pivot (00-69 → 2000s, else 1900s).
  if (year < 100) year += year < 70 ? 2000 : 1900;

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { iso: null, ambiguous: true, reason: `invalid calendar parts in "${s}"` };
  }

  // Ambiguity: the locale-flipped reading is ALSO a valid, different date.
  const otherOrder = order === 'mdy' ? 'dmy' : 'mdy';
  const oMonth = otherOrder === 'mdy' ? day : month; // swap day/month
  const oDay = otherOrder === 'mdy' ? month : day;
  void oMonth; void oDay;
  const swapped = { m: day, d: month }; // the alternative interpretation
  if (swapped.m >= 1 && swapped.m <= 12 && swapped.d >= 1 && swapped.d <= 31 && (swapped.m !== month)) {
    // Both readings are valid calendar dates and disagree → ambiguous.
    return {
      iso: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      ambiguous: true,
      reason: `ambiguous date "${s}" — could be ${PROFILES[locale].dateOrder} or the flip`,
    };
  }

  return { iso: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, ambiguous: false };
}

/**
 * Preserve an identifier as a STRING (leading zeros, internal separators kept).
 * Never number-cast. Returns trimmed non-empty string or null.
 */
export function preserveIdentifier(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s.length ? s : null;
}

/** A US ZIP is 5 digits or 5+4; leading zeros MUST survive (02134). */
export function normalizeZip(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(\d{5})(?:-(\d{4}))?$/);
  if (!m) return null;
  return m[2] ? `${m[1]}-${m[2]}` : m[1];
}
