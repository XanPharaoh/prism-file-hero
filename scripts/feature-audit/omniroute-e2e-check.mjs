#!/usr/bin/env node
/**
 * End-to-end proof that the free-model gateway actually serves a real /api/ai call.
 *
 * The unit gate (tests/omnirouteProviderChain.test.ts) proves how the chain is composed. This proves
 * the parts a unit test cannot: that an unauthenticated provider sends no bogus `Bearer undefined`
 * header, that the gateway answers the Worker's exact payload inside the Worker's wall clock, and
 * that the meter settles instead of stranding a PENDING row when a free model answers.
 *
 * Nothing here spends money: the localtest Worker is started with no NVIDIA/GROQ/MISTRAL keys, so the
 * free gateway is the only reachable provider. If it were not configured, every call would answer 502.
 *
 * Requires: local Supabase, scripts/local-jwks.mjs (:8799), and a Worker on $WORKER_URL started with
 *   npx wrangler dev --env localtest --port 8789 --ip 127.0.0.1 --inspector-port 9230 \
 *     --var OMNIROUTE_BASE_URL:http://<host>:20128/v1 --var OMNIROUTE_TOOLS:ocr,pdf-summary
 *
 *   node scripts/feature-audit/omniroute-e2e-check.mjs
 */
import { readFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';

const WORKER = process.env.WORKER_URL || 'http://127.0.0.1:8789';
const REST = (process.env.SUPABASE_URL || 'http://127.0.0.1:54321') + '/rest/v1';
const JWKS = process.env.JWKS_ORIGIN || 'http://127.0.0.1:8799';
const SR = JSON.parse(readFileSync('.localdev/tokens.json', 'utf8')).service_role;
const FREE_MODELS = [
  'kilocode/cohere/north-mini-code:free',
  'kilocode/nvidia/nemotron-3-super-120b-a12b:free',
];

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`PASS ${n}`)) : (fail++, console.log(`FAIL ${n} ${e}`)); };
const bearer = async (sub) => (await fetch(`${JWKS}/mint?sub=${encodeURIComponent(sub)}`)).text();
// Headers merge, they do not replace: a call that adds `Prefer` must not silently drop the service-role
// Authorization, or every seed write answers 401 and the subject stays on the free plan.
function rest(path, init = {}) {
  return fetch(`${REST}/${path.replace(/^\/+/, '')}`, {
    ...init,
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

/** Synthetic statement — the figures are known here, so a wrong transcript is detectable. */
function statementDataUrl() {
  const c = createCanvas(900, 520);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 900, 520);
  g.fillStyle = '#111';
  g.font = 'bold 34px sans-serif'; g.fillText('MERIDIAN BANK', 40, 70);
  g.font = '22px sans-serif'; g.fillText('Account 4471-99-1', 40, 115);
  g.font = '20px sans-serif';
  [['12/10/2026', 'CARD PURCHASE TAKEALOT', '-1,245.67'],
   ['14/10/2026', 'SALARY CREDIT', '24,500.00'],
   ['19/10/2026', 'DEBIT ORDER INSURANCE', '-842.00']]
    .forEach((r, i) => { const y = 190 + i * 40; g.fillText(r[0], 40, y); g.fillText(r[1], 300, y); g.fillText(r[2], 660, y); });
  g.font = 'bold 22px sans-serif'; g.fillText('Closing balance R 35,862.33', 40, 340);
  return `data:image/png;base64,${c.toBuffer('image/png').toString('base64')}`;
}

const IMG = statementDataUrl();

async function seedCoverage(sub) {
  await rest(`usage_logs?user_id=eq.${sub}`, { method: 'DELETE' });
  await rest(`user_plans?user_id=eq.${sub}`, { method: 'DELETE' });
  await rest(`billing_payments?payment_id=eq.PAY-OMNI-E2E`, { method: 'DELETE' });
  await rest(`billing_subscriptions?subscription_id=eq.I-OMNI-E2E`, { method: 'DELETE' });
  await rest('billing_price_plans', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ price_id: 'P-OMNI-E2E', plan: 'pro', label: 'omniroute e2e' }]) });
  await rest('billing_subscriptions', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ subscription_id: 'I-OMNI-E2E', user_id: sub, plan_id: 'P-OMNI-E2E', provider: 'paypal', status: 'ACTIVE' }]) });
  await rest('billing_payments', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ payment_id: 'PAY-OMNI-E2E', subscription_id: 'I-OMNI-E2E', user_id: sub, currency: 'USD', gross_amount: 19, status: 'captured', period_start: new Date(Date.now() - 3.6e6).toISOString(), period_end: new Date(Date.now() + 8.64e7).toISOString(), captured_at: new Date().toISOString() }]) });
  await rest('rpc/refresh_user_coverage', { method: 'POST', body: JSON.stringify({ p_user_id: sub }) });
}

