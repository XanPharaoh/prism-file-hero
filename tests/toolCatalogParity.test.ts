/**
 * Batch 06 — advertised-vs-runner parity. Reads the REAL source files and enforces that
 * the catalog is not just a list but a true map. This is the check the guide demands:
 * "a shared catalog alone does not establish functional parity."
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TOOL_CATALOG } from '../shared/catalog/toolCatalog';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const featuresSrc = readFileSync(resolve(ROOT, 'site/assets/features.data.js'), 'utf8');
const toolJs = readFileSync(resolve(ROOT, 'site/assets/tool.js'), 'utf8');
const registry = readFileSync(resolve(ROOT, 'src/registry/toolRegistry.ts'), 'utf8');

const advertised = new Map<string, string[]>();
for (const m of featuresSrc.matchAll(/\{\s*slug:\s*"([^"]+)".*?runs:\s*\[([^\]]*)\]/gs)) {
  advertised.set(m[1], m[2].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean));
}
const siteRunners = new Set(Array.from(toolJs.matchAll(/^\s{4}"([a-z0-9-]+)":\s*\{/gm), m => m[1]));
const appIds = new Set(Array.from(registry.matchAll(/\bid:\s*'([a-z0-9-]+)'/g), m => m[1]));

// Declared, KNOWN site-capability gaps (advertised browser/web-ai but no live runner yet).
// Asserting this EXACT set both documents the gap and fails if a new gap appears OR if one
// is closed without updating this list — so the catalog never silently drifts.
const DECLARED_PENDING_SITE = new Set([
  'bank-statement-to-xlsx',
  'vat-ready-workbooks',
  'portfolio-statements',
]);

describe('tool catalog ↔ real runners parity', () => {
  it('every catalog siteSlug is actually advertised in features.data.js', () => {
    const orphans = TOOL_CATALOG.filter(t => !advertised.has(t.siteSlug)).map(t => t.siteSlug);
    // pdf-to-word / ocr-to-markdown slugs back more than one canonical entry; all must be real.
    expect([...new Set(orphans)]).toEqual([]);
  });

  it('every advertised slug is covered by the catalog (nothing advertised is dropped)', () => {
    const covered = new Set(TOOL_CATALOG.map(t => t.siteSlug));
    const missing = [...advertised.keys()].filter(s => !covered.has(s));
    expect(missing).toEqual([]);
  });

  it('every declared site runner exists in tool.js', () => {
    const dangling = TOOL_CATALOG.filter(t => t.runner && !siteRunners.has(t.runner)).map(t => `${t.id}→${t.runner}`);
    expect(dangling).toEqual([]);
  });

  it('every declared app id exists in toolRegistry (no dangling handler refs)', () => {
    const dangling = TOOL_CATALOG.filter(t => t.appId && !appIds.has(t.appId)).map(t => `${t.id}→${t.appId}`);
    expect(dangling).toEqual([]);
  });

  it('a tool that claims browser/web-ai execution has a site runner, except the declared pending set', () => {
    const claimers = TOOL_CATALOG
      .filter(t => t.exec.some(e => e === 'browser' || e === 'web-ai'))
      .filter(t => !t.runner || !siteRunners.has(t.runner))
      .map(t => t.siteSlug);
    expect(new Set(claimers)).toEqual(DECLARED_PENDING_SITE);
  });

  it('no catalog tool references a runner/appId set that does not exist while claiming offline desktop', () => {
    // Desktop-only tools should still map to a real app handler; report any without one.
    const desktopOnlyNoApp = TOOL_CATALOG
      .filter(t => !t.exec.some(e => e === 'browser' || e === 'web-ai'))
      .filter(t => !t.appId)
      .map(t => t.id);
    expect(new Set(desktopOnlyNoApp)).toEqual(new Set(['per-client-rules-engine', 'industry-templates']));
  });
});
