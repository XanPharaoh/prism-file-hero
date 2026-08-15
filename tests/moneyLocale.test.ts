import { describe, it, expect } from 'vitest';
import { parseMoney, parseMoneySigned } from '../services/moneyLocale';

describe('moneyLocale', () => {
  it('parses ZA format R 1 234.56', () => {
    expect(parseMoneySigned('R 1 234.56', 'za-ZAR')).toBe(1234.56);
  });
  it('parses EU format 1.234,56', () => {
    expect(parseMoneySigned('1.234,56', 'de-DE')).toBe(1234.56);
  });
  it('parses US format 1,234.56', () => {
    expect(parseMoneySigned('1,234.56', 'en-US')).toBe(1234.56);
  });
  it('returns null for garbage', () => {
    expect(parseMoney('—', 'auto')).toBeNull();
    expect(parseMoney('', 'auto')).toBeNull();
    expect(parseMoney(null, 'auto')).toBeNull();
  });
  it('detects CR/DR markers', () => {
    const p = parseMoney('1 234.56 CR', 'za-ZAR')!;
    expect(p.hasCreditMarker).toBe(true);
    expect(p.value).toBe(1234.56);
  });
});
