/**
 * Item G1 — prove the strict integer-cent money path survives the app's real boundaries with NO
 * precision loss and NO silent acceptance of unsafe values: parser math, JSON persistence
 * (history), and the xlsx export path (excelService.getExcelBlob → re-read with exceljs).
 */
import { describe, it, expect } from 'vitest';
import { parseMoneyDetailed, moneyToNumber, toCents } from '../shared/finance/locale';
import { getExcelBlob } from '../services/excelService';

describe('integer-cent money survives every boundary', () => {
  it('parses float-hostile decimals exactly (no 0.1+0.2 drift)', () => {
    expect(toCents('0.30', { locale: 'en-US' })).toBe(30);
    expect(toCents('1,234.56', { locale: 'en-US' })).toBe(123456);
    expect(toCents('1.234,56', { locale: 'de-DE' })).toBe(123456); // EU grouping
  });

  it('applies the documented HALF-UP rounding for sub-cent precision and flags it', () => {
    const r = parseMoneyDetailed('1000.005', { locale: 'en-US' });
    expect(r.ok && r.rounded).toBe(true);
    expect(r.ok && r.cents).toBe(100001);
  });

  it('rejects out-of-safe-range instead of silently losing precision', () => {
    const r = parseMoneyDetailed('99999999999999999999.99', { locale: 'en-US' });
    expect(r.ok === false && !r.ok && r.code).toBe('OUT_OF_RANGE');
    expect(moneyToNumber('99999999999999999999.99', { locale: 'en-US' })).toBeNull();
  });

  it('rejects foreign symbols and conflicting separators under the US profile', () => {
    expect(parseMoneyDetailed('€1,000.00', { locale: 'en-US' }).ok === false).toBe(true);
    expect(parseMoneyDetailed('1.234,56', { locale: 'en-US' }).ok === false).toBe(true);
    expect(parseMoneyDetailed('1.234,56', { locale: 'en-US' })).toMatchObject({ ok: false, code: 'CONFLICTING_SEPARATORS' });
  });

  it('a large cent-exact value round-trips through JSON persistence (history boundary)', () => {
    const value = moneyToNumber('12345678901234.56', { locale: 'en-US' })!;
    const cents = toCents(value, { locale: 'en-US' });
    expect(cents).toBe(1234567890123456);
    const persisted = JSON.parse(JSON.stringify({ Amount: value, cents }));
    expect(persisted.cents).toBe(1234567890123456);
    expect(toCents(persisted.Amount, { locale: 'en-US' })).toBe(1234567890123456); // exact after JSON
  });

  it('getExcelBlob preserves the exact cents when the workbook is re-read', async () => {
    const big = moneyToNumber('1234567.89', { locale: 'en-US' })!; // 123456789 cents
    const blob = await getExcelBlob([{ Date: '2026-01-01', Description: 'rent', Amount: big }], undefined);
    const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    const ws = wb.worksheets[0];
    // Find the numeric cell carrying the amount and confirm its cents survive the xlsx boundary.
    let found: number | undefined;
    ws.eachRow((row) => row.eachCell((cell) => {
      const v = cell.value;
      if (typeof v === 'number' && Math.abs(v - big) < 1e-9) found = v;
    }));
    expect(found).toBeCloseTo(big, 2);
    expect(toCents(found!, { locale: 'en-US' })).toBe(123456789);
  }, 30000);
});
