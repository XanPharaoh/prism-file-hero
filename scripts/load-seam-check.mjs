#!/usr/bin/env node
/**
 * A ratchet on raw PDF loads: no new `getDocument(` or `PDFDocument.load(` outside document intake.
 *
 * Every raw load is a place that must independently remember encryption refusal, byte-copy discipline
 * and teardown — the duplication that produced the 14,476-characters-to-8 loss and three forgotten
 * `destroy()` families. `services/pdf/intake.ts` owns those now. This gate cannot force a migration,
 * so it counts: the baseline may only go down. When a call site moves behind intake, lower the number
 * in this file deliberately, in the same commit.
 *
 * Not counted: tests (they load fixtures directly on purpose), `site/assets/*.js` (separate build, no
 * shared module system — tracked as its own follow-up), and the two allowed homes: intake itself and
 * shared/pdf/loadGuard.ts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASELINE = 37;
const PATTERNS = [/getDocument\(/g, /PDFDocument\.load\(/g];
const ALLOWED = new Set([
  'services/pdf/intake.ts',
  'shared/pdf/loadGuard.ts',
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const hits = [];
for (const dir of ['services', 'src']) {
  for (const file of walk(path.join(ROOT, dir))) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (ALLOWED.has(rel)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const pattern of PATTERNS) {
        pattern.lastIndex = 0;
        if (pattern.test(line)) hits.push(`${rel}:${index + 1}`);
      }
    });
  }
}

const byFile = new Map();
for (const hit of hits) {
  const file = hit.slice(0, hit.lastIndexOf(':'));
  byFile.set(file, (byFile.get(file) || 0) + 1);
}

console.log(`raw PDF loads outside intake: ${hits.length} (baseline ${BASELINE})`);
for (const [file, count] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(3)}  ${file}`);
}

if (hits.length > BASELINE) {
  console.error(`\nFAIL  ${hits.length - BASELINE} new raw load(s). Use openForRead/openForRebuild from services/pdf/intake.ts (see the counts above).`);
  process.exit(1);
}

if (hits.length < BASELINE) {
  console.log(`\nNOTE  ${BASELINE - hits.length} raw load(s) retired. Lower BASELINE to ${hits.length} in this commit.`);
}

process.exit(0);