const health = await fetch(`${WORKER}/api/health`).then((r) => r.json()).catch((e) => ({ error: e.message }));
if (health.status !== 'ok') {
  console.error(`Worker on ${WORKER} is not healthy (${JSON.stringify(health)}). Start it with the OMNIROUTE_* vars — see the header.`);
  process.exit(1);
}

const sub = '11111111-0000-4000-8000-0000a20002';
await seedCoverage(sub);
const seeded = await rest(`user_plans?user_id=eq.${sub}&select=plan,subscription_status`, { method: 'GET' }).then((x) => x.json());
if (!Array.isArray(seeded) || seeded.length !== 1 || seeded[0].plan !== 'pro') {
  console.error(`Coverage seeding did not produce a pro plan (${JSON.stringify(seeded)}). Refusing to read a 402 as a gateway failure.`);
  process.exit(1);
}
const token = await bearer(sub);

async function callAi(toolId, text) {
  const started = Date.now();
  const res = await fetch(`${WORKER}/api/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ toolId, messages: [{ role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: IMG } }] }] }),
  });
  return { ms: Date.now() - started, status: res.status, body: await res.text() };
}

// 1. Vision tool through the free gateway.
{
  const r = await callAi('ocr', 'Transcribe the bank name, account number and each amount visible on this statement page.');
  const j = (() => { try { return JSON.parse(r.body); } catch { return {}; } })();
  const served = j.model || j?.choices?.[0]?.model || '';
  ok('ocr: /api/ai answered 200 through the free gateway', r.status === 200, `status=${r.status} body=${r.body.slice(0, 220)}`);
  // The gateway echoes the UPSTREAM id and drops the pool alias: requested
  // "kilocode/cohere/north-mini-code:free", answered "cohere/north-mini-code:free". Match on the tail,
  // because requiring the full catalogue id here would fail against a correct response.
  ok('ocr: the answer came from a measured free model, not a paid provider',
    FREE_MODELS.some((m) => served === m || m.endsWith(`/${served}`)), `model=${served}`);
  const text = j?.choices?.[0]?.message?.content ?? '';
  ok('ocr: the statement text actually came back', /meridian/i.test(text), text.slice(0, 160));
  console.log(`     ${r.ms}ms wall clock · ${text.trim().slice(0, 120).replace(/\s+/g, ' ')}`);
}

// 2. Summary tool, same gateway.
{
  const r = await callAi('pdf-summary', 'Summarise this statement page: bank, account, and the amounts.'), j = (() => { try { return JSON.parse(r.body); } catch { return {}; } })();
  ok('pdf-summary: 200 from the free gateway', r.status === 200 && j?.choices?.[0]?.message?.content, `status=${r.status} ${r.body.slice(0, 160)}`);
  console.log(`     ${r.ms}ms wall clock`);
}

// 3. The meter must not strand a reservation behind a free model.
{
  const rows = await rest(`usage_logs?user_id=eq.${sub}&select=status,tool_id`, { method: 'GET' }).then((x) => x.json());
  const routed = rows.filter((x) => x.tool_id === 'ocr' || x.tool_id === 'pdf-summary');
  ok('meter: both gateway calls settled, no dangling PENDING', routed.length === 2 && routed.every((x) => x.status !== 'PENDING'), JSON.stringify(rows));
  console.log(`     ${JSON.stringify(rows)}`);
}

// 4. A tool the operator did not list must not reach the gateway. This Worker holds no paid key, so
//    the correct observable outcome is 502 — proof the gate is per-tool, not global.
{
  const started = Date.now();
  const res = await fetch(`${WORKER}/api/ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ toolId: 'grammar-check', messages: [{ role: 'user', content: 'Correct: “she dont has no apples”' }] }),
  });
  const r = { status: res.status, body: await res.text() };
  ok('gate: an unlisted tool has no provider here (502, not a silent 200)', r.status === 502, `status=${r.status} ${r.body.slice(0, 140)}`);
  console.log(`     ${Date.now() - started}ms · grammar-check is outside OMNIROUTE_TOOLS`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
