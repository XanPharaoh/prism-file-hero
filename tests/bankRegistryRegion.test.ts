/**
 * Batch 08 / Item G2 — US region filtering of the bank registry, exercised with representative
 * SYNTHETIC US fixtures (no private data). Verifies detection, that region-scoped detection can
 * exclude foreign banks, that the region→money/date profile mapping is correct, and that the
 * strict parser + date parser run under the US profile.
 */
import { describe, it, expect } from 'vitest';
import { detectBank, getBankPatternsForRegion, getBankRegion, getFinanceLocaleForCountry } from '../services/bankRegistry';
import { parseMoneyDetailed, parseDate } from '../shared/finance/locale';

describe('US region filtering + profile', () => {
  const chase = 'CHASE\nJPMorgan Chase Chase Checking Account Statement\nStatement Period 01/01/2026 - 01/31/2026\nDate Description Payment Deposit Balance\n01/05/2026 DIRECT DEPOSIT $2,500.00 $1,234.56';
  const fnb = 'First National Bank FNB Account Statement\n05 Jan 2026 Salary R1,200.00 R5,000.00';

  it('registers US banks and maps their region + profile', () => {
    expect(getBankPatternsForRegion('US').map((p) => p.code)).toEqual(
      expect.arrayContaining(['CHASE_US', 'BOA_US', 'WELLSFARGO_US', 'CITIBANK_US']),
    );
    expect(getBankRegion('CHASE_US')).toBe('US');
    expect(getFinanceLocaleForCountry('US')).toBe('en-US');
    expect(getFinanceLocaleForCountry('ZA')).toBe('en-ZA');
    expect(getFinanceLocaleForCountry('DE')).toBe('de-DE');
  });

  it('detects a Chase (US) statement', () => {
    expect(detectBank(chase).bankCode).toBe('CHASE_US');
  });

  it('region-scoped detection isolates US from ZA', () => {
    expect(detectBank(fnb, { region: 'US' }).bankCode).not.toBe('FNB_SA'); // ZA brand excluded under US region
    expect(detectBank(fnb).bankCode).toBe('FNB_SA'); // unscoped still detects ZA
    expect(detectBank(chase, { region: 'US' }).bankCode).toBe('CHASE_US');
  });

  it('strict money + date parse under the US profile', () => {
    expect(parseMoneyDetailed('$2,500.00', { locale: 'en-US', allowForeignCurrency: true })).toMatchObject({ ok: true, cents: 250000 });
    // 1,234.56 US grouping = one thousand two hundred thirty four fifty-six
    expect(parseMoneyDetailed('1,234.56', { locale: 'en-US' })).toMatchObject({ ok: true, cents: 123456 });
    // mm/dd — day 15 > 12 so it is NOT ambiguous under mdy
    const d = parseDate('01/15/2026', 'en-US');
    expect(d.iso).toBe('2026-01-15');
    expect(d.ambiguous).toBe(false);
  });
});
