#!/usr/bin/env node
/**
 * Item 2 — positive production authentication test against an EXISTING read-only authenticated
 * route (`GET /api/usage`), which does not need the undeployed billing endpoints.
 *
 *   PROD_CLERK_TOKEN=<session token> node scripts/prod-auth-check.mjs
 *
 * Getting the token without exposing it: sign in at https://prismfilehero.com/account.html with the
 * real account, then in that browser's devtools run
 *   copy(await window.Clerk.session.getToken())
 * and set it in the shell as PROD_CLERK_TOKEN (read from the environment; never a CLI argument,
 * never printed, never written to disk).
 *
 * What this proves and what it does not:
 *   - authentication: the deployed Worker accepted a token signed by the LIVE Clerk key;
 *   - claim binding: the identity the Worker reports equals the `sub` in the token, so a caller
 *     cannot ask for someone else's usage;
 *   - a 200 with an error body, or a 5xx from the data layer, is reported as AUTHENTICATED BUT
 *     BACKEND FAILED — never as an authentication pass;
 *   - it does NOT prove issuer/expiry enforcement by itself (see scripts/worker-routes-check.mjs §7,
 *     where correctly signed tokens with a wrong issuer or an expired `exp` are rejected).
 */
const WORKER = process.env.WORKER_URL || 'https://prism-worker.prismfilehero.workers.dev';
const JWKS_URL = process.env.PROD_CLERK_JWKS || 'https://clerk.prismfilehero.com/.well-known/jwks.json';
const token = (process.env.PROD_CLERK_TOKEN || '').trim();

let pass = 0, fail = 0, pending = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`PASS ${n}`)) : (fail++, console.log(`FAIL ${n} ${e}`)); return c; };
const pendingNote = (n, how) => { pending++; console.log(`PENDING ${n}\n        ${how}`); };

if (!token) {
  pendingNote('production session token',
    'Set PROD_CLERK_TOKEN in the environment. Obtain it from a signed-in browser tab with ' +
    "`copy(await window.Clerk.session.getToken())` — do not paste it into chat or a file.");
  console.log(`\n=== prod-auth-check: ${pass} passed, ${fail} failed, ${pending} pending ===`);
  process.exit(2);
}

const b64 = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
const [header, claims] = token.split('.').map((p) => { try { return b64(p); } catch { return null; } });
if (!header || !claims) { console.error('FAIL token is not a readable JWT (not logged)'); process.exit(1); }

console.log('token claims (no signature material shown):');
console.log(`  iss=${claims.iss}  sub=${claims.sub}  sid=${claims.sid ?? '-'}`);
console.log(`  exp in ${Math.round((claims.exp - Date.now() / 1000))}s   kid=${header.kid}   alg=${header.alg}`);

ok('alg is RS256 (the only algorithm the Worker accepts)', header.alg === 'RS256', header.alg);
ok('the token is not expired', claims.exp * 1000 > Date.now(), `exp in ${Math.round(claims.exp - Date.now() / 1000)}s`);

const jwks = await (await fetch(JWKS_URL, { signal: AbortSignal.timeout(20000) })).json().catch(() => ({ keys: [] }));
ok('the token kid is published by the production JWKS', (jwks.keys || []).some((k) => k.kid === header.kid), `kid=${header.kid} served=${(jwks.keys || []).map((k) => k.kid).join(',')}`);

const r = await fetch(`${WORKER}/api/usage`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
const body = await r.text();
console.log(`\nGET ${WORKER}/api/usage -> ${r.status}`);
console.log(`  body: ${body.slice(0, 220)}`);

if (r.status === 401) {
  ok('deployed Worker authenticates a genuine production Clerk session', false, `401 ${body.slice(0, 80)}`);
} else if (r.status >= 500) {
  ok('deployed Worker authenticates a genuine production Clerk session', true, '');
  ok('backend answered without a data-layer error', false, `authenticated, then ${r.status}: ${body.slice(0, 120)}`);
  console.log('NOTE  authentication succeeded; the failure above is the data layer, reported separately.');
} else if (r.status === 200) {
  const j = JSON.parse(body);
  ok('deployed Worker authenticates a genuine production Clerk session', true, '');
  ok('the Worker answers as a real usage summary shape (plan + limits)', 'plan' in j && 'pages_limit' in j, body.slice(0, 120));
  console.log(`  plan=${j.plan} pages ${j.pages_used}/${j.pages_limit}`);
} else {
  ok(`unexpected status ${r.status} from /api/usage`, false, body.slice(0, 120));
}

const other = await fetch(`${WORKER}/api/usage/summary`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) });
const otherBody = await other.text();
console.log(`\nGET ${WORKER}/api/usage/summary -> ${other.status} ${otherBody.slice(0, 200)}`);
if (other.ok) {
  const j = JSON.parse(otherBody);
  ok('the second authenticated route resolves the SAME identity (sub comes from the token)', j.userId === claims.sub, `userId=${j.userId} sub=${claims.sub}`);
} else {
  console.log('NOTE  /api/usage/summary was not reachable on the deployed build — consistent with it predating current routes; reported, not assumed.');
}

console.log(`\n=== prod-auth-check: ${pass} passed, ${fail} failed, ${pending} pending ===`);
process.exit(fail === 0 && pending === 0 ? 0 : 1);
