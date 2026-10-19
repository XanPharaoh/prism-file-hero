#!/usr/bin/env node
/**
 * Concurrency test for the free-model gateway.
 *
 * The selection in docs/omniroute-model-selection.md rests on single-request measurements: a 2.9 s
 * answer and a 14.6 s answer for the *same payload*. That spread is the question this answers — what
 * happens when subscribers share one gateway instead of each getting it to themselves.
 *
 * Three things are measured, because "throughput" alone would hide the two that matter:
 *   1. latency and completions/sec as concurrency rises;
 *   2. which failure mode appears (429 rate limit, 402 spent pool, 502, timeout, connection reset);
 *   3. whether the answer is still *correct* under load. A 200 carrying wrong arithmetic is the only
 *      failure that can hurt a user silently, so every response is graded against the ledger's four
 *      target figures rather than just checked for HTTP 200.
 *
 * The last phase hits both routed models at once. The chain in worker/src/index.ts offers
 * north-mini-code then nemotron-3-super as if they were independent; both are reached through the
 * same upstream pool, so if they degrade together the second entry buys less than it looks like.
 *
 * Load is deliberately modest (peak 16 concurrent, ~60 requests per model): this is somebody's
 * third-party free tier, and hammering it risks the connector, not just the experiment.
 * No document data leaves the machine — the prompt is the synthetic ledger from the survey script.
 *
 *   node scripts/feature-audit/omniroute-load.mjs [--levels=1,4,8,16] [--models=a,b]
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = (process.env.OMNIROUTE_URL || 'http://100.75.214.23:20128/v1').replace(/\/$/, '');
const OUT_DIR = 'evidence/features/omniroute';
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const arg = (name, fallback) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || fallback;
const LEVELS = arg('levels', '1,4,8,16').split(',').map(Number);
const MODELS = arg('models', 'kilocode/cohere/north-mini-code:free,kilocode/nvidia/nemotron-3-super-120b-a12b:free').split(',');
const PER_REQUEST_MS = 60000;
const MAX_PER_LEVEL = 24;

mkdirSync(OUT_DIR, { recursive: true });

const LEDGER = [
  ['2026-10-01', 'OPENING BALANCE', '', '', '10000.00'],
  ['2026-10-02', 'CARD PURCHASE', '245.67', '', '9754.33'],
  ['2026-10-05', 'SALARY', '', '12500.00', '22254.33'],
  ['2026-10-07', 'FUEL', '842.00', '', '21412.33'],
  ['2026-10-09', 'SHOPRITE', '1245.67', '', '20166.66'],
  ['2026-10-11', 'INTEREST', '', '88.44', '20255.10'],
  ['2026-10-13', 'INSURANCE', '950.00', '', '19305.10'],
  ['2026-10-15', 'TRANSFER OUT', '2000.00', '', '17305.10'],
  ['2026-10-18', 'REFUND', '', '310.50', '17615.60'],
  ['2026-10-21', 'ATM', '600.00', '', '17015.60'],
  ['2026-10-25', 'DIVIDEND', '', '485.20', '17500.80'],
  ['2026-10-30', 'CLOSING BALANCE', '', '', '17500.80'],
].map((r) => r.join(' | ')).join('\n');

const MESSAGES = [{
  role: 'user',
  content: `Ledger rows (date | description | debit | credit | balance):\n${LEDGER}\n\nIn under 120 words: total of all debits, total of all credits, the closing balance, and the single largest debit. Show each as a number.`,
}];

// The two totals appear nowhere in the rows, so only real arithmetic produces them.
function figuresFor(content) {
  const nums = (content.match(/-?\d[\d,]*(?:\.\d+)?/g) || []).map((t) => Number(t.replace(/,/g, '')));
  const near = (v) => nums.some((n) => Math.abs(n - v) < 0.005);
  return { debits: near(5883.34), credits: near(13384.14), closing: near(17500.80), largest: near(2000.00) };
}

async function once(model) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.OMNIROUTE_KEY ? { Authorization: `Bearer ${process.env.OMNIROUTE_KEY}` } : {}) },
      // max_tokens 4096 is what the Worker sends. A smaller budget makes a reasoning model answer
      // with HTTP 200 and content: null, which a naive probe would score as an empty reply.
      body: JSON.stringify({ model, messages: MESSAGES, temperature: 0.1, max_tokens: 4096 }),
      signal: AbortSignal.timeout(PER_REQUEST_MS),
    });
    const raw = await res.text();
    let json = null;
    try { json = JSON.parse(raw); } catch { /* gateway HTML error page */ }
    const content = (json?.choices?.[0]?.message?.content ?? '').toString();
    const f = figuresFor(content);
    return {
      model, status: res.status, ms: Date.now() - started,
      ok: res.ok && content.length > 0,
      correct: res.ok && f.debits && f.credits && f.closing && f.largest,
      figures: f, chars: content.length,
      finish: json?.choices?.[0]?.finish_reason ?? null,
      tokens: json?.usage ? `${json.usage.prompt_tokens}/${json.usage.completion_tokens}` : '',
      err: res.ok ? '' : (json?.error?.message || json?.error?.type || raw).slice(0, 120),
    };
  } catch (e) {
    return { model, status: 0, ms: Date.now() - started, ok: false, correct: false, chars: 0, finish: null, tokens: '', err: `${e.name}: ${e.message}`.slice(0, 120) };
  }
}

