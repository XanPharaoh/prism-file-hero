#!/usr/bin/env node
/**
 * Prism File Hero — Agentic Bank Statement Pipeline
 * ===================================================
 * Usage:
 *   node pipeline/run.mjs --statement=<path.pdf> --client=<clientId> [options]
 *
 * Options:
 *   --statement=<path>     Path to the bank statement PDF (required)
 *   --client=<id>          Fiscal Fox client ID (required for direct import)
 *   --fy=<id>              Financial year ID (auto-detected from client if omitted)
 *   --bank-account=<no>    Bank account number shown on the statement
 *   --bootstrap=<workbook> Path to historical XLSX workbook to build/update rules first
 *   --dry-run              Extract and categorize only, don't write to Fiscal Fox
 *   --output=<path>        Write JSON result to this file
 *   --dpi=<180>            PDF render DPI (default 180)
 *   --max-pages=<n>        Limit pages processed
 *   --model=<name>         Ollama model override (default: qwen2.5vl:7b)
 *   --list-clients         List all Fiscal Fox clients and exit
 *   --list-rules           List clients with cached rules and exit
 *   --add-rule             Add a manual rule (interactive prompt)
 *
 * Environment variables:
 *   OLLAMA_URL             Override Ollama URL (default: http://localhost:11434)
 *   OLLAMA_VISION_MODEL    Override model name
 *   FISCAL_FOX_DB          Override path to fiscal_fox.db
 */

import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { promises as fs } from 'node:fs';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { checkOllamaReady, VISION_MODEL } from './ollamaVision.mjs';
import { extractBankStatement } from './bankStatementExtractor.mjs';
import {
  loadClientRules,
  bootstrapRulesFromHistory,
  addManualRule,
  listClientsWithRules,
} from './clientRulesEngine.mjs';
import { categorizeTransactions } from './transactionCategorizer.mjs';
import {
  listClients,
  getActiveFinancialYear,
  writeStagingTransactions,
  notifyReviewRequired,
} from './fiscalFoxBridge.mjs';

// ─── Arg parsing ──────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    statement:     { type: 'string' },
    client:        { type: 'string' },
    fy:            { type: 'string' },
    'bank-account':{ type: 'string' },
    bootstrap:     { type: 'string' },
    'dry-run':     { type: 'boolean', default: false },
    output:        { type: 'string' },
    dpi:           { type: 'string', default: '180' },
    'max-pages':   { type: 'string' },
    model:         { type: 'string' },
    'list-clients':{ type: 'boolean', default: false },
    'list-rules':  { type: 'boolean', default: false },
    'add-rule':    { type: 'boolean', default: false },
    help:          { type: 'boolean', default: false },
  },
  allowPositionals: true,
  strict: false,
});

if (args.model) process.env.OLLAMA_VISION_MODEL = args.model;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function banner(msg) {
  console.log(`\n${'─'.repeat(60)}\n  ${msg}\n${'─'.repeat(60)}`);
}

function prettyTable(rows, cols) {
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const header = cols.map((c, i) => c.padEnd(widths[i])).join('  ');
  const divider = widths.map((w) => '─'.repeat(w)).join('  ');
  console.log(header);
  console.log(divider);
  rows.forEach((r) => console.log(cols.map((c, i) => String(r[c] ?? '').padEnd(widths[i])).join('  ')));
}

// ─── Workbook bootstrap (read XLSX historical transactions) ───────────────────

// ─── Workbook bootstrap (read XLSX historical transactions) ───────────────────

async function readWorkbookTransactions(xlsxPath) {
  try {
    const { read, utils } = await import('xlsx');
    const buf  = await fs.readFile(xlsxPath);
    const wb   = read(buf);
    const rows = [];

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rawRows = utils.sheet_to_json(ws, { header: 1, defval: '' });
      for (const r of rawRows) {
        if (!Array.isArray(r) || r.length === 0) continue;
        const nonBlank = r.filter(c => c !== '' && c !== null && c !== undefined);
        if (nonBlank.length >= 2) {
          const desc = String(nonBlank[0]).trim();
          if (desc.length > 2 && !desc.toLowerCase().startsWith('total') && !desc.toLowerCase().startsWith('page')) {
            rows.push({
              description: desc,
              account: String(sheetName).trim(),
              accountName: desc,
              raw: nonBlank.slice(1).join(' | '),
            });
          }
        }
      }
    }

    // Fallback: if no multi-sheet rows were found, try simple sheet_to_json
    if (rows.length === 0 && wb.SheetNames.length > 0) {
      const ws = wb.Sheets[wb.SheetNames[0]];
      const simple = utils.sheet_to_json(ws, { defval: '' });
      return simple;
    }

    return rows;
  } catch (err) {
    throw new Error(`Cannot read workbook ${xlsxPath}: ${err.message}`);
  }
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

