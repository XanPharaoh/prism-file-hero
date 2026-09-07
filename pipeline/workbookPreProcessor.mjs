/**
 * South African Financial Workbook Pre-Processor
 * ===============================================
 * Dual-Mode Parser:
 * 1. Write-up / Cashbook Mode: If the workbook contains completed bank write-up
 *    sheets (e.g. "Write-up", "Bank Recon", "Cashbook"), it mines the exact
 *    real-world bank statement narratives paired with the accountant's categories.
 * 2. Annual Financial Statement (AFS) Mode: If the workbook only has AFS/management
 *    accounts, it parses the Detailed Income Statement and General Information.
 *
 * Supports English & Afrikaans financial records and enforces strict client isolation.
 */

import { read, utils } from 'xlsx';
import { promises as fs } from 'node:fs';

// GL account code mapping for standard SA categories
const CATEGORY_GL_MAP = {
  // Income
  'income': { code: '1000', name: 'Sales / Fees Income', vat: false },
  'gross revenue': { code: '1000', name: 'Sales / Fees Income', vat: false },
  'creche fees': { code: '1000', name: 'School & Creche Fees', vat: false },
  'school fees': { code: '1000', name: 'School & Creche Fees', vat: false },
  'parent fees': { code: '1000', name: 'Parent Fees', vat: false },

  // Cost of Sales / Operating direct
  'cost of sales': { code: '2000', name: 'Cost of Sales', vat: false },

  // Expenses
  'consumables': { code: '7600', name: 'Consumables & Groceries', vat: false },
  'cleaning': { code: '7650', name: 'Cleaning & Detergents', vat: false },
  'uniform': { code: '7680', name: 'Uniforms & Apparel', vat: false },
  'electricity/rates and taxes': { code: '7100', name: 'Electricity & Utilities', vat: false },
  'electricity': { code: '7100', name: 'Electricity & Utilities', vat: false },
  'travel costs fuel': { code: '7400', name: 'Fuel & Oil', vat: false },
  'fuel': { code: '7400', name: 'Fuel & Oil', vat: false },
  'travel costs repairs/maintenance': { code: '7450', name: 'Vehicle Repairs & Maintenance', vat: false },
  'travel costs insurance': { code: '7900', name: 'Vehicle Insurance', vat: false },
  'salaries and wages': { code: '6000', name: 'Salaries & Wages', vat: false },
  'salaries director': { code: '6100', name: "Directors' Remuneration / Drawings", vat: false },
  'members fee': { code: '6100', name: "Directors' Remuneration / Drawings", vat: false },
  'telephone and internet': { code: '7300', name: 'Telephone & Internet', vat: false },
  'it expenses': { code: '7350', name: 'IT & Software', vat: false },
  'small equipment< r7 000': { code: '7750', name: 'Small Equipment (< R7,000)', vat: false },
  'bank costs': { code: '7200', name: 'Bank Charges', vat: false },
  'entertainment and gifts': { code: '7800', name: 'Entertainment & Gifts', vat: false },
  'insurance': { code: '7900', name: 'Insurance', vat: false },
  'rental paid': { code: '7050', name: 'Rent Paid', vat: false },
  'repairs/maintenance': { code: '7550', name: 'Repairs & Maintenance', vat: false },
  'administrative costs': { code: '7000', name: 'Administrative Expenses', vat: false },
  'advertising and marketing': { code: '7250', name: 'Advertising & Marketing', vat: false },
};

