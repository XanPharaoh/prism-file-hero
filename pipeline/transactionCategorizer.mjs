/**
 * Transaction Categorizer
 * Applies client-specific rules to categorize extracted transactions.
 * Uses a two-phase approach:
 *   1. Rule-based match (fast, deterministic, uses clientRulesEngine)
 *   2. AI fallback (qwen2.5vl reasoning for unmatched transactions)
 *
 * Output: transactions with account, accountName, vatAmount, confidence fields added.
 */

import { ollamaChat } from './ollamaVision.mjs';
import { matchRule } from './clientRulesEngine.mjs';

// ─── SA Chart of Accounts — default mapping used when no client rule exists ──

const SA_DEFAULT_CATEGORIES = {
  // Income
  'SALARY':         { account: '4000', accountName: 'Salaries Received',     vatApplicable: false },
  'WAGES':          { account: '4000', accountName: 'Wages',                  vatApplicable: false },
  'RENTAL INCOME':  { account: '4100', accountName: 'Rental Income',          vatApplicable: true  },
  // Bank charges
  'SERVICE FEE':    { account: '7200', accountName: 'Bank Charges',           vatApplicable: false },
  'MONTHLY FEE':    { account: '7200', accountName: 'Bank Charges',           vatApplicable: false },
  'BANK CHARGES':   { account: '7200', accountName: 'Bank Charges',           vatApplicable: false },
  // Common expenses
  'ESKOM':          { account: '7100', accountName: 'Electricity',            vatApplicable: true  },
  'CITY POWER':     { account: '7100', accountName: 'Electricity',            vatApplicable: true  },
  'MUNICIPALITY':   { account: '7110', accountName: 'Rates & Taxes',          vatApplicable: false },
  'VODACOM':        { account: '7300', accountName: 'Telephone & Data',       vatApplicable: true  },
  'MTN ':           { account: '7300', accountName: 'Telephone & Data',       vatApplicable: true  },
  'TELKOM':         { account: '7300', accountName: 'Telephone & Data',       vatApplicable: true  },
  'CELL C':         { account: '7300', accountName: 'Telephone & Data',       vatApplicable: true  },
  'RAIN ':          { account: '7300', accountName: 'Telephone & Data',       vatApplicable: true  },
  'PETROL':         { account: '7400', accountName: 'Fuel & Oil',             vatApplicable: true  },
  'FUEL':           { account: '7400', accountName: 'Fuel & Oil',             vatApplicable: true  },
  'ENGEN':          { account: '7400', accountName: 'Fuel & Oil',             vatApplicable: true  },
  'SHELL':          { account: '7400', accountName: 'Fuel & Oil',             vatApplicable: true  },
  'BP ':            { account: '7400', accountName: 'Fuel & Oil',             vatApplicable: true  },
  'TOTAL GARAGE':   { account: '7400', accountName: 'Fuel & Oil',             vatApplicable: true  },
  'SASOL':          { account: '7400', accountName: 'Fuel & Oil',             vatApplicable: true  },
  'SHOPRITE':       { account: '7500', accountName: 'Groceries',              vatApplicable: false },
  'CHECKERS':       { account: '7500', accountName: 'Groceries',              vatApplicable: false },
  'PICK N PAY':     { account: '7500', accountName: 'Groceries',              vatApplicable: false },
  'PNP ':           { account: '7500', accountName: 'Groceries',              vatApplicable: false },
  'WOOLWORTHS':     { account: '7500', accountName: 'Groceries',              vatApplicable: false },
  'SPAR':           { account: '7500', accountName: 'Groceries',              vatApplicable: false },
  'MAKRO':          { account: '7600', accountName: 'General Supplies',       vatApplicable: true  },
  'BUILDERS':       { account: '7650', accountName: 'Building Materials',     vatApplicable: true  },
  'CASHBUILD':      { account: '7650', accountName: 'Building Materials',     vatApplicable: true  },
  'TAKEALOT':       { account: '7700', accountName: 'Office Supplies',        vatApplicable: true  },
  'AMAZON':         { account: '7700', accountName: 'Office Supplies',        vatApplicable: true  },
  'CLICKS':         { account: '7800', accountName: 'Medical / Pharmacy',     vatApplicable: false },
  'DISCHEM':        { account: '7800', accountName: 'Medical / Pharmacy',     vatApplicable: false },
  // Transfers
  'CAPITEC SEND':   { account: '8100', accountName: 'Transfers',             vatApplicable: false },
  'EFT PAYMENT':    { account: '8100', accountName: 'Transfers',             vatApplicable: false },
  'INTERNET TRANSFER': { account: '8100', accountName: 'Transfers',         vatApplicable: false },
  // SARS
  'SARS':           { account: '8200', accountName: 'SARS Payments',         vatApplicable: false },
  'UIF ':           { account: '6100', accountName: 'UIF Contributions',      vatApplicable: false },
  // Insurance
  'OUTSURANCE':     { account: '7900', accountName: 'Insurance',              vatApplicable: false },
  'SANTAM':         { account: '7900', accountName: 'Insurance',              vatApplicable: false },
  'OLD MUTUAL':     { account: '7900', accountName: 'Insurance',              vatApplicable: false },
  'MOMENTUM':       { account: '7900', accountName: 'Insurance',              vatApplicable: false },
  'DISCOVERY':      { account: '7900', accountName: 'Insurance',              vatApplicable: false },
};

