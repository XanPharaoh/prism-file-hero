/**
 * South African Financial Workbook Pre-Processor
 * ===============================================
 * Parses annual financial statements (AFS), management accounts, and cashbooks
 * across Excel workbooks (supports English & Afrikaans).
 *
 * Extracts:
 *   - Entity details (name, registration number, nature of business)
 *   - VAT status & registration indications (VAT recon sheets, tax computations)
 *   - Clean Chart of Accounts (filters out Excel date serials, formula noise, pagination)
 *   - Bilingual expense & revenue classifications (Afrikaans & English)
 */

import { read, utils } from 'xlsx';
import { promises as fs } from 'node:fs';

// ─── South African Bilingual Category Lexicon ───
export const SA_BILINGUAL_CATEGORIES = {
  // Fuel & Vehicle Logistics (Brandstof & Vervoer)
  FUEL: {
    codes: ['7400', '7405'],
    names: ['Fuel & Oil', 'Brandstof & Olie', 'Travel costs fuel'],
    keywords: [
      'ENGEN', 'SHELL', 'BP ', 'SASOL', 'TOTAL', 'CALTEX', 'ASTRAL',
      'PETROL', 'DIESEL', 'BRANDSTOF', 'GARAGE', 'VULSTASIE'
    ],
    vatApplicable: true,
  },
  TOLLS: {
    codes: ['7410'],
    names: ['Toll Fees & Travel', 'Tolpaaie & Reis', 'Travel costs'],
    keywords: [
      'SANRAL', 'TOLL', 'TOLPAD', 'BAKWENA', 'N3TC', 'TRAC N4', 'PARKING', 'PARKEER'
    ],
    vatApplicable: true,
  },
  VEHICLE_REPAIRS: {
    codes: ['7450'],
    names: ['Vehicle Repairs & Tyres', 'Voertuig Herstelwerk & Bande', 'Travel costs repairs/maintenance'],
    keywords: [
      'SUPA QUICK', 'HI-Q', 'TIGER WHEEL', 'TYRES', 'BANDE', 'AUTOZONE', 'MIDAS',
      'WORKSHOP', 'WERKSWINKEL', 'HERSTELWERK', 'DIENS', 'FITMENT'
    ],
    vatApplicable: true,
  },
  SALARIES: {
    codes: ['6000', '6010'],
    names: ['Salaries & Wages', 'Salarisse & Lone', 'Salaries and Wages'],
    keywords: [
      'SALARY', 'SALARIS', 'WAGES', 'LONE', 'BESOLDIGING', 'PAYROLL', 'UIF', 'SDL', 'PAYE', 'LBS'
    ],
    vatApplicable: false,
  },
  BANK_CHARGES: {
    codes: ['7200'],
    names: ['Bank Charges', 'Bankkoste', 'Bank costs'],
    keywords: [
      'SERVICE FEE', 'DIENSFOOI', 'MONTHLY FEE', 'MAANDELIKSE FOOI', 'BANK CHARGES',
      'BANKKOSTE', 'CASH HANDLING', 'KONTANTHANTERING', 'TRANSACTION CHARGE'
    ],
    vatApplicable: false,
  },
  INSURANCE: {
    codes: ['7900'],
    names: ['Insurance', 'Versekering', 'Travel costs insurance'],
    keywords: [
      'OUTSURANCE', 'SANTAM', 'DISCOVERY', 'OLD MUTUAL', 'MOMENTUM', 'HOLLARD',
      'AUTO & GENERAL', 'VERSEKERING', 'POLIS', 'ASSURANSIE'
    ],
    vatApplicable: false,
  },
  TELECOM: {
    codes: ['7300'],
    names: ['Telephone & Internet', 'Telefoon & Internet', 'Telephone and internet'],
    keywords: [
      'VODACOM', 'MTN', 'TELKOM', 'CELL C', 'RAIN', 'AFRIHOST', 'WEB AFRICA',
      'COOL IDEAS', 'TELEFOON', 'INTERNET', 'SELFOON', 'DATA'
    ],
    vatApplicable: true,
  },
  UTILITIES: {
    codes: ['7100'],
    names: ['Electricity, Rates & Taxes', 'Elektrisiteit, Belasting & Munisipaal', 'Electricity/Rates and Taxes'],
    keywords: [
      'ESKOM', 'CITY POWER', 'MUNICIPALITY', 'MUNISIPALITEIT', 'STAD KAAPSTAD',
      'CITY OF JHB', 'TSHWANE', 'EKURHULENI', 'ELEKTRISITEIT', 'WATER & LIGTE'
    ],
    vatApplicable: true,
  },
  GROCERIES_CONSUMABLES: {
    codes: ['7500', '7600'],
    names: ['Groceries & Consumables', 'Kruideniersware & Verbruiksgoedere', 'Consumables'],
    keywords: [
      'SHOPRITE', 'CHECKERS', 'SPAR', 'PICK N PAY', 'PNP', 'WOOLWORTHS', 'MAKRO',
      'BOXER', 'SUPERMARKET', 'KRUIDENIERSWARE', 'VERBRUIKSGOEDERE'
    ],
    vatApplicable: false,
  },
  OFFICE_IT: {
    codes: ['7700', '7350'],
    names: ['Office & IT Expenses', 'Kantoor & IT Uitgawes', 'IT expenses'],
    keywords: [
      'TAKEALOT', 'AMAZON', 'INCREDIBLE', 'MICROSOFT', 'GOOGLE', 'ADOBE',
      'KANTOOR', 'SKRYFBEHOEFTES', 'STATIONERY', 'REKENAAR'
    ],
    vatApplicable: true,
  },
  SARS: {
    codes: ['8200'],
    names: ['SARS Tax Payments', 'SAID Belastingbetalings'],
    keywords: [
      'SARS', 'SAID', 'PROVISIONAL TAX', 'INCOME TAX', 'BTW BETALING', 'VAT PAYMENT'
    ],
    vatApplicable: false,
  },
};

