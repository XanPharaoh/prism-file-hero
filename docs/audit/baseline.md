# Batch 00 — Honest Baseline Audit

Prepared in-repo on 2026-10-09 by executing the actual checks against the working
tree at `/mnt/hdd/Prism/prism-file-hero` (git HEAD `a4cbf2e`). Per the US SaaS
Implementation Guide §14/§16, this batch is **verify-only**: no product source was
repaired, deployed, or certified here. Every number below is from a command that was
actually run; nothing is inferred from the master snapshot or from prior transcripts.

## 1. Commands run + real results

| Check | Command | Result |
|---|---|---|
| Unit/integration suite | `npm test` (`vitest run`) | **564 passed / 2 skipped** across 58 files (1 skipped file); exit 0; ~34s |
| App build | `npm run build` (`vite build`) | **success**, 49.45s, exit 0. Warning: `dist/assets/index-*.js` = **4,414 kB (1,349 kB gzip)** — oversized chunk |
| Worker typecheck | `cd worker && npx tsc --noEmit` | **FAIL**, exit code **2**, **64 `error TS` lines total, all in `node_modules/@cloudflare/workers-types/index.d.ts`, 0 errors in `worker/src/*.ts`**. Root cause: the tsconfig's `types: ["@cloudflare/workers-types"]` collides with the ambient DOM `lib` globals (TS6200 "definitions conflict with…", TS2403, TS2717, TS2315, TS2687, TS2508). This is a **tsconfig `lib`/`types` configuration problem**, not app-logic errors. `wrangler deploy` uses esbuild which strips types, so the deployed Worker is unaffected. See §10 for the verbatim diagnostics. |
| Static site JS | `node --check` on tool.js / site.js / features.data.js | **OK** |
| Live backend probe (earlier) | `curl /api/health`, `/api/ai` | health **200 ok**; `/api/ai` unauth **401** (gated); origin `localhost:4173` accepted (not 403) |

Caveat the guide states and this audit agrees with: **a green test suite does not
prove the P0/P1 defects are absent.** The 564 passing tests do not cover the
output-correctness, redaction-removal, quota-concurrency, or billing behaviours the
audit lists.

## 2. Build targets identified

- **Static site** `site/` — no-build, deployed to Cloudflare Pages project
  `prism-file-hero` (owns `prismfilehero.com`, `www.prismfilehero.com`,
  `prism-file-hero.pages.dev`). Serves 43 tool pages + landing/account/download/pricing/financial/tools/404.
- **React web app** — root `index.html` → `src/`, `App.tsx`, `services/`; `vite build` → `dist/`.
- **Desktop (Tauri)** — `src-tauri/` (Cargo.toml + tauri.conf.json; `src-tauri/src` has only 2 `.rs`). **A second, parallel desktop tree also exists: `Prism File Hero Desktop/`** with its own `src-tauri/`, `package.json`, `vite.config.ts`, `dist-desktop/`. This is recorded as **potentially-overlapping build targets until configuration proves otherwise** — it is *not* yet confirmed that both trees are wired into any build/CI path or that they ship different versions; that determination requires comparing the two tauri.conf.json `identifier`s / product names and inspecting which tree (if any) the release pipeline targets (guide §11 follow-up).
- **Android (Capacitor)** — `android/` + `capacitor.config.ts`.
- **Cloudflare Worker** — `worker/` (`wrangler dev|deploy`; no test/typecheck script).
- **Supabase Postgres** — `supabase/migrations/` (2) + root `migrations/` (001,003,004,rls_document_history). **No `supabase/functions/`** (no edge functions).
- **Docling** — `docling-service/` + `docling-hf-space/` (unwired).

## 3. Manifests / config / vendor / migrations — present vs missing

Present: root `package.json` + `package-lock.json`; `vite.config.ts`; `tsconfig.json`;
`vitest.config.ts`; Tauri + Android manifests; Worker `package.json`+`wrangler.toml`;
`.env.local`, `.env.production`, `.env.local.example`; `site/assets/vendor/` (pdf-lib,
pdf.js+worker, jszip, docx, exceljs, tesseract.min.js, pdf-encrypt trio).

Missing / gaps (recorded precisely, not assumed):
- **No `.nvmrc`, no `packageManager` field** → the guide's proposed CI (`node-version-file: .nvmrc`) and any version pinning are not satisfiable as-is. Node here is v26.
- **No `typecheck` script** in root package.json.
- **OCR runs *locally* but is NOT *offline*.** These are two different claims and the copy must not conflate them:
  - *Local* — the page pixels are rasterized and recognised in the browser; the document itself is never uploaded. This is **true**.
  - *Offline* — the tool works with no network. This is **false** for OCR. Only `tesseract.min.js` (the JS glue) is vendored; the **wasm core and `eng.traineddata` language model are fetched from jsdelivr at runtime**, so a first OCR run on an air-gapped or CDN-blocked device fails. Marketing copy "Runs on your device / never uploaded" is accurate about *privacy/locality* but must not be read as *fully self-contained/offline*. Guide §7.1 requires bundling worker/core/font/lang to make the offline claim true.
