#!/usr/bin/env node
/**
 * R1 — the conversion check that ACTUALLY runs. The plain vitest files SKIP the real office→pdf
 * tests when no `soffice` engine is present (that skip is honest, but it must never be mistaken for
 * "conversion verified"). This wrapper guarantees execution:
 *   1. require Docker,
 *   2. build prism-lo (from tools/libreoffice/Dockerfile) if absent,
 *   3. install a reproducible `soffice` shim on PATH (.localdev/bin/soffice) that bind-mounts each
 *      provider temp dir at the same host path and runs as the host uid (so the provider cleans up),
 *   4. preflight that the engine answers (so we never run in a state where the tests would skip),
 *   5. run the conversion + provider vitest files with the shim on PATH and propagate the exit code.
 * Any unmet dependency exits non-zero with the exact missing piece — it does NOT silently skip.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, '.localdev', 'bin');
const SHIM = join(BIN, 'soffice');
const fail = (msg) => { console.error(`\nBLOCKED: ${msg}`); process.exit(1); };

if (process.env.SKIP_DOCKER_TESTS === 'true') { console.error('SKIP_DOCKER_TESTS=true set; exiting non-zero by design so conversions are never silently skipped.'); process.exit(1); }

// 1. Docker present?
const dv = spawnSync('docker', ['info'], { stdio: 'ignore' });
if (dv.status !== 0) fail('Docker daemon not available. Install/start Docker — the LibreOffice conversion engine runs in a container.');

// 2. Build prism-lo if missing.
if (spawnSync('docker', ['image', 'inspect', 'prism-lo'], { stdio: 'ignore' }).status !== 0) {
  console.log('building prism-lo (apt: libreoffice + poppler; needs network once)…');
  const b = spawnSync('docker', ['build', '-t', 'prism-lo', join(ROOT, 'tools', 'libreoffice')], { stdio: 'inherit' });
  if (b.status !== 0) fail('Failed to build prism-lo from tools/libreoffice/Dockerfile (see above).');
}

// 3. Install the committed reproducible shim onto PATH as `soffice`.
mkdirSync(BIN, { recursive: true });
copyFileSync(join(ROOT, 'tools', 'libreoffice', 'soffice.sh'), SHIM);
chmodSync(SHIM, 0o755);

// 4. Preflight the engine so the vitest engineReady gate is guaranteed true.
const pre = spawnSync(SHIM, ['--version'], { encoding: 'utf8', env: { ...process.env } });
if (pre.status !== 0 || !/LibreOffice/.test(pre.stdout)) fail(`soffice shim preflight failed (status=${pre.status}). Docker or the prism-lo image is not usable.`);
console.log('engine ready:', pre.stdout.trim().split('\n')[0]);

// 5. Run the real conversion tests with the shim on PATH.
const vitest = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = spawnSync(vitest, ['vitest', 'run', 'tests/libreofficeConversion.test.ts', 'tests/libreofficeProvider.test.ts'], {
  stdio: 'inherit', cwd: ROOT, env: { ...process.env, PATH: `${BIN}:${process.env.PATH}` },
});
process.exit(run.status ?? 1);
