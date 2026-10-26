#!/usr/bin/env node
/**
 * E-family — fail the build when a committed page points at an asset whose fingerprint is stale.
 *
 * `site/tools/generate-features.mjs` and `site/tools/asset-version.mjs` write `?v=<sha256[0..10]>`
 * onto every local asset reference, so a changed file gets a new URL and a browser cannot reuse the
 * cached one. The scheme only works if someone re-runs it AFTER editing `site/assets/` — and it had
 * not been run since 2026-10-14, while `site/assets/tool.js` was edited on 2026-10-19
 * (`b021786`, `1aabd38`). Every page therefore advertised `tool.js?v=782ff87117` for a file that
 * hashes to `c93318e537`: a returning visitor's cache could keep serving the engine from before the
 * encrypted-rebuild refusal and the flatten appearance-bake fixes. That is a correctness and security
 * regression delivered through a URL, and no test could see it, because the bytes were fine and only
 * the pointer was wrong.
 *
 * This closes the loop: parse every page, hash what each URL points at, and fail on any mismatch or
 * any local asset reference carrying no fingerprint at all.
 *
 *   node scripts/asset-fingerprint-check.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const HASH_RE = /\?v=([0-9a-f]{10})\b/;

const hashCache = new Map();
function fingerprint(absPath) {
  if (!hashCache.has(absPath)) {
    hashCache.set(absPath, createHash('sha256').update(readFileSync(absPath)).digest('hex').slice(0, 10));
  }
  return hashCache.get(absPath);
}

function htmlFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) htmlFiles(p, out);
    else if (entry.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const problems = [];
let checked = 0, sriChecked = 0, pages = 0;

/**
 * A local asset reference is protected if it carries a `?v=` fingerprint OR an `integrity` attribute
 * (the three third-party vendor bundles are SRI-pinned instead — a stronger guarantee, since a
 * changed file refuses to load rather than loading stale code). Anything else is a hole.
 */
function verifyTag(file, base, tag) {
  const attr = (name) => (tag.match(new RegExp(`${name}="([^"]+)"`)) || [])[1];
  const ref = attr('src') || attr('href');
  if (!ref) return;
  if (/^(https?:)?\/\//i.test(ref) || ref.startsWith('data:') || ref.startsWith('mailto:')) return;
  if (!/\.(js|css|mjs)($|[?#])/.test(ref)) return;
  const clean = ref.split('?')[0].split('#')[0];
  const abs = clean.startsWith('/') ? join(SITE, clean) : resolve(SITE, base, clean);
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    problems.push(`${relative(ROOT, file)}: references ${ref} which does not exist locally`);
    return;
  }
  const bytes = readFileSync(abs);
  const integrity = attr('integrity');
  if (integrity) {
    const hashes = integrity.split(/\s+/).filter(Boolean);
    const failed = hashes.filter((entry) => {
      const [alg, b64] = entry.split('-');
      if (!['sha384', 'sha512', 'sha256'].includes(alg)) return true;
      return createHash(alg).update(bytes).digest('base64') !== b64;
    });
    sriChecked++;
    if (failed.length) problems.push(`${relative(ROOT, file)}: ${ref} fails its own SRI (${failed[0]}) — the browser will refuse to load it`);
    return;
  }
  checked++;
  const found = ref.match(HASH_RE);
  const actual = fingerprint(abs);
  if (!found) { problems.push(`${relative(ROOT, file)}: ${ref} has neither a fingerprint nor an integrity attribute`); return; }
  if (found[1] !== actual) problems.push(`${relative(ROOT, file)}: ${ref} is stale — this file hashes to ${actual}`);
}

for (const file of htmlFiles(SITE)) {
  pages++;
  const html = readFileSync(file, 'utf8');
  const base = relative(SITE, dirname(file)).split('\\').join('/');
  for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) verifyTag(file, base, tag[0]);
}

console.log(`asset integrity: ${pages} pages, ${checked} fingerprinted references, ${sriChecked} SRI-pinned references`);
if (problems.length) {
  console.error(`\n${problems.length} PROBLEM(S):`);
  for (const p of problems.slice(0, 40)) console.error('  ' + p);
  if (problems.length > 40) console.error(`  … and ${problems.length - 40} more`);
  console.error('\nFix by re-running: node site/tools/generate-features.mjs && node site/tools/asset-version.mjs');
  process.exit(1);
}
console.log('PASS  every local asset URL matches the bytes on disk.');
