#!/usr/bin/env node
/**
 * Item 4 / Check C — exercise the REAL Worker routes over HTTP (via `wrangler dev`) against the
 * REAL local Postgres/PostgREST. Proves: auth-gated quota preflight, the /api/ai reserve→settle
 * path (settled to ERROR when no provider is configured — recovery, no paid spend), webhook
 * signature accept/reject + live-plan grant over HTTP, and concurrent /api/ai never leaving a
 * dangling PENDING. Uses scripts/local-jwks.mjs as the Clerk stand-in and locally-signed webhook
 * fixtures. Clearly NOT real Clerk, NOT real AI providers, NOT real Paddle.
 *
 * Requires running: local supabase stack, scripts/local-jwks.mjs (JWKS_PORT 8799), and
 * `wrangler dev` (port 8787) in worker/ with worker/.dev.vars.
 */
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const WORKER = process.env.WORKER_URL || 'http://127.0.0.1:8787';
const REST = (process.env.SUPABASE_URL || 'http://127.0.0.1:54321') + '/rest/v1';
const JWKS = process.env.JWKS_ORIGIN || 'http://127.0.0.1:8799';
const WEBHOOK_SECRET = (readFileSync('worker/.dev.vars', 'utf8').match(/PADDLE_WEBHOOK_SECRET=(.+)/) || [])[1]?.trim();
const TOK = JSON.parse(readFileSync('.localdev/tokens.json', 'utf8'));
const SR = TOK.service_role;

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`PASS ${n}`)) : (fail++, console.log(`FAIL ${n} ${e}`)); };
const bearer = async (sub) => (await fetch(`${JWKS}/mint?sub=${encodeURIComponent(sub)}`)).text();
async function q(table, qs) { const r = await fetch(`${REST}/${table}?${qs}`, { headers: { apikey: SR, Authorization: `Bearer ${SR}` } }); return r.json(); }
async function del(table, qs) { await fetch(`${REST}/${table}?${qs}`, { method: 'DELETE', headers: { apikey: SR, Authorization: `Bearer ${SR}` } }); }
async function ins(table, rows) { return (await fetch(`${REST}/${table}`, { method: 'POST', headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(rows) })).status; }

// 1. health
{ const r = await fetch(`${WORKER}/api/health`); ok('health: GET /api/health → 200 ok', r.status === 200 && (await r.json()).status === 'ok', `status=${r.status}`); }

// 2. auth-gated usage summary with a minted JWT
{ const sub = '11111111-0000-4000-8000-0000c0ffee'; const t = await bearer(sub);
  const noTok = await fetch(`${WORKER}/api/usage`); ok('usage: unauthenticated → 401', noTok.status === 401, `status=${noTok.status}`);
  const r = await fetch(`${WORKER}/api/usage`, { headers: { Authorization: `Bearer ${t}` } });
  const j = await r.json(); ok('usage: authenticated → 200 with plan', r.status === 200 && typeof j.plan === 'string', JSON.stringify(j)); }

// 3. /api/execute quota preflight (server authority)
{ const sub = '11111111-0000-4000-8000-0000beef01'; const t = await bearer(sub);
  const r = await fetch(`${WORKER}/api/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ toolId: 'merge', pageCount: 1 }) });
  const j = await r.json(); ok('execute: local tool allowed by server check', r.status === 200 && j.allowed === true, JSON.stringify(j)); }

// 4. /api/ai reserve→settle(ERROR) with no provider configured = recovery, no paid spend
{ const sub = '11111111-0000-4000-8000-0000a10001'; const t = await bearer(sub);
  await del('usage_logs', `user_id=eq.${sub}`);
  const msg = [{ role: 'user', content: [{ type: 'text', text: 'extract' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }] }];
  const r = await fetch(`${WORKER}/api/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ toolId: 'ocr', messages: msg }) });
  ok('ai: no-provider path returns 502 (not a silent success)', r.status === 502, `status=${r.status}`);
  const rows = await q('usage_logs', `user_id=eq.${sub}&select=status`);
  ok('ai: reservation was recovered to ERROR (no dangling PENDING)', Array.isArray(rows) && rows.length >= 1 && rows.every((x) => x.status !== 'PENDING'), JSON.stringify(rows)); }

// 5. concurrent /api/ai never oversells and never leaves PENDING
{ const sub = '11111111-0000-4000-8000-0000cafe01'; const t = await bearer(sub);
  await del('usage_logs', `user_id=eq.${sub}`);
  const msg = [{ role: 'user', content: [{ type: 'text', text: 'x' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }] }];
  const reqs = Array.from({ length: 15 }, () => fetch(`${WORKER}/api/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ toolId: 'ocr', messages: msg }) }).then((r) => r.status));
  const codes = await Promise.all(reqs);
  const p = await q('usage_logs', `user_id=eq.${sub}&status=eq.PENDING&select=request_id`);
  ok('ai concurrency: quota enforced (≥1 402) and never 200 without a provider', codes.includes(402) && !codes.includes(200), JSON.stringify(codes));
  ok('ai concurrency: no PENDING rows stranded after settle', Array.isArray(p) && p.length === 0, JSON.stringify(p)); }

// 6. webhook signature accept → grants the LIVE plan; reject on bad signature
{ const user = '11111111-0000-4000-8000-0000bbbb01', cust = 'cus_http1', sub = 'sub_http1';
  await del('user_plans', `user_id=eq.${user}`); await del('billing_customers', `customer_id=eq.${cust}`); await del('billing_subscriptions', `subscription_id=eq.${sub}`); await del('billing_events', `customer_id=eq.${cust}`);
  await ins('billing_customers', [{ customer_id: cust, user_id: user }]);
  const body = JSON.stringify({ event_id: 'http-e1', event_type: 'subscription.activated', occurred_at: '2026-10-01T00:00:00Z', data: { id: sub, customer_id: cust, metadata: { plan: 'business' } } });
  const ts = Math.floor(Date.now() / 1000); const h1 = createHmac('sha256', WEBHOOK_SECRET).update(`${ts}:${body}`).digest('hex');
  const bad = await fetch(`${WORKER}/api/paddle/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Paddle-Signature': `ts=${ts};h1=deadbeef` }, body });
  ok('webhook: invalid signature → 401 (no mutation)', bad.status === 401, `status=${bad.status}`);
  const afterBad = await q('user_plans', `user_id=eq.${user}&select=plan`); ok('webhook: bad signature did not grant', Array.isArray(afterBad) && afterBad.length === 0, JSON.stringify(afterBad));
  const good = await fetch(`${WORKER}/api/paddle/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Paddle-Signature': `ts=${ts};h1=${h1}` }, body });
  ok('webhook: valid signature → 200 ack', good.status === 200, `status=${good.status}`);
  const upl = await q('user_plans', `user_id=eq.${user}&select=plan,subscription_status`);
  ok('webhook: valid event granted the LIVE user_plans (business/active)', upl[0] && upl[0].plan === 'business' && upl[0].subscription_status === 'active', JSON.stringify(upl));
  const dup = await fetch(`${WORKER}/api/paddle/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Paddle-Signature': `ts=${ts};h1=${h1}` }, body });
  ok('webhook: replayed event still acked 200 (dedupe by PK)', dup.status === 200, `status=${dup.status}`); }

console.log(`\n=== worker-routes-check: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
