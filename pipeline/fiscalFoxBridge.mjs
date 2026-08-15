/**
 * Fiscal Fox Bridge
 * Writes categorized transactions directly into the Fiscal Fox SQLite database.
 * Uses the staging_transactions table as the landing zone.
 *
 * Schema reference (Fiscal Fox v1.3 staging_transactions):
 *   id, financial_year_id, bank_account_number, transaction_date, description,
 *   amount, running_balance, suggested_gl, suggested_rule, suggestion_provenance,
 *   vat_amount, business_percent, vat_applicable, target_account_id,
 *   is_categorized, is_excluded, excluded_reason, excluded_at, created_at
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Default Fiscal Fox database location (Tauri appdata)
const FISCAL_FOX_DB = process.env.FISCAL_FOX_DB
  || join(homedir(), '.local', 'share', 'com.fiscalfox.app', 'fiscal_fox.db');

function openDb() {
  try {
    const db = new Database(FISCAL_FOX_DB);
    // Match the app's pragma settings
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    return db;
  } catch (err) {
    throw new Error(`Cannot open Fiscal Fox database at ${FISCAL_FOX_DB}: ${err.message}`);
  }
}

// ─── Client lookup ────────────────────────────────────────────────────────────

/**
 * List all clients with their active financial years.
 */
export function listClients() {
  const db = openDb();
  try {
    return db.prepare(`
      SELECT c.id, c.name, c.vat_number,
             fy.id AS financial_year_id, fy.label, fy.pipeline_state,
             fy.year_start, fy.year_end
      FROM clients c
      JOIN financial_years fy ON fy.client_id = c.id
      WHERE c.is_active = 1
      ORDER BY c.name, fy.year_start DESC
    `).all();
  } finally {
    db.close();
  }
}

/**
 * Get a specific client's active (or most recent) financial year.
 */
export function getActiveFinancialYear(clientId) {
  const db = openDb();
  try {
    // Prefer the most recent non-CLOSED financial year
    return db.prepare(`
      SELECT fy.id, fy.label, fy.pipeline_state, fy.year_start, fy.year_end,
             c.name AS client_name, c.vat_number
      FROM financial_years fy
      JOIN clients c ON c.id = fy.client_id
      WHERE fy.client_id = ?
        AND fy.pipeline_state NOT IN ('CLOSED')
      ORDER BY fy.year_start DESC
      LIMIT 1
    `).get(clientId);
  } finally {
    db.close();
  }
}

/**
 * Resolve a GL account code (string like "7500") to its database ID for a client.
 * Falls back to creating a placeholder if not found.
 */
export function resolveAccountId(clientId, accountCode, accountName) {
  const db = openDb();
  try {
    // Try exact code match
    const byCode = db.prepare(`
      SELECT id FROM accounts
      WHERE client_id = ? AND code = ? AND is_active = 1
      LIMIT 1
    `).get(clientId, accountCode);
    if (byCode) return byCode.id;

    // Try name match (case-insensitive)
    const byName = db.prepare(`
      SELECT id FROM accounts
      WHERE client_id = ? AND lower(name) = lower(?) AND is_active = 1
      LIMIT 1
    `).get(clientId, accountName ?? '');
    if (byName) return byName.id;

    // Fall back to a generic expense account
    const fallback = db.prepare(`
      SELECT id FROM accounts
      WHERE client_id = ? AND is_bank = 0 AND is_control = 0 AND is_active = 1
        AND (lower(name) LIKE '%expense%' OR lower(name) LIKE '%other%' OR lower(name) LIKE '%miscellaneous%')
      LIMIT 1
    `).get(clientId);
    return fallback?.id ?? null;
  } finally {
    db.close();
  }
}

// ─── Write staging transactions ───────────────────────────────────────────────

/**
 * Insert categorized transactions into the Fiscal Fox staging_transactions table.
 * All insertions are wrapped in a single transaction for atomicity.
 *
 * @param {string}  financialYearId       - The target financial year ID
 * @param {string}  clientId              - Client ID (for account resolution)
 * @param {Array}   categorizedTx         - Transactions from transactionCategorizer
 * @param {string}  [bankAccountNumber]   - Bank account number from statement
 * @param {string}  [importSource]        - Label for the import source (e.g. "AI-import-2026-08")
 * @returns {{ inserted: number, skipped: number, duplicates: number }}
 */
