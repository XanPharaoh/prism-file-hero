#!/usr/bin/env node
/**
 * OmniRoute free-model survey: pick the AI backends for this app by measurement.
 *
 * The router at OMNIROUTE_URL (default: the owner's box) exposes ~1660 models, 81 of them free,
 * across pools the owner configured (cline, kilocode, zenmux, tokenrouter, opencode-zen, freebuff,
 * cl, kc) plus three pinned openai-compatible providers. Names lie about capability, so every
 * candidate is probed with the SAME payload shape the Worker sends
 * (`worker/src/index.ts: buildNvidiaPayload` -> {model, messages, temperature, max_tokens: 4096}):
 *
 *   text      must echo a fixed token, proving the model answers in `content` and not only
 *             `reasoning_content` (a measured failure mode at small max_tokens)
 *   vision    a synthetic statement page drawn here (MERIDIAN BANK / account 4471-99-1 /
 *             -1,245.67) must be read back; no real customer document is ever sent
 *   longform  a 12-row ledger must be summarised with real figures, for pdf-summary / pdf-qa
 *
 * Output: evidence/features/omniroute/survey-<utc>.jsonl (one row per probe) plus a ranked summary
 * printed and written to summary.md. Nothing is configured or deployed by this script.
 *
 *   node scripts/feature-audit/omniroute-survey.mjs [--limit=N] [--skip=vision,longform]
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';

const BASE = (process.env.OMNIROUTE_URL || 'http://100.75.214.23:20128/v1').replace(/\/$/, '');
const CATALOGUE = BASE.replace(/\/v1$/, '') + '/v1beta/models';
const OUT_DIR = 'evidence/features/omniroute';
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || 0);
const SKIP = new Set((process.argv.find((a) => a.startsWith('--skip=')) || '').split('=')[1]?.split(',') || []);
const PER_REQUEST_MS = 45000;
const CONCURRENCY = 4;

mkdirSync(OUT_DIR, { recursive: true });
const rows = [];
const record = (r) => { rows.push(r); };

// ---------- synthetic statement image (ground truth known here, nothing real leaves the box) ----
function statementPngBase64() {
  const c = createCanvas(1000, 700);
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 1000, 700);
  g.fillStyle = '#111111';
  g.font = 'bold 44px sans-serif'; g.fillText('MERIDIAN BANK', 60, 90);
  g.font = '28px sans-serif';
  g.fillText('Statement 01 Oct 2026 - 31 Oct 2026', 60, 140);
  g.fillText('Account 4471-99-1  Balance R 12,450.00', 60, 185);
  g.font = '24px sans-serif';
  const rowsTxt = [
    ['12/10/2026', 'CARD PURCHASE  TAKEALOT', '-1,245.67'],
    ['14/10/2026', 'SALARY CREDIT', '24,500.00'],
    ['19/10/2026', 'DEBIT ORDER  INSURANCE', '-842.00'],
    ['27/10/2026', 'ATM WITHDRAWAL', '-500.00'],
  ];
  rowsTxt.forEach((r, i) => {
    const y = 260 + i * 46;
    g.fillText(r[0], 60, y); g.fillText(r[1], 280, y); g.fillText(r[2], 780, y);
  });
  g.font = 'bold 26px sans-serif';
  g.fillText('Closing balance  R 35,862.33', 60, 520);
  return c.toBuffer('image/png').toString('base64');
}
const PNG = statementPngBase64();

// ---------- probe payloads (same shape as the Worker's) ---------------------------------------
const TEXT_MSGS = [{ role: 'user', content: 'Reply with exactly this word and nothing else: PRISM-OK' }];
const VISION_MSGS = [{
  role: 'user',
  content: [
    { type: 'text', text: 'This is a bank statement page. Answer with the bank name, the account number, and the amount of the TAKEALOT purchase, as three words separated by spaces.' },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
  ],
}];
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
const LONG_MSGS = [
  { role: 'system', content: 'You summarise bank statements for a accountant. Use the figures exactly as given.' },
  { role: 'user', content: `Ledger rows (date | description | debit | credit | balance):\n${LEDGER}\n\nIn under 200 words: total of all debits, total of all credits, the closing balance, and the single largest debit. Show each as a number.` },
];

async function ask(model, messages, temperature = 0.1) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.OMNIROUTE_KEY ? { Authorization: `Bearer ${process.env.OMNIROUTE_KEY}` } : {}) },
      body: JSON.stringify({ model, messages, temperature, max_tokens: 4096 }),
      signal: AbortSignal.timeout(PER_REQUEST_MS),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON gateway error page */ }
    const msg = json?.choices?.[0]?.message;
    return {
      status: res.status,
      ms: Date.now() - started,
      content: (msg?.content ?? '').toString(),
      reasoning: (msg?.reasoning_content ?? msg?.reasoning ?? '').toString().slice(0, 80),
      finish: json?.choices?.[0]?.finish_reason ?? null,
      usage: json?.usage ?? null,
      err: json?.error?.message || json?.error?.type || text.slice(0, 160),
    };
  } catch (e) {
    return { status: 0, ms: Date.now() - started, content: '', reasoning: '', finish: null, usage: null, err: `${e.name}: ${e.message}` };
  }
}

