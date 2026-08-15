/**
 * Classifies statement layout from first-2-pages text + optional pdf.js text items.
 * Returns layout profile + column roles + confidence.
 * Brand detection stays separate (bankRegistry) and is combined downstream.
 */

import type { LayoutProfile } from './statementSchema';

export interface ColumnRole {
  header: string;
  role: 'date' | 'description' | 'debit' | 'credit' | 'fees' | 'money_out' | 'money_in' | 'balance' | 'amount' | 'unknown';
  xCluster?: number;  // avg x position if available
}

export interface LayoutClassification {
  profile: LayoutProfile;
  columnRoles: ColumnRole[];
  confidence: number;  // 0..1
  headerLineIndex: number | null;
}

const HEADER_PATTERNS: Array<{ role: ColumnRole['role']; patterns: RegExp[] }> = [
  { role: 'date',        patterns: [/\bdate\b/i, /\btransaction\s+date\b/i] },
  { role: 'description', patterns: [/\bdescription\b/i, /\bparticulars?\b/i, /\bdetails?\b/i, /\bnarrative\b/i] },
  { role: 'debit',       patterns: [/\bdebit\b/i, /\bdr\b/i] },
  { role: 'credit',      patterns: [/\bcredit\b/i, /\bcr\b/i] },
  { role: 'fees',        patterns: [/\bfees?\b/i, /\bcharges?\b/i, /\bbank\s+charges?\b/i] },
  { role: 'money_out',   patterns: [/\bmoney\s+out\b/i, /\bpaid\s+out\b/i, /\bwithdrawals?\b/i] },
  { role: 'money_in',    patterns: [/\bmoney\s+in\b/i, /\bpaid\s+in\b/i, /\bdeposits?\b/i, /\bincome\b/i] },
  { role: 'balance',     patterns: [/\bbalance\b/i, /\brunning\s+balance\b/i] },
  { role: 'amount',      patterns: [/\bamount\b/i] },
];

export function classifyLayout(
  firstTwoPagesText: string,
  textItems?: Array<{ str: string; transform?: number[] }>
): LayoutClassification {
  const lines = firstTwoPagesText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const roles = new Map<ColumnRole['role'], ColumnRole>();

  // Scan first ~20 lines for headers
  let headerLineIndex: number | null = null;
  const scanLimit = Math.min(lines.length, 20);
  for (let i = 0; i < scanLimit; i++) {
    const line = lines[i];
    for (const hp of HEADER_PATTERNS) {
      if (hp.patterns.some(p => p.test(line)) && !roles.has(hp.role)) {
        const match = line.match(hp.patterns[0]);
        if (match) {
          roles.set(hp.role, { header: match[0], role: hp.role });
          if (headerLineIndex === null) headerLineIndex = i;
        }
      }
    }
  }

  const has = (r: ColumnRole['role']) => roles.has(r);

  // Decide profile
  let profile: LayoutProfile;
  let confidence: number;

  if (has('debit') && has('credit') && has('balance')) {
    profile = 'DEBIT_CREDIT_BALANCE';
    confidence = 0.85;
  } else if ((has('money_out') || has('money_in')) && has('balance')) {
    profile = 'MONEY_IN_OUT_FEES';
    confidence = has('fees') ? 0.9 : 0.75;
  } else if (has('amount') && has('balance')) {
    profile = 'SINGLE_SIGNED_AMOUNT';
    confidence = 0.7;
  } else if (has('balance') && (has('date') || has('description'))) {
    // Weak: balance + date/description but no explicit amount column
    profile = 'SINGLE_SIGNED_AMOUNT';
    confidence = 0.5;
  } else if (textItems && textItems.length > 50 && headerLineIndex === null) {
    // Lots of items, no headers — try positional
    profile = 'POSITIONAL';
    confidence = 0.35;
  } else {
    profile = 'UNKNOWN';
    confidence = 0.2;
  }

  return {
    profile,
    columnRoles: Array.from(roles.values()),
    confidence,
    headerLineIndex,
  };
}