- **No Paddle/billing code or routes** in the Worker (guide BUG-04/§9) — no checkout/webhook/portal exists.

## 4. Snapshot vs actual files (master `complete source code with updates.md`)

- **BUG-31 confirmed as snapshot staleness, not a live defect.** The 6 app services
  (`apiConfig`, `geminiService`, `aiExtractionService`, `internalDeviceAuth`,
  `semanticCellParser`, `usageTrackingService`) on disk now default to
  `https://prism-worker.prismfilehero.workers.dev`. But the master `.md` still embeds
  `http://localhost:8787` **13 times** in its mirrored app-service blocks. ⇒ **the
  master snapshot is not a faithful current mirror of app source**; do not trust it
  over the bytes (guide §16). Its "Site source (verbatim)" section IS current (appended
  this session).
- The `.md` mirrors the React app + the appended site; it does **not** include the
  full vendor tree, Tauri config, or Android build (guide §1 limitation).

## 5. Website runner vs advertised-page gap

`site/assets/tool.js` defines **38 runners**; `site/assets/features.data.js` advertises
**43 pages**. The 5 advertised capabilities with **no website runner** (honest
app-fallback today) are: `bank-statement-to-xlsx`, `vat-ready-workbooks`,
`per-client-rules-engine`, `industry-templates`, `portfolio-statements`. Having a runner
does not mean the advertised behaviour is correct (see §6).

## 6. Defect triage — status of the guide's findings at baseline

Batch 00 does not fix anything. For the record, the audit's defects are **carried
forward unverified-but-plausible** and are addressed in later batches. Spot notes from
reading current code:
- Site `redact-pdf` already rasterizes (text removed) — but the **app** `pdfService.redactPdf` still only overlays (BUG-01 stood for the app → **FIXED in Batch 01**, see §11).
- Site `delete-pages` / `reorder-pages` / `multi-page-layout` used pre-Batch-02 logic (BUG-10/11/12). **Reproduced and FIXED in Batch 02** (§12): `parseRange` now de-duplicates (BUG-10), reorder rejects repeated pages (BUG-11), and N-up uses a declared grid with two-up = 1×2 plus a new 9-up option (BUG-12). The app `reorderPages` also rejected subsets-by-mistake; it now allows a subset reorder but forbids repeats.
- `usageConfig` free `aiPages = 0` (BUG-06) is real in code; site AI is premium-gated accordingly.
- `deploy.yml` ran on `pull_request` and always deployed `--branch=main` (BUG-33) — **FIXED in Batch 01** (§11).
- Site `split-pdf` produced ONE `extracted.pdf` (BUG-13) — **FIXED in Batch 02** (§12): genuine split-to-many with per-page / per-range / every-N modes, bundled into a ZIP.

## 7. Tool acceptance manifest + fixture inventory (planned)

Acceptance contract per tool = guide §5. Fixture corpus to create (guide §15), at
minimum: one-page text, many-page text, scanned text, blank/faint page, landscape,
90/180/270-rotated, mixed sizes, filled-form PDF, encrypted PDF, Unicode names,
PDF with metadata/attachment/JS, inline+embedded images, split text phrases, large
image PDF, malformed structure, synthetic statements with known cent balances.
Fixtures are **not** created in Batch 00 (that is Batch 01/02 work); this section names
them so later batches have a fixed target. No private/real financial data may be
committed — synthetic/de-identified only.

## 8. Honest gate statement

- No dependencies, endpoints, versions, or test counts were invented; the numbers in
  §1 are from executed commands.
- Baseline is **green on build + unit tests** but has **known non-blocking defects**:
  oversized web bundle, Worker `tsc` config conflict, duplicate Tauri tree, no offline
  OCR assets, no billing, and a stale master snapshot.
- **Not verified here** (needs deployed access / real devices / paid sandboxes): Supabase
  deployed role grants (BUG-09), Paddle checkout/webhook end-to-end (BUG-04), native
  signed builds, real-device Android, and the deployed Worker's quota concurrency
  behaviour (only health/auth-gate were probed).

## 9. Next batch

Proceed to **Batch 01** (stop unsafe redaction + restore the finance review gate) per
guide §14, using this baseline as input. Do not mark the program complete on any
single batch.

## 10. Worker typecheck — verbatim diagnostics (evidence for §1)

Running `cd worker && npx tsc --noEmit` (exit **2**). The full output is ~64 `error TS`
lines and **every one** is inside `node_modules/@cloudflare/workers-types/index.d.ts`;
`grep -E '^src/'` over the output returns **0 lines**. Representative first lines:

