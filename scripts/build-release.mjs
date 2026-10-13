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

// SPA fallback as a Pages Function, NOT _redirects. Measured with `wrangler pages dev`: a redirect
// rule is applied BEFORE the static-asset lookup, so `/app/*  /app/  200` also captured
// /app/assets/index-*.js and *.css and answered them with the HTML document (MIME errors, blank
// page). A matching Function is consulted BEFORE the asset lookup in this runtime too, so the
// function itself must hand file requests back to the static-asset store instead of 404ing them.
const fnDir = join(DEPLOY, 'functions', 'app');
mkdirSync(fnDir, { recursive: true });
writeFileSync(join(fnDir, '[[path]].js'), [
  '// Deep links and refreshes under /app render the React document; anything with a file extension',
  '// is passed straight back to the static-asset store, because a matching Function is consulted',
  '// before the asset lookup (measured with `wrangler pages dev` — a naive fallback 404s the app’s',
  '// own JS/CSS).',
  'export async function onRequest({ request, env }) {',
  "  const url = new URL(request.url);",
  "  if (/\\.[a-z0-9]{1,8}$/i.test(url.pathname)) return env.ASSETS.fetch(request);",
  "  const doc = await env.ASSETS.fetch(new Request(new URL('/app/index.html', url.origin)));",
  "  if (!doc.ok) return new Response('Not found', { status: 404 });",
  "  return new Response(doc.body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });",
  '}',
  '',
].join('\n'));
writeFileSync(join(DEPLOY, '_redirects'), '# No catch-all: /app/* is resolved by functions/app/[[path]].js so static assets win.\n');

const app = count(join(DEPLOY, 'app'));
const all = count(DEPLOY);
console.log(`\ndeploy/ assembled: ${all.n} files, ${(all.bytes / 1e6).toFixed(1)} MB`);
console.log(`  app at /app: ${app.n} files, ${(app.bytes / 1e6).toFixed(1)} MB`);
console.log(`  marketing at /: ${all.n - app.n} files`);
console.log('\nverify locally (no deployment):');
console.log('  npx wrangler pages dev deploy --port 8790');
console.log('  curl -s -o /dev/null -w "%{http_code}\\n" http://127.0.0.1:8790/app/merge-pdf   # must be the app, not the marketing page');