const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ');
// A model passes long-form by naming four figures. The two totals appear nowhere in the ledger, so
// only actual arithmetic produces them — an echo of the rows cannot pass. Grading is on values, never
// on length: the tersest correct answer is "5883.34\n13384.14\n17500.80\n2000.00" at 33 chars, and a
// 120-char floor earlier in this script's life marked every one of those correct answers a failure.
function namesFigures(content, values) {
  const nums = (content.match(/-?\d[\d,]*(?:\.\d+)?/g) || []).map((t) => Number(t.replace(/,/g, '')));
  const hit = {};
  for (const [k, v] of Object.entries(values)) hit[k] = nums.some((n) => Math.abs(n - v) < 0.005);
  return hit;
}

// ---------- candidate selection ---------------------------------------------------------------
const cat = await fetch(CATALOGUE, { signal: AbortSignal.timeout(30000) }).then((r) => r.json());
const all = (cat.models || []).map((m) => ({
  id: m.name.replace(/^models\//, ''),
  display: m.displayName,
  in: m.inputTokenLimit,
  out: m.outputTokenLimit,
  think: !!m.thinking,
}));
const pool = (id) => id.split('/')[0];
let free = all.filter((m) => /free/i.test(m.id) || ['freebuff'].includes(pool(m.id)));
const excludedUnaligned = free.filter((m) => /uncensored/i.test(m.id)).map((m) => m.id);
free = free.filter((m) => !/uncensored|content-safety/i.test(m.id));
// Re-run a single stage against named models (e.g. --models=a,b --skip=text,vision).
const ONLY = (process.argv.find((a) => a.startsWith('--models=')) || '').split('=')[1]?.split(',').filter(Boolean) || null;
if (ONLY) free = all.filter((m) => ONLY.includes(m.id));
if (LIMIT) free = free.slice(0, LIMIT);

console.log(`catalogue ${all.length} models · free candidates ${free.length} · excluded (uncensored/classifier) ${excludedUnaligned.length ? excludedUnaligned.join(', ') : 'none'}`);
console.log(`probes:${SKIP.has('text') ? '' : ' text'}${SKIP.has('vision') ? '' : ' + vision'}${SKIP.has('longform') ? '' : ' + longform'} · ${BASE}\n`);

async function mapWith(items, n, fn) {
  const out = []; let i = 0;
  const workers = Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } });
  await Promise.all(workers);
  return out;
}

// ---------- stage 1: text ----------------------------------------------------------------------
let textResults;
if (SKIP.has('text')) {
  textResults = free.map((m) => ({ ...m, text: null, textPass: true }));
  console.log('text stage skipped by flag — treating the given models as candidates');
} else {
  textResults = await mapWith(free, CONCURRENCY, async (m) => {
    const r = await ask(m.id, TEXT_MSGS, 0);
    const pass = r.status === 200 && /prism-?ok/i.test(r.content);
    record({ stage: 'text', model: m.id, ...r, pass });
    process.stdout.write(pass ? '.' : 'x');
    return { ...m, text: r, textPass: pass };
  });
  console.log(`\ntext pass: ${textResults.filter((t) => t.textPass).length}/${textResults.length}`);
}

