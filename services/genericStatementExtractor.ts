/**
 * Generic statement extractor: header detection → role assignment → row assembly
 * with multi-line description continuation + balance-delta direction fallback +
 * reconciliation scoring.
 *
 * Replaces the toy regex "first money = amount, second money = balance" sketch.
 */

import type {
  CanonicalStatement, CanonicalTransaction, Direction, LayoutProfile
} from './statementSchema';
import { parseMoney } from './moneyLocale';
import { classifyLayout, type LayoutClassification } from './layoutClassifier';

export interface GenericExtractorOptions {
  bankCode?: string | null;
  bankName?: string | null;
  openingBalance?: number | null;
  closingBalance?: number | null;
  accountNumber?: string | null;
  branchCode?: string | null;
  statementPeriod?: string | null;
  currency?: string | null;
  locale?: 'za-ZAR' | 'en-US' | 'de-DE' | 'auto';
  headerLineIndex?: number | null;  // skip lines up to here
}

// Date patterns covering ZA (DD Mon YYYY, YYYY/MM/DD), US (MM/DD/YYYY), EU (DD.MM.YYYY)
const DATE_PATTERNS: RegExp[] = [
  /\b(\d{4}[-/]\d{2}[-/]\d{2})\b/,                                  // 2026-01-31 / 2026/01/31
  /\b(\d{2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})\b/i, // 01 Nov 2025
  /\b(\d{2}[-/]\d{2}[-/]\d{4})\b/,                                  // 31-01-2026 / 01/31/2026
  /\b(\d{2}\.\d{2}\.\d{4})\b/,                                      // 31.01.2026
];

