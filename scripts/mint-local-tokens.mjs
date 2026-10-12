#!/usr/bin/env node
/**
 * R1 — mint the HS256 role/user tokens the local checks need (.localdev/tokens.json) from the LOCAL
 * stack's JWT secret. Reads the secret from SUPABASE_JWT_SECRET, else inspects the running
 * supabase_auth_* container, else falls back to the well-known local default (config.toml ships no
 * custom secret). Writes anon / service_role / userA / userB tokens. Local-only, throwaway secrets;
 * .localdev/ is gitignored. NEVER run this against a real/remote project.
 */
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_LOCAL_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';

function discoverSecret() {
  if (process.env.SUPABASE_JWT_SECRET) return process.env.SUPABASE_JWT_SECRET;
  try {
    const ps = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
    const name = ps.stdout.split('\n').find((n) => n.startsWith('supabase_auth_'));
    if (name) {
      const e = spawnSync('docker', ['exec', name, 'printenv', 'GOTRUE_JWT_SECRET'], { encoding: 'utf8' });
      if (e.status === 0 && e.stdout.trim()) return e.stdout.trim();
    }
  } catch { /* fall through */ }
  return DEFAULT_LOCAL_SECRET;
}

const secret = discoverSecret();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => {
  const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(payload);
  return `${h}.${p}.${createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
};
const iat = Math.floor(Date.now() / 1000), exp = iat + 3600 * 24;
const tokens = {
  anon: jwt({ role: 'anon', iss: 'supabase', iat, exp }),
  service_role: jwt({ role: 'service_role', iss: 'supabase', iat, exp }),
  userA: jwt({ role: 'authenticated', sub: '11111111-1111-1111-1111-111111111111', iss: 'supabase', iat, exp }),
  userB: jwt({ role: 'authenticated', sub: '22222222-2222-2222-2222-222222222222', iss: 'supabase', iat, exp }),
};
mkdirSync(join(ROOT, '.localdev'), { recursive: true });
writeFileSync(join(ROOT, '.localdev', 'tokens.json'), JSON.stringify(tokens, null, 2));
console.log(`minted .localdev/tokens.json (anon, service_role, userA, userB). secret_source=${process.env.SUPABASE_JWT_SECRET ? 'env' : secret === DEFAULT_LOCAL_SECRET ? 'default-local' : 'container'}`);
