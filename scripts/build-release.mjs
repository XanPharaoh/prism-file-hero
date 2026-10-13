#!/usr/bin/env node
/**
 * Assemble the deployable artifact: the static marketing site at / AND the built React application
 * at /app, in one Cloudflare Pages directory. Today deploy.yml publishes only ./site, which is why
 * https://prismfilehero.com/app is a 404 and the product UI exists nowhere in production.
 *
 *   node scripts/build-release.mjs            # npm run build + assemble ./deploy
 *   node scripts/build-release.mjs --no-build # reuse an existing ./dist
 *
 * Rules this enforces, because they are the failure modes that matter:
 *  - the app is built with base /app/ (vite.config.ts), so its document works at any deep link;
 *  - Pages reads a SINGLE _redirects at the deploy root, so the SPA fallback is written there and
 *    scoped to /app — a root `/* /index.html 200` would swallow the marketing pages;
 *  - dist/_redirects (which assumes the app owns the site root) is deliberately NOT copied;
 *  - /api/* is NOT routed here: the app calls the Worker by absolute origin (services/apiConfig.ts),
 *    so the Pages project must not proxy or shadow it.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DEPLOY = join(ROOT, 'deploy');
const doBuild = !process.argv.includes('--no-build');

const count = (dir) => { let n = 0, bytes = 0; const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name); if (f.isDirectory()) walk(p); else { n++; bytes += statSync(p).size; } } }; walk(dir); return { n, bytes }; };

if (doBuild) { console.log('building the React app (base /app/)…'); execFileSync('npm', ['run', 'build'], { stdio: 'inherit', cwd: ROOT }); }
if (!existsSync(join(ROOT, 'dist', 'index.html'))) { console.error('dist/index.html missing — run without --no-build first.'); process.exit(1); }
if (!existsSync(join(ROOT, 'site', 'index.html'))) { console.error('site/index.html missing — refusing to publish a site with no marketing root.'); process.exit(1); }

rmSync(DEPLOY, { recursive: true, force: true });
mkdirSync(DEPLOY, { recursive: true });

cpSync(join(ROOT, 'site'), DEPLOY, { recursive: true });
mkdirSync(join(DEPLOY, 'app'), { recursive: true });
for (const entry of readdirSync(join(ROOT, 'dist'))) {
  if (entry === '_redirects') continue;              // would claim the whole site root
  cpSync(join(ROOT, 'dist', entry), join(DEPLOY, 'app', entry), { recursive: true });
}

// The router must live INSIDE the artifact. `wrangler pages dev deploy` / `pages deploy deploy` run
// from the repo root report "No Functions. Shimming..." for a deploy/functions directory (measured:
// /app/merge-pdf then 404s), because Functions are looked up relative to the CLI's working directory.
// `_worker.js` in the output directory is read from the artifact itself, so CI cannot lose it.
//
// Why not _redirects either: a redirect rule is consulted BEFORE the static-asset lookup, so
// `/app/* → /app/ 200` answered the app's own JS/CSS with HTML (MIME errors, blank page). Hence this
// router passes every file-like path straight back to the asset store.
writeFileSync(join(DEPLOY, '_worker.js'), [
  '// Prism File Hero release router: marketing at /, the React app at /app.',
  'export default {',
  '  async fetch(request, env) {',
  '    const url = new URL(request.url);',
  '    const underApp = url.pathname === "/app" || url.pathname.startsWith("/app/");',
  '    const looksLikeFile = /\\.[a-z0-9]{1,8}$/i.test(url.pathname);',
  '    const method = request.method.toUpperCase();',
  '    if (underApp && !looksLikeFile && (method === "GET" || method === "HEAD")) {',
  '      const doc = await env.ASSETS.fetch(new Request(new URL("/app/index.html", url.origin)));',
  '      if (doc.ok) {',
  '        return new Response(doc.body, { status: 200, headers: {',
  "          'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',",
  '        } });',
  '      }',
  '    }',
  '    // Everything else — assets, marketing pages, genuinely missing files — is the asset store,',
  '    // so a missing .js/.css answers 404 instead of receiving the app document.',
  '    return env.ASSETS.fetch(request);',
  '  },',
  '};',
  '',
].join('\n'));
writeFileSync(join(DEPLOY, '_redirects'), '# No catch-all rule: /app/* is resolved by _worker.js so static assets and real 404s win.\n');
writeFileSync(join(DEPLOY, '_redirects'), '# No catch-all: /app/* is resolved by functions/app/[[path]].js so static assets win.\n');

const app = count(join(DEPLOY, 'app'));
const all = count(DEPLOY);
console.log(`\ndeploy/ assembled: ${all.n} files, ${(all.bytes / 1e6).toFixed(1)} MB`);
console.log(`  app at /app: ${app.n} files, ${(app.bytes / 1e6).toFixed(1)} MB`);
console.log(`  marketing at /: ${all.n - app.n} files`);
console.log('\nverify locally (no deployment):');
console.log('  npx wrangler pages dev deploy --port 8790');
console.log('  curl -s -o /dev/null -w "%{http_code}\\n" http://127.0.0.1:8790/app/merge-pdf   # must be the app, not the marketing page');