/** Run `total` requests with at most `concurrency` in flight; returns rows plus the measured window. */
async function ramp(model, concurrency, total) {
  const t0 = Date.now();
  let next = 0;
  const rows = [];
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (next < total) {
      next++;
      rows.push(await once(model));
    }
  }));
  return { rows, windowMs: Date.now() - t0 };
}

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;

function summarise(level, model, rows, windowMs) {
  const lat = rows.map((r) => r.ms).sort((a, b) => a - b);
  const byStatus = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  return {
    level, model: model.includes('north-mini') ? 'north-mini' : model.includes('super') ? 'nemo-super' : model,
    n: rows.length,
    ok: rows.filter((r) => r.ok).length,
    correct: rows.filter((r) => r.correct).length,
    p50ms: pct(lat, 50), p95ms: pct(lat, 95), maxMs: lat.at(-1) ?? 0,
    perSec: +(rows.length / (windowMs / 1000)).toFixed(2),
    statuses: byStatus,
    firstErr: rows.find((r) => r.err)?.err ?? '',
    emptyContent: rows.filter((r) => r.status === 200 && r.chars === 0).length,
  };
}

const all = [];
const summary = [];
console.log(`gateway ${BASE}\nlevels ${LEVELS.join(', ')} · ${(MAX_PER_LEVEL)} req/level cap · models ${MODELS.join(' + ')}\n`);

for (const model of MODELS) {
  for (const level of LEVELS) {
    const total = Math.min(MAX_PER_LEVEL, Math.max(level, level * 3));
    process.stdout.write(`  ${model.split('/').pop()} @${level} `.padEnd(34));
    const { rows, windowMs } = await ramp(model, level, total);
    all.push(...rows.map((r) => ({ ...r, level, phase: 'isolated' })));
    const s = summarise(level, model, rows, windowMs);
    summary.push(s);
    console.log(`${s.n} req  p50 ${s.p50ms}ms  p95 ${s.p95ms}ms  ${s.perSec}/s  ok ${s.ok}/${s.n}  correct ${s.correct}/${s.n}  ${JSON.stringify(s.statuses)}${s.firstErr ? `  err="${s.firstErr.slice(0, 46)}"` : ''}`);
  }
}

// Both routed models at once, sharing the concurrency budget — the shape the Worker's chain produces
// when a request falls through and other subscribers are in flight.
const combined = LEVELS.at(-1);
process.stdout.write(`  combined both @${combined} `.padEnd(34));
const t0 = Date.now();
const pairs = await Promise.all(MODELS.map((m) => ramp(m, Math.max(1, Math.floor(combined / MODELS.length)), Math.min(MAX_PER_LEVEL, combined))));
const windowMs = Date.now() - t0;
for (const [i, { rows }] of pairs.entries()) {
  all.push(...rows.map((r) => ({ ...r, level: combined, phase: 'combined' })));
  const s = { ...summarise(combined, MODELS[i], rows, windowMs), phase: 'combined' };
  summary.push(s);
  console.log(`${s.model} ${s.n} req  p50 ${s.p50ms}ms  p95 ${s.p95ms}ms  ok ${s.ok}/${s.n}  correct ${s.correct}/${s.n}  ${JSON.stringify(s.statuses)}`);
}

const lines = [
  `# OmniRoute free-model gateway — concurrency test ${RUN_ID}`, '',
  `Gateway \`${BASE}\` · levels ${LEVELS.join(', ')} · ${PER_REQUEST_MS / 1000}s per-request ceiling · payload is the Worker's own shape (max_tokens 4096).`, '',
  '| conc | model | phase | n | ok | correct | p50 | p95 | req/s | statuses |',
  '| --: | :-- | :-- | --: | --: | --: | --: | --: | --: | :-- |',
  ...summary.map((s) => `| ${s.level} | ${s.model} | ${s.phase ?? 'isolated'} | ${s.n} | ${s.ok} | ${s.correct} | ${s.p50ms}ms | ${s.p95ms}ms | ${s.perSec} | \`${JSON.stringify(s.statuses)}\` |`),
  '',
  '`correct` counts 200-responses whose four ledger figures are all right. A drop there while `ok`',
  'stays high would mean the gateway answers confidently and wrongly under load — the failure that',
  'matters for this product. Raw per-request records: `load-' + RUN_ID + '.jsonl`.',
];

writeFileSync(`${OUT_DIR}/load-${RUN_ID}.jsonl`, all.map((r) => JSON.stringify(r)).join('\n'));
writeFileSync(`${OUT_DIR}/load-summary-${RUN_ID}.md`, lines.join('\n'));
console.log(`\nevidence: load-${RUN_ID}.jsonl · load-summary-${RUN_ID}.md`);