```
node_modules/@cloudflare/workers-types/index.d.ts(17,1): error TS6200: Definitions of the
  following identifiers conflict with those in another file: DOMException, console,
  BufferSource, … Blob, File, CacheStorage, Cache, Crypto, … URL, URLSearchParams, …
node_modules/@cloudflare/workers-types/index.d.ts(17,13): error TS2403: Subsequent variable
  declarations must have the same type. Variable 'onmessage' must be of type
  '((this: Window, ev: MessageEvent<any>) => any) | null', but here has type 'never'.
node_modules/@cloudflare/workers-types/index.d.ts(79,50): error TS2508: No base constructor
  has the specified number of type arguments.
node_modules/@cloudflare/workers-types/index.d.ts(229,5): error TS2717: … Property 'value'
  must be of type 'T', but here has type 'keyof ValueTypeMap'.
```

Diagnosis: `worker/tsconfig.json` sets `"types": ["@cloudflare/workers-types"]` but leaves
`lib` at the default, so the DOM lib's global declarations are also loaded and collide with
the Workers types. The fix is a tsconfig change (exclude `dom` from `lib`, or scope
`workers-types` per-file), **not** an application-code change — which is why the deployed
Worker (built by `wrangler`/esbuild, which ignores these type conflicts) runs correctly in
production. Recorded here so a future batch fixes the config rather than "chasing" phantom
logic errors.

## 11. Batch 01 deltas (applied on top of this Batch 00 baseline)

- **BUG-01 (app redaction) FIXED** — `pdfService.redactPdf` rewritten from vector-overlay to
  genuine raster reconstruction (render page → paint opaque black → embed JPEG into a NEW
  image-only PDF). Text layer is discarded, so covered content is no longer extractable. New
  unmocked regression `tests/redactionRemoval.test.ts` proves a secret token is present in the
  input and absent from the output; Feature 17 in `fullFeatureValidation` and the 3
  `pdfService.test.ts` redact cases were updated to assert removal instead of overlay.
- **BUG-03 (finance review gate) FIXED** — `documentService.applyReviewGate` no longer forces
  `requiresReview=false`/deletes reasons; it derives the review state from genuine signals
  (reconcile failure, low confidence, parser disagreement, raw-text/alignment fallback) while
  **preserving** bank-extractor-set reasons and **never zero-filling balances**. Direct unit
  tests in `tests/reviewGate.test.ts`.
- **BUG-33 (PR deploys production) FIXED** — `.github/workflows/deploy.yml` dropped the
  `pull_request` trigger (now `push: [main]` + `workflow_dispatch` only), added a `concurrency`
  group and an `if:` guard, and pinned the job to the `production` environment.
- Worker `tsc` conflict (§1/§10) is **pre-existing and unchanged** by this batch — reported,
  not silently marked green.

## 12. Batch 02 deltas — destructive page operations (applied on top of Batch 01)

A single tested parser (`shared/pdf/pageSelection.ts`) is now the source of truth for page
selection across BOTH the app and the site (the site carries a hand-mirrored copy because it is
a no-build IIFE).

- **BUG-10 FIXED (delete-pages, duplicate ranges)** — the site `parseRange` returned duplicates,
  so `removePage(i)` over a descending duplicated list removed an extra original page ("2,2" killed
  pages 2 AND 3). `parseRange` now de-duplicates + sorts ascending; the app `deletePages` uses the
  shared `keepIndicesForDeletion`, which also refuses an all-pages deletion instead of emitting an
  empty document.
- **BUG-11 FIXED (reorder-pages, duplicate pages)** — the site only de-duplicated when the length
  differed from the page count, so "1,1,1" (length === n) produced three copies of page 1. Both the
  site `parseOrder` and the app `reorderPages` now REJECT repeated pages and out-of-range values
  while still permitting a legitimate subset reorder ("3,2,1" out of 16). Invalid input throws, so
  no download is produced.
- **BUG-12 FIXED (multi-page-layout, grid)** — two-up used `cols=1, rows=1`, drawing the second
  page off the sheet at negative y. `nUpGrid` declares two-up = 1 col × 2 rows, four-up = 2×2,
  nine-up = 3×3; the site gained a **9-up** option and the app routes through the same table.
- **BUG-13 FIXED (split-pdf, split-to-many)** — the site emitted ONE `extracted.pdf`. It now
  genuinely splits-to-many with three modes (every page / each listed range / every N pages) and
  bundles the parts into a ZIP, matching the advertised behaviour.
- **Tests** — `tests/pageSelection.test.ts` (13 cases: dedup, reversed range, "and"/to-syntax,
  out-of-range strict throw, malformed, oversized cap, fallback, permutation + unique checks, grid)
  and `tests/pageOps.test.ts` (6 cases reproducing BUG-10/11/12 at the service layer with real
  pdf-lib fixtures and real `pdfjs-dist` text extraction, asserting each original page appears
  exactly once and 2-up/4-up keep every page on-sheet). The `reorder-pages` stress case now passes.
- **Verification** — `npx vitest run` → **591 passed / 2 skipped** (62 files, 1 skipped) exit 0;
  `npm run build` → success exit 0 (known oversized-chunk warning); `node --check site/assets/tool.js`
  → OK. Worker `tsc` unchanged (§10): exit 2, 64 errors, all in `@cloudflare/workers-types`, 0 in `worker/src`.
  Nothing deployed.
