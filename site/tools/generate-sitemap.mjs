// Batch 10 — Emit site/sitemap.xml from the shared feature data + core pages, and
// site/robots.txt. Canonical origin is PRF_SITE_URL (default https://prismfilehero.com)
// so staging previews get a matching sitemap. Run: `node site/tools/generate-sitemap.mjs`.
import { createRequire } from "module";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(import.meta.url);
require("../assets/features.data.js");
const PRISM = globalThis.PRISM;
const SITE = (process.env.PRF_SITE_URL || "https://prismfilehero.com").replace(/\/+$/, "");
const here = dirname(fileURLToPath(import.meta.url));
const today = new Date().toISOString().slice(0, 10);

const CORE = ["", "tools", "financial", "pricing", "download", "account"];
const featureSlugs = (PRISM.ALL || []).map(f => f.slug).filter(Boolean);

const urls = [];
for (const p of CORE) {
  urls.push(`${SITE}/${p === "" ? "" : p + (p.endsWith(".html") ? "" : p === "account" ? ".html" : ".html")}`);
}
// landing + tools hub are index.html / tools.html etc.
urls.push(`${SITE}/index.html`);
for (const s of featureSlugs) urls.push(`${SITE}/features/${s}.html`);

// de-dup, keep order, drop obvious dupes
const seen = new Set();
const uniq = urls.filter(u => (seen.has(u) ? false : (seen.add(u), true)));

const xml =
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${uniq.map(u => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join("\n")}
</urlset>
`;

writeFileSync(join(here, "..", "sitemap.xml"), xml, "utf-8");
writeFileSync(
  join(here, "..", "robots.txt"),
  `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`,
  "utf-8"
);
console.log(`sitemap.xml: ${uniq.length} urls; robots.txt written for ${SITE}`);
