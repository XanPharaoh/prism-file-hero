/**
 * D1 — provision the APPLICATION's copy of the Tesseract bundles into `<root>/public/ocr`.
 *
 * `vite` serves `public/` at the app's base, so the same directory answers `/ocr/` in dev,
 * `/app/ocr/` in the release artifact, and inside `dist-desktop` / the Capacitor `www` copy.
 * `services/ocrService.ts` asks tesseract.js for exactly those paths (via
 * `shared/ocr/assets.ts::appOcrWorkerOptions`), which is what stops the app's OCR reaching for a
 * CDN. Called from `vite.config.ts` on every invocation and from
 * `node scripts/vendor-ocr-assets.mjs --app` for CI and manual runs.
 *
 * Sources are the INSTALLED packages, not a CDN: the app's tesseract.js glue is bundled out of
 * `node_modules`, so taking its worker and cores from the same directory makes a glue/worker
 * version split structurally impossible, and provisioning needs no network. `createWorker`'s
 * default `oem` is LSTM_ONLY, which makes the worker request only the `-lstm` core variants —
 * those three (baseline / simd / relaxedsimd, ~11.7 MB) are what ships, over the `4.0.0_best_int`
 * LSTM-only language model already vendored for the site.
 *
 * Hashes live in `<root>/shared/ocr/app-assets.lock.json` (tracked, reviewable in code review).
 * `--update` rewrites that lock after an intentional dependency bump; a normal run verifies and
 * fails loudly on drift or a mismatch — a silently swapped binary is the failure this guards.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const SOURCES = [
  { file: 'tesseract-worker.min.js', pkg: 'tesseract.js', from: 'dist/worker.min.js' },
  { file: 'core/tesseract-core-lstm.wasm.js', pkg: 'tesseract.js-core', from: 'tesseract-core-lstm.wasm.js' },
  { file: 'core/tesseract-core-simd-lstm.wasm.js', pkg: 'tesseract.js-core', from: 'tesseract-core-simd-lstm.wasm.js' },
  { file: 'core/tesseract-core-relaxedsimd-lstm.wasm.js', pkg: 'tesseract.js-core', from: 'tesseract-core-relaxedsimd-lstm.wasm.js' },
];

/** @param {{root: string, update?: boolean, quiet?: boolean}} opts */
export function provisionAppOcrAssets({ root, update = false, quiet = false }) {
  const outDir = join(root, 'public', 'ocr');
  const lockPath = join(root, 'shared', 'ocr', 'app-assets.lock.json');
  const siteDir = join(root, 'site', 'assets', 'vendor', 'tesseract');
  const pkgVersion = (name) => JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version;

  const pinned = {};
  for (const src of SOURCES) pinned[src.pkg] = pkgVersion(src.pkg);
  const siteLock = join(siteDir, 'ocr-assets.lock.json');
  pinned.traineddata = existsSync(siteLock) ? JSON.parse(readFileSync(siteLock, 'utf8')).pinned?.traineddata ?? 'unknown' : 'unknown';

  let lock = { pinned, files: {} };
  if (!update && existsSync(lockPath)) lock = JSON.parse(readFileSync(lockPath, 'utf8'));

  for (const [pkg, version] of Object.entries(pinned)) {
    if (lock.pinned?.[pkg] !== version) {
      console.error(`OCR ASSET VERSION DRIFT ${pkg}: installed ${version} != locked ${lock.pinned?.[pkg]}. Re-run with --app --update to accept it.`);
      process.exit(1);
    }
  }

  const entries = [
    ...SOURCES.map((s) => ({ file: s.file, srcPath: join(root, 'node_modules', s.pkg, s.from) })),
    { file: 'langdata/eng.traineddata.gz', srcPath: join(siteDir, 'langdata', 'eng.traineddata.gz') },
  ];
  mkdirSync(join(outDir, 'core'), { recursive: true });
  mkdirSync(join(outDir, 'langdata'), { recursive: true });

  let failed = false, copied = 0, verified = 0;
  for (const entry of entries) {
    if (!existsSync(entry.srcPath)) { console.error(`OCR ASSET SOURCE MISSING ${relative(root, entry.srcPath)}`); failed = true; continue; }
    const buf = readFileSync(entry.srcPath);
    const hash = sha256(buf);
    const expected = lock.files?.[entry.file]?.sha256;
    if (!update && expected && expected !== hash) {
      console.error(`OCR ASSET INTEGRITY FAIL ${entry.file}: source ${hash} != locked ${expected}`);
      failed = true; continue;
    }
    const dest = join(outDir, entry.file);
    if (existsSync(dest) && sha256(readFileSync(dest)) === hash) { verified++; continue; }
    writeFileSync(dest, buf);
    lock.files[entry.file] = { source: relative(root, entry.srcPath), sha256: hash, bytes: buf.length };
    copied++;
  }
  if (failed) { console.error('\nApp OCR asset provisioning FAILED (see above).'); process.exit(1); }
  if (update || copied > 0) writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  if (!quiet) console.log(`ocr assets: ${verified} verified in place, ${copied} written — pinned ${Object.entries(pinned).map(([k, v]) => `${k}@${v}`).join(', ')}`);
  return { pinned, outDir, copied, verified };
}
