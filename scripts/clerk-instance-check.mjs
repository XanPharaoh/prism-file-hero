#!/usr/bin/env node
/**
 * Clerk pairing preflight — does the FRONTEND key and the WORKER's token verification point at the
 * SAME instance, and is that instance actually reachable?
 *
 * Why this exists: the repo's live publishable key encodes the satellite `clerk.prismfilehero.com`,
 * which has no DNS record (authoritative NXDOMAIN), while worker/wrangler.toml points the DEPLOYED
 * Worker's CLERK_JWKS_URL at that same unreachable host. Any key/issuer drift makes every auth-gated
 * route fail closed — which is safe but silent. This script says so out loud before a deploy.
 *
 *   node scripts/clerk-instance-check.mjs            checks .env.local + worker/.dev.vars
 *   node scripts/clerk-instance-check.mjs --live     also checks worker/wrangler.toml [vars]
 *   node scripts/clerk-instance-check.mjs --env=.env.journey   pair the journey frontend config instead
 *
 * Read-only: DNS lookups + a GET of the public JWKS. No keys are printed.
 */
import { readFileSync, existsSync } from 'node:fs';
import { promisify } from 'node:util';
import dns from 'node:dns';

const lookup = promisify(dns.resolve4);
const live = process.argv.includes('--live');
const envFile = (process.argv.find((a) => a.startsWith('--env=')) ?? '--env=.env.local').slice(6);

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const varOf = (src, name) => (src.match(new RegExp(`^${name}\\s*=\\s*(.*)$`, 'm'))?.[1] ?? '').trim().replace(/^["']|["']$/g, '');

const envLocal = read(envFile);
const devVars = read('worker/.dev.vars');
const wrangler = read('worker/wrangler.toml');

const pk = varOf(envLocal, 'VITE_CLERK_PUBLISHABLE_KEY');
// --live describes the DEPLOYED configuration only; local .dev.vars must not leak into the report.
const jwksUrl = live ? varOf(wrangler, 'CLERK_JWKS_URL')
                    : (varOf(devVars, 'CLERK_JWKS_URL') || varOf(wrangler, 'CLERK_JWKS_URL'));
const issuer = live ? varOf(wrangler, 'CLERK_JWT_ISSUER')
                    : (varOf(devVars, 'CLERK_JWT_ISSUER') || varOf(wrangler, 'CLERK_JWT_ISSUER'));

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`PASS ${n}`)) : (fail++, console.log(`FAIL ${n} ${e}`)); return c; };
const info = (m) => console.log(`      ${m}`);

function domainOf(key) {
  const m = /^pk_(live|test)_([A-Za-z0-9_-]+)$/.exec(key);
  if (!m) return null;
  try {
    const decoded = Buffer.from(m[2], 'base64').toString('utf8');
    return { env: m[1], domain: decoded.replace(/\$+$/, '') };
  } catch { return null; }
}

if (!pk) { console.log(`NOTE  no VITE_CLERK_PUBLISHABLE_KEY in ${envFile} — nothing to pair.`); }
else {
  const d = domainOf(pk);
  ok('publishable key decodes to a Clerk satellite domain', !!d?.domain, '');
  if (!d) { console.log(`\n=== clerk-instance-check: ${pass} passed, ${fail} failed ===`); process.exit(1); }
  info(`key is ${d.env.toUpperCase()} for satellite ${d.domain}`);
  const frontendHost = (() => { const u = varOf(envLocal, 'VITE_FRONTEND_URL') || varOf(envLocal, 'FRONTEND_URL'); return u; })();
  let addresses = [];
  try { addresses = await lookup(d.domain); } catch (e) { addresses = []; info(`DNS: ${String(e).split('\n')[0]}`); }
  ok('the key\'s satellite domain resolves', addresses.length > 0, addresses.length ? '' : 'NXDOMAIN or no A record — Clerk sign-in cannot work with this key');

  if (jwksUrl) {
    const jHost = (() => { try { return new URL(jwksUrl).hostname; } catch { return ''; } })();
    ok('Worker CLERK_JWKS_URL points at the SAME instance as the frontend key', jHost === d.domain, `jwks host=${jHost} key domain=${d.domain}`);
    if (issuer) {
      const iHost = (() => { try { return new URL(issuer).hostname; } catch { return issuer; } })();
      ok('CLERK_JWT_ISSUER matches the same instance', iHost === d.domain, `issuer host=${iHost}`);
    } else {
      console.log('NOTE  CLERK_JWT_ISSUER unset — the Worker derives the issuer from CLERK_JWKS_URL.');
    }
    try {
      const r = await fetch(jwksUrl, { signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => ({}));
      const keys = j.keys || [];
      ok('the Worker can actually fetch its JWKS', r.ok && keys.length > 0, `http=${r.status} keys=${keys.length}`);
      ok('JWKS serves RS256 RSA keys (what the Worker verifies with)', keys.every((k) => k.kty === 'RSA' && (!k.alg || k.alg === 'RS256')), keys.map((k) => `${k.kty}/${k.alg}`).join(','));
    } catch (e) {
      ok('the Worker can actually fetch its JWKS', false, String(e).split('\n')[0]);
    }
  } else {
    console.log('NOTE  no CLERK_JWKS_URL found in worker/.dev.vars — local token verification is off.');
  }

  if (d.env === 'live' && !live) {
    console.log('NOTE  this is a LIVE key. Local journeys should use a development instance (pk_test_…).');
  }
}

console.log(`\n=== clerk-instance-check: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
