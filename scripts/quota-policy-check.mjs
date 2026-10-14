#!/usr/bin/env node
/**
 * Quota policy + metering integrity check.
 *
 * Two halves. (1) Static: the plan/tool classification must have exactly one definition — the
 * shared table in services/usageConfig.ts — and the database function must agree with it.
 * (2) Live: the Worker and the ledger must refuse the ways a client could cheat the meter:
 * booking or closing cloud credits from the browser, forging quantities, double-settling,
 * settling somebody else's reservation, or "refunding" work the server already completed.
 *
 * Requires the local supabase stack, scripts/local-jwks.mjs (:8799) and `wrangler dev --env
 * localtest` (:8788). The tokens are the local stand-in; nothing here touches production.
 */
import { readFileSync } from 'node:fs';

const WORKER = process.env.WORKER_URL || 'http://127.0.0.1:8788';
const REST = (process.env.SUPABASE_URL || 'http://127.0.0.1:54321') + '/rest/v1';
const JWKS = process.env.JWKS_ORIGIN || 'http://127.0.0.1:8799';
const TOK = JSON.parse(readFileSync('.localdev/tokens.json', 'utf8'));
const SR = TOK.service_role;
const MIGRATION = 'supabase/migrations/20261015000001_production_schema_hardening.sql';

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`PASS ${n}`)) : (fail++, console.log(`FAIL ${n} ${e}`)); return c; };
const bearer = async (sub) => (await fetch(`${JWKS}/mint?sub=${encodeURIComponent(sub)}`)).text();
async function rest(table, qs, init = {}) {
  const r = await fetch(`${REST}/${table}?${qs}`, {
    ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, Accept: 'application/json', ...(init.headers || {}) },
  });
  const text = await r.text();
  let body; try { body = JSON.parse(text || '[]'); } catch { body = { parseError: text.slice(0, 120) }; }
  if (!Array.isArray(body)) { fail++; console.log(`FAIL rest ${table}?${qs} → ${r.status} ${text.slice(0, 160)}`); return []; }
  return body;
}
const rpc = async (fn, body) => {
  const r = await fetch(`${REST}/rpc/${fn}`, { method: 'POST', headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, text: await r.text() };
};

// ── 1. One authoritative definition ─────────────────────────────────────────────────────
const cfg = readFileSync('services/usageConfig.ts', 'utf8');
const sql = readFileSync(MIGRATION, 'utf8');

const entries = [...cfg.matchAll(/'([a-z0-9-]+)':\s*\{([^}]*)\}/g)]
  .filter(([, , b]) => b.includes('category:'))
  .map(([m, id, body]) => ({
    id,
    category: (body.match(/category: '(\w+)'/) || [])[1],
    processing: (body.match(/processing: '(\w+)'/) || [])[1],
  }));
const tsPremium = new Set(entries.filter((e) => e.category === 'ai').map((e) => e.id));
// `p_tool_id in (...)` is the premium gate; the allowlist clause is `p_tool_id not in (...)`.
const premiumClause = [...sql.matchAll(/\bp_tool_id in \(([^)]*)\)/g)].pop();
const sqlPremium = new Set((premiumClause ? premiumClause[1] : '')
  .split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean));
const dbAllowList = new Set(((sql.match(/p_tool_id not in \(([^)]*)\)/) || [])[1] || '')
  .split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean));

ok('every tool declares how it processes', entries.every((e) => ['local', 'hybrid', 'cloud'].includes(e.processing)),
  JSON.stringify(entries.filter((e) => !['local', 'hybrid', 'cloud'].includes(e.processing))));
const tsPremiumKnown = [...tsPremium].filter((t) => dbAllowList.has(t)).sort();
ok('the database premium set is exactly the shared premium set the DB recognises',
  [...sqlPremium].sort().join() === tsPremiumKnown.join(),
  `sql=[${[...sqlPremium].sort().join(',')}] shared=[${tsPremiumKnown.join(',')}]`);
ok('free cloud AI is zero in the shared table', /free:\s*\{ aiPages: 0,/.test(cfg), (cfg.match(/free:\s*\{[^}]*\}/) || [])[0]);
ok('free cloud AI is zero in the database', /v_month_limit := case v_plan when 'pro' then 500 when 'business' then -1 else 0 end/.test(sql));
ok('free AI daily ceilings are zero in the database', /v_tool_limit := case when v_plan = 'free' then \(case v_feature when 'ai' then 0 else 5 end\)/.test(sql));
ok('the duplicate worker plan table is gone', !readFileSync('worker/wrangler.toml', 'utf8').includes('planLimits') && !fileExists('worker/src/planLimits.ts'));
ok('no second monthly-AI figure survives in the worker', !/aiPagesPerMonth/.test(readFileSync('worker/src/usageTracker.ts', 'utf8')));

// ── 1b. Three-way tool parity: registry === shared table === ledger allowlist ─────────────
// The registry is what the app can launch, the shared table is what the browser shows, the SQL
// allowlist is what the database will book. Two of the three drifting is how `pdf-qa` ended up
// answering "Unknown tool" for a tool the interface was happily running.
const registrySrc = readFileSync('src/registry/toolRegistry.ts', 'utf8');
const registryIds = [...registrySrc.matchAll(/^\s*id:\s*'([a-z0-9-]+)'/gm)].map((m) => m[1]).sort();
const configIds = [...cfg.matchAll(/^\s*'([a-z0-9-]+)':\s*\{[^}]*featureType:/gm)].map((m) => m[1]).sort();
const sqlAllowlistIds = [...dbAllowList].sort();

ok('38-tool parity: toolRegistry.ts === usageConfig.ts === SQL check_usage_limit allowlist',
  JSON.stringify(registryIds) === JSON.stringify(configIds) && JSON.stringify(configIds) === JSON.stringify(sqlAllowlistIds),
  `registry=${registryIds.length} config=${configIds.length} sql=${sqlAllowlistIds.length}`);
ok('the ledger recognises every tool the app can launch',
  registryIds.filter((id) => !dbAllowList.has(id)).length === 0,
  JSON.stringify(registryIds.filter((id) => !dbAllowList.has(id))));
ok('the ledger allows nothing the app cannot launch',
  sqlAllowlistIds.filter((id) => !registryIds.includes(id)).length === 0,
  JSON.stringify(sqlAllowlistIds.filter((id) => !registryIds.includes(id))));
ok('premium parity: usageConfig category=ai === SQL premium gate',
  [...tsPremium].sort().join() === [...sqlPremium].sort().join(),
  `config=[${[...tsPremium].sort().join(',')}] sql=[${[...sqlPremium].sort().join(',')}]`);
ok('the retired Paddle ledger is not referenced by the live schema',
  !/create table if not exists public.(plan_grants|credit_reservations|user_plan)\b/.test(
    readFileSync(MIGRATION, 'utf8').replace(/^--.*$/gm, '')),
  'the hardening migration must drop, never recreate');

function fileExists(p) { try { readFileSync(p, 'utf8'); return true; } catch { return false; } }

// ── 2. The browser cannot book or close cloud credits ───────────────────────────────────
// The journey account holds a real captured sandbox payment in this local database, so its plan
// is the ledger's answer rather than a fixture we insert here. The token is the local stand-in.
const PRO = process.env.PRO_SUB || 'user_3KdoIR0BqZIJaW9Yh0aOXxKF13c';
const FREE = '11111111-0000-4000-8000-0000free01';
{
  const t = await bearer(PRO);
  for (const route of ['/api/usage/reserve', '/api/usage/settle']) {
    const r = await fetch(`${WORKER}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ toolId: 'ocr', pageCount: 1, requestId: '00000000-0000-4000-8000-000000000000', status: 'SUCCESS' }) });
    ok(`browser credit path is closed: POST ${route} → 404`, r.status === 404, `status=${r.status}`);
  }
  const forged = await fetch(`${WORKER}/api/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ toolId: 'pdf-to-word', pageCount: 5000 }) });
  ok('forged quantity rejected before any accounting (pageCount 5000 → 400)', forged.status === 400, `status=${forged.status}`);
}

// ── 3. Classification decides what is metered ───────────────────────────────────────────
{
  const t = await bearer(PRO);
  const before = await rest('usage_logs', 'select=request_id&feature_type=eq.ai&user_id=eq.' + encodeURIComponent(PRO));
  const preflight = await fetch(`${WORKER}/api/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ toolId: 'ocr', pageCount: 2 }) });
  const pj = await preflight.json();
  ok('a local OCR run is authorised by entitlement, not by cloud budget', preflight.status === 200 && pj.allowed === true, JSON.stringify(pj));
  const report = await fetch(`${WORKER}/api/usage/report`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ toolId: 'ocr', pagesProcessed: 2, status: 'SUCCESS' }) });
  ok('a local completion report cannot book cloud pages (refused)', report.status === 400, `status=${report.status}`);
  const after = await rest('usage_logs', 'select=request_id&feature_type=eq.ai&user_id=eq.' + encodeURIComponent(PRO));
  ok('local OCR consumed no cloud credit row', Array.isArray(before) && Array.isArray(after) && after.length === before.length, `${before.length} → ${after.length}`);
}

// ── 4. Free tier: no cloud AI, no premium tools ──────────────────────────────────────────
{
  const t = await bearer(FREE);
  for (const [tool, why] of [['pdf-to-word', 'cloud'], ['ocr', 'premium-local']]) {
    const r = await fetch(`${WORKER}/api/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ toolId: tool, pageCount: 1 }) });
    const j = await r.json();
    ok(`free cannot reach the ${why} tool ${tool} (402, server reason)`, r.status === 402 && j.allowed === false && /paid plan/.test(j.reason || ''), JSON.stringify(j));
  }
  const core = await fetch(`${WORKER}/api/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ toolId: 'merge', pageCount: 2 }) });
  ok('free core tools still work within the local ceiling', core.status === 200 && (await core.json()).allowed === true, '');
  const tooBig = await fetch(`${WORKER}/api/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ toolId: 'merge', pageCount: 40 }) });
  ok('practical local limits are preserved for free (40 pages → 402)', tooBig.status === 402, `status=${tooBig.status}`);
}

// ── 5. Settlement is the server's, once, and final ───────────────────────────────────────
{
  const requestId = crypto.randomUUID();
  const res = await rpc('reserve_usage', { p_request_id: requestId, p_user_id: PRO, p_tracking_key: PRO, p_ip_address: '10.9.9.9', p_tool_id: 'pdf-to-word', p_ai_pages: 2, p_operations: 0, p_page_count: 2 });
  ok('a cloud reservation is created as PENDING', res.status === 200 && /"allowed":true/.test(res.text), res.text.slice(0, 120));

  // settle_usage returns void, so PostgREST answers 204 No Content on success.
  const settled = (r) => r.status === 200 || r.status === 204;
  const first = await rpc('settle_usage', { p_request_id: requestId, p_status: 'SUCCESS' });
  ok('the server settles the reservation once', settled(first), `status=${first.status} ${first.text.slice(0, 120)}`);

  const refund = await rpc('settle_usage', { p_request_id: requestId, p_status: 'ERROR' });
  ok('a duplicate settlement attempt is accepted without changing the outcome', settled(refund), `status=${refund.status} ${refund.text.slice(0, 120)}`);
  const row = await rest('usage_logs', `select=status,ai_pages&request_id=eq.${requestId}`);
  ok('the recorded outcome stays SUCCESS with its 2 cloud pages', row[0]?.status === 'SUCCESS' && Number(row[0]?.ai_pages) === 2, JSON.stringify(row));

  const anon = await fetch(`${REST}/rpc/settle_usage`, { method: 'POST', headers: { apikey: TOK.anon, Authorization: `Bearer ${TOK.anon}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_request_id: requestId, p_status: 'ERROR' }) });
  ok('settle_usage is not executable with a client key (no cross-user settlement surface)', anon.status === 401 || anon.status === 403, `status=${anon.status}`);

  // Ownership, server-side: the row is real and still open, but it belongs to another tracking key.
  const foreignId = crypto.randomUUID();
  const held = await rpc('reserve_usage', { p_request_id: foreignId, p_user_id: PRO, p_tracking_key: PRO, p_ip_address: '10.9.9.10', p_tool_id: 'pdf-to-word', p_ai_pages: 2, p_operations: 0, p_page_count: 2 });
  ok('a reservation is held for the owning session', held.status === 200 && /"allowed":true/.test(held.text), held.text.slice(0, 120));
  const stolen = await rpc('settle_usage', { p_request_id: foreignId, p_status: 'SUCCESS', p_tracking_key: 'someone-elseentirely' });
  ok('settling a reservation that belongs to another session is refused', stolen.status >= 400, `status=${stolen.status} ${stolen.text.slice(0, 140)}`);
  const stillOpen = await rest('usage_logs', `select=status&request_id=eq.${foreignId}`);
  ok('the refused settlement left the reservation PENDING', stillOpen[0]?.status === 'PENDING', JSON.stringify(stillOpen));
  const ownSettle = await rpc('settle_usage', { p_request_id: foreignId, p_status: 'SUCCESS', p_tracking_key: PRO });
  ok('the owning session settles it', settled(ownSettle), `status=${ownSettle.status} ${ownSettle.text.slice(0, 140)}`);
  const nowClosed = await rest('usage_logs', `select=status&request_id=eq.${foreignId}`);
  ok('the settled row reads SUCCESS', nowClosed[0]?.status === 'SUCCESS', JSON.stringify(nowClosed));
  const arity = await rpc('settle_usage', { p_request_id: foreignId, p_status: 'ERROR' });
  ok('a call that omits p_tracking_key still resolves (no PostgREST overload ambiguity)', !/Ambiguous|300/.test(arity.text), `status=${arity.status} ${arity.text.slice(0, 140)}`);

  await rest('usage_logs', `request_id=in.(${requestId},${foreignId})`, { method: 'DELETE' });
}

// ── 6. A renewal webhook that has not landed must not cost a paid customer a request ──────
// Reproduce the lag exactly: real captured payment evidence in the ledger, stale user_plans row
// still saying free. check_usage_limit re-derives coverage in the refuse direction and allows.
{
  const LAG = `99999999-0000-4000-8000-${crypto.randomUUID().slice(-12)}`;
  const sub = `sub-lag-${LAG.slice(-8)}`;
  const sale = `sale-lag-${LAG.slice(-8)}`;
  const FUTURE = new Date(Date.now() + 30 * 864e5).toISOString();
  const PAST = new Date(Date.now() - 864e5).toISOString();
  const link = await rpc('begin_paypal_subscription', { p_user_id: LAG, p_subscription_id: sub, p_plan_id: 'P-SANDBOX-PRO-MONTHLY' });
  ok('the lag fixture links a subscription to its own user', link.status === 200 && JSON.parse(link.text) === 'ok', link.text.slice(0, 120));
  await rpc('apply_paypal_event', {
    p_event_id: crypto.randomUUID(), p_event_type: 'PAYMENT.SALE.COMPLETED',
    p_resource: {
      id: sale, subscription_id: sub, billing_agreement_id: sub, transaction_state: 'completed',
      amount: { currency: 'USD', total: '19.00' }, billing_period_start_date: PAST,
      billing_period_end_date: FUTURE, time_updated: new Date().toISOString(),
    },
  });
  await fetch(`${REST}/user_plans?user_id=eq.${LAG}`, {
    method: 'PATCH', headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan: 'free', subscription_status: 'inactive' }),
  });
  const lagRow = await rest('user_plans', `select=plan,subscription_status&user_id=eq.${LAG}`);
  ok('the fixture is in the lagged state (payment covers, plan row says free)',
    lagRow[0]?.plan === 'free' && lagRow[0]?.subscription_status === 'inactive', JSON.stringify(lagRow));
  const retried = await rpc('check_usage_limit', { p_user_id: LAG, p_tracking_key: LAG, p_ip_address: '10.9.9.11', p_tool_id: 'pdf-to-word', p_ai_pages: 2, p_operations: 0, p_page_count: 2 });
  const granted = JSON.parse(retried.text)[0] || {};
  ok('coverage is re-derived from the payment before the customer is refused',
    granted.allowed === true && granted.plan === 'pro', retried.text.slice(0, 200));
  ok('and the re-derivation only happens in the refuse direction',
    /if v_plan = 'free' then[\s\S]*perform public.refresh_user_coverage/.test(sql), 'no conditional refresh');

  await rest('user_plans', `user_id=eq.${LAG}`, { method: 'DELETE' });
  await rest('billing_subscriptions', `subscription_id=eq.${sub}`, { method: 'DELETE' });
  await rest('billing_payments', `subscription_id=eq.${sub}`, { method: 'DELETE' });
  await rest('billing_events', `subscription_id=eq.${sub}`, { method: 'DELETE' });
}

console.log(`\n=== quota-policy-check: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