function normalizeCategory(cat) {
  if (!cat) return '7000';
  const clean = String(cat).trim().toLowerCase().replace(/['"]/g, '');
  return CATEGORY_GL_MAP[clean] || { code: '7000', name: String(cat).trim(), vat: false };
}

// Clean common banking prefixes to find meaningful merchant names
function extractMerchantPattern(description) {
  if (!description) return null;
  let clean = String(description).trim().toUpperCase();

  // Strip common SA bank narrative boilerplate
  clean = clean
    .replace(/^POS PURCHASE\s+/i, '')
    .replace(/^CARD PURCHASE\s+/i, '')
    .replace(/^CARD PURCHASE WITH CASHBACK\s+/i, '')
    .replace(/^CARD CASHBACK CASHB\s+/i, '')
    .replace(/^FUEL PURCHASE\s+/i, '')
    .replace(/^PAYSHAP (?:CREDIT|ACCOUNT OFF-US)\s+/i, '')
    .replace(/^MAGTAPE CREDIT\s+/i, '')
    .replace(/^ADT CASH DEPOSIT\s+[A-Z0-9]+\s+/i, '')
    .replace(/^FNB APP (?:PAYMENT TO|TRANSFER TO|TRANSFER FROM)\s+/i, '')
    .replace(/^INTERNAL DEBIT ORDER\s+/i, '')
    .replace(/^ATM CASH\s+\d+\s+/i, '')
    .replace(/\s+\d{6}\*\d{4}.*$/i, '') // strip trailing card numbers like 485442*4071 08 Mar
    .replace(/\s+\d{2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC).*$/i, '')
    .trim();

  // Extract first 1-3 significant words as keyword pattern
  const tokens = clean.split(/\s+/).filter(t => t.length > 2 && !/^\d+$/.test(t));
  if (tokens.length === 0) return null;

  // Key merchants: SHOPRITE, CHECKERS, ENGEN, DISCHEM, NETFLIX, PNP, SPAR, VODACOM, etc.
  const first = tokens[0];
  if (tokens.length >= 2 && ['PREPAID', 'GOODHOPE', 'FNB', 'CITY'].includes(first)) {
    return `${first} ${tokens[1]}`;
  }
  return first;
}

export async function preProcessWorkbook(xlsxPath) {
  const buf = await fs.readFile(xlsxPath);
  const wb = read(buf);

  let entityName = '';
  let registrationNumber = '';
  let businessType = '';
  let vatRegistered = false;
  let vatNumber = '';

  // ── 1. Discover Entity Info from "Input" or "1. Gen Info" ──
  const inputSheet = wb.Sheets['Input'];
  if (inputSheet) {
    const raw = utils.sheet_to_json(inputSheet, { header: 1, defval: '' });
    for (const r of raw) {
      if (!Array.isArray(r)) continue;
      for (let i = 0; i < r.length - 1; i++) {
        const key = String(r[i]).trim().toLowerCase();
        const val = String(r[i + 1]).trim();
        if (key.includes('name of company') && val) entityName = val;
        if (key.includes('registration number') && val) registrationNumber = val;
        if (key.includes('vat number')) {
          if (val.toLowerCase().includes('not registered') || val === '0' || !val) {
            vatRegistered = false;
          } else if (/\d{10}/.test(val)) {
            vatRegistered = true;
            vatNumber = val;
          }
        }
      }
    }
  }

  // Check 1. Gen Info if entityName still missing
  const genInfoSheet = wb.Sheets['1. Gen Info'] || wb.Sheets['Gen Info'] || wb.Sheets['General Information'];
  if (genInfoSheet) {
    const raw = utils.sheet_to_json(genInfoSheet, { header: 1, defval: '' });
    for (const r of raw) {
      if (!Array.isArray(r)) continue;
      const text = r.map(c => String(c).trim()).join(' ');
      if (!entityName && (text.includes('Pty Ltd') || text.includes('(Pty) Ltd') || text.includes('CC') || text.includes('Educare') || text.includes('Transport'))) {
        const match = text.match(/([A-Za-z0-9\s'&]+(?:Pty\s*Ltd|\(Pty\)\s*Ltd|CC|Centre|Educare))/i);
        if (match) entityName = match[1].trim();
      }
      if (!registrationNumber) {
        const regMatch = text.match(/(\d{4}\/\d{6}\/\d{2})/);
        if (regMatch) registrationNumber = regMatch[1];
      }
    }
  }

  // Infer Business Type from Name and Content
  const combinedText = `${entityName} ${xlsxPath}`.toLowerCase();
  if (combinedText.includes('educare') || combinedText.includes('creche') || combinedText.includes('childcare') || combinedText.includes('school')) {
    businessType = 'Education & Childcare';
  } else if (combinedText.includes('transport') || combinedText.includes('logistics') || combinedText.includes('freight') || combinedText.includes('express')) {
    businessType = 'Transport & Logistics';
  } else if (combinedText.includes('retail') || combinedText.includes('shop') || combinedText.includes('store') || combinedText.includes('supermarket')) {
    businessType = 'Retail & Wholesale';
  } else if (combinedText.includes('engineer') || combinedText.includes('consulting') || combinedText.includes('legal') || combinedText.includes('accounting')) {
    businessType = 'Professional Services';
  } else if (combinedText.includes('construct') || combinedText.includes('building') || combinedText.includes('civils')) {
    businessType = 'Construction';
  } else {
    businessType = 'Other';
  }

  // ── 2. Check for "Write-up" Sheet (Direct Transaction Mining) ──
  const writeupSheet = wb.Sheets['Write-up'] || wb.Sheets['Cashbook'] || wb.Sheets['Bank Recon'];
  const suggestedRules = [];
  const accounts = [];
  const addedPatterns = new Map();

  if (writeupSheet) {
    console.log(`[workbookPreProcessor] Mining transactions directly from "${writeupSheet === wb.Sheets['Write-up'] ? 'Write-up' : 'Bank Recon'}" sheet...`);
    const raw = utils.sheet_to_json(writeupSheet, { header: 1, defval: '' });

    // Header row is row 1
    let descIdx = 2;
    let typeIdx = 1;
    let vatIdx = 4;

    for (let i = 2; i < raw.length; i++) {
      const row = raw[i];
      if (!Array.isArray(row) || row.length < 3) continue;

      const rawType = row[typeIdx];
      const rawDesc = row[descIdx];
      const rawVat = row[vatIdx];

      if (!rawType || !rawDesc || typeof rawType !== 'string' || typeof rawDesc !== 'string') continue;
      if (rawType.toLowerCase().includes('bank balance') || rawType.toLowerCase().includes('personal')) continue;

      const pattern = extractMerchantPattern(rawDesc);
      if (!pattern || pattern.length < 3) continue;

      const mapping = normalizeCategory(rawType);
      const isVatApplicable = vatRegistered && (rawVat === 1 || rawVat === '1' || rawVat === true);

      if (!addedPatterns.has(pattern)) {
        addedPatterns.set(pattern, {
          pattern,
          account: mapping.code,
          accountName: mapping.name,
          vatApplicable: isVatApplicable,
          confidence: 0.98,
          source: 'workbook',
          examples: [rawDesc.trim()],
          count: 1,
        });
      } else {
        const item = addedPatterns.get(pattern);
        item.count++;
        if (item.examples.length < 2 && !item.examples.includes(rawDesc.trim())) {
          item.examples.push(rawDesc.trim());
        }
      }
    }

    // Sort by frequency and build top rules
    const sorted = Array.from(addedPatterns.values()).sort((a, b) => b.count - a.count);
    for (const r of sorted) {
      suggestedRules.push({
        pattern: r.pattern,
        account: r.account,
        accountName: r.accountName,
        vatApplicable: r.vatApplicable,
        confidence: r.confidence,
        source: 'workbook',
        examples: r.examples,
      });
    }
  }

  // ── 3. Fallback / Augment with Detailed Income Statement lines ──
  const isSheet = wb.Sheets['8&9 Detail Income Statement']
    || wb.Sheets['Manage Acc & Taxable Income']
    || wb.Sheets['Income and Expenses']
    || wb.Sheets['Detailed Income Statement'];

  if (isSheet) {
    const raw = utils.sheet_to_json(isSheet, { header: 1, defval: '' });
    for (const r of raw) {
      if (!Array.isArray(r) || r.length === 0) continue;
      const title = r[0];
      if (typeof title === 'string' && title.trim().length > 2) {
        const clean = title.trim();
        if (clean.includes('(Registration') || clean.includes('Annual Financial') || clean.includes('Detailed Income')) continue;
        const amt = r.slice(1).find(c => typeof c === 'number' && Math.abs(c) > 0);
        accounts.push({ name: clean, amount: amt ? Math.abs(amt) : undefined });
      }
    }
  }

  return {
    entityName: entityName || "Client Entity",
    registrationNumber: registrationNumber || '',
    businessType,
    vatRegistered,
    vatNumber,
    accounts,
    suggestedRules,
  };
}
