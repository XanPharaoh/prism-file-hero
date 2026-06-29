/**
 * Multilingual Date Parser
 * 
 * Purpose:
 * - Parse dates in multiple formats and languages
 * - Handle ambiguous dates (DD/MM vs MM/DD)
 * - Support English, Afrikaans, Spanish, French, Portuguese, German
 * - Auto-detect current year for 2-digit year formats
 * 
 * Supported Formats:
 * - "06 Jan", "06 January"
 * - "6/1", "06/01", "2024-01-06"
 * - "01-06-2024", "January 6"
 */

export interface ParsedDate {
  date: Date | null;
  format: string;
  confidence: number; // 0-100
  raw: string;
}

/**
 * Month names in multiple languages
 */
const MONTH_NAMES: Record<string, Record<string, number>> = {
  en: {
    january: 1, jan: 1,
    february: 2, feb: 2,
    march: 3, mar: 3,
    april: 4, apr: 4,
    may: 5,
    june: 6, jun: 6,
    july: 7, jul: 7,
    august: 8, aug: 8,
    september: 9, sep: 9, sept: 9,
    october: 10, oct: 10,
    november: 11, nov: 11,
    december: 12, dec: 12,
  },
  af: {
    januarie: 1, jan: 1,
    februarie: 2, feb: 2,
    maart: 3, mrt: 3,
    april: 4, apr: 4,
    mei: 5,
    junie: 6, jun: 6,
    julie: 7, jul: 7,
    augustus: 8, aug: 8,
    september: 9, sep: 9,
    oktober: 10, okt: 10,
    november: 11, nov: 11,
    desember: 12, des: 12,
  },
  es: {
    enero: 1, ene: 1,
    febrero: 2, feb: 2,
    marzo: 3, mar: 3,
    abril: 4, abr: 4,
    mayo: 5,
    junio: 6, jun: 6,
    julio: 7, jul: 7,
    agosto: 8, ago: 8,
    septiembre: 9, sep: 9, spt: 9,
    octubre: 10, oct: 10,
    noviembre: 11, nov: 11,
    diciembre: 12, dic: 12,
  },
  fr: {
    janvier: 1, jan: 1,
    février: 2, fevrier: 2, fev: 2,
    mars: 3, mar: 3,
    avril: 4, avr: 4,
    mai: 5,
    juin: 6, jun: 6,
    juillet: 7, jul: 7,
    août: 8, aout: 8, aou: 8,
    septembre: 9, sep: 9,
    octobre: 10, oct: 10,
    novembre: 11, nov: 11,
    décembre: 12, decembre: 12, dec: 12,
  },
  pt: {
    janeiro: 1, jan: 1,
    fevereiro: 2, fev: 2,
    março: 3, marco: 3, mar: 3,
    abril: 4, abr: 4,
    maio: 5, mai: 5,
    junho: 6, jun: 6,
    julho: 7, jul: 7,
    agosto: 8, ago: 8,
    setembro: 9, set: 9, sep: 9,
    outubro: 10, out: 10, oct: 10,
    novembro: 11, nov: 11,
    dezembro: 12, dez: 12, dec: 12,
  },
  de: {
    januar: 1, jan: 1,
    februar: 2, feb: 2,
    märz: 3, maerz: 3, mär: 3, mar: 3,
    april: 4, apr: 4,
    mai: 5,
    juni: 6, jun: 6,
    juli: 7, jul: 7,
    august: 8, aug: 8,
    september: 9, sep: 9,
    oktober: 10, okt: 10,
    november: 11, nov: 11,
    dezember: 12, dez: 12,
  },
};

/**
 * Get month number from month name (English, Afrikaans, etc.)
 */
export function getMonthNumber(monthName: string): number | null {
  const normalized = monthName.toLowerCase().trim();

  // Check all language variants
  for (const langMonths of Object.values(MONTH_NAMES)) {
    if (normalized in langMonths) {
      return langMonths[normalized];
    }
  }

  return null;
}

/**
 * Parse date in format "06 Jan" or "6 January"
 */
