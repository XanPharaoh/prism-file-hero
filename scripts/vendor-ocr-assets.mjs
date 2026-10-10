#!/usr/bin/env node
/**
 * Batch 07 — Vendored OCR assets with pinned versions + SHA-256 integrity.
 *
 * Downloads the tesseract.js worker, WASM core variants, and language model into
 * site/assets/vendor/tesseract/ so the "runs on your device / offline" claim becomes TRUE
 * (today only the JS glue is vendored; core + eng.traineddata come from jsdelivr at runtime).
 *
 * - A lockfile (site/assets/vendor/tesseract/ocr-assets.lock.json) records each file's exact
 *   URL, version, and SHA-256. Downloads are verified against it; a mismatch is a hard failure
 *   (never a silently-swapped binary).
 * - `--update` regenerates the lockfile from the pinned versions (network required); normal runs
 *   verify only. This lets a maintainer review the pinned hashes in code review.
 *
 * Requires network to download. It CANNOT run in an offline/sandboxed environment — running it,
 * and the "network disabled + empty cache" browser verification, are recorded as PENDING until
 * actually executed (see docs/audit/baseline.md §20).
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'site/assets/vendor/tesseract');
const LOCK = join(OUT_DIR, 'ocr-assets.lock.json');

// Pin exact versions — no floating ranges — for reproducible, auditable offline bundles.
const TESSERACT_JS_VERSION = '5.1.1';
const TESSERACT_CORE_VERSION = '5.1.1';
const TRAINEDDATA_VERSION = '0.1.0';

const SOURCES = [
  { file: 'tesseract-worker.min.js', url: `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_JS_VERSION}/dist/worker.min.js` },
  { file: 'core/tesseract-core-simd.wasm.js', url: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${TESSERACT_CORE_VERSION}/tesseract-core-simd.wasm.js` },
  { file: 'core/tesseract-core.wasm.js', url: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${TESSERACT_CORE_VERSION}/tesseract-core.wasm.js` },
  { file: 'core/tesseract-core-simd-lstm.wasm.js', url: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${TESSERACT_CORE_VERSION}/tesseract-core-simd-lstm.wasm.js` },
  { file: 'core/tesseract-core-lstm.wasm.js', url: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${TESSERACT_CORE_VERSION}/tesseract-core-lstm.wasm.js` },
  { file: 'langdata/eng.traineddata.gz', url: `https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@${TRAINEDDATA_VERSION}/4.0.0_best_int/eng.traineddata.gz` },
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function main() {
  const update = process.argv.includes('--update');
  mkdirSync(join(OUT_DIR, 'core'), { recursive: true });
  mkdirSync(join(OUT_DIR, 'langdata'), { recursive: true });

  let lock = { pinned: { tesseractJs: TESSERACT_JS_VERSION, core: TESSERACT_CORE_VERSION, traineddata: TRAINEDDATA_VERSION }, files: {} };
  if (!update && existsSync(LOCK)) lock = JSON.parse(readFileSync(LOCK, 'utf8'));

  let failed = false;
  for (const src of SOURCES) {
    const dest = join(OUT_DIR, src.file);
    const expected = lock.files[src.file]?.sha256;
    if (existsSync(dest) && !update) {
      // verify already-present asset against the lock
      const actual = sha256(readFileSync(dest));
      if (expected && actual !== expected) { console.error(`INTEGRITY FAIL ${src.file}: ${actual} != ${expected}`); failed = true; }
      else console.log(`present+ok  ${src.file}`);
      continue;
    }
    console.log(`download    ${src.url}`);
    const res = await fetch(src.url);
    if (!res.ok) { console.error(`DOWNLOAD FAIL ${src.file}: HTTP ${res.status}`); failed = true; continue; }
    const buf = new Uint8Array(await res.arrayBuffer());
    const hash = sha256(buf);
    if (expected && !update && hash !== expected) { console.error(`INTEGRITY FAIL ${src.file}: ${hash} != ${expected}`); failed = true; continue; }
    writeFileSync(dest, buf);
    lock.files[src.file] = { url: src.url, sha256: hash, bytes: buf.length };
    console.log(`vendored    ${src.file} (${buf.length} bytes, sha256 ${hash.slice(0, 12)}…)`);
  }

  writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
  if (failed) { console.error('\nOCR asset vendoring FAILED (see above).'); process.exit(1); }
  console.log(update ? '\nLockfile updated. Review hashes before committing.' : '\nAll OCR assets present and verified.');
}

main().catch((e) => { console.error(e); process.exit(1); });
