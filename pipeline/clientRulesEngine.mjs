/**
 * Client Rules Engine
 * Manages per-client categorization rules. Rules are stored as JSON in
 * ~/fiscal-fox-rules/<client_id>/rules.json and are NEVER shared between clients.
 *
 * Rules are bootstrapped by:
 *   1. Ingesting historical workbooks (XLSX) for a client
 *   2. Using qwen2.5vl to infer patterns from those workbooks
 *   3. Manual overrides by the accountant
 *
 * Rule structure:
 *   {
 *     clientId: string,
 *     clientName: string,
 *     vatRegistered: boolean,
 *     vatRate: number,               // 0.15 for SA standard
 *     vatNumber: string,
 *     businessType: string,          // "transport", "educare", "retail", etc.
 *     defaultExpenseAccount: string, // fallback GL code if no rule matches
 *     rules: [
 *       {
 *         pattern: "SHOPRITE",       // substring match (case-insensitive) on description
 *         account: "5010",           // Chart of Accounts code in Fiscal Fox
 *         accountName: "Groceries",
 *         vatApplicable: boolean,
 *         confidence: 0.95,          // how confident the rule is
 *         source: "workbook" | "manual" | "ai-inferred",
 *         examples: ["SHOPRITE CHECKERS LANGA", "SHOPRITE #245"]
 *       }
 *     ]
 *   }
 */

import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { ollamaChat } from './ollamaVision.mjs';
import { preProcessWorkbook } from './workbookPreProcessor.mjs';

const RULES_DIR = join(homedir(), '.fiscal-fox', 'client-rules');

