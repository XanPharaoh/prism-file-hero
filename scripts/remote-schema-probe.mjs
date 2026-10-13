#!/usr/bin/env node
/**
 * Item 5 — read-only remote schema inspection, because the Supabase CLI has no access token here
 * (`supabase projects list` → "Access token not provided") and no DB password is available.
 *
 * Method: ask PostgREST for each table with the ANON key and compare against a database whose state
 * is KNOWN (the fully migrated local stack). The comparison is what makes the result meaningful —
 * a bare 404 from the remote proves nothing on its own, so every probe is run twice and reported
 * side by side.
 *
 *   node scripts/remote-schema-probe.mjs
 *
 * Limits, stated up front:
 *  - anon visibility depends on Supabase's default privileges. A table that exists but has been
 *    explicitly REVOKED from anon also answers PGRST205, so "absent" here means "absent or
 *    ungranted"; only a CLI token (`supabase migration list --linked`) or a DB login settles which.
 *  - RPC probes are reported as inconclusive on purpose: with wrong arguments BOTH an absent and a
 *    present-but-revoked function answer PGRST202, so no claim is made from them.
 *  - nothing is written: GETs with limit=0 and a deliberately invalid RPC body that cannot execute.
 */
import { existsSync, readFileSync } from 'node:fs';

const readEnv = (file) => {
  if (!existsSync(file)) return {};
  const s = readFileSync(file, 'utf8');
  const pick = (k) => (s.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '').trim();
  return { url: pick('VITE_SUPABASE_URL'), anon: pick('VITE_SUPABASE_ANON_KEY') };
};
const prod = readEnv('.env.production');
const local = { url: process.env.SUPABASE_URL || 'http://127.0.0.1:54321', anon: JSON.parse(readFileSync('.localdev/tokens.json', 'utf8')).anon };

const TABLES = ['user_plan', 'user_plans', 'usage_logs', 'plan_grants', 'credit_reservations',
  'billing_events', 'billing_subscriptions', 'billing_price_plans', 'billing_payments'];
const RPCS = ['get_user_entitlement', 'apply_paypal_event'];

if (!prod.url || !prod.anon) { console.error('missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.production'); process.exit(2); }

const probeTable = async (base, key, t) => {
  try {
    const r = await fetch(`${base}/rest/v1/${t}?select=*&limit=0`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
    const txt = await r.text(); let code = ''; try { code = JSON.parse(txt).code || ''; } catch {}
    return { status: r.status, code, visible: r.ok };
  } catch (e) { return { status: 0, code: 'FETCH_ERR', visible: false }; }
};
const probeRpc = async (base, key, f) => {
  try {
    const r = await fetch(`${base}/rest/v1/rpc/${f}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{"__probe":1}', signal: AbortSignal.timeout(20000) });
    const t = await r.text(); let code = ''; try { code = JSON.parse(t).code || ''; } catch {}
    return `${r.status}${code ? '/' + code : ''}`;
  } catch { return 'ERR'; }
};

console.log(`remote: ${prod.url}`);
console.log(`control: ${local.url} (this session's fully migrated database)\n`);
console.log('table'.padEnd(24), 'remote'.padEnd(16), 'local control'.padEnd(16), 'reading');
const absentOnRemote = [];
for (const t of TABLES) {
  const a = await probeTable(prod.url, prod.anon, t);
  const b = await probeTable(local.url, local.anon, t);
  let reading;
  if (a.visible && b.visible) reading = 'present on both';
  else if (!a.visible && b.visible) { reading = 'ABSENT (or ungranted) remotely, present locally'; absentOnRemote.push(t); }
  else if (!a.visible && !b.visible) reading = 'absent on both — not a discriminator';
  else reading = 'present remotely only';
  console.log(t.padEnd(24), `${a.status}${a.code ? '/' + a.code : ''}`.padEnd(16), `${b.status}${b.code ? '/' + b.code : ''}`.padEnd(16), reading);
}
console.log('\nRPC presence (deliberately invalid args; nothing can execute):');
for (const f of RPCS) {
  const a = await probeRpc(prod.url, prod.anon, f), b = await probeRpc(local.url, local.anon, f);
  console.log('  '.padEnd(2), f.padEnd(24), `remote=${a.padEnd(12)} local=${b.padEnd(12)}`, a === b ? '→ INCONCLUSIVE (identical on a database that definitely has the function)' : '→ differs');
}
console.log(`\nDerived: the remote is missing ${absentOnRemote.length} table(s) that the migrated database has:`);
console.log('  ' + (absentOnRemote.join(', ') || 'none'));
console.log('Those tables are created by 20261010000000_authoritative_plan_credits and later, so the pending');
console.log('migration set starts there — NOT at the PayPal-era files. Confirm the exact ledger with');
console.log('SUPABASE_ACCESS_TOKEN=… supabase migration list --linked, and settle absent-vs-revoked with a DB login.');
