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
  /** Accept a currency symbol that is not the profile's own. Default false (reject foreign). */
  allowForeignCurrency?: boolean;
}

/** Rounding policy for sub-cent precision: explicit HALF-UP to the cent. Documented, not accidental. */
export type MoneyErrorCode =
  | 'MISSING' | 'FOREIGN_CURRENCY' | 'CONFLICTING_SEPARATORS' | 'MALFORMED' | 'OUT_OF_RANGE';

export type MoneyResult =
  | { ok: true; cents: number; rounded: boolean; currency: string }
  | { ok: false; code: MoneyErrorCode };

// Symbols we can recognise; mapped to a currency code so foreign ones can be rejected.
const SYMBOL_TO_CURRENCY: Record<string, string> = {
  '$': 'USD', 'R': 'ZAR', '£': 'GBP', '€': 'EUR', '¥': 'JPY',
};

/**
 * Parse a monetary string into INTEGER CENTS using decimal/BigInt digit math — NO
 * `Number * 100`, so there is no binary-float rounding error (1.005 and 0.1+0.2 are exact).
 * Enforces the profile's separator conventions: a '.'-decimal profile REJECTS a lone
 * decimal comma ('200,00') and a comma-after-period ('1.234,56') instead of silently
 * producing a different number, and rejects a foreign currency symbol unless allowed.
 * Sub-cent precision is resolved with the documented HALF-UP policy and flagged `rounded`.
 */
export function parseMoneyDetailed(raw: unknown, opts: AmountOptions = {}): MoneyResult {
  const profile = PROFILES[opts.locale ?? 'en-US'];
  const allowForeign = opts.allowForeignCurrency === true;

  if (raw === null || raw === undefined) return { ok: false, code: 'MISSING' };

  let s: string;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false, code: 'MISSING' };
    s = String(raw); // shortest round-trip, then parse as text (no float*100)
  } else {
    s = String(raw).trim();
  }
  if (s === '' || /^(n\/?a|na|-|\s+)$/.test(s)) return { ok: false, code: 'MISSING' };

  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) { negative = true; s = s.slice(1, -1).trim(); } // accounting parens

  const allowBanking = opts.allowBankingSigns !== false;
  if (allowBanking) {
    if (/\bd(r|ebit)\b$/i.test(s)) { negative = true; s = s.replace(/\s*\bd(r|ebit)\b$/i, ''); }
    else if (/\bc(r|redit)\b$/i.test(s)) { s = s.replace(/\s*\bc(r|redit)\b$/i, ''); }
  }
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  else if (s.endsWith('-')) { negative = true; s = s.slice(0, -1); }

  const symbols = Array.from(new Set(s.match(/[$R£€¥]/g) || []));
  if (symbols.length > 1) return { ok: false, code: 'MALFORMED' };
  if (symbols.length === 1 && SYMBOL_TO_CURRENCY[symbols[0]] !== profile.currency && !allowForeign) {
    return { ok: false, code: 'FOREIGN_CURRENCY' };
  }
  s = s.replace(/[$R£€¥\s]/g, '');

  const norm = normalizeSeparators(s, profile.decimal, profile.thousand);
  if (norm.ok === false) return { ok: false, code: norm.code };
  let { intDigits, fracDigits } = norm;
  if (!/^\d*$/.test(intDigits) || !/^\d*$/.test(fracDigits)) return { ok: false, code: 'MALFORMED' };
  if (intDigits === '' && fracDigits === '') return { ok: false, code: 'MALFORMED' };
  intDigits = intDigits || '0';

  // HALF-UP rounding of sub-cent precision to 2 decimals, via string/BigInt (no float).
  let rounded = false;
  if (fracDigits.length > 2) {
    rounded = true;
    const nextDigit = fracDigits.charCodeAt(2) - 48;
    let centsFrac = Number(fracDigits.slice(0, 2));
    if (nextDigit >= 5) centsFrac += 1;
    if (centsFrac >= 100) { intDigits = (BigInt(intDigits) + 1n).toString(); centsFrac -= 100; }
    fracDigits = String(centsFrac).padStart(2, '0');
  } else {
    fracDigits = fracDigits.padEnd(2, '0');
  }

  let cents: number;
  try { cents = Number(BigInt(intDigits) * 100n + BigInt(fracDigits || '0')); }
  catch { return { ok: false, code: 'MALFORMED' }; }
  if (!Number.isSafeInteger(cents)) return { ok: false, code: 'OUT_OF_RANGE' };
  const signed = negative ? -cents : cents;
  if (!Number.isSafeInteger(signed)) return { ok: false, code: 'OUT_OF_RANGE' };
  return { ok: true, cents: signed, rounded, currency: profile.currency };
}

/**
 * Validate + split a numeric string under a profile's decimal/thousand separators.
 * Rejects conflicting separators (a decimal comma in a '.'-decimal profile, a comma after
 * a period, doubled separators, or malformed thousands grouping).
 */
function normalizeSeparators(
  s: string, decimal: '.' | ',', thousand: ',' | '.'
): { ok: true; intDigits: string; fracDigits: string } | { ok: false; code: MoneyErrorCode } {
  if (s === '') return { ok: false, code: 'MALFORMED' };
  const wrong = decimal === '.' ? ',' : '.';
  const decCount = (s.match(new RegExp(`\\${decimal}`, 'g')) || []).length;
  const wrongCount = (s.match(new RegExp(`\\${wrong}`, 'g')) || []).length;
  if (decCount > 1) return { ok: false, code: 'MALFORMED' };

  // Decimal present: thousand-separators may only group the integer part, in exact 3s.
  if (decCount === 1) {
    const [left, right] = s.split(new RegExp(`\\${decimal}`));
    if (right.includes(wrong)) return { ok: false, code: 'CONFLICTING_SEPARATORS' };
    if (left.includes(wrong)) {
      const groups = left.split(new RegExp(`\\${wrong}`));
      for (let i = 1; i < groups.length; i++) if (groups[i].length !== 3) return { ok: false, code: 'CONFLICTING_SEPARATORS' };
    }
    return { ok: true, intDigits: left.split(wrong).join(''), fracDigits: right };
  }

  // No decimal: the `wrong` char may only be thousands grouping (3-digit trailing groups).
  if (wrongCount > 0) {
    const groups = s.split(new RegExp(`\\${wrong}`));
    for (let i = 1; i < groups.length; i++) if (groups[i].length !== 3) return { ok: false, code: 'CONFLICTING_SEPARATORS' };
  }
  return { ok: true, intDigits: s.split(wrong).join(''), fracDigits: '' };
}

/** Thin wrapper: integer cents or null on any error (used by validators + math). */
export function toCents(raw: unknown, opts: AmountOptions = {}): number | null {
  const r = parseMoneyDetailed(raw, opts);
  return r.ok ? r.cents : null;
}

/**
 * Exact decimal `value` from a monetary string, computed via integer cents (never `Number*100`).
 * Returns null on ANY strict-parse failure (malformed grouping, conflicting separators, foreign
 * symbol under policy, out-of-safe-range) so a caller NEVER silently gets a wrong number. The
 * division `cents/100` is the shortest round-trip display value; authoritative math stays in cents.
 */
export function moneyToNumber(raw: unknown, opts: AmountOptions = {}): number | null {
  const r = parseMoneyDetailed(raw, opts);
  if (!r.ok) return null;
  const abs = Math.abs(r.cents);
  return r.cents < 0 ? -(abs / 100) : abs / 100;
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