// Ensure the rules directory exists
async function ensureRulesDir(clientId) {
  const dir = join(RULES_DIR, clientId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// ─── Load / Save ──────────────────────────────────────────────────────────────

export async function loadClientRules(clientId) {
  const path = join(RULES_DIR, clientId, 'rules.json');
  try {
    const raw = await fs.readFile(path, 'utf-8');
    return JSON.parse(raw);
  } catch {
    // Return empty ruleset
    return {
      clientId,
      clientName: clientId,
      vatRegistered: false,
      vatRate: 0.15,
      vatNumber: '',
      businessType: 'unknown',
      defaultExpenseAccount: '8000',
      rules: [],
    };
  }
}

export async function saveClientRules(clientId, rules) {
  await ensureRulesDir(clientId);
  const path = join(RULES_DIR, clientId, 'rules.json');
  await fs.writeFile(path, JSON.stringify(rules, null, 2), 'utf-8');
  console.log(`[clientRulesEngine] Saved ${rules.rules.length} rule(s) for client ${clientId}`);
}

// ─── Match a transaction against rules ───────────────────────────────────────

/**
 * Try to match a transaction description against the client's rule set.
 * Returns the best matching rule or null.
 */
export function matchRule(description, clientRules) {
  if (!description || !clientRules?.rules?.length) return null;

  const upper = description.toUpperCase();

  // Sort rules by confidence descending to prefer the most specific match
  const sorted = [...clientRules.rules].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

  for (const rule of sorted) {
    if (!rule.pattern) continue;
    // Support regex patterns (prefix with "regex:")
    if (rule.pattern.startsWith('regex:')) {
      try {
        const re = new RegExp(rule.pattern.slice(6), 'i');
        if (re.test(description)) return rule;
      } catch { /* invalid regex, skip */ }
    } else {
      if (upper.includes(rule.pattern.toUpperCase())) return rule;
    }
  }
  return null;
}

// ─── Bootstrap rules from historical workbook ─────────────────────────────────

const WORKBOOK_BOOTSTRAP_SYSTEM = `You are an expert South African chartered accountant and bookkeeper.
You will be given a list of transactions from a historical workbook for a specific client.
Each transaction has a description and an account name that was assigned by a human accountant.

Your task is to:
1. Identify recurring patterns (merchant names, payment types) and the account they map to.
2. Infer the business type from the transaction mix.
3. Identify whether the client is VAT registered.
4. Build a set of categorization rules.

Return ONLY a JSON object with this exact structure (no markdown, no explanation):
{
  "businessType": "transport|educare|retail|construction|professional|other",
  "vatRegistered": true|false,
  "vatNumber": "" or "4312345678",
  "rules": [
    {
      "pattern": "UPPERCASE_KEYWORD",
      "account": "GL_CODE_OR_NAME",
      "accountName": "Human readable account name",
      "vatApplicable": true|false,
      "confidence": 0.0-1.0,
      "source": "workbook",
      "examples": ["example description that matched this rule"]
    }
  ]
}

Focus on the TOP 40 most common patterns. Higher confidence for frequently recurring patterns.`;

/**
 * High-accuracy AFS & workbook bootstrap using the South African pre-processor.
 */
export async function bootstrapFromWorkbook(clientId, clientName, xlsxPath) {
  console.log(`[clientRulesEngine] Pre-processing workbook: ${xlsxPath}`);
  const preProcessed = await preProcessWorkbook(xlsxPath);

  const existing = await loadClientRules(clientId);
  const merged = {
    ...existing,
    clientId,
    clientName: preProcessed.entityName || clientName || existing.clientName,
    businessType: preProcessed.businessType || existing.businessType,
    vatRegistered: preProcessed.vatRegistered ?? existing.vatRegistered,
    vatNumber: preProcessed.vatNumber || existing.vatNumber,
    rules: mergeRules(existing.rules, preProcessed.suggestedRules ?? []),
  };

  await saveClientRules(clientId, merged);
  console.log(`[clientRulesEngine] Pre-processor bootstrap complete: ${merged.rules.length} bilingual rules for ${merged.clientName} (${merged.businessType})`);
  return merged;
}

function mergeRules(existing, incoming) {
  const map = new Map();
  for (const rule of existing) {
    map.set(rule.pattern?.toUpperCase(), rule);
  }
  for (const rule of incoming) {
    const key = rule.pattern?.toUpperCase();
    if (!key) continue;
    
    if (map.has(key)) {
      const existingRule = map.get(key);
      if (existingRule.account !== rule.account) {
        // Surface conflict for accountant to resolve
        map.set(key, {
          ...existingRule, // keep the template rule as base
          hasConflict: true,
          conflictDetails: {
            oldAccount: existingRule.account,
            oldAccountName: existingRule.accountName,
            newAccount: rule.account,
            newAccountName: rule.accountName
          }
        });
      } else if ((rule.confidence ?? 0) > (existingRule.confidence ?? 0)) {
        map.set(key, rule);
      }
    } else {
      map.set(key, rule);
    }
  }
  return Array.from(map.values()).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
}

// ─── Add a single manual rule override ───────────────────────────────────────

export async function addManualRule(clientId, rule) {
  const rules = await loadClientRules(clientId);
  const key = rule.pattern?.toUpperCase();
  if (!key) throw new Error('Rule must have a pattern');

  const idx = rules.rules.findIndex((r) => r.pattern?.toUpperCase() === key);
  if (idx >= 0) {
    rules.rules[idx] = { ...rules.rules[idx], ...rule, source: 'manual', confidence: 1.0 };
  } else {
    rules.rules.push({ ...rule, source: 'manual', confidence: 1.0 });
  }

  await saveClientRules(clientId, rules);
  return rules;
}

// ─── List all clients with rules ─────────────────────────────────────────────

export async function listClientsWithRules() {
  try {
    const entries = await fs.readdir(RULES_DIR, { withFileTypes: true });
    const clients = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const rules = await loadClientRules(entry.name);
        clients.push({ clientId: entry.name, clientName: rules.clientName, ruleCount: rules.rules.length });
      } catch { /* skip */ }
    }
    return clients;
  } catch {
    return [];
  }
}

// ─── Industry Template Bootstrap ──────────────────────────────────────────────

/**
 * Bootstrap client rules from an industry template instead of a workbook.
 * Useful when no historical workbook is available but the business type is known.
 *
 * @param {string} clientId   - Fiscal Fox client UUID
 * @param {string} clientName - Human-readable client name
 * @param {string} businessType - e.g. 'Transport & Logistics'
 * @returns {Promise<object>} The merged rules object that was saved
 */
export async function bootstrapIndustryTemplate(clientId, clientName, businessType) {
  const { buildIndustryTemplate } = await import('./workbookPreProcessor.mjs');
  const template = buildIndustryTemplate(businessType);
  const existing = await loadClientRules(clientId);
  const merged = {
    ...existing,
    clientId,
    clientName,
    businessType: template.businessType,
    vatRegistered: false,
    vatNumber: '',
    rules: mergeRules(existing.rules, template.suggestedRules),
    isTemplate: true,
  };
  await saveClientRules(clientId, merged);
  console.log(`[clientRulesEngine] Industry template bootstrap: ${merged.rules.length} rules for ${businessType}`);
  return merged;
}

