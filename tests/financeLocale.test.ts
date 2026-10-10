import { describe, it, expect } from 'vitest';
import {
  toCents,
  formatCents,
  parseDate,
  preserveIdentifier,
  normalizeZip,
  PROFILES,
} from '../shared/finance/locale';

describe('toCents — integer cents, no zero-fill', () => {
  it('is exact on 2-decimal values and avoids float drift on sums', () => {
    expect(toCents('10.01')).toBe(1001);
    expect(toCents('2.34')).toBe(234);
    // The anti-drift guarantee: cents add exactly, unlike 0.1 + 0.2 in float.
    expect(toCents('0.10')! + toCents('0.20')!).toBe(30);
    expect(0.1 + 0.2).not.toBe(0.3); // documents why cents are used
  });
  it('handles negatives, explicit and trailing minus', () => {
    expect(toCents('-45.10')).toBe(-4510);
    expect(toCents('45.10-')).toBe(-4510);
    expect(toCents('(1,234.56)')).toBe(-123456); // accounting parens
  });
  it('handles symbols, thousands, Dr/Cr', () => {
    expect(toCents('$1,200.00')).toBe(120000);
    expect(toCents('R1 200.00')).toBe(120000);   // spaces + R symbol stripped
    expect(toCents('100.00 Dr')).toBe(-10000);
    expect(toCents('100.00 Cr')).toBe(10000);
  });
  it('EU decimal-comma profile', () => {
    expect(toCents('1.234,56', { locale: 'de-DE' })).toBe(123456);
  });
  it('returns NULL for missing / unparseable (never 0)', () => {
    expect(toCents('')).toBeNull();
    expect(toCents('   ')).toBeNull();
    expect(toCents('N/A')).toBeNull();
    expect(toCents('abc')).toBeNull();
    expect(toCents('1.2.3')).toBeNull();
    expect(toCents(null)).toBeNull();
    expect(toCents(undefined)).toBeNull();
    expect(toCents(Number.NaN)).toBeNull();
  });
});

describe('formatCents', () => {
  it('groups + symbol per locale, preserves sign', () => {
    expect(formatCents(123456, 'en-US')).toBe('$1,234.56');
    expect(formatCents(-123456, 'en-US')).toBe('-$1,234.56');
    expect(formatCents(123456, 'de-DE')).toBe('€1.234,56');
  });
  it('round-trips cents', () => {
    for (const c of [1, 100, 12345, -999, 0]) {
      expect(toCents(formatCents(c, 'en-US'), { allowBankingSigns: false })).toBe(c);
    }
  });
});

describe('parseDate — explicit order + ambiguity', () => {
  it('ISO is unambiguous', () => {
    expect(parseDate('2026-01-31', 'en-US')).toMatchObject({ iso: '2026-01-31', ambiguous: false });
  });
  it('US mm/dd resolves; ZA dd/mm resolves to a DIFFERENT unambiguous date when >12 present', () => {
    expect(parseDate('01/31/2026', 'en-US')).toMatchObject({ iso: '2026-01-31', ambiguous: false });
    expect(parseDate('31/01/2026', 'en-ZA')).toMatchObject({ iso: '2026-01-31', ambiguous: false });
  });
  it('flags AMBIGUOUS when day/month both ≤12 and disagree', () => {
    const r = parseDate('03/04/2026', 'en-US'); // could be Mar 4 or Apr 3
    expect(r.ambiguous).toBe(true);
    expect(r.reason).toMatch(/ambiguous/i);
  });
  it('missing/unparseable dates are flagged, not defaulted', () => {
    expect(parseDate('', 'en-US')).toMatchObject({ iso: null, ambiguous: true });
    expect(parseDate('13/45/2026', 'en-US')).toMatchObject({ iso: null, ambiguous: true });
    expect(parseDate('not a date', 'en-US').ambiguous).toBe(true);
  });
  it('two-digit year pivots', () => {
    expect(parseDate('01/31/26', 'en-US').iso).toBe('2026-01-31');
  });
});

describe('identifier + ZIP preservation', () => {
  it('keeps leading zeros and length as strings', () => {
    expect(preserveIdentifier('0012345')).toBe('0012345');
    expect(preserveIdentifier(' 012 ')).toBe('012');
    expect(preserveIdentifier('')).toBeNull();
  });
  it('US ZIP 5 and 5+4, leading zero survives, invalid rejected', () => {
    expect(normalizeZip('02134')).toBe('02134');
    expect(normalizeZip('02134-1234')).toBe('02134-1234');
    expect(normalizeZip('1234')).toBeNull();
    expect(normalizeZip('123456')).toBeNull();
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
