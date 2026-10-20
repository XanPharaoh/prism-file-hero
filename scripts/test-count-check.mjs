#!/usr/bin/env node
/**
 * Per-file test counts, and a loud failure when a file did not run.
 *
 * Two real problems this exists to catch, both from this repository's own history:
 *
 *  1. A claim like "12/12" was written into a commit message after reading the *combined* total of a
 *     two-file run. Per-file rows make such a claim diffable against a line of output instead of
 *     against someone's memory of a summary.
 *  2. A vitest run exited 1 while printing `Test Files 9 passed`, because a worker failed to start
 *     and its file simply never ran. Nothing in the summary said which file went missing. Comparing
 *     test files on disk against the report turns that silent shrink into a named failure.
 *
 *   node scripts/test-count-check.mjs [vitest filters...]
 *   npm run check:counts
 *
 * With filters, the per-file table and the failure/zero-test checks still apply; the disk-coverage
 * comparison is skipped, because the files left out of a filtered run are selected, not missing.
 *
 * Verified firing: the zero-test branch (a file importing a module that does not exist — reported the
 * resolver error next to the file) and the failed-test branch (an assertion that does not hold, named
 * by full test title). The disk-coverage branch has not been reproduced on demand; it is the shape of
 * the incident in note 2, where a pool skip left a file out of the report entirely.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
// Everything the caller passed is a vitest filter: the reporter and output file are ours, not theirs.
const filters = process.argv.slice(2);

// Two vitest processes in one checkout share fixed scratch paths under evidence/ and Downloads/, so
// they corrupt each other's files and one reports a genuine pass as a failure. Measured in this
// checkout: tests/features/security.test.ts writes a redacted PDF and reads it back, and with a second
// run in flight the read failed "Unsupported image type" on bytes the other process had just written.
// Refusing is cheaper than explaining that flake later.
const VITEST_RUNNERS = new Set(['node', 'npm', 'npx', 'pnpm', 'yarn', 'bun']);
const isVitestProcess = (cmdline) => {
  // A shell wrapper whose command STRING mentions vitest is not a vitest run. Only accept processes
  // that are themselves a JS runner, so `bash -c '… npx vitest …'` cannot lock the gate.
  const prog = (cmdline.split(/\s+/)[0] || '').replace(/^.*\//u, '');
  return VITEST_RUNNERS.has(prog) && /\bvitest\b/u.test(cmdline);
};
const probe = spawnSync('pgrep', ['-af', 'vitest'], { encoding: 'utf8' });
const competing = (probe.stdout || '')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((line) => isVitestProcess(line.slice(line.indexOf(' ') + 1)));
if (competing.length) {
  console.error('Another vitest is already running; this gate would race it over shared scratch paths:');
  for (const line of competing) console.error(`  ${line}`);
  console.error('\nWait for it to finish (or stop it), then re-run.');
  process.exit(1);
}

const scratch = mkdtempSync(path.join(tmpdir(), 'vitest-counts-'));
const reportFile = path.join(scratch, 'report.json');
const die = (message) => {
  rmSync(scratch, { recursive: true, force: true });
  console.error(message);
  process.exit(1);
};

const result = spawnSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${reportFile}`, ...filters], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});

if (!existsSync(reportFile)) {
  die(`No JSON report produced (vitest exit ${result.status}).\n${(result.stderr || result.stdout || '').slice(-2000)}`);
}

let report;
try {
  report = JSON.parse(readFileSync(reportFile, 'utf8'));
} catch (e) {
  die(`Could not parse the JSON report: ${e.message}`);
}

const statusesOf = (file) => file.assertionResults ?? [];
const count = (list, want) => list.filter((a) => a.status === want).length;
const rows = (report.testResults ?? []).map((file) => {
  const a = statusesOf(file);
  return {
    file: path.relative(ROOT, file.name),
    passed: count(a, 'passed'),
    failed: count(a, 'failed'),
    skipped: count(a, 'skipped') + count(a, 'pending') + count(a, 'todo'),
    other: a.length - count(a, 'passed') - count(a, 'failed') - count(a, 'skipped') - count(a, 'pending') - count(a, 'todo'),
    total: a.length,
    // The JSON reporter gives no per-file `duration`; wall time is start/end epoch ms.
    ms: Math.max(0, (file.endTime ?? file.startTime ?? 0) - (file.startTime ?? 0)),
    failures: a.filter((x) => x.status === 'failed').map((x) => x.fullName || x.title),
  };
});
rows.sort((x, y) => x.file.localeCompare(y.file));

const width = Math.max(4, ...rows.map((r) => r.file.length));
console.log(`${'file'.padEnd(width)}  pass  fail  skip  total     ms`);
console.log('-'.repeat(width + 34));
for (const r of rows) {
  console.log(
    `${r.file.padEnd(width)}  ${String(r.passed).padStart(4)}  ${String(r.failed).padStart(4)}  ` +
    `${String(r.skipped).padStart(4)}  ${String(r.total).padStart(5)}  ${String(Math.round(r.ms)).padStart(6)}` +
    `${r.other ? `  [${r.other} in an unrecognised status]` : ''}`,
  );
}
const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
console.log('-'.repeat(width + 34));
console.log(`${'TOTAL'.padEnd(width)}  ${String(sum('passed')).padStart(4)}  ${String(sum('failed')).padStart(4)}  ${String(sum('skipped')).padStart(4)}  ${String(sum('total')).padStart(5)}  ${String(Math.round(sum('ms'))).padStart(6)}`);
console.log(`\n${rows.length} file(s) reported, ${sum('total')} test(s) accounted for.`);

// A file that ran nothing is indistinguishable from a file the pool skipped, so compare against what
// is actually on disk rather than trusting the report's own idea of completeness. That comparison is
// only honest for a full run: with filters, every unselected file would be reported as missing.
const onDisk = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full); }
    else if (/\.test\.(ts|tsx)$/.test(entry.name)) onDisk.push(path.relative(ROOT, full));
  }
};
walk(path.join(ROOT, 'tests'));

const reported = new Set(rows.map((r) => r.file));
const missing = filters.length === 0 ? onDisk.filter((f) => !reported.has(f)).sort() : [];
const empty = rows.filter((r) => r.total === 0).map((r) => r.file);
const collectErrors = (report.testResults ?? [])
  .filter((f) => (f.assertionResults ?? []).length === 0 && f.message)
  .map((f) => [path.relative(ROOT, f.name), String(f.message).split('\n')[0]]);

let problems = 0;
if (missing.length) {
  console.error(`\nFAIL  ${missing.length} test file(s) on disk reported nothing — they did not run:`);
  for (const f of missing) console.error(`      ${f}`);
  problems += missing.length;
}
if (empty.length) {
  console.error(`\nFAIL  ${empty.length} file(s) ran with zero tests (a file with no tests makes vitest exit 1 silently):`);
  for (const f of empty) console.error(`      ${f}`);
  for (const [f, message] of collectErrors) console.error(`      ${f} :: ${message}`);
  problems += empty.length;
}
if (sum('failed')) {
  console.error(`\nFAIL  ${sum('failed')} test(s) failed:`);
  for (const r of rows.filter((x) => x.failed)) {
    for (const name of r.failures) console.error(`      ${r.file} :: ${name}`);
  }
  problems += sum('failed');
}

if (problems) {
  die(`\n${problems} problem(s). A green-looking summary is not the same as a complete run.`);
}
rmSync(scratch, { recursive: true, force: true });
if (filters.length) {
  console.log(`\nPASS  ${rows.length} selected file(s) reported results. Disk coverage was not checked: this run is filtered (${filters.join(' ')}).`);
} else {
  console.log(`\nPASS  every test file on disk reported results.`);
}