export function writeStagingTransactions(financialYearId, clientId, categorizedTx, bankAccountNumber = '', importSource = 'ai-pipeline') {
  const db = openDb();

  const insert = db.prepare(`
    INSERT INTO staging_transactions (
      id, financial_year_id, bank_account_number,
      transaction_date, description, amount,
      running_balance, suggested_gl, suggested_rule,
      suggestion_provenance, vat_amount, vat_applicable,
      target_account_id, is_categorized, created_at
    ) VALUES (
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, datetime('now')
    )
  `);

  // Check for existing staging rows to avoid duplicate imports
  const checkDuplicate = db.prepare(`
    SELECT id FROM staging_transactions
    WHERE financial_year_id = ? AND transaction_date = ? AND description = ? AND amount = ?
    LIMIT 1
  `);

  let inserted = 0, skipped = 0, duplicates = 0;

  const doInserts = db.transaction(() => {
    for (const tx of categorizedTx) {
      // Skip rows without a valid date
      if (!tx.date) { skipped++; continue; }

      // Amount: negative for debits (money out), positive for credits
      const debitAmt  = parseFloat(tx.debit)  || 0;
      const creditAmt = parseFloat(tx.credit) || 0;
      let amount;
      if (debitAmt > 0 && creditAmt === 0)       amount = (-debitAmt).toFixed(2);
      else if (creditAmt > 0 && debitAmt === 0)  amount = creditAmt.toFixed(2);
      else if (debitAmt > 0 && creditAmt > 0)    amount = (creditAmt - debitAmt).toFixed(2); // net
      else { skipped++; continue; }

      // Duplicate check
      const dup = checkDuplicate.get(financialYearId, tx.date, tx.description, amount);
      if (dup) { duplicates++; continue; }

      // Resolve target account
      const targetAccountId = tx.account
        ? resolveAccountId(clientId, tx.account, tx.accountName)
        : null;

      // is_categorized = 1 if we have a high-confidence category, 0 if needs review
      const isCategorized = (tx.confidence ?? 0) >= 0.7 && targetAccountId ? 1 : 0;

      const suggestedRule = tx.source
        ? `${tx.source}:${tx.account ?? ''}:${tx.accountName ?? ''}`
        : null;

      insert.run(
        randomUUID(),
        financialYearId,
        bankAccountNumber,
        tx.date,
        tx.description,
        amount,
        tx.balance ?? null,
        tx.account    ?? null,           // suggested_gl
        suggestedRule,                   // suggested_rule
        `${importSource}|confidence:${(tx.confidence ?? 0).toFixed(2)}|${tx.reasoning ?? ''}`.slice(0, 500),
        tx.vatAmount  ?? '0.00',
        tx.vatApplicable ? 1 : 0,
        targetAccountId,
        isCategorized,
      );
      inserted++;
    }
  });

  try {
    doInserts();
    console.log(`[fiscalFoxBridge] Inserted ${inserted} staging rows (${duplicates} duplicates skipped, ${skipped} invalid skipped)`);
    return { inserted, skipped, duplicates };
  } finally {
    db.close();
  }
}

// ─── Notification: write a review_needed flag to a simple JSON file ───────────

const NOTIFICATION_DIR = join(homedir(), '.fiscal-fox', 'notifications');

export async function notifyReviewRequired(clientName, financialYearLabel, stats) {
  await fs.mkdir(NOTIFICATION_DIR, { recursive: true });

  const notification = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    type: 'staging-review-required',
    clientName,
    financialYearLabel,
    message: `${stats.inserted} transactions imported from bank statement and require accountant review.`,
    stats,
    status: 'unread',
  };

  const notifPath = join(NOTIFICATION_DIR, `${notification.id}.json`);
  await fs.writeFile(notifPath, JSON.stringify(notification, null, 2));

  // Also write/update a summary file for easy polling
  const summaryPath = join(NOTIFICATION_DIR, 'pending.json');
  let pending = [];
  try {
    pending = JSON.parse(await fs.readFile(summaryPath, 'utf-8'));
  } catch { /* first notification */ }
  pending.push(notification);
  await fs.writeFile(summaryPath, JSON.stringify(pending, null, 2));

  console.log(`[fiscalFoxBridge] 🔔 Notification written: ${notifPath}`);
  return notification;
}

/**
 * Get all pending (unread) notifications.
 */
export async function getPendingNotifications() {
  try {
    const summaryPath = join(NOTIFICATION_DIR, 'pending.json');
    const raw = await fs.readFile(summaryPath, 'utf-8');
    return JSON.parse(raw).filter((n) => n.status === 'unread');
  } catch {
    return [];
  }
}

/**
 * Mark a notification as read.
 */
export async function markNotificationRead(notificationId) {
  const summaryPath = join(NOTIFICATION_DIR, 'pending.json');
  try {
    const pending = JSON.parse(await fs.readFile(summaryPath, 'utf-8'));
    const updated = pending.map((n) =>
      n.id === notificationId ? { ...n, status: 'read', readAt: new Date().toISOString() } : n
    );
    await fs.writeFile(summaryPath, JSON.stringify(updated, null, 2));
  } catch { /* ignore */ }
}
