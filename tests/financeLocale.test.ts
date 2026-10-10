import { describe, it, expect } from 'vitest';
import {
  toCents, parseMoneyDetailed, formatCents, parseDate,
  preserveIdentifier, normalizeZip, PROFILES,
} from '../shared/finance/locale';

describe('parseMoneyDetailed — decimal math, no float drift', () => {
  it('is exact on 2-decimal values; 0.1+0.2 sums exactly in cents', () => {
    expect(toCents('10.01')).toBe(1001);
    expect(toCents('0.10')! + toCents('0.20')!).toBe(30);
    expect(0.1 + 0.2).not.toBe(0.3); // documents why float is avoided
  });
  it('HALF-UP sub-cent rounding is explicit and flagged, not binary float', () => {
    const r = parseMoneyDetailed('1.005');
    expect(r.ok && r.cents).toBe(101);       // half-up on the 3rd decimal
    expect(r.ok && (r as any).rounded).toBe(true);
    expect(parseMoneyDetailed('1.004')).toEqual(expect.objectContaining({ ok: true, cents: 100, rounded: true }));
    expect(parseMoneyDetailed('2.999')).toEqual(expect.objectContaining({ cents: 300, rounded: true }));
  });
  it('accepts 3+ decimals via the documented policy, exact values are unrounded', () => {
    expect(parseMoneyDetailed('12.34')).toEqual(expect.objectContaining({ ok: true, cents: 1234, rounded: false }));
  });
});

describe('toCents — negatives, symbols, banking, locale', () => {
  it('negatives: leading/trailing minus + accounting parentheses', () => {
    expect(toCents('-45.10')).toBe(-4510);
    expect(toCents('45.10-')).toBe(-4510);
    expect(toCents('(1,234.56)')).toBe(-123456);
  });
  it('Dr/Cr signs (banking)', () => {
    expect(toCents('100.00 Dr')).toBe(-10000);
    expect(toCents('100.00 Cr')).toBe(10000);
  });
  it('US thousands with $, and EU decimal-comma with de-DE', () => {
    expect(toCents('$1,200.00')).toBe(120000);
    expect(toCents('1.234,56', { locale: 'de-DE' })).toBe(123456);
  });
});

describe('toCents — rejection, not silent mis-parse (US profile)', () => {
  it('rejects a foreign currency symbol under US (R/€), unless explicitly allowed', () => {
    expect(parseMoneyDetailed('R1 200.00').ok).toBe(false);
    expect(parseMoneyDetailed('R1 200.00').ok === false && (parseMoneyDetailed('R1 200.00') as any).code).toBe('FOREIGN_CURRENCY');
    expect(toCents('€10.00')).toBeNull();
    expect(toCents('€10.00', { allowForeignCurrency: true })).toBe(1000); // allowed
  });
  it('rejects a decimal comma used under a decimal-point profile (the misread case)', () => {
    // '200,00' under en-US: comma with 2 trailing digits is a decimal comma -> CONFLICTING, not 20000
    const r = parseMoneyDetailed('200,00');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('CONFLICTING_SEPARATORS');
  });
  it('rejects comma-after-period and mixed separators', () => {
    expect(parseMoneyDetailed('1.234,56').ok === false && (parseMoneyDetailed('1.234,56') as any).code).toBe('CONFLICTING_SEPARATORS');
    expect(parseMoneyDetailed('1,23.45,67').ok).toBe(false);
  });
  it('rejects malformed thousands grouping', () => {
    expect(parseMoneyDetailed('1,23,456.00').ok === false && (parseMoneyDetailed('1,23,456.00') as any).code).toBe('CONFLICTING_SEPARATORS');
    expect(toCents('1,2345.00')).toBeNull();
  });
  it('rejects doubled decimal points and non-numeric', () => {
    expect(toCents('1.2.3')).toBeNull();
    expect(toCents('abc')).toBeNull();
    expect(toCents('')).toBeNull();
    expect(toCents('   ')).toBeNull();
    expect(toCents(Number.NaN)).toBeNull();
  });
  it('rejects values beyond the safe-integer cent range', () => {
    expect(parseMoneyDetailed('9'.repeat(20) + '.00').ok === false && (parseMoneyDetailed('9'.repeat(20) + '.00') as any).code).toBe('OUT_OF_RANGE');
  });
});

describe('formatCents', () => {
  it('groups + symbol per locale, preserves sign, round-trips', () => {
    expect(formatCents(123456, 'en-US')).toBe('$1,234.56');
    expect(formatCents(-123456, 'en-US')).toBe('-$1,234.56');
    expect(formatCents(123456, 'de-DE')).toBe('€1.234,56');
    for (const c of [1, 100, 12345, -999, 0]) {
      expect(toCents(formatCents(c, 'en-US'), { allowBankingSigns: false })).toBe(c);
    }
  });
});

describe('parseDate — explicit order + ambiguity', () => {
  it('ISO unambiguous; US vs ZA disambiguate by the >12 component', () => {
    expect(parseDate('2026-01-31', 'en-US')).toMatchObject({ iso: '2026-01-31', ambiguous: false });
    expect(parseDate('01/31/2026', 'en-US')).toMatchObject({ iso: '2026-01-31', ambiguous: false });
    expect(parseDate('31/01/2026', 'en-ZA')).toMatchObject({ iso: '2026-01-31', ambiguous: false });
  });
  it('flags AMBIGUOUS when both readings are valid and differ', () => {
    const r = parseDate('03/04/2026', 'en-US');
    expect(r.ambiguous).toBe(true);
    expect(r.reason).toMatch(/ambiguous/i);
  });
  it('missing / invalid dates are flagged, never defaulted', () => {
    expect(parseDate('', 'en-US')).toMatchObject({ iso: null, ambiguous: true });
    expect(parseDate('13/45/2026', 'en-US')).toMatchObject({ iso: null, ambiguous: true });
    expect(parseDate('not a date', 'en-US').ambiguous).toBe(true);
  });
  it('two-digit year pivots', () => {
    expect(parseDate('01/31/26', 'en-US').iso).toBe('2026-01-31');
  });
});

describe('identifier + ZIP preservation', () => {
  it('keeps leading zeros + length as strings', () => {
    expect(preserveIdentifier('0012345')).toBe('0012345');
    expect(preserveIdentifier(' 012 ')).toBe('012');
    expect(preserveIdentifier('')).toBeNull();
  });
  it('US ZIP 5 and 5+4; leading zero survives; invalid rejected', () => {
    expect(normalizeZip('02134')).toBe('02134');
    expect(normalizeZip('02134-1234')).toBe('02134-1234');
    expect(normalizeZip('1234')).toBeNull();
  });
});

describe('profiles', () => {
  it('US mode does NOT force ZAR', () => {
    expect(PROFILES['en-US'].currency).toBe('USD');
    expect(PROFILES['en-ZA'].currency).toBe('ZAR');
    expect(PROFILES['en-US'].dateOrder).toBe('mdy');
    expect(PROFILES['en-ZA'].dateOrder).toBe('dmy');
  });
});
