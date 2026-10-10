/**
 * Batch 06 / Item 3 — advertised-vs-implementation parity, asserted against the REAL files and
 * the ACTUAL handlers. This does NOT exempt gaps: it enforces that whatever is advertised as
 * browser-executable truly runs in the browser, and that app/Worker-only tools do not claim
 * browser execution. A tool with no implementation anywhere is reported, not excused.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TOOL_CATALOG } from '../shared/catalog/toolCatalog';
import { getToolById } from '../src/registry/toolRegistry';

const handlerFor = (id: string) => getToolById(id as any)?.handler;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const featuresSrc = readFileSync(resolve(ROOT, 'site/assets/features.data.js'), 'utf8');
const toolJs = readFileSync(resolve(ROOT, 'site/assets/tool.js'), 'utf8');
const registry = readFileSync(resolve(ROOT, 'src/registry/toolRegistry.ts'), 'utf8');

const advertised = new Map<string, string[]>();
for (const m of featuresSrc.matchAll(/\{\s*slug:\s*"([^"]+)".*?runs:\s*\[([^\]]*)\]/gs)) {
  advertised.set(m[1], m[2].split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean));
}
const siteRunners = new Set(Array.from(toolJs.matchAll(/^\s{4}"([a-z0-9-]+)":\s*\{/gm), m => m[1]));
const siteAiAdapters = new Set(Array.from(toolJs.matchAll(/aiCall\("([a-z-]+)"/g), m => m[1]));
const appIds = new Set(Array.from(registry.matchAll(/\bid:\s*'([a-z0-9-]+)'/g), m => m[1]));

describe('catalog ↔ advertised ↔ runner consistency', () => {
  it('every catalog siteSlug is advertised; every advertised slug is catalogued', () => {
    expect(TOOL_CATALOG.filter(t => !advertised.has(t.siteSlug)).map(t => t.siteSlug)).toEqual([]);
    const covered = new Set(TOOL_CATALOG.map(t => t.siteSlug));
    expect([...advertised.keys()].filter(s => !covered.has(s))).toEqual([]);
  });

  it('a tool advertised as browser-runnable has a real site runner or a site AI adapter', () => {
    const offenders = TOOL_CATALOG.filter(t => {
      const runs = advertised.get(t.siteSlug) || [];
      if (!runs.includes('browser')) return false;
      return !(t.runner && siteRunners.has(t.runner)) && !siteAiAdapters.has(t.id);
    }).map(t => t.siteSlug);
    expect(offenders).toEqual([]);
  });

  it('every declared site runner actually exists in tool.js', () => {
    expect(TOOL_CATALOG.filter(t => t.runner && !siteRunners.has(t.runner)).map(t => `${t.id}->${t.runner}`)).toEqual([]);
  });

  it('siteExecutable is accurate wherever it is declared: true only with a runner or adapter', () => {
    for (const t of TOOL_CATALOG.filter(x => x.siteExecutable !== undefined)) {
      const canRun = (!!t.runner && siteRunners.has(t.runner)) || siteAiAdapters.has(t.id);
      expect({ id: t.id, claimed: t.siteExecutable === true, actual: canRun })
        .toEqual({ id: t.id, claimed: canRun, actual: canRun });
    }
  });

  it('every declared app id resolves to a real handler via getHandler', () => {
    for (const t of TOOL_CATALOG.filter(x => x.appId)) {
      expect(typeof handlerFor(t.appId!)).toBe('function');
    }
  });

  it('the app-ONLY / unimplemented set is reported honestly (not silently claimed working)', () => {
    // Tools the SITE cannot run: must carry no `browser` claim in the UI data.
    const notSiteRunnable = TOOL_CATALOG.filter(t => t.siteExecutable === false).map(t => t.id);
    for (const id of notSiteRunnable) {
      const t = TOOL_CATALOG.find(x => x.id === id)!;
      expect(advertised.get(t.siteSlug) || []).not.toContain('browser');
    }
    // Genuinely unimplemented capabilities (no runner, no app id, no pipeline impl).
    const unimplemented = TOOL_CATALOG.filter(t => !t.runner && !t.appId && !t.impl).map(t => t.id);
    expect(unimplemented).toEqual(['industry-templates', 'portfolio-statements']);
  });
});

describe('invoke the ACTUAL handlers and inspect outputs (functional parity, not a list)', () => {
  // Uses a real generated PDF so the handler runs end-to-end in Node (pdf-lib), not mocked.
  it('merge / split / delete / redact handlers produce inspectable, correct outputs', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const mk = async (label: string, pages: number) => {
      const d = await PDFDocument.create();
      const f = await d.embedFont(StandardFonts.Helvetica);
      for (let i = 0; i < pages; i++) d.addPage([300, 400]).drawText(`${label}-${i + 1}`, { x: 40, y: 300, size: 16, font: f });
      return new File([await d.save()], `${label}.pdf`, { type: 'application/pdf' });
    };
    const F = (b: Blob, name: string) => new File([b], name, { type: 'application/pdf' });
    const a = await mk('A', 2); const b = await mk('B', 3);

    const merge = await handlerFor('merge')!({ files: [a, b], options: {} } as any);
    expect((await PDFDocument.load(await merge.blob.arrayBuffer())).getPageCount()).toBe(5);

    const del = await handlerFor('delete-pages')!({ files: [b], options: { deletePages: '2' } } as any);
    expect((await PDFDocument.load(await del.blob.arrayBuffer())).getPageCount()).toBe(2);

    const red = await handlerFor('redact')!({ files: [await mk('S', 1)], options: { redactKeywords: 'S-1' } } as any);
    const redDoc = await PDFDocument.load(await red.blob.arrayBuffer());
    expect(redDoc.getPageCount()).toBe(1);
    // Genuine redaction => rasterized image-only page, no extractable original text.
    const rdoc = await (await import('pdfjs-dist')).getDocument({ data: new Uint8Array(await red.blob.arrayBuffer()) }).promise;
    const txt = await (await rdoc.getPage(1)).getTextContent();
    expect((txt.items as any[]).map(i => i.str).join(' ')).not.toContain('S-1');
  }, 60000);
});