function normalizeDate(s: string): string | null {
  const d = new Date(s.replace(/\./g, '-'));
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function extractDate(line: string): { iso: string | null; raw: string | null } {
  for (const p of DATE_PATTERNS) {
    const m = line.match(p);
    if (m) return { iso: normalizeDate(m[1]), raw: m[1] };
  }
  return { iso: null, raw: null };
}

const NOISE_FOOTER_PATTERNS: RegExp[] = [
  /^(page|end of statement|statement continues|disclaimer|tymebank is a licensed|client care|vat reg|www\.|http)/i,
  /^\s*[-_=]{3,}\s*$/,
  /^\s*\d+\s*$/,  // lone page numbers
];

function isNoise(line: string): boolean {
  const t = line.trim();
  if (t.length < 2) return true;
  return NOISE_FOOTER_PATTERNS.some(p => p.test(t));
}

export function extractGenericStatement(
  text: string,
  opts: GenericExtractorOptions = {}
): CanonicalStatement {
  const locale = opts.locale ?? 'auto';
  const classification: LayoutClassification = classifyLayout(text);
  const profile: LayoutProfile = classification.profile;

  const lines = text.split(/\r?\n/);
  const skipUntil = (opts.headerLineIndex ?? classification.headerLineIndex ?? -1) + 1;

  // Extract rows
  const txs: CanonicalTransaction[] = [];
  let pending: Partial<CanonicalTransaction> | null = null;
  let parseErrors = 0;

  const flushPending = () => {
    if (!pending || !pending.date) { pending = null; return; }
    txs.push(finalizeRow(pending as CanonicalTransaction, profile, locale));
    pending = null;
  };

  for (let i = skipUntil; i < lines.length; i++) {
    const raw = lines[i];
    if (isNoise(raw)) { flushPending(); continue; }

    const { iso: dateIso, raw: dateRaw } = extractDate(raw);

    if (dateIso || dateRaw) {
      flushPending();
      pending = {
        date: dateIso,
        description: '',
        debit: null, credit: null, fees: null, balance: null, amount: null,
        direction: 'UNKNOWN',
        currency: opts.currency ?? null,
        raw,
        page: 1,
        confidence: 0,
      };
      // Strip the date from the line to leave description + amounts
      let remainder = dateRaw ? raw.replace(dateRaw, '') : raw;
      parseRemainder(remainder, pending, profile, locale);
    } else if (pending) {
      // Continuation line — append to description
      pending.description = ((pending.description ?? '') + ' ' + raw).trim();
    }
  }
  flushPending();

  // Stats
  const rowsWithValidDate = txs.filter(t => t.date).length;
  const rowsWithValidMoney = txs.filter(t =>
    t.debit !== null || t.credit !== null || t.amount !== null || t.fees !== null
  ).length;
  const headerRolesMatched = profile !== 'UNKNOWN' && classification.confidence >= 0.5;

  // Reconciliation
  const opening = opts.openingBalance ?? null;
  const closing = opts.closingBalance ?? null;
  let expected: number | null = null;
  let delta: number | null = null;
  let isValidRecon = false;

  if (opening !== null) {
    let run = opening;
    for (const t of txs) {
      const debit = t.debit ?? 0;
      const credit = t.credit ?? 0;
      const fees = t.fees ?? 0;
      const amt = t.amount ?? 0;
      run = run - debit + credit - fees + amt;
    }
    expected = Number(run.toFixed(2));
    if (closing !== null) {
      delta = Number((expected - closing).toFixed(2));
      isValidRecon = Math.abs(delta) < 0.05;
    }
  }

  // Computed statement-level confidence (from the critical review)
  const rows = txs.length;
  const computedConfidence = rows === 0 ? 0 :
    0.25 * Math.min(1, rowsWithValidDate / rows) +
    0.25 * Math.min(1, rowsWithValidMoney / rows) +
    0.20 * (headerRolesMatched ? 1 : 0) +
    0.20 * (isValidRecon ? 1 : closing !== null && delta !== null
            ? Math.max(0, 1 - Math.abs(delta) / Math.max(Math.abs(opening ?? 1), 1))
            : 0.3) +
    0.10 * (opts.bankCode ? 1 : 0.5);

  return {
    bankCode: opts.bankCode ?? null,
    bankName: opts.bankName ?? null,
    layoutProfile: profile,
    openingBalance: opening,
    closingBalance: closing,
    accountNumber: opts.accountNumber ?? null,
    branchCode: opts.branchCode ?? null,
    statementPeriod: opts.statementPeriod ?? null,
    currency: opts.currency ?? null,
    transactions: txs,
    reconcile: { expected, actual: closing, delta, isValid: isValidRecon },
    computedConfidence: Number(computedConfidence.toFixed(3)),
    pagesProcessed: 1,
    rowsWithValidDate,
    rowsWithValidMoney,
    headerRolesMatched,
    parseErrors,
  };
}

/**
 * Parse the non-date remainder of a line into money columns based on profile.
 */
function parseRemainder(
  remainder: string,
  pending: Partial<CanonicalTransaction>,
  profile: LayoutProfile,
  locale: 'za-ZAR' | 'en-US' | 'de-DE' | 'auto'
) {
  // Extract all money tokens in order
  const moneyRegex = /[+-]?(?:[R$€£]\s*)?(?:\d{1,3}(?:[\s.,]\d{3})*|\d+)(?:[.,]\d{2})?(?:\s*(?:CR|DR|Cr|Dr))?/gi;
  const tokens = (remainder.match(moneyRegex) ?? [])
    .map(t => t.trim())
    .filter(t => t.length > 0 && t !== '-' && parseMoney(t, locale) !== null);

  // Everything BEFORE the first money token is description
  const firstMoneyIdx = tokens.length > 0 ? remainder.indexOf(tokens[0]) : -1;
  const desc = firstMoneyIdx > 0 ? remainder.slice(0, firstMoneyIdx).trim() : remainder.trim();
  pending.description = desc.replace(/\s+/g, ' ');

  // Map tokens → roles based on profile (positional, right-to-left)
  const values = tokens.map(t => parseMoney(t, locale)!);
  const N = values.length;

  switch (profile) {
    case 'MONEY_IN_OUT_FEES': {
      // Expected order (left→right): Fees?, Money Out?, Money In?, Balance
      // Balance is LAST. Money Out/In determined by keyword or position.
      if (N >= 1) pending.balance = values[N - 1].sign * values[N - 1].value;
      if (N >= 2) {
        // 2nd-to-last is the "main" money column
        const main = values[N - 2];
        if (/fee|charge/i.test(pending.description ?? '')) {
          pending.fees = main.value;
        } else if (/payshap|reversal|sendmoney|deposit|paid in/i.test(pending.description ?? '')) {
          pending.credit = main.value;
        } else {
          pending.debit = main.value;
        }
      }
      if (N >= 3) {
        // 3rd-to-last: could be fees OR the other money column
        const third = values[N - 3];
        if (pending.fees === null && /fee/i.test(pending.description ?? '')) {
          pending.fees = third.value;
        }
      }
      break;
    }
    case 'DEBIT_CREDIT_BALANCE': {
      // Balance last. Then one or both of debit/credit.
      if (N >= 1) pending.balance = values[N - 1].sign * values[N - 1].value;
      if (N >= 2) {
        // Two remaining values: assign by sign marker if present, else position
        const a = values[N - 2], b = N >= 3 ? values[N - 3] : null;
        if (a.hasDebitMarker) pending.debit = a.value;
        else if (a.hasCreditMarker) pending.credit = a.value;
        else pending.debit = a.value;  // default to debit if ambiguous
        if (b) {
          if (b.hasCreditMarker) pending.credit = b.value;
          else if (b.hasDebitMarker) pending.debit = b.value;
          else pending.credit = b.value;
        }
      }
      break;
    }
    case 'SINGLE_SIGNED_AMOUNT':
    default: {
      // Balance last, amount 2nd-to-last
      if (N >= 1) pending.balance = values[N - 1].sign * values[N - 1].value;
      if (N >= 2) {
        const a = values[N - 2];
        pending.amount = a.sign * a.value;
      }
      break;
    }
  }
}

function finalizeRow(
  row: CanonicalTransaction,
  profile: LayoutProfile,
  _locale: 'za-ZAR' | 'en-US' | 'de-DE' | 'auto'
): CanonicalTransaction {
  // Determine direction
  let direction: Direction = row.direction;
  if (direction === 'UNKNOWN') {
    if (row.fees !== null && row.fees > 0 && row.debit === null && row.credit === null && row.amount === null) {
      direction = 'FEE';
    } else if (row.credit !== null && row.credit > 0) {
      direction = 'CREDIT';
    } else if (row.debit !== null && row.debit > 0) {
      direction = 'DEBIT';
    } else if (row.amount !== null) {
      direction = row.amount >= 0 ? 'CREDIT' : 'DEBIT';
    }
  }

  // Per-row confidence: 0.4 for date + 0.4 for any money + 0.2 for description
  const rowConf =
    (row.date ? 0.4 : 0) +
    ((row.debit ?? row.credit ?? row.amount ?? row.fees) !== null ? 0.4 : 0) +
    (row.description && row.description.length > 2 ? 0.2 : 0);

  return { ...row, direction, confidence: Number(rowConf.toFixed(2)) };
}
