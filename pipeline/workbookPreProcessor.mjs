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
  } else if (combinedText.includes('engineer') || combinedText.includes('consult') || combinedText.includes('legal') || combinedText.includes('account') || combinedText.includes('advisory')) {
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

// ─── Industry-specific rule templates ────────────────────────────────────────

/**
 * Returns a suggested rules array for the given business type.
 * Patterns are common SA merchant names / bank narrative keywords.
 */
function rulesForType(businessType) {
  // 120+ Baseline rules every business gets
  const baseline = [
    { pattern: 'SALARY', account: '6000', accountName: 'Salaries & Wages', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'WAGES', account: '6000', accountName: 'Salaries & Wages', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'PAYE', account: '6010', accountName: 'PAYE/UIF', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'UIF', account: '6010', accountName: 'PAYE/UIF', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'SARS', account: '6020', accountName: 'Taxes & Levies', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'SERVICE FEE', account: '7000', accountName: 'Administrative Expenses', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'ACCOUNT FEE', account: '7200', accountName: 'Bank Charges', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'BANKKOSTE', account: '7200', accountName: 'Bank Charges', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'BANK COSTS', account: '7200', accountName: 'Bank Charges', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'MONTHLY FEE', account: '7200', accountName: 'Bank Charges', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'UNPAID FEE', account: '7200', accountName: 'Bank Charges', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'INTEREST', account: '7210', accountName: 'Interest Paid', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'LOAN REPAYMENT', account: '8500', accountName: 'Loan Repayments', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'ESKOM', account: '7100', accountName: 'Electricity & Utilities', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'CITY OF', account: '7100', accountName: 'Municipal Rates & Taxes', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'VODACOM', account: '7300', accountName: 'Telephone & Internet', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'MTN', account: '7300', accountName: 'Telephone & Internet', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'CELL C', account: '7300', accountName: 'Telephone & Internet', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'TELKOM', account: '7300', accountName: 'Telephone & Internet', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'RAIN', account: '7300', accountName: 'Telephone & Internet', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'FIBRE', account: '7300', accountName: 'Telephone & Internet', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'WEBHOST', account: '7310', accountName: 'Software & Hosting', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'XERO', account: '7310', accountName: 'Software Subscriptions', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'MICROSOFT', account: '7310', accountName: 'Software Subscriptions', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'GOOGLE', account: '7310', accountName: 'Software Subscriptions', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'ADOBE', account: '7310', accountName: 'Software Subscriptions', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'AWS', account: '7310', accountName: 'Software & Hosting', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'ZOOM', account: '7310', accountName: 'Software Subscriptions', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'OUTSURANCE', account: '7900', accountName: 'Insurance', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'SANTAM', account: '7900', accountName: 'Insurance', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'MIWAY', account: '7900', accountName: 'Insurance', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'DISCOVERY', account: '7900', accountName: 'Insurance', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'HOLLARD', account: '7900', accountName: 'Insurance', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'OLD MUTUAL', account: '7900', accountName: 'Insurance', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'MOMENTUM', account: '7900', accountName: 'Insurance', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'SANLAM', account: '7900', accountName: 'Insurance', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'RENT', account: '7500', accountName: 'Rent Paid', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'CLEANING', account: '7610', accountName: 'Cleaning Services', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'SECURITY', account: '7620', accountName: 'Security Services', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'ADT', account: '7620', accountName: 'Security Services', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'ENGEN', account: '7400', accountName: 'Fuel & Oil', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'SHELL', account: '7400', accountName: 'Fuel & Oil', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'SASOL', account: '7400', accountName: 'Fuel & Oil', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'BP', account: '7400', accountName: 'Fuel & Oil', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'CALTEX', account: '7400', accountName: 'Fuel & Oil', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'TOTAL', account: '7400', accountName: 'Fuel & Oil', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'ASTRON', account: '7400', accountName: 'Fuel & Oil', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'PUMA', account: '7400', accountName: 'Fuel & Oil', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'SANRAL', account: '7400', accountName: 'Toll Fees', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'E TOLL', account: '7400', accountName: 'Toll Fees', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'BAKWERA', account: '7400', accountName: 'Toll Fees', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'N3TC', account: '7400', accountName: 'Toll Fees', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'AUTOZONE', account: '7450', accountName: 'Vehicle Repairs & Maintenance', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'MIDAS', account: '7450', accountName: 'Vehicle Repairs & Maintenance', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'TIGER WHEEL', account: '7450', accountName: 'Vehicle Repairs & Maintenance', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'SUPA QUICK', account: '7450', accountName: 'Vehicle Repairs & Maintenance', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'HI Q', account: '7450', accountName: 'Vehicle Repairs & Maintenance', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'PG GLASS', account: '7450', accountName: 'Vehicle Repairs & Maintenance', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'GLASFIT', account: '7450', accountName: 'Vehicle Repairs & Maintenance', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'TRACKER', account: '7460', accountName: 'Vehicle Tracking', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'SHOPRITE', account: '7600', accountName: 'Consumables & Groceries', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'CHECKERS', account: '7600', accountName: 'Consumables & Groceries', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'SPAR', account: '7600', accountName: 'Consumables & Groceries', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'PICK N PAY', account: '7600', accountName: 'Consumables & Groceries', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'WOOLWORTHS', account: '7600', accountName: 'Consumables & Groceries', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'MAKRO', account: '7600', accountName: 'Consumables & Groceries', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'GAME', account: '7600', accountName: 'Consumables & Groceries', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'BUILDERS', account: '7700', accountName: 'Repairs & Maintenance', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'CASHBUILD', account: '7700', accountName: 'Repairs & Maintenance', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'LEROY MERLIN', account: '7700', accountName: 'Repairs & Maintenance', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'CTM', account: '7700', accountName: 'Repairs & Maintenance', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'CHAMBERLAIN', account: '7700', accountName: 'Repairs & Maintenance', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'KLINGSPOR', account: '7700', accountName: 'Repairs & Maintenance', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'TAKEALOT', account: '7650', accountName: 'Office Supplies & Equipment', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'INCREDIBLE', account: '7650', accountName: 'Office Supplies & Equipment', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'BISON', account: '7650', accountName: 'Office Supplies & Equipment', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'WALTONS', account: '7650', accountName: 'Stationery & Printing', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'CNA', account: '7650', accountName: 'Stationery & Printing', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'PNA', account: '7650', accountName: 'Stationery & Printing', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'POSTNET', account: '7650', accountName: 'Postage & Courier', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'ARAMEX', account: '7650', accountName: 'Postage & Courier', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'DHL', account: '7650', accountName: 'Postage & Courier', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'FEDEX', account: '7650', accountName: 'Postage & Courier', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'DSV', account: '7650', accountName: 'Postage & Courier', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'PEP', account: '7600', accountName: 'Consumables & Groceries', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'UBER', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'BOLT', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'GAUTRAIN', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'FLIGHT', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'AIRLINK', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'FLYSAFAIR', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'LIFT', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'AVIS', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'EUROPCAR', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'HERTZ', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'CITY LODGE', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'TSOGO SUN', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'KFC', account: '7810', accountName: 'Staff Refreshments & Meals', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'MCDONALDS', account: '7810', accountName: 'Staff Refreshments & Meals', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'NANDOS', account: '7810', accountName: 'Staff Refreshments & Meals', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'MAILCHIMP', account: '7820', accountName: 'Advertising & Marketing', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'FACEBOOK', account: '7820', accountName: 'Advertising & Marketing', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'LINKEDIN', account: '7820', accountName: 'Advertising & Marketing', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'TWITTER', account: '7820', accountName: 'Advertising & Marketing', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'CANVA', account: '7820', accountName: 'Advertising & Marketing', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'FIVERR', account: '7830', accountName: 'Consulting Fees', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'UPWORK', account: '7830', accountName: 'Consulting Fees', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'LAW', account: '7830', accountName: 'Legal & Professional Fees', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'ATTORNEY', account: '7830', accountName: 'Legal & Professional Fees', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'ACCOUNTANT', account: '7830', accountName: 'Accounting Fees', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'AUDITOR', account: '7830', accountName: 'Accounting Fees', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'STORAGE', account: '7840', accountName: 'Storage Fees', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'PARKING', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'WATER', account: '7100', accountName: 'Electricity & Utilities', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'RATES', account: '7100', accountName: 'Municipal Rates & Taxes', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'DONATION', account: '8200', accountName: 'Charitable Donations', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'NSPCA', account: '8200', accountName: 'Charitable Donations', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'GIFT', account: '8210', accountName: 'Gifts', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'FLOWERS', account: '8210', accountName: 'Gifts', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'NETCARE', account: '8300', accountName: 'Medical Aid', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'CARS', account: '7400', accountName: 'Fuel & Oil', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'TRUCK', account: '7400', accountName: 'Fuel & Oil', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'DELIVERY', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'OFFICE', account: '7650', accountName: 'Office Supplies & Equipment', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'HARDWARE', account: '7700', accountName: 'Repairs & Maintenance', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'SOFTWARE', account: '7310', accountName: 'Software Subscriptions', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'CLINIC', account: '8300', accountName: 'Medical Aid', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'HOSPITAL', account: '8300', accountName: 'Medical Aid', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'VET', account: '8300', accountName: 'Medical Aid', vatApplicable: false, confidence: 0.90, source: 'sa-default' },
    { pattern: 'COFFEE', account: '7810', accountName: 'Staff Refreshments & Meals', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'TEA', account: '7810', accountName: 'Staff Refreshments & Meals', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    { pattern: 'SALARY', account: '6000', accountName: 'Salaries & Wages', vatApplicable: false, confidence: 0.91, source: 'sa-default' },\n    { pattern: 'WAGES', account: '6000', accountName: 'Salaries & Wages', vatApplicable: false, confidence: 0.87, source: 'sa-default' },\n    { pattern: 'PAYE', account: '6010', accountName: 'PAYE/UIF', vatApplicable: false, confidence: 0.94, source: 'sa-default' },\n    { pattern: 'UIF', account: '6010', accountName: 'PAYE/UIF', vatApplicable: false, confidence: 0.94, source: 'sa-default' },\n    { pattern: 'SARS', account: '6020', accountName: 'Taxes & Levies', vatApplicable: false, confidence: 0.94, source: 'sa-default' },\n    { pattern: 'SERVICE FEE', account: '7000', accountName: 'Administrative Expenses', vatApplicable: false, confidence: 0.93, source: 'sa-default' },\n    { pattern: 'ACCOUNT FEE', account: '7200', accountName: 'Bank Charges', vatApplicable: false, confidence: 0.86, source: 'sa-default' },\n    { pattern: 'BANKKOSTE', account: '7200', accountName: 'Bank Charges', vatApplicable: false, confidence: 0.86, source: 'sa-default' },\n    { pattern: 'BANK COSTS', account: '7200', accountName: 'Bank Charges', vatApplicable: false, confidence: 0.9, source: 'sa-default' },\n    { pattern: 'MONTHLY FEE', account: '7200', accountName: 'Bank Charges', vatApplicable: false, confidence: 0.93, source: 'sa-default' },\n    { pattern: 'UNPAID FEE', account: '7200', accountName: 'Bank Charges', vatApplicable: false, confidence: 0.93, source: 'sa-default' },\n    { pattern: 'INTEREST', account: '7210', accountName: 'Interest Paid', vatApplicable: false, confidence: 0.93, source: 'sa-default' },\n    { pattern: 'LOAN REPAYMENT', account: '8500', accountName: 'Loan Repayments', vatApplicable: false, confidence: 0.87, source: 'sa-default' },\n    { pattern: 'ESKOM', account: '7100', accountName: 'Electricity & Utilities', vatApplicable: true, confidence: 0.92, source: 'sa-default' },\n    { pattern: 'CITY OF', account: '7100', accountName: 'Municipal Rates & Taxes', vatApplicable: true, confidence: 0.93, source: 'sa-default' },\n    { pattern: 'VODACOM', account: '7300', accountName: 'Telephone & Internet', vatApplicable: true, confidence: 0.95, source: 'sa-default' },\n    { pattern: 'MTN', account: '7300', accountName: 'Telephone & Internet', vatApplicable: true, confidence: 0.87, source: 'sa-default' },\n    { pattern: 'CELL C', account: '7300', accountName: 'Telephone & Internet', vatApplicable: true, confidence: 0.88, source: 'sa-default' },\n    { pattern: 'TELKOM', account: '7300', accountName: 'Telephone & Internet', vatApplicable: true, confidence: 0.94, source: 'sa-default' },\n    { pattern: 'RAIN', account: '7300', accountName: 'Telephone & Internet', vatApplicable: true, confidence: 0.91, source: 'sa-default' },\n    { pattern: 'FIBRE', account: '7300', accountName: 'Telephone & Internet', vatApplicable: true, confidence: 0.89, source: 'sa-default' },\n    { pattern: 'WEBHOST', account: '7310', accountName: 'Software & Hosting', vatApplicable: true, confidence: 0.87, source: 'sa-default' },\n    { pattern: 'XERO', account: '7310', accountName: 'Software Subscriptions', vatApplicable: true, confidence: 0.94, source: 'sa-default' },\n    { pattern: 'MICROSOFT', account: '7310', accountName: 'Software Subscriptions', vatApplicable: true, confidence: 0.92, source: 'sa-default' },\n    { pattern: 'GOOGLE', account: '7310', accountName: 'Software Subscriptions', vatApplicable: true, confidence: 0.87, source: 'sa-default' },\n    { pattern: 'ADOBE', account: '7310', accountName: 'Software Subscriptions', vatApplicable: true, confidence: 0.89, source: 'sa-default' },\n    { pattern: 'AWS', account: '7310', accountName: 'Software & Hosting', vatApplicable: true, confidence: 0.86, source: 'sa-default' },\n    { pattern: 'ZOOM', account: '7310', accountName: 'Software Subscriptions', vatApplicable: true, confidence: 0.89, source: 'sa-default' },\n    { pattern: 'OUTSURANCE', account: '7900', accountName: 'Insurance', vatApplicable: false, confidence: 0.91, source: 'sa-default' },\n    { pattern: 'SANTAM', account: '7900', accountName: 'Insurance', vatApplicable: false, confidence: 0.86, source: 'sa-default' },\n    { pattern: 'MIWAY', account: '7900', accountName: 'Insurance', vatApplicable: false, confidence: 0.9, source: 'sa-default' },\n    { pattern: 'DISCOVERY', account: '7900', accountName: 'Insurance', vatApplicable: false, confidence: 0.93, source: 'sa-default' },\n    { pattern: 'HOLLARD', account: '7900', accountName: 'Insurance', vatApplicable: false, confidence: 0.94, source: 'sa-default' },\n    { pattern: 'OLD MUTUAL', account: '7900', accountName: 'Insurance', vatApplicable: false, confidence: 0.89, source: 'sa-default' },\n    { pattern: 'MOMENTUM', account: '7900', accountName: 'Insurance', vatApplicable: false, confidence: 0.87, source: 'sa-default' },\n    { pattern: 'SANLAM', account: '7900', accountName: 'Insurance', vatApplicable: false, confidence: 0.92, source: 'sa-default' },\n    { pattern: 'RENT', account: '7500', accountName: 'Rent Paid', vatApplicable: true, confidence: 0.94, source: 'sa-default' },\n    { pattern: 'CLEANING', account: '7610', accountName: 'Cleaning Services', vatApplicable: true, confidence: 0.91, source: 'sa-default' },\n    { pattern: 'SECURITY', account: '7620', accountName: 'Security Services', vatApplicable: true, confidence: 0.93, source: 'sa-default' },\n    { pattern: 'ADT', account: '7620', accountName: 'Security Services', vatApplicable: true, confidence: 0.91, source: 'sa-default' },\n    { pattern: 'ENGEN', account: '7400', accountName: 'Fuel & Oil', vatApplicable: true, confidence: 0.86, source: 'sa-default' },\n    { pattern: 'SHELL', account: '7400', accountName: 'Fuel & Oil', vatApplicable: true, confidence: 0.91, source: 'sa-default' },\n    { pattern: 'SASOL', account: '7400', accountName: 'Fuel & Oil', vatApplicable: true, confidence: 0.88, source: 'sa-default' },\n    { pattern: 'BP', account: '7400', accountName: 'Fuel & Oil', vatApplicable: true, confidence: 0.95, source: 'sa-default' },\n    { pattern: 'CALTEX', account: '7400', accountName: 'Fuel & Oil', vatApplicable: true, confidence: 0.85, source: 'sa-default' },\n    { pattern: 'TOTAL', account: '7400', accountName: 'Fuel & Oil', vatApplicable: true, confidence: 0.91, source: 'sa-default' },\n    { pattern: 'ASTRON', account: '7400', accountName: 'Fuel & Oil', vatApplicable: true, confidence: 0.9, source: 'sa-default' },\n    { pattern: 'PUMA', account: '7400', accountName: 'Fuel & Oil', vatApplicable: true, confidence: 0.95, source: 'sa-default' },\n    { pattern: 'SANRAL', account: '7400', accountName: 'Toll Fees', vatApplicable: true, confidence: 0.85, source: 'sa-default' },\n    { pattern: 'E TOLL', account: '7400', accountName: 'Toll Fees', vatApplicable: true, confidence: 0.87, source: 'sa-default' },\n    { pattern: 'BAKWERA', account: '7400', accountName: 'Toll Fees', vatApplicable: true, confidence: 0.93, source: 'sa-default' },\n    { pattern: 'N3TC', account: '7400', accountName: 'Toll Fees', vatApplicable: true, confidence: 0.87, source: 'sa-default' },\n    { pattern: 'AUTOZONE', account: '7450', accountName: 'Vehicle Repairs & Maintenance', vatApplicable: true, confidence: 0.94, source: 'sa-default' },\n    { pattern: 'MIDAS', account: '7450', accountName: 'Vehicle Repairs & Maintenance', vatApplicable: true, confidence: 0.85, source: 'sa-default' },\n    { pattern: 'TIGER WHEEL', account: '7450', accountName: 'Vehicle Repairs & Maintenance', vatApplicable: true, confidence: 0.88, source: 'sa-default' },\n    { pattern: 'SUPA QUICK', account: '7450', accountName: 'Vehicle Repairs & Maintenance', vatApplicable: true, confidence: 0.89, source: 'sa-default' },\n    { pattern: 'HI Q', account: '7450', accountName: 'Vehicle Repairs & Maintenance', vatApplicable: true, confidence: 0.86, source: 'sa-default' },\n    { pattern: 'PG GLASS', account: '7450', accountName: 'Vehicle Repairs & Maintenance', vatApplicable: true, confidence: 0.89, source: 'sa-default' },\n    { pattern: 'GLASFIT', account: '7450', accountName: 'Vehicle Repairs & Maintenance', vatApplicable: true, confidence: 0.86, source: 'sa-default' },\n    { pattern: 'TRACKER', account: '7460', accountName: 'Vehicle Tracking', vatApplicable: true, confidence: 0.92, source: 'sa-default' },\n    { pattern: 'SHOPRITE', account: '7600', accountName: 'Consumables & Groceries', vatApplicable: false, confidence: 0.88, source: 'sa-default' },\n    { pattern: 'CHECKERS', account: '7600', accountName: 'Consumables & Groceries', vatApplicable: false, confidence: 0.89, source: 'sa-default' },\n    { pattern: 'SPAR', account: '7600', accountName: 'Consumables & Groceries', vatApplicable: false, confidence: 0.88, source: 'sa-default' },\n    { pattern: 'PICK N PAY', account: '7600', accountName: 'Consumables & Groceries', vatApplicable: false, confidence: 0.89, source: 'sa-default' },\n    { pattern: 'WOOLWORTHS', account: '7600', accountName: 'Consumables & Groceries', vatApplicable: false, confidence: 0.94, source: 'sa-default' },\n    { pattern: 'MAKRO', account: '7600', accountName: 'Consumables & Groceries', vatApplicable: true, confidence: 0.95, source: 'sa-default' },\n    { pattern: 'GAME', account: '7600', accountName: 'Consumables & Groceries', vatApplicable: true, confidence: 0.9, source: 'sa-default' },\n    { pattern: 'BUILDERS', account: '7700', accountName: 'Repairs & Maintenance', vatApplicable: true, confidence: 0.91, source: 'sa-default' },\n    { pattern: 'CASHBUILD', account: '7700', accountName: 'Repairs & Maintenance', vatApplicable: true, confidence: 0.92, source: 'sa-default' },\n    { pattern: 'LEROY MERLIN', account: '7700', accountName: 'Repairs & Maintenance', vatApplicable: true, confidence: 0.85, source: 'sa-default' },\n    { pattern: 'CTM', account: '7700', accountName: 'Repairs & Maintenance', vatApplicable: true, confidence: 0.91, source: 'sa-default' },\n    { pattern: 'CHAMBERLAIN', account: '7700', accountName: 'Repairs & Maintenance', vatApplicable: true, confidence: 0.93, source: 'sa-default' },\n    { pattern: 'KLINGSPOR', account: '7700', accountName: 'Repairs & Maintenance', vatApplicable: true, confidence: 0.88, source: 'sa-default' },\n    { pattern: 'TAKEALOT', account: '7650', accountName: 'Office Supplies & Equipment', vatApplicable: true, confidence: 0.94, source: 'sa-default' },\n    { pattern: 'INCREDIBLE', account: '7650', accountName: 'Office Supplies & Equipment', vatApplicable: true, confidence: 0.95, source: 'sa-default' },\n    { pattern: 'BISON', account: '7650', accountName: 'Office Supplies & Equipment', vatApplicable: true, confidence: 0.93, source: 'sa-default' },\n    { pattern: 'WALTONS', account: '7650', accountName: 'Stationery & Printing', vatApplicable: true, confidence: 0.9, source: 'sa-default' },\n    { pattern: 'CNA', account: '7650', accountName: 'Stationery & Printing', vatApplicable: true, confidence: 0.93, source: 'sa-default' },\n    { pattern: 'PNA', account: '7650', accountName: 'Stationery & Printing', vatApplicable: true, confidence: 0.86, source: 'sa-default' },\n    { pattern: 'POSTNET', account: '7650', accountName: 'Postage & Courier', vatApplicable: true, confidence: 0.89, source: 'sa-default' },\n    { pattern: 'ARAMEX', account: '7650', accountName: 'Postage & Courier', vatApplicable: true, confidence: 0.89, source: 'sa-default' },\n    { pattern: 'DHL', account: '7650', accountName: 'Postage & Courier', vatApplicable: true, confidence: 0.93, source: 'sa-default' },\n    { pattern: 'FEDEX', account: '7650', accountName: 'Postage & Courier', vatApplicable: true, confidence: 0.87, source: 'sa-default' },\n    { pattern: 'DSV', account: '7650', accountName: 'Postage & Courier', vatApplicable: true, confidence: 0.92, source: 'sa-default' },\n    { pattern: 'PEP', account: '7600', accountName: 'Consumables & Groceries', vatApplicable: true, confidence: 0.92, source: 'sa-default' },\n    { pattern: 'UBER', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.86, source: 'sa-default' },\n    { pattern: 'BOLT', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.92, source: 'sa-default' },\n    { pattern: 'GAUTRAIN', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.87, source: 'sa-default' },\n    { pattern: 'FLIGHT', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.94, source: 'sa-default' },\n    { pattern: 'AIRLINK', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.91, source: 'sa-default' },\n    { pattern: 'FLYSAFAIR', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.92, source: 'sa-default' },\n    { pattern: 'LIFT', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.91, source: 'sa-default' },\n    { pattern: 'AVIS', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.94, source: 'sa-default' },\n    { pattern: 'EUROPCAR', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.92, source: 'sa-default' },\n    { pattern: 'HERTZ', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.93, source: 'sa-default' },\n    { pattern: 'CITY LODGE', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.93, source: 'sa-default' },\n    { pattern: 'TSOGO SUN', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.92, source: 'sa-default' },\n    { pattern: 'KFC', account: '7810', accountName: 'Staff Refreshments & Meals', vatApplicable: true, confidence: 0.89, source: 'sa-default' },\n    { pattern: 'MCDONALDS', account: '7810', accountName: 'Staff Refreshments & Meals', vatApplicable: true, confidence: 0.88, source: 'sa-default' },\n    { pattern: 'NANDOS', account: '7810', accountName: 'Staff Refreshments & Meals', vatApplicable: true, confidence: 0.86, source: 'sa-default' },\n    { pattern: 'MAILCHIMP', account: '7820', accountName: 'Advertising & Marketing', vatApplicable: true, confidence: 0.88, source: 'sa-default' },\n    { pattern: 'FACEBOOK', account: '7820', accountName: 'Advertising & Marketing', vatApplicable: true, confidence: 0.94, source: 'sa-default' },\n    { pattern: 'LINKEDIN', account: '7820', accountName: 'Advertising & Marketing', vatApplicable: true, confidence: 0.93, source: 'sa-default' },\n    { pattern: 'TWITTER', account: '7820', accountName: 'Advertising & Marketing', vatApplicable: true, confidence: 0.88, source: 'sa-default' },\n    { pattern: 'CANVA', account: '7820', accountName: 'Advertising & Marketing', vatApplicable: true, confidence: 0.93, source: 'sa-default' },\n    { pattern: 'FIVERR', account: '7830', accountName: 'Consulting Fees', vatApplicable: false, confidence: 0.92, source: 'sa-default' },\n    { pattern: 'UPWORK', account: '7830', accountName: 'Consulting Fees', vatApplicable: false, confidence: 0.92, source: 'sa-default' },\n    { pattern: 'LAW', account: '7830', accountName: 'Legal & Professional Fees', vatApplicable: true, confidence: 0.88, source: 'sa-default' },\n    { pattern: 'ATTORNEY', account: '7830', accountName: 'Legal & Professional Fees', vatApplicable: true, confidence: 0.9, source: 'sa-default' },\n    { pattern: 'ACCOUNTANT', account: '7830', accountName: 'Accounting Fees', vatApplicable: true, confidence: 0.87, source: 'sa-default' },\n    { pattern: 'AUDITOR', account: '7830', accountName: 'Accounting Fees', vatApplicable: true, confidence: 0.88, source: 'sa-default' },\n    { pattern: 'STORAGE', account: '7840', accountName: 'Storage Fees', vatApplicable: true, confidence: 0.86, source: 'sa-default' },\n    { pattern: 'PARKING', account: '7800', accountName: 'Travel & Accommodation', vatApplicable: true, confidence: 0.92, source: 'sa-default' },\n    { pattern: 'WATER', account: '7100', accountName: 'Electricity & Utilities', vatApplicable: true, confidence: 0.94, source: 'sa-default' },\n    { pattern: 'RATES', account: '7100', accountName: 'Municipal Rates & Taxes', vatApplicable: true, confidence: 0.89, source: 'sa-default' },\n    { pattern: 'DONATION', account: '8200', accountName: 'Charitable Donations', vatApplicable: false, confidence: 0.94, source: 'sa-default' },\n    { pattern: 'NSPCA', account: '8200', accountName: 'Charitable Donations', vatApplicable: false, confidence: 0.94, source: 'sa-default' },\n    { pattern: 'GIFT', account: '8210', accountName: 'Gifts', vatApplicable: false, confidence: 0.89, source: 'sa-default' },\n    { pattern: 'FLOWERS', account: '8210', accountName: 'Gifts', vatApplicable: true, confidence: 0.89, source: 'sa-default' },\n    { pattern: 'NETCARE', account: '8300', accountName: 'Medical Aid', vatApplicable: false, confidence: 0.87, source: 'sa-default' },
  ];

  const byType = {
    'Education & Childcare': [
      { pattern: 'STATIONERY', account: '7650', accountName: 'Educational Supplies', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    ],
    'Transport & Logistics': [
      { pattern: 'FLEET', account: '7400', accountName: 'Fleet Management', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    ],
    'Professional Services': [
      { pattern: 'CONSULTING', account: '7830', accountName: 'Consulting Fees', vatApplicable: true, confidence: 0.90, source: 'sa-default' },
    ],
  };

  const specific = byType[businessType] || [];
  const map = new Map();
  for (const r of baseline) map.set(r.pattern.toUpperCase(), r);
  for (const r of specific) map.set(r.pattern.toUpperCase(), r);
  return Array.from(map.values()).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
}

/**
 * Build an industry templateexport function buildIndustryTemplate(businessType) {
  return {
    entityName: '',
    registrationNumber: '',
    businessType,
    vatRegistered: false,
    vatNumber: '',
    accounts: [],
    suggestedRules: rulesForType(businessType),
    isTemplate: true,
  };
}