async function runPipeline() {
  // ── List commands ──────────────────────────────────────────────────────────
  if (args.help) {
    console.log((await fs.readFile(new URL(import.meta.url), 'utf-8')).split('\n').slice(1, 35).join('\n'));
    process.exit(0);
  }

  if (args['list-clients']) {
    banner('Fiscal Fox Clients');
    const clients = listClients();
    if (!clients.length) { console.log('No clients found in Fiscal Fox database.'); }
    else prettyTable(clients, ['id', 'name', 'financial_year_id', 'label', 'pipeline_state', 'year_start', 'year_end']);
    process.exit(0);
  }

  if (args['list-rules']) {
    banner('Clients with Categorization Rules');
    const clients = await listClientsWithRules();
    if (!clients.length) { console.log('No rules found. Run with --bootstrap to create rules from a workbook.'); }
    else prettyTable(clients, ['clientId', 'clientName', 'ruleCount']);
    process.exit(0);
  }

  if (args['add-rule']) {
    const rl = readline.createInterface({ input, output });
    const clientId    = await rl.question('Client ID: ');
    const pattern     = await rl.question('Description keyword (e.g. SHOPRITE): ');
    const account     = await rl.question('GL account code (e.g. 7500): ');
    const accountName = await rl.question('Account name (e.g. Groceries): ');
    const vatStr      = await rl.question('VAT applicable? (y/n): ');
    rl.close();

    const rules = await addManualRule(clientId, {
      pattern: pattern.trim().toUpperCase(),
      account: account.trim(),
      accountName: accountName.trim(),
      vatApplicable: vatStr.trim().toLowerCase() === 'y',
      confidence: 1.0,
    });
    console.log(`✅  Rule added. Client ${clientId} now has ${rules.rules.length} rules.`);
    process.exit(0);
  }

  // ── Check Ollama ───────────────────────────────────────────────────────────
  banner('Checking Ollama');
  const { ready, reason, models } = await checkOllamaReady(VISION_MODEL);
  if (!ready) {
    console.error(`❌  Ollama not ready: ${reason}`);
    console.error(`    To pull the model: docker exec ollama-gpu ollama pull ${VISION_MODEL}`);
    process.exit(1);
  }
  console.log(`✅  Ollama ready. Models: ${models.join(', ')}`);

  // ── Bootstrap rules from historical workbook ───────────────────────────────
  if (args.bootstrap) {
    if (!args.client) {
      console.error('❌  --client=<clientId> is required when using --bootstrap');
      process.exit(1);
    }
    banner(`Bootstrapping Rules for Client: ${args.client}`);
    const workbookPath = resolve(args.bootstrap);
    const historicalRows = await readWorkbookTransactions(workbookPath);
    console.log(`  Read ${historicalRows.length} historical item(s) from workbook`);
    const rules = await bootstrapRulesFromHistory(args.client, args.client, historicalRows);
    console.log(`  ✅  ${rules.rules.length} rules created/updated`);

    // If no statement is provided, we are done!
    if (!args.statement) {
      banner('Bootstrap Complete');
      console.log(`  Rules protocol saved for client: ${args.client}`);
      process.exit(0);
    }
  }

  // ── Validate statement if not in bootstrap-only mode ───────────────────────
  if (!args.statement) {
    console.error('❌  --statement=<path.pdf> or --bootstrap=<path.xlsx> is required');
    process.exit(1);
  }

  const statementPath = resolve(args.statement);
  await fs.access(statementPath); // throws if not found

  // ── Load client rules (strict per-client isolation) ───────────────────────
  const clientId = args.client;
  const clientRules = clientId ? await loadClientRules(clientId) : null;

  if (clientId && clientRules) {
    console.log(`\n📋  Client rules loaded: ${clientRules.rules.length} rules for ${clientRules.clientName || clientId}`);
    console.log(`    Business type: ${clientRules.businessType} | VAT registered: ${clientRules.vatRegistered}`);
  } else if (!clientId) {
    console.log('\n⚠️   No --client specified. Will categorize using SA defaults only (no client-specific rules).');
  }

  // ── Phase 1: Extract bank statement ───────────────────────────────────────
  banner(`Extracting Bank Statement: ${statementPath.split('/').pop()}`);

  const extractResult = await extractBankStatement(statementPath, {
    dpi:      parseInt(args.dpi, 10) || 180,
    maxPages: args['max-pages'] ? parseInt(args['max-pages'], 10) : undefined,
    onPageProgress: (page, total) => process.stdout.write(`\r  Processing page ${page}/${total}…`),
  });

  console.log(`\n  ✅  Extracted ${extractResult.transactions.length} transactions from ${extractResult.pageCount} page(s)`);
  console.log(`  🏦  Detected bank: ${extractResult.bank}`);

  if (extractResult.transactions.length === 0) {
    console.error('\n❌  No transactions extracted. Check the PDF quality or try a higher DPI (--dpi=240).');
    process.exit(1);
  }

  // ── Phase 2: Categorize ────────────────────────────────────────────────────
  banner('Categorizing Transactions');

  const categorized = await categorizeTransactions(
    extractResult.transactions,
    clientRules,
    {
      useAiFallback: true,
      onProgress: (done, total) => process.stdout.write(`\r  Categorizing ${done}/${total}…`),
    }
  );

  console.log('\n');
  const highConf   = categorized.filter((t) => (t.confidence ?? 0) >= 0.7).length;
  const needsReview = categorized.filter((t) => (t.confidence ?? 0) < 0.7 || t.requiresReview).length;
  console.log(`  ✅  Categorized: ${highConf} high-confidence, ${needsReview} need accountant review`);

  // ── Print summary table ────────────────────────────────────────────────────
  banner('Transaction Summary (first 20)');
  const preview = categorized.slice(0, 20);
  prettyTable(
    preview.map((t) => ({
      date:        t.date,
      description: t.description.slice(0, 40),
      amount:      parseFloat(t.debit) > 0 ? `-R${t.debit}` : `+R${t.credit}`,
      account:     t.account ?? '—',
      category:    (t.accountName ?? '—').slice(0, 22),
      conf:        ((t.confidence ?? 0) * 100).toFixed(0) + '%',
      vat:         t.vatAmount !== '0.00' ? `R${t.vatAmount}` : '—',
    })),
    ['date', 'description', 'amount', 'account', 'category', 'conf', 'vat']
  );
  if (categorized.length > 20) console.log(`  … and ${categorized.length - 20} more`);

  // ── Write output JSON ──────────────────────────────────────────────────────
  const result = {
    extractedAt:  new Date().toISOString(),
    statementPath,
    bank:         extractResult.bank,
    pageCount:    extractResult.pageCount,
    totalRows:    categorized.length,
    highConfidence: highConf,
    needsReview,
    transactions: categorized,
  };

  if (args.output) {
    await fs.writeFile(resolve(args.output), JSON.stringify(result, null, 2));
    console.log(`\n💾  Full results saved to: ${args.output}`);
  }

  // ── Phase 3: Write to Fiscal Fox (unless --dry-run) ───────────────────────
  if (args['dry-run']) {
    banner('Dry Run Complete');
    console.log('  --dry-run flag set. No data written to Fiscal Fox.');
    process.exit(0);
  }

  if (!clientId) {
    console.log('\n⚠️   No --client specified. Skipping Fiscal Fox import.');
    process.exit(0);
  }

  banner('Writing to Fiscal Fox Staging');

  // Auto-detect financial year if not provided
  const fyId = args.fy ?? getActiveFinancialYear(clientId)?.id;
  if (!fyId) {
    console.error(`❌  No active financial year found for client ${clientId}.`);
    console.error('    Use --fy=<id> or ensure the client has an active financial year in Fiscal Fox.');
    process.exit(1);
  }

  const fyInfo = getActiveFinancialYear(clientId);
  console.log(`  Writing to: ${fyInfo?.label ?? fyId} (${fyInfo?.pipeline_state ?? '—'})`);

  const stats = writeStagingTransactions(
    fyId,
    clientId,
    categorized,
    args['bank-account'] ?? extractResult.bank,
    `ai-pipeline-${new Date().toISOString().slice(0,10)}`
  );

  // ── Phase 4: Notify accountant ─────────────────────────────────────────────
  const notification = await notifyReviewRequired(
    fyInfo?.client_name ?? clientId,
    fyInfo?.label ?? fyId,
    { ...stats, needsReview, highConf, bank: extractResult.bank }
  );

  banner('🎉  Pipeline Complete');
  console.log(`  Client:       ${fyInfo?.client_name ?? clientId}`);
  console.log(`  Period:       ${fyInfo?.label ?? fyId}`);
  console.log(`  Inserted:     ${stats.inserted} transactions`);
  console.log(`  Duplicates:   ${stats.duplicates} (skipped)`);
  console.log(`  Needs review: ${needsReview}`);
  console.log(`  Notification: ${notification.id}`);
  console.log(`\n  🔔  Open Fiscal Fox → Staging Transactions to review and approve.\n`);
}

// ─── Run ───────────────────────────────────────────────────────────────────────

runPipeline().catch((err) => {
  console.error('\n❌  Pipeline failed:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
