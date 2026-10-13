#!/usr/bin/env node
/**
 * Item 4 — synthetic authentication must stay synthetic.
 *
 * Proves that the localtest JWT issuer, the stand-in JWKS and the token-injection mechanism cannot
 * reach a production configuration or a release artifact. Static checks on what ships, plus a live
 * probe of the DEPLOYED Worker with a locally minted token.
 *
 *   node scripts/auth-isolation-check.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const WORKER = process.env.WORKER_URL || 'https://prism-worker.prismfilehero.workers.dev';
const JWKS = process.env.JWKS_ORIGIN || 'http://127.0.0.1:8799';
const LOCALTEST = process.env.LOCALTEST_URL || 'http://127.0.0.1:8788';

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`PASS ${n}`)) : (fail++, console.log(`FAIL ${n} ${e}`)); return c; };
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
// git/grep signal through their exit code, so treat non-zero as 'no result' rather than an error.
const tryGit = (args) => { try { execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] }); return true; } catch { return false; } };
const grepFiles = (pattern, paths) => { try { return execFileSync('grep', ['-rlEn', pattern, ...paths], { encoding: 'utf8' }).trim(); } catch { return ''; } };

const MARKERS = ['127.0.0.1:8799', 'localhost:8799', '/.well-known/jwks.json', 'localtest', '/mint?sub=', '127.0.0.1:8787', 'localhost:8787', '127.0.0.1:8788'];

// 1. The DEFAULT worker config (what `wrangler deploy` uploads) must not name the stand-in.
const toml = read('worker/wrangler.toml');
// Only assignment lines count; a comment that merely names the stand-in is not configuration.
const defaultSection = toml.split(/\n(?=\[env\.)/)[0].split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
ok('worker/wrangler.toml default section has no stand-in JWKS or localtest issuer',
  !/8799|localtest|127\.0\.0\.1:879|localhost:879/.test(defaultSection), '');
ok('the localtest environment is declared separately and cannot leak into the default',
  /\[env\.localtest\.vars\]/.test(toml) && (defaultSection.match(/\[env\./g) || []).length === 0, '');

// 2. Nothing secret-bearing is tracked by git.
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n');
ok('no .dev.vars file is committed', !tracked.some((f) => /(^|\/)\.dev\.vars/.test(f)), tracked.filter((f) => /dev\.vars/.test(f)).join(','));
ok('no local token/jwks material is committed', !tracked.some((f) => /\.localdev\/|tokens\.json|last-webhook\.json/.test(f)), '');
for (const f of ['worker/.dev.vars', 'worker/.dev.vars.localtest', '.localdev/tokens.json']) {
  ok(`${f} is gitignored`, tryGit(['check-ignore', '-q', f]), 'NOT ignored');
}

// 3. The release artifact: if it exists, scan every shipped byte for synthetic-auth references.
if (existsSync('deploy')) {
  const hits = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (statSync(p).size > 4_000_000) continue;
      const s = readFileSync(p).toString('latin1');
      for (const m of MARKERS) if (s.includes(m)) hits.push(`${p} → ${m}`);
    }
  };
  walk('deploy');
  ok('release artifact contains no stand-in issuer, mint endpoint or local Worker origin', hits.length === 0, hits.slice(0, 4).join(' | '));
} else {
  console.log('NOTE  deploy/ not assembled yet (run node scripts/build-release.mjs) — artifact scan skipped this run.');
}

// 4. The CI workflow must not be able to select the localtest environment.
const wf = read('.github/workflows/deploy.yml');
const wfCode = wf.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
ok('deploy workflow cannot select the localtest Worker environment', !/--env[= ]+localtest|env:\s*localtest|wrangler dev[^\n]*localtest/.test(wfCode), '');
ok('deploy workflow does not set a Clerk issuer override', !/CLERK_JWT_ISSUER/.test(wf), '');

// 5. Live behaviour: the deployed Worker must reject a locally minted token, while the localtest
//    Worker accepts the same one. This is the property that matters, not just the text of the config.
try {
  const token = await (await fetch(`${JWKS}/mint?sub=11111111-0000-4000-8000-0000isolate1`)).text();
  const prod = await fetch(`${WORKER}/api/usage`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(25000) });
  ok('DEPLOYED Worker rejects a locally minted token', prod.status === 401, `status=${prod.status}`);
  if (existsSync('worker/.dev.vars.localtest')) {
    const local = await fetch(`${LOCALTEST}/api/billing/entitlement`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.status).catch(() => 0);
    ok('localtest Worker accepts the same token (so the difference is the trust anchor, not the token)', local === 200, `status=${local}`);
  } else {
    console.log('NOTE  localtest Worker not running on :8788 — comparison skipped.');
  }
} catch (e) {
  ok('live probe reachable', false, String(e).slice(0, 90));
}

// 6. The injection mechanism is test-only: it exists solely in scripts, never in app or worker code.
const appSrc = grepFiles('route\\.continue|route\\.fulfill|setExtraHeaders', ['src', 'services', 'worker/src', 'App.tsx']);
ok('no request-injection code in the app or Worker sources', appSrc === '', appSrc.replace(/\n/g, ' '));

console.log(`\n=== auth-isolation-check: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
