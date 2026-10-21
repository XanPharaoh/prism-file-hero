/**
 * Pipeline Rules Engine — Wave 2 tests.
 * Covers: client isolation ("solid wall"), industry template bootstrap for
 * clients with no history, workbook-mined override precedence, accountant
 * manual-rule preservation, match precedence, regex rules, the SA 15/115 VAT
 * split, and unmatched-narration review routing.
 *
 * All rules are written under throwaway client ids and removed afterwards, so
 * real client rule stores in ~/.fiscal-fox are never touched.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import {
  loadClientRules,
  saveClientRules,
  matchRule,
  bootstrapIndustryTemplate,
  bootstrapFromWorkbook,
  addManualRule,
} from '../pipeline/clientRulesEngine.mjs';

const CLIENT_A = `zz-vitest-a-${Date.now()}`;
const CLIENT_B = `zz-vitest-b-${Date.now()}`;
const RULES_DIR = join(homedir(), '.fiscal-fox', 'client-rules');
const MAYA_WORKBOOK = "/mnt/hdd/Write-ups Plugin/Sheets/Maya's Educare 2027.xlsx";
// That workbook lives outside the repository, on the owner's machine only. The two tests that
// mine it are skipped (with this reason) where it is absent, instead of failing a clean checkout.
const hasMayaWorkbook = existsSync(MAYA_WORKBOOK);

afterAll(async () => {
  await fs.rm(join(RULES_DIR, CLIENT_A), { recursive: true, force: true });
  await fs.rm(join(RULES_DIR, CLIENT_B), { recursive: true, force: true });
});

describe('client rules engine (Wave 2)', () => {
  it(
    'bootstraps an industry template with 50+ starter rules for a brand-new client',
    async () => {
      const merged = await bootstrapIndustryTemplate(CLIENT_A, 'Vitest Educare', 'Educare & Childcare');
      expect(merged.isTemplate).toBe(true);
      expect(merged.rules.length).toBeGreaterThanOrEqual(50);
      // Bilingual SA baseline must be present (English + Afrikaans tokens).
      const patterns = merged.rules.map((r: any) => String(r.pattern).toUpperCase());
      expect(patterns).toContain('SALARY');
      expect(patterns).toContain('BANKKOSTE');
    },
    60_000,
  );

  it('keeps client rule stores perfectly isolated (solid wall)', async () => {
    await addManualRule(CLIENT_A, {
      pattern: 'ONLYINACLIENT',
      account: '9999',
      accountName: 'A Only',
      vatApplicable: false,
    });
    const b = await loadClientRules(CLIENT_B);
    const leaked = (b.rules ?? []).some((r: any) => r.pattern === 'ONLYINACLIENT');
    expect(leaked).toBe(false);
  });

  it.skipIf(!hasMayaWorkbook)(
    'mines workbook rules that upgrade the starter template (Maya fixture)',
    async () => {
      const merged = await bootstrapFromWorkbook(CLIENT_A, "Maya's Educare", MAYA_WORKBOOK);
      expect(merged.rules.length).toBeGreaterThan(0);
      // Workbook-mined tokens the generic template could not know.
      const patterns = merged.rules.map((r: any) => String(r.pattern).toUpperCase());
      const mined = patterns.some((p: string) => p.includes('SUPERSPAR') || p.includes('CRECHE'));
      expect(mined).toBe(true);
      // Entity facts flow from the workbook, not the template.
      expect(String(merged.clientName)).toContain('Maya');
    },
    180_000,
  );

  it.skipIf(!hasMayaWorkbook)(
    'preserves accountant-crafted manual rules across a workbook re-bootstrap',
    async () => {
      const before = await loadClientRules(CLIENT_A);
      expect(
        before.rules.some((r: any) => r.source === 'manual' && r.pattern === 'ONLYINACLIENT'),
      ).toBe(true);

      // Re-mine the same workbook; the manual rule must survive the merge.
      await bootstrapFromWorkbook(CLIENT_A, "Maya's Educare", MAYA_WORKBOOK);
      const after = await loadClientRules(CLIENT_A);
      const manual = after.rules.find((r: any) => r.pattern === 'ONLYINACLIENT');
      expect(manual).toBeTruthy();
      expect(manual.source).toBe('manual');
      expect(manual.account).toBe('9999');
    },
    180_000,
  );

  it('prefers the highest-confidence rule when patterns overlap', async () => {
    await saveClientRules(CLIENT_B, {
      clientId: CLIENT_B,
      clientName: 'Vitest B',
      vatRegistered: false,
      vatRate: 0.15,
      vatNumber: '',
      businessType: 'test',
      defaultExpenseAccount: '8000',
      rules: [
        { pattern: 'CHECKERS', account: '7600', accountName: 'Groceries', vatApplicable: true, confidence: 0.8, source: 'manual' },
        { pattern: 'CHECKERS HYPER', account: '7601', accountName: 'Bulk Groceries', vatApplicable: true, confidence: 0.95, source: 'manual' },
      ],
    } as any);
    const rules = await loadClientRules(CLIENT_B);
    const hit = matchRule('POS PURCHASE CHECKERS HYPER WINELANDS', rules);
    expect(hit?.account).toBe('7601');
  });

  it('supports regex: rules for narration shapes', async () => {
    const rules = await loadClientRules(CLIENT_B);
    rules.rules.push({
      pattern: 'regex:SARS[-\\s]?(EFILING|PAYMENT)',
      account: '6020',
      accountName: 'Taxes & Levies',
      vatApplicable: false,
      confidence: 0.9,
      source: 'manual',
    });
    expect(matchRule('SARS EFILING 202603', rules)?.account).toBe('6020');
    expect(matchRule('SARS-PAYMENT 4471', rules)?.account).toBe('6020');
    expect(matchRule('SARSONS BRAAI PACK', rules)).toBeNull();
  });

  it('splits VAT out of VAT-inclusive amounts at 15/115 only when registered', async () => {
    const { categorizeTransactions } = await import('../pipeline/transactionCategorizer.mjs');
    const txs = [{ description: 'CHECKERS HYPER WINELANDS', debit: '115.00', credit: '0.00' }];

    const registered = { ...(await loadClientRules(CLIENT_B)), vatRegistered: true, vatRate: 0.15 };
    const [hit] = await categorizeTransactions(txs, registered, { useAiFallback: false });
    expect(hit.account).toBe('7601');
    expect(hit.vatAmount).toBe('15.00');

    const notRegistered = { ...registered, vatRegistered: false };
    const [noVat] = await categorizeTransactions(txs, notRegistered, { useAiFallback: false });
    expect(noVat.vatAmount).toBe('0.00');
  });

  it('routes unmatched narrations to review instead of guessing (no AI fallback)', async () => {
    const { categorizeTransactions } = await import('../pipeline/transactionCategorizer.mjs');
    const rules = await loadClientRules(CLIENT_B);
    const [row] = await categorizeTransactions(
      [{ description: 'QZXVQX UNMATCHEDZQ PURCHASE', debit: '10.00', credit: '0.00' }],
      rules,
      { useAiFallback: false },
    );
    expect(row.requiresReview).toBe(true);
    expect(row.confidence).toBe(0);
  });
});