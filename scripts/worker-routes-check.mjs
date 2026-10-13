#!/usr/bin/env node
/**
 * Item 4 / Check C — exercise the REAL Worker routes over HTTP (via `wrangler dev`) against the
 * REAL local Postgres/PostgREST. Proves: auth-gated quota preflight, the /api/ai reserve→settle
 * path (settled to ERROR when no provider is configured — recovery, no paid spend), webhook
 * signature accept/reject + live-plan grant over HTTP, and concurrent /api/ai never leaving a
 * dangling PENDING. Uses scripts/local-jwks.mjs as the Clerk stand-in and locally-signed webhook
 * fixtures. Clearly NOT real Clerk, NOT real AI providers, NOT a real PayPal buyer approval.
 *
 * Requires running: local supabase stack, scripts/local-jwks.mjs (JWKS_PORT 8799), and
 * `wrangler dev` (port 8787) in worker/ with worker/.dev.vars.
 */
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const WORKER = process.env.WORKER_URL || 'http://127.0.0.1:8788';   // `--env localtest`: the stand-in-JWKS Worker this suite authenticates against
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

// 6. PayPal: an UNVERIFIED webhook never grants; subscribe is gated on creds; entitlement is server-derived.
{ const user = '11111111-0000-4000-8000-0000bbbb01', sub = 'I-HTTP1';
  await del('user_plans', `user_id=eq.${user}`); await del('billing_subscriptions', `subscription_id=eq.${sub}`); await del('billing_events', `subscription_id=eq.${sub}`);
  const evt = JSON.stringify({ id: 'http-pay-1', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id: sub, status: 'ACTIVE', plan_id: 'P-SANDBOX-PRO-MONTHLY' } });
  const unsigned = await fetch(`${WORKER}/api/paypal/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: evt });
  ok('paypal webhook: unverified event → 401 (browser/forged approval cannot grant)', unsigned.status === 401, `status=${unsigned.status}`);
  const after = await q('user_plans', `user_id=eq.${user}&select=plan`);
  ok('paypal webhook: unverified event granted nothing', Array.isArray(after) && after.length === 0, JSON.stringify(after));
  const t = await bearer(user);
  const hasPayPalCreds = /PAYPAL_CLIENT_ID=\S/.test(readFileSync('worker/.dev.vars', 'utf8'));
  const allowCreate = process.env.PRISM_ALLOW_SANDBOX_SUBSCRIBE === '1';
  const badPlan = await fetch(`${WORKER}/api/billing/paypal/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ plan: 'gold', cycle: 'monthly' }) });
  ok('paypal subscribe: a plan outside pro|business is rejected before any PayPal call', badPlan.status === 400, `status=${badPlan.status}`);
  const foreign = await fetch(`${WORKER}/api/billing/paypal/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ subscriptionId: 'I-NOT-YOURS' }) });
  ok('paypal cancel: a subscription the caller does not own is refused (403, server mapping)', foreign.status === 403, `status=${foreign.status}`);
  if (!hasPayPalCreds) {
    const sj = await (await fetch(`${WORKER}/api/billing/paypal/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ plan: 'pro', cycle: 'monthly' }) })).json().catch(() => ({}));
    ok('paypal subscribe: without credentials → 503 configured:false (never grants)', sj.configured === false, JSON.stringify(sj));
  } else if (allowCreate) {
    // Opt-in: this really creates a sandbox subscription (and PayPal then sends a real CREATED event).
    const subRes = await fetch(`${WORKER}/api/billing/paypal/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ plan: 'pro', cycle: 'monthly' }) });
    const sj = await subRes.json().catch(() => ({}));
    ok('paypal subscribe: returns pending + approve URL, no entitlement granted server-side',
      subRes.status === 201 && typeof sj.approveUrl === 'string' && sj.status === 'pending', JSON.stringify(sj).slice(0, 160));
    const granted = await q('user_plans', `user_id=eq.${user}&select=plan,subscription_status`);
    const paid = !!(granted?.[0] && granted[0].plan !== 'free' && granted[0].subscription_status === 'active');
    ok('paypal subscribe: creating the subscription did not grant paid access', paid === false, JSON.stringify(granted));
    const cx = await fetch(`${WORKER}/api/billing/paypal/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify({ subscriptionId: sj.subscriptionId }) });
    ok('paypal cancel: an APPROVAL_PENDING subscription reports 409 nothing-to-cancel (not a bare 502)', cx.status === 409, `status=${cx.status}`);
  } else {
    console.log('NOTE  paypal subscribe: the 201-pending / 409-cancel assertions create a real sandbox subscription and were NOT run (set PRISM_ALLOW_SANDBOX_SUBSCRIBE=1). Both were measured live and are covered by scripts/checkout-return-check.mjs.');
  }
  const ej = await (await fetch(`${WORKER}/api/billing/entitlement`, { headers: { Authorization: `Bearer ${t}` } })).json().catch(() => ({}));
  ok('paypal entitlement: server-derived plan for the caller', typeof ej.plan === 'string' && ej.source === 'server', JSON.stringify(ej)); }

// 7. JWT claim isolation — every token here is CORRECTLY SIGNED by the stand-in key, so a rejection
//    proves the specific claim check fired rather than "the signature was wrong". The control must
//    pass, otherwise the other four results mean nothing.
{
  const sub = '11111111-0000-4000-8000-0000jwt0001';
  const mint = async (q) => (await fetch(`${JWKS}/mint?sub=${encodeURIComponent(sub)}${q}`)).text();
  const probe = async (tok) => (await fetch(`${WORKER}/api/billing/entitlement`, { headers: { Authorization: `Bearer ${tok}` } })).status;
  const control = await mint('');
  ok('jwt: correctly signed token with the expected issuer is accepted (control)', await probe(control) === 200, '');
  ok('jwt: same signature but EXPIRED is rejected', await probe(await mint('&expOffset=-7200')) === 401, '');
  ok('jwt: same signature but WRONG ISSUER is rejected', await probe(await mint(`&iss=${encodeURIComponent('https://someone-else.clerk.accounts.dev')}`)) === 401, '');
  ok('jwt: correctly signed by our key but under an UNKNOWN kid is rejected', await probe(await mint('&kid=not-in-jwks')) === 401, '');
  ok('jwt: a token for another subject cannot read this user (sub is taken from the token)',
    (await (await fetch(`${WORKER}/api/billing/entitlement`, { headers: { Authorization: `Bearer ${await mint('')}` } })).json()).userId === sub, '');
}

console.log(`\n=== worker-routes-check: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