function parseDateWithMonth(text: string): ParsedDate | null {
  // Format: "06 Jan 2024" or "6 January" or "Jan 06"
  const patterns = [
    /(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})?/,
    /([a-zA-Z]+)\s+(\d{1,2})(?:\s+(\d{4}))?/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    let day: number, month: number | null, year: number | undefined;

    if (pattern === patterns[0]) {
      // DD MMM YYYY or D MMM YYYY
      day = parseInt(match[1], 10);
      month = getMonthNumber(match[2]);
      year = match[3] ? parseInt(match[3], 10) : undefined;
    } else {
      // MMM DD YYYY or MMM D
      month = getMonthNumber(match[1]);
      day = parseInt(match[2], 10);
      year = match[3] ? parseInt(match[3], 10) : undefined;
    }

    if (!month || day < 1 || day > 31) continue;

    // Auto-detect current year if not provided
    if (!year) {
      year = new Date().getFullYear();
    }

    try {
      const date = new Date(year, month - 1, day);
      return {
        date,
        format: 'DDMMMYYYY',
        confidence: 95,
        raw: text,
      };
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Parse date in numeric format "06/01", "6/1", "2024-01-06"
 */
function parseNumericDate(text: string): ParsedDate | null {
  // Formats: DD/MM/YYYY, D/M/YYYY, DD-MM-YYYY, YYYY-MM-DD
  const patterns = [
    { regex: /(\d{4})-(\d{1,2})-(\d{1,2})/, format: 'YYYY-MM-DD', order: [0, 1, 2] as [number, number, number] },
    { regex: /(\d{1,2})\/(\d{1,2})\/(\d{4})/, format: 'DD/MM/YYYY', order: [0, 1, 2] as [number, number, number] },
    { regex: /(\d{1,2})-(\d{1,2})-(\d{4})/, format: 'DD-MM-YYYY', order: [0, 1, 2] as [number, number, number] },
    { regex: /(\d{1,2})\/(\d{1,2})(?!\/\d)/, format: 'DD/MM', order: [0, 1, 2] as [number, number, number] },
  ];

  for (const { regex, format, order } of patterns) {
    const match = text.match(regex);
    if (!match) continue;

    let day: number, month: number, year: number;

    if (format === 'YYYY-MM-DD') {
      year = parseInt(match[order[0]], 10);
      month = parseInt(match[order[1]], 10);
      day = parseInt(match[order[2]], 10);
    } else if (format === 'DD/MM' || format === 'DD-MM-YYYY') {
      day = parseInt(match[order[0]], 10);
      month = parseInt(match[order[1]], 10);
      year = match[order[2]] ? parseInt(match[order[2]], 10) : new Date().getFullYear();
    } else {
      day = parseInt(match[order[0]], 10);
      month = parseInt(match[order[1]], 10);
      year = parseInt(match[order[2]], 10);
    }

    // Validate
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;

    // Handle 2-digit years
    if (year < 100) {
      year += year < 50 ? 2000 : 1900;
    }

    try {
      const date = new Date(year, month - 1, day);
      return {
        date,
        format,
        confidence: 90,
        raw: text,
      };
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Main date parser
 * @param dateStr Raw date string (e.g., "06 Jan", "6/1/2024")
 * @returns Parsed date or null if unable to parse
 */
export function parseDate(dateStr: string): ParsedDate {
  // Remove extra whitespace
  const normalized = dateStr.trim();

  if (!normalized) {
    return {
      date: null,
      format: 'UNKNOWN',
      confidence: 0,
      raw: dateStr,
    };
  }

  // Try parsing with month names first
  const withMonth = parseDateWithMonth(normalized);
  if (withMonth?.date) return withMonth;

  // Try numeric parsing
  const numeric = parseNumericDate(normalized);
  if (numeric?.date) return numeric;

  // Fallback: explicit ISO detection (handle environments where numeric regex may miss)
  const isoMatch = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    try {
      const date = new Date(y, m - 1, d);
      return { date, format: 'YYYY-MM-DD', confidence: 99, raw: dateStr };
    } catch {
      // continue
    }
  }

  // Fallback: attempt token scan to find a month name and adjacent day
  const cleaned = normalized.replace(/[.,]/g, '');
  const tokens = cleaned.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const monthNum = getMonthNumber(tokens[i]);
    if (monthNum) {
      // find a numeric day either left or right
      const left = i > 0 ? parseInt(tokens[i - 1], 10) : NaN;
      const right = i < tokens.length - 1 ? parseInt(tokens[i + 1], 10) : NaN;
      const day = Number.isFinite(left) ? left : Number.isFinite(right) ? right : NaN;
      if (Number.isFinite(day)) {
        const yearToken = tokens.find((t) => /^\d{4}$/.test(t));
        const year = yearToken ? parseInt(yearToken, 10) : new Date().getFullYear();
        try {
          const date = new Date(year, monthNum - 1, day);
          return { date, format: 'DDMMMYYYY', confidence: 90, raw: dateStr };
        } catch {
          // ignore and continue
        }
      }
    }
  }

  // Parse failed
  return {
    date: null,
    format: 'UNKNOWN',
    confidence: 0,
    raw: dateStr,
  };
}

/**
 * Format date to ISO string
 */
export function formatDate(date: Date | null): string | null {
  if (!date) return null;
  // Build ISO date (YYYY-MM-DD) using local date components to avoid
  // timezone shifts caused by toISOString() which converts to UTC.
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parse date and return ISO format string
 */
export function parseDateToISO(dateStr: string): string | null {
  const parsed = parseDate(dateStr);
  return formatDate(parsed.date);
}

export default {
  parseDate,
  parseDateToISO,
  formatDate,
  getMonthNumber,
};