// ─── Phase 1: Rule-based categorization ──────────────────────────────────────

function categorizeWithRules(transaction, clientRules) {
  // Try client-specific rules first
  const rule = matchRule(transaction.description, clientRules);
  if (rule) {
    return {
      ...transaction,
      account:      rule.account,
      accountName:  rule.accountName,
      vatApplicable: rule.vatApplicable,
      confidence:   rule.confidence ?? 0.9,
      source:       rule.source ?? 'client-rule',
    };
  }

  // Fall back to SA defaults
  const upper = transaction.description.toUpperCase();
  for (const [pattern, mapping] of Object.entries(SA_DEFAULT_CATEGORIES)) {
    if (upper.includes(pattern)) {
      return {
        ...transaction,
        ...mapping,
        confidence: 0.75,
        source: 'sa-default',
      };
    }
  }

  return null; // No match — send to AI
}

// ─── Phase 2: AI categorization for unmatched transactions ───────────────────

const AI_CATEGORIZE_SYSTEM = `You are a South African chartered accountant. 
You will be given a list of bank transactions that could not be automatically categorized.
You must assign each one an appropriate chart of accounts category.

Context about South African accounting:
- VAT is 15% (standard rate) on most goods/services. Zero-rated items include basic food (bread, milk, vegetables), exported goods.
- Common account codes: 4000=Income, 5000=Cost of Sales, 6000=Personnel, 7000-7999=Operating Expenses, 8000+=Other
- UIF and PAYE are payroll deductions paid to SARS
- COIDA (Workmen's Compensation) is an annual assessment
- Director Loan Account (DLA) movements are balance sheet items, not income/expense

Return ONLY a JSON array (no markdown) where each object has:
{
  "index": 0,           // original index in input array
  "account": "7500",    // chart of accounts code
  "accountName": "Groceries",
  "vatApplicable": false,
  "vatRate": 0.15,      // or 0 for zero-rated/exempt
  "confidence": 0.85,
  "reasoning": "Short explanation"
}`;

async function categorizeWithAI(transactions, clientRules) {
  if (transactions.length === 0) return [];

  const clientContext = clientRules ? `
Client business type: ${clientRules.businessType}
VAT registered: ${clientRules.vatRegistered}
Client-specific context: ${clientRules.notes || 'None'}` : '';

  const txList = transactions
    .map((t, i) => `${i}. [${t.amount_type || (parseFloat(t.debit) > 0 ? 'DEBIT' : 'CREDIT')}] R${t.debit > '0.00' ? t.debit : t.credit} — "${t.description}"`)
    .join('\n');

  const userMessage = `${clientContext}

Uncategorized transactions to classify:
${txList}

Assign the correct account to each transaction. Return JSON array only.`;

  const raw = await ollamaChat(AI_CATEGORIZE_SYSTEM, userMessage, {
    options: { temperature: 0, num_ctx: 8192 },
  });

  try {
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    }
    const startIdx = cleaned.indexOf('[');
    const endIdx   = cleaned.lastIndexOf(']');
    if (startIdx !== -1 && endIdx !== -1) cleaned = cleaned.slice(startIdx, endIdx + 1);
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[transactionCategorizer] AI parse error:', err.message);
    return [];
  }
}

