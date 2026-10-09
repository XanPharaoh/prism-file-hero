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
| Worker typecheck | `cd worker && npx tsc --noEmit` | **FAIL**, exit 2 — all errors are `@cloudflare/workers-types` vs DOM `lib` global conflicts (TS6200/TS2403/…), i.e. a tsconfig `lib` problem, not app-logic errors. `wrangler` builds via esbuild so deploy is unaffected. |
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
- **Desktop (Tauri)** — `src-tauri/` (Cargo.toml + tauri.conf.json; `src-tauri/src` has only 2 `.rs`). **A second, parallel desktop tree exists: `Prism File Hero Desktop/`** with its own `src-tauri/`, `package.json`, `vite.config.ts`, `dist-desktop/`. Two Tauri apps can silently ship different versions (guide §11).
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
- **OCR is not offline-capable.** Only `tesseract.min.js` is vendored; the **wasm core and `eng.traineddata` are fetched from jsdelivr at runtime**. So "Runs on your device / never uploaded" is **false for OCR** (the document stays local, but the engine/model are a third-party download). Guide §7.1 requires bundling worker/core/font/lang for offline OCR.
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
- Site `redact-pdf` already rasterizes (text removed) — but the **app** `pdfService.redactPdf` still only overlays (BUG-01 stands for the app).
- Site `delete-pages` / `reorder-pages` / `multi-page-layout` still use the pre-Batch-02 logic (BUG-10/11/12 plausible in the site runners too — to be reproduced with fixtures in Batch 02, not asserted here).
- `usageConfig` free `aiPages = 0` (BUG-06) is real in code; site AI is premium-gated accordingly.
- `deploy.yml` still runs on `pull_request` and always deploys `--branch=main` (BUG-33) — confirmed in the file.

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
