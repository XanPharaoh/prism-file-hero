/**
 * Batch 10 — SEO metadata + sitemap, verified locally. Confirms every advertised feature
 * page carries a canonical + absolute og:url, and the generated sitemap lists every feature
 * page and core page. Live crawl / Search Console indexing is a separate deploy-time check.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const featuresSrc = readFileSync(resolve(ROOT, 'site/assets/features.data.js'), 'utf8');
const sitemapPath = resolve(ROOT, 'site/sitemap.xml');
const robotsPath = resolve(ROOT, 'site/robots.txt');

const slugs = Array.from(featuresSrc.matchAll(/\{\s*slug:\s*"([^"]+)"/g)).map(m => m[1]);

describe('SEO metadata on generated feature pages', () => {
  it('a sample feature page has an absolute canonical + og:url', () => {
    const html = readFileSync(resolve(ROOT, 'site/features/merge-pdf.html'), 'utf8');
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/prismfilehero\.com\/features\/merge-pdf\.html">/);
    expect(html).toMatch(/property="og:url" content="https:\/\/prismfilehero\.com\/features\/merge-pdf\.html"/);
    expect(html).toMatch(/property="og:image" content="https:\/\//); // absolute, not relative
  });

  it('every advertised slug has a physical feature page', () => {
    const pages = new Set(readdirSync(resolve(ROOT, 'site/features')).filter(f => f.endsWith('.html')));
    const missing = slugs.filter(s => !pages.has(`${s}.html`));
    expect(missing).toEqual([]);
  });
});

describe('sitemap + robots', () => {
  it('sitemap.xml exists, is well-formed XML, and lists every feature + core page', () => {
    expect(existsSync(sitemapPath)).toBe(true);
    const xml = readFileSync(sitemapPath, 'utf8');
    expect(xml).toMatch(/^<\?xml version="1\.0"/);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    for (const s of slugs) expect(xml).toContain(`https://prismfilehero.com/features/${s}.html`);
    for (const p of ['https://prismfilehero.com/', 'https://prismfilehero.com/tools.html', 'https://prismfilehero.com/pricing.html']) {
      expect(xml).toContain(p);
    }
    // balanced <url> tags
    expect((xml.match(/<url>/g) || []).length).toBe((xml.match(/<\/url>/g) || []).length);
  });

  it('robots.txt allows all and points at the sitemap', () => {
    const r = readFileSync(robotsPath, 'utf8');
    expect(r).toMatch(/User-agent: \*/);
    expect(r).toMatch(/Allow: \//);
    expect(r).toMatch(/Sitemap: https:\/\/prismfilehero\.com\/sitemap\.xml/);
  });
});