// ─── VAT calculation ──────────────────────────────────────────────────────────

function calculateVat(transaction, category, clientRules) {
  const vatRate = category.vatRate ?? 0.15;
  if (!clientRules?.vatRegistered || !category.vatApplicable || vatRate === 0) {
    return '0.00';
  }

  const gross = parseFloat(transaction.debit > '0.00' ? transaction.debit : transaction.credit) || 0;
  // SA formula: VAT = gross * (VAT rate / (1 + VAT rate))  — i.e. VAT-inclusive amount
  const vatAmount = gross * (vatRate / (1 + vatRate));
  return vatAmount.toFixed(2);
}

// ─── Main categorization function ────────────────────────────────────────────

/**
 * Categorize an array of extracted transactions for a specific client.
 *
 * @param {Array}  transactions - Raw transaction objects from bankStatementExtractor
 * @param {object} clientRules  - Client rules from clientRulesEngine.loadClientRules()
 * @param {object} opts
 * @param {boolean} [opts.useAiFallback=true] - Use AI for unmatched transactions
 * @param {function} [opts.onProgress]        - Progress callback(done, total)
 * @returns {Promise<CategorizedTransaction[]>}
 */
export async function categorizeTransactions(transactions, clientRules, opts = {}) {
  const { useAiFallback = true, onProgress } = opts;

  const categorized  = [];
  const unmatched    = [];
  const unmatchedIdx = [];

  // Phase 1: Rule-based
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const result = categorizeWithRules(tx, clientRules);

    if (result) {
      const vatAmount = calculateVat(tx, result, clientRules);
      categorized.push({ ...result, vatAmount, categorizedAt: new Date().toISOString() });
    } else {
      unmatched.push(tx);
      unmatchedIdx.push(i);
      categorized.push(null); // placeholder
    }

    if (onProgress) onProgress(i + 1, transactions.length);
  }

  // Phase 2: AI fallback for unmatched
  if (useAiFallback && unmatched.length > 0) {
    console.log(`[transactionCategorizer] ${unmatched.length} transaction(s) need AI categorization…`);

    // Process in batches of 30 to avoid context limits
    const BATCH = 30;
    for (let batchStart = 0; batchStart < unmatched.length; batchStart += BATCH) {
      const batch     = unmatched.slice(batchStart, batchStart + BATCH);
      const batchIdxs = unmatchedIdx.slice(batchStart, batchStart + BATCH);

      const aiResults = await categorizeWithAI(batch, clientRules);

      for (const aiResult of aiResults) {
        const localIdx = aiResult.index;
        if (localIdx < 0 || localIdx >= batch.length) continue;
        const globalIdx = batchIdxs[localIdx];

        const tx = unmatched[localIdx];
        const vatAmount = calculateVat(tx, aiResult, clientRules);

        categorized[globalIdx] = {
          ...tx,
          account:       aiResult.account     ?? clientRules?.defaultExpenseAccount ?? '8000',
          accountName:   aiResult.accountName  ?? 'Uncategorized Expense',
          vatApplicable: aiResult.vatApplicable ?? false,
          confidence:    aiResult.confidence    ?? 0.5,
          reasoning:     aiResult.reasoning     ?? '',
          vatAmount,
          source:        'ai-fallback',
          categorizedAt: new Date().toISOString(),
        };
      }
    }
  }

  // Fill any remaining nulls (AI returned no match) with a "needs-review" placeholder
  return categorized.map((tx, i) => {
    if (tx !== null) return tx;
    const raw = transactions[i];
    return {
      ...raw,
      account:      clientRules?.defaultExpenseAccount ?? '8000',
      accountName:  'Uncategorized — Review Required',
      vatApplicable: false,
      confidence:   0.0,
      source:       'unmatched',
      vatAmount:    '0.00',
      requiresReview: true,
      categorizedAt: new Date().toISOString(),
    };
  });
}

export { matchRule, SA_DEFAULT_CATEGORIES };
