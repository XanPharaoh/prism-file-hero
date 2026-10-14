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
import { cpSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const DEPLOY = join(ROOT, 'deploy');
const doBuild = !process.argv.includes('--no-build');
// Staging must never be indexed; the router has to carry the header itself because responses it
// produces (the /app document) bypass _headers.
const NOINDEX = process.argv.includes('--noindex');

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
  'const ROBOTS = ' + String(NOINDEX) + '; // set at build time by --noindex (staging)',
  'export default {',
  '  async fetch(request, env) {',
  '    const url = new URL(request.url);',
  '    const underApp = url.pathname === "/app" || url.pathname.startsWith("/app/");',
  '    const looksLikeFile = /\\.[a-z0-9]{1,8}$/i.test(url.pathname);',
  '    const method = request.method.toUpperCase();',
  '    if (underApp && !looksLikeFile && (method === "GET" || method === "HEAD")) {',
  '      const doc = await env.ASSETS.fetch(new Request(new URL("/app/index.html", url.origin)));',
  '      if (doc.ok) {',
  "        const h = new Headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });",
  "        if (ROBOTS) h.set('x-robots-tag', 'noindex, nofollow, noarchive');",
  '        return new Response(doc.body, { status: 200, headers: h });',
  '      }',
  '    }',
  '    // Everything else — assets, marketing pages, genuinely missing files — is the asset store,',
  '    // so a missing .js/.css answers 404 instead of receiving the app document.',
  '    const res = await env.ASSETS.fetch(request);',
  "    if (ROBOTS && !res.headers.has('x-robots-tag')) {",
  '      const h = new Headers(res.headers);',
  "      h.set('x-robots-tag', 'noindex, nofollow, noarchive');",
  '      return new Response(res.body, { status: res.status, headers: h });',
  '    }',
  '    return res;',
  '  },',
  '};',
  '',
].join('\n'));
writeFileSync(join(DEPLOY, '_redirects'), '# No catch-all rule: /app/* is resolved by _worker.js so static assets and real 404s win.\n');
writeFileSync(join(DEPLOY, '_redirects'), '# No catch-all: /app/* is resolved by functions/app/[[path]].js so static assets win.\n');

// Staging must never carry a production binding, and the marketing bundle embeds two: the live
// Worker origin and the live Clerk publishable key (site/assets/features.data.js). Rewrite them in
// the copied artifact from .env.staging — the source file, and therefore production, is untouched.
if (NOINDEX) {
  const envFile = '.env.staging';
  if (!existsSync(envFile)) {
    console.error('--noindex requires .env.staging (VITE_WORKER_URL + VITE_CLERK_PUBLISHABLE_KEY) so staging cannot inherit production bindings');
    process.exit(2);
  }
  const read = (key) => (readFileSync(envFile, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm')) || [])[1]?.trim() || '';
  const worker = read('VITE_WORKER_URL');
  const clerkKey = read('VITE_CLERK_PUBLISHABLE_KEY');
  const dataFile = join(DEPLOY, 'assets', 'features.data.js');
  if (!worker || !clerkKey) { console.error('.env.staging is missing VITE_WORKER_URL or VITE_CLERK_PUBLISHABLE_KEY'); process.exit(2); }
  let src = readFileSync(dataFile, 'utf8');
  const before = src;
  // No comments are injected: the publishable key sits inside an object literal, and a trailing
  // `//` there swallows the closing brace (measured, not hypothetical).
  src = src.replace(/var WORKER = "[^"]*";/, `var WORKER = "${worker}";`);
  src = src.replace(/clerkPublishableKey: "[^"]*"/, `clerkPublishableKey: "${clerkKey}"`);
  if (src === before) { console.error('staging rewrite found no production bindings to replace — the artifact layout changed'); process.exit(2); }
  writeFileSync(dataFile, src);
  console.log('staging: marketing bundle re-pointed at the staging Worker and the Clerk development instance');
}

// Staging must never be indexed: the marketing copy and the app would compete with the real
// domain in search results. `--noindex` writes a Pages _headers rule for every path.
if (process.argv.includes('--noindex')) {
  writeFileSync(join(DEPLOY, '_headers'), [
    '/*',
    '  X-Robots-Tag: noindex, nofollow, noarchive',
    '  X-Content-Type-Options: nosniff',
    '',
    '/app/*',
    '  X-Robots-Tag: noindex, nofollow, noarchive',
    '',
  ].join('\n'));
  writeFileSync(join(DEPLOY, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  console.log('noindex: deploy/_headers + disallow-all robots.txt written');
}

const app = count(join(DEPLOY, 'app'));
const all = count(DEPLOY);
console.log(`\ndeploy/ assembled: ${all.n} files, ${(all.bytes / 1e6).toFixed(1)} MB`);
console.log(`  app at /app: ${app.n} files, ${(app.bytes / 1e6).toFixed(1)} MB`);
console.log(`  marketing at /: ${all.n - app.n} files`);
console.log('\nverify locally (no deployment):');
console.log('  npx wrangler pages dev deploy --port 8790');
console.log('  curl -s -o /dev/null -w "%{http_code}\\n" http://127.0.0.1:8790/app/merge-pdf   # must be the app, not the marketing page');