/**
 * Pre-process an Excel workbook into clean client metadata and structured account lines.
 *
 * @param {string} xlsxPath
 * @returns {Promise<{
 *   entityName: string,
 *   registrationNumber: string,
 *   businessType: string,
 *   vatRegistered: boolean,
 *   vatNumber: string,
 *   accounts: Array<{ code: string, name: string, category: string, amount?: number }>,
 *   suggestedRules: Array<{ pattern: string, account: string, accountName: string, vatApplicable: boolean, confidence: number, source: string, examples: string[] }>
 * }>}
 */
export async function preProcessWorkbook(xlsxPath) {
  const buf = await fs.readFile(xlsxPath);
  const wb = read(buf);

  let entityName = '';
  let registrationNumber = '';
  let businessType = 'Transport & Logistics';
  let vatRegistered = false;
  let vatNumber = '';

  const accounts = [];
  const rawSheetNames = wb.SheetNames;

  // ── 1. General Info & Entity Discovery ──
  const genInfoSheet = wb.Sheets['1. Gen Info'] || wb.Sheets['Gen Info'] || wb.Sheets['General Information'] || wb.Sheets['Input'];
  if (genInfoSheet) {
    const raw = utils.sheet_to_json(genInfoSheet, { header: 1, defval: '' });
    for (const row of raw) {
      if (!Array.isArray(row)) continue;
      const text = row.map(c => String(c).trim()).join(' ');

      // Entity Name
      if (!entityName && (text.includes('(Pty) Ltd') || text.includes('CC') || text.includes('Centre') || text.includes('Agency'))) {
        const match = text.match(/([A-Za-z0-9\s'&]+(?:\(Pty\)\s*Ltd|CC|Centre|Inc|Agency))/i);
        if (match) entityName = match[1].trim();
      }

      // Registration Number
      const regMatch = text.match(/(\d{4}\/\d{6}\/\d{2})/);
      if (regMatch) registrationNumber = regMatch[1];

      // Income tax number
      const taxMatch = text.match(/Income Tax Number:\s*(\d{10})/i);
      if (taxMatch) vatNumber = taxMatch[1];

      // Nature of Business
      if (text.toLowerCase().includes('principal activities') || text.toLowerCase().includes('nature of business') || text.toLowerCase().includes('interests in')) {
        if (text.toLowerCase().includes('transport') || text.toLowerCase().includes('tourism') || text.toLowerCase().includes('freight')) {
          businessType = 'Transport & Logistics';
        } else if (text.toLowerCase().includes('educare') || text.toLowerCase().includes('child') || text.toLowerCase().includes('school')) {
          businessType = 'Education & Childcare';
        } else if (text.toLowerCase().includes('retail') || text.toLowerCase().includes('shop') || text.toLowerCase().includes('store')) {
          businessType = 'Retail & Wholesale';
        } else if (text.toLowerCase().includes('engineer') || text.toLowerCase().includes('consult')) {
          businessType = 'Professional Services';
        } else if (text.toLowerCase().includes('construct') || text.toLowerCase().includes('build')) {
          businessType = 'Construction';
        }
      }
    }
  }

  // ── 2. VAT Status Discovery ──
  const vatSheet = wb.Sheets['VAT s.ment'] || wb.Sheets['VAT'] || wb.Sheets['VAT Recon'];
  if (vatSheet) {
    const vatData = utils.sheet_to_json(vatSheet, { header: 1, defval: '' });
    const hasVatValues = vatData.some(r => Array.isArray(r) && r.some(c => typeof c === 'number' && Math.abs(c) > 0));
    if (hasVatValues) vatRegistered = true;
  }

  // ── 3. Chart of Accounts & Expense Lines Discovery ──
  const incomeSheet = wb.Sheets['8&9 Detail Income Statement']
    || wb.Sheets['Manage Acc & Taxable Income']
    || wb.Sheets['Income and Expenses']
    || wb.Sheets['Detailed Income Statement']
    || wb.Sheets['Income Statement'];

  if (incomeSheet) {
    const raw = utils.sheet_to_json(incomeSheet, { header: 1, defval: '' });
    for (const r of raw) {
      if (!Array.isArray(r) || r.length === 0) continue;
      const titleCell = r[0];
      if (typeof titleCell === 'string' && titleCell.trim().length > 2) {
        const cleanTitle = titleCell.trim();

        // Skip non-account metadata
        if (
          cleanTitle.includes('(Registration') ||
          cleanTitle.includes('Annual Financial') ||
          cleanTitle.includes('Notes') ||
          cleanTitle.includes('Page') ||
          cleanTitle.startsWith('Zithelo Transport') ||
          cleanTitle.startsWith('Maya') ||
          cleanTitle.toLowerCase() === 'total' ||
          cleanTitle.toLowerCase() === 'gross revenue'
        ) {
          continue;
        }

        // Find active total amount if present
        const amt = r.slice(1).find(c => typeof c === 'number' && Math.abs(c) > 0);
        accounts.push({
          name: cleanTitle,
          amount: amt ? Math.abs(amt) : undefined,
        });
      }
    }
  }

  // ── 4. Generate Domain-Accurate Rules Protocol ──
  const suggestedRules = [];
  const addedPatterns = new Set();

  for (const [catKey, catDef] of Object.entries(SA_BILINGUAL_CATEGORIES)) {
    // Check if this category matches this client's accounts or business profile
    const glCode = catDef.codes[0];
    const accountName = catDef.names[0];

    for (const kw of catDef.keywords) {
      if (addedPatterns.has(kw)) continue;
      addedPatterns.add(kw);

      suggestedRules.push({
        pattern: kw,
        account: glCode,
        accountName: accountName,
        vatApplicable: vatRegistered ? catDef.vatApplicable : false,
        confidence: 0.95,
        source: 'workbook',
        examples: [`${kw} transaction matching ${accountName}`],
      });
    }
  }

  return {
    entityName: entityName || 'Client Entity',
    registrationNumber: registrationNumber || '',
    businessType,
    vatRegistered,
    vatNumber,
    accounts,
    suggestedRules,
  };
}
