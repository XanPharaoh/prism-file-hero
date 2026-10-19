#!/usr/bin/env node
/**
 * Proves the site-side engine (site/assets/tool.js) refuses encrypted input with an actionable
 * message instead of producing an empty document, and still works on plaintext fixtures.
 * The TypeScript guard is covered by tests/features/page-ops.test.ts; this file is plain JS with no
 * typecheck, so its behaviour has to be measured in the browser that actually runs it.
 *
 *   node scripts/feature-audit/site-guard-check.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PAGES_PORT || 8793);
const PAGES = `http://127.0.0.1:${PORT}`;
const PLAIN_A = 'tests/fixtures/statements/July 2026.pdf';
const PLAIN_B = 'tests/fixtures/statements/14. 15 Jun - 15 Jul 2026 R1250.pdf';
const ENCRYPTED = 'tests/fixtures/statements/Test.pdf';

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`PASS ${n}`)) : (fail++, console.log(`FAIL ${n} ${e}`)); };

const server = spawn('npx', ['--yes', 'wrangler', 'pages', 'dev', 'deploy', '--port', String(PORT), '--ip', '127.0.0.1'], {
  cwd: process.cwd(), stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
});
const stop = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

let up = false;
for (let i = 0; i < 90 && !up; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try { up = (await fetch(`${PAGES}/`, { redirect: 'manual' })).status < 500; } catch { /* not listening yet */ }
}
if (!up) { console.error('FATAL pages runtime did not start on ' + PAGES); stop(); process.exit(2); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 120)));

async function runMerge(files) {
  await page.goto(`${PAGES}/features/merge-pdf.html`, { waitUntil: 'load' });
  await page.waitForSelector('#tool-mount input[type="file"]', { timeout: 20000, state: 'attached' });
  await page.setInputFiles('#tool-mount input[type="file"]', files);
  await page.waitForFunction(() => { const b = document.querySelector('button.tool-run'); return b && !b.disabled; }, { timeout: 20000 });
  await page.locator('button.tool-run').first().click();
  await page.waitForTimeout(9000);
  return await page.evaluate(() => ({
    error: (document.querySelector('.tool-error')?.textContent || '').trim(),
    links: [...document.querySelectorAll('a')].filter(a => /^(blob|https?:)/.test(a.href) && /download|\.pdf/i.test(a.textContent || '')).map(a => (a.textContent || '').trim()),
    resultHtml: (document.querySelector('.tool-results, .tool-out, #tool-mount')?.textContent || '').slice(0, 160),
  }));
}

// 1. plaintext fixtures still merge in the browser
const plain = await runMerge([PLAIN_A, PLAIN_B]);
ok('plaintext merge on the landing page produces a result', plain.links.length > 0 && !/password-protected/.test(plain.error),
  JSON.stringify(plain).slice(0, 260));

// 2. an encrypted member is refused with an actionable message, not a pdf-lib type error
const enc = await runMerge([PLAIN_A, ENCRYPTED]);
ok('encrypted member is refused with the password message', /password-protected/.test(enc.error), JSON.stringify(enc).slice(0, 300));
ok('the old "instance of undefined" pdf-lib failure is gone', !/instance of undefined/.test(enc.error + enc.resultHtml), JSON.stringify(enc).slice(0, 300));

// 3. nothing uncaught
ok('no uncaught page errors during the two runs', pageErrors.length === 0, pageErrors.join(' | '));

console.log(`\n=== site-guard-check: ${pass} passed, ${fail} failed ===`);
await browser.close();
stop();
process.exit(fail === 0 ? 0 : 1);