// ---------- stage 2: vision (only on text survivors) ------------------------------------------
let visionSurvivors = [];
if (!SKIP.has('vision')) {
  const cands = textResults.filter((t) => t.textPass);
  const vres = await mapWith(cands, CONCURRENCY, async (m) => {
    const r = await ask(m.id, VISION_MSGS);
    const n = norm(r.content);
    const seesName = n.includes('meridian');
    const seesAcct = /4471/.test(n) || /4471[-\s]?99[-\s]?1/.test(n);
    const seesAmount = /1[.,\s]?245[.,\s]?67/.test(n);
    const pass = r.status === 200 && seesName && seesAcct;
    record({ stage: 'vision', model: m.id, ...r, pass, detail: { seesName, seesAcct, seesAmount } });
    process.stdout.write(pass ? 'V' : (r.status === 200 ? '-' : 'x'));
    return { ...m, vision: r, visionPass: pass, visionDetail: { seesName, seesAcct, seesAmount } };
  });
  visionSurvivors = vres.filter((v) => v.visionPass);
  console.log(`\nvision pass: ${visionSurvivors.length}/${cands.length}`);
}

// ---------- stage 3: long-form numeric reasoning ----------------------------------------------
let longSurvivors = [];
if (!SKIP.has('longform')) {
  const cands = textResults.filter((t) => t.textPass);
  const lres = await mapWith(cands, CONCURRENCY, async (m) => {
    const r = await ask(m.id, LONG_MSGS);
    const figures = namesFigures(r.content, {
      // Ledger above: debits 245.67+842.00+1245.67+950.00+2000.00+600.00, credits
      // 12500.00+88.44+310.50+485.20, closing 17500.80, largest single debit 2000.00.
      debits: 5883.34,
      credits: 13384.14,
      closing: 17500.80,
      largest: 2000.00,
    });
    const pass = r.status === 200 && figures.debits && figures.credits && figures.closing && figures.largest;
    record({ stage: 'longform', model: m.id, ...r, pass, detail: { ...figures, chars: r.content.length } });
    process.stdout.write(pass ? 'L' : (r.status === 200 ? '-' : 'x'));
    return { ...m, long: r, longPass: pass, longDetail: figures };
  });
  longSurvivors = lres.filter((l) => l.longPass);
  console.log(`\nlong-form pass: ${longSurvivors.length}/${cands.length}`);
}

// ---------- report ----------------------------------------------------------------------------
const byModel = new Map();
for (const r of rows) {
  const e = byModel.get(r.model) || { model: r.model, stages: {} };
  e.stages[r.stage] = { pass: r.pass, ms: r.ms, status: r.status, len: (r.content || '').length, err: r.pass ? '' : String(r.err || '').slice(0, 70), finish: r.finish };
  byModel.set(r.model, e);
}
const list = [...byModel.values()];
const score = (e) => (e.stages.text?.pass ? 4 : 0) + (e.stages.vision?.pass ? 3 : 0) + (e.stages.longform?.pass ? 2 : 0);
list.sort((a, b) => score(b) - score(a) || (a.stages.text?.ms ?? 9e8) - (b.stages.text?.ms ?? 9e8));

const lines = [];
lines.push(`# OmniRoute free-model survey — ${RUN_ID}`);
lines.push('');
lines.push(`Router \`${BASE}\` · catalogue ${all.length} models · ${free.length} free candidates probed · ` +
  `excluded by policy: ${excludedUnaligned.length ? excludedUnaligned.join(', ') : 'none (uncensored / classifier endpoints)'}`);
lines.push('');
lines.push('| model | text | vision | long-form | text ms | notes |');
lines.push('| :-- | :-- | :-- | :-- | --: | :-- |');
for (const e of list) {
  const t = e.stages.text || {}, v = e.stages.vision || {}, l = e.stages.longform || {};
  const mark = (s) => (s.pass === undefined ? '—' : s.pass ? 'PASS' : 'fail');
  lines.push(`| ${e.model} | ${mark(t)} | ${mark(v)} | ${mark(l)} | ${t.ms ?? ''} | ${t.err || v.err || l.err || (t.len ? `${t.len}ch` : '')} |`);
}
lines.push('');
lines.push('Probe definitions, payload shape and the synthetic ground truth are in the header of');
lines.push('`scripts/feature-audit/omniroute-survey.mjs`. Every row here is a recorded HTTP response;');
lines.push('`survey-' + RUN_ID + '.jsonl` holds full request outcomes including usage counters.');

writeFileSync(`${OUT_DIR}/survey-${RUN_ID}.jsonl`, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
writeFileSync(`${OUT_DIR}/summary-${RUN_ID}.md`, lines.join('\n') + '\n');
console.log('\n' + lines.slice(0, 40).join('\n'));
console.log(`\nevidence: ${OUT_DIR}/survey-${RUN_ID}.jsonl · summary-${RUN_ID}.md`);
