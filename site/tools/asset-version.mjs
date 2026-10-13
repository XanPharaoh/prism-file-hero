#!/usr/bin/env node
/**
 * Applies the same content-hash asset versioning that tools/generate-features.mjs uses to the
 * hand-written pages, so one asset has one URL across the whole site. Without this, a visitor
 * moving from index.html to a feature page would refetch identical CSS/JS under two different
 * query strings.
 *
 * Re-run after editing anything in site/assets/ (the generated pages pick the new hash up on
 * their own the next time generate-features.mjs runs).
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const hash = new Map();
function version(rel) {
  const key = rel.replace(/^\.\//, '');
  if (!hash.has(key)) {
    hash.set(key, 'v=' + createHash('sha256').update(readFileSync(join(ROOT, key))).digest('hex').slice(0, 10));
  }
  return hash.get(key);
}

const targets = readdirSync(ROOT).filter((f) => f.endsWith('.html'));
let changed = 0;
for (const file of targets) {
  const path = join(ROOT, file);
  const src = readFileSync(path, 'utf8');
  const out = src.replace(/((?:\.\.\/)?assets\/[\w./-]+?\.(?:css|js))(\?v=[^"&]*)?/g, (m, asset) => {
    const rel = asset.replace(/^\.\.\//, '');
    if (!readdirSync(join(ROOT, 'assets')).length) return m;
    try {
      readFileSync(join(ROOT, rel));
    } catch {
      return m; // vendor paths that do not resolve locally stay untouched
    }
    return `${asset}?${version(rel)}`;
  });
  if (out !== src) {
    writeFileSync(path, out);
    changed++;
    console.log('versioned', file);
  }
}
console.log(`\n${changed} page(s) updated; ${hash.size} distinct asset fingerprint(s).`);
