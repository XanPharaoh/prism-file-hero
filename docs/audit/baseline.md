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
  - *Local* — the page pixels are rasterized and recognised in the browser (the OCR engine runs on-device). This is **true by code inspection**.
  - *Offline* — the tool works with no network. This is **false** for OCR. Only `tesseract.min.js` (the JS glue) is vendored; the **wasm core and `eng.traineddata` language model are fetched from jsdelivr at runtime**, so a first OCR run on an air-gapped or CDN-blocked device fails. Guide §7.1 requires bundling worker/core/font/lang to make the offline claim true.
  - ⚠ **Evidence limitation:** the "the document is never uploaded" claim was assessed from the code path (pixels are fed to a local worker, no `fetch` of document bytes in the OCR runner), **not** from a live network capture — this audit sandbox has no outbound network. A browser DevTools / packet capture during a real OCR run is still a **required manual check** before the "never uploaded" wording ships. Marketing copy "Runs on your device / never uploaded" is accurate about *locality* but must not be read as *fully self-contained/offline*.
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

> **RESOLVED 2026-10-10.** The preexisting failure below was fixed by giving
> `worker/tsconfig.json` an explicit `"lib": ["ES2022"]` (no DOM) while keeping
> `"types": ["@cloudflare/workers-types"]`, so the browser and Worker compilation
> contexts stay separate and the two global-definition sets no longer collide. No
> diagnostic was suppressed and no check weakened. Actual result now: `worker &&
> npm run typecheck` → **exit 0**; `npx wrangler deploy --dry-run` → **exit 0**
> (bundling unaffected, as predicted). A `typecheck` + `check` script was added to
> `worker/package.json`.

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

## 13. Batch 03 deltas — AI contracts, truncation and schema mismatch

A single typed contract `shared/ai/aiContract.ts` now governs every AI path (app, Worker,
site), with results carrying **coverage** so a partial run is reported as partial.

- **Schema mismatch FIXED (the headline defect)** — `geminiService.mergeResults` returned
  `{rows}` / `{regions}` / `{text}`, but every `toolRegistry` consumer read `result.data` /
  `result.summary`. Net effect: **AI redaction, AI compare, and every text AI tool (OCR,
  Word, grammar, Q&A, summary) silently produced empty/fallback output.** `processWithAI`
  now returns a canonical `data` per tool (excel → `{rows, document_metadata}` · redact →
  `regions[]` · text → string) plus legacy aliases (`rows/regions/text/summary`) so no
  caller breaks during migration.
- **No silent truncation** — all requested page batches are attempted; a failed batch is
  retried once and, if still failing, is reported in `coverage.failedPages` with
  `status: 'partial'` and a user `notice` — never a fake success built only from the
  batches that happened to work. (Old code merged only successes and warned to console.)
- **compare pairing (BUG-14)** — compare now sends page N of document A together with page
  N of document B in each request (`buildCompareBatches` + `docLabel`), so the model can
  actually see a before/after; previously a 2-image batch held pages from a single document.
- **Malformed vs empty** — malformed/non-JSON replies throw (typed `AiContractError`);
  valid-but-empty tables/redactions are a legitimate complete run (empty ledger / no PII),
  while a blank transcript is a failure.
- **Server-owned prompts + capability check (Worker source)** — `worker/src/index.ts` now
  strips any client-supplied system message and injects the authoritative per-tool prompt
  (`SYSTEM_PROMPTS` + `normalizeToServerOwnedMessages`), and rejects a vision tool that
  received zero images before spend. The client still sends its (now-overridden) system
  message so the LIVE, not-yet-redeployed Worker keeps working; removal is gated on deploy.
  ⚠ **Deploy-gated:** the Worker-side prompt/metering/capability behaviour is verified by
  source + typecheck only, NOT end-to-end (do-not-deploy constraint).
- **Tests** — `tests/aiContract.test.ts` (coverage/parse/compare-pairing), `tests/aiProcess.test.ts`
  (canonical `.data`, partial-not-silent, retry-only-missing, compare pairs both docs, malformed
  vs empty), and the existing `tests/geminiService.test.ts` updated to the new contract.
- **Verification** — `npx vitest run` → **607 passed / 2 skipped** (64 files, 1 skipped) exit 0;
  `npx tsc --noEmit -p tsconfig.json` → **0** app errors; `npm run build` → exit 0; `node --check
  site/assets/tool.js` → OK; Worker `tsc` unchanged (64 errors, 0 in `worker/src`). Nothing deployed.

## 14. Batch 04 (partial) — endpoint authority + usage-report schema

This slice is fully local and verified. The remaining Batch 04 items (quota authority —
finite cloud credits, removing shared zero-AI/paid-daily limits, qualified SQL columns, the
plan catalog + forward migration) live in the Worker + Supabase and are **deploy/infra-gated**
(see §15).

- **Single API URL source** — `services/apiConfig.ts` now owns `WORKER_BASE_URL` via a pure,
  unit-tested `resolveWorkerBaseUrl(configured, isDev)`. Production builds MUST resolve to an
  `https://` origin; a non-https / `localhost` `VITE_WORKER_URL` in production THROWS instead of
  silently binding to a dev machine. Localhost is allowed only when `import.meta.env.DEV`.
- **De-duplicated URL constants** — five services (`geminiService`, `aiExtractionService`,
  `internalDeviceAuth`, `semanticCellParser`, `usageTrackingService`) each re-declared their own
  `WORKER_BASE_URL` with a hardcoded default; all now import the single source.
- **Usage-report schema FIXED** — `reportUsage` POSTed `featureType`, but the Worker's
  `UsageReportSchema` is `.strict()` with no such field, so **every usage report was rejected
  (400)**. The client now sends only schema fields (`toolId`, `pagesProcessed`, `status`, and
  optional `fileName`/`fileSizeBytes`/`error`); `featureType` is derived server-side.
- **Tests** — `tests/apiAndUsageContract.test.ts` (6): prod https default, https override trim,
  prod rejects localhost, dev allows localhost, report body has no featureType + only schema keys,
  optional fields pass through.
- **Verification** — `npx vitest run` → **613 passed / 2 skipped** (65 files, 1 skipped) exit 0;
  app `tsc` → **0** errors; `npm run build` → exit 0. Nothing deployed.

## 15. Deploy/infra-gated backlog (needs separate authorization to verify)

These later-batch acceptance criteria cannot be honestly verified without deploying the
Worker/Supabase and using paid provider/processor sandboxes; they are recorded, NOT claimed done:
- Batch 04 (rest): cloud-credit quota authority, plan catalog + forward migration, qualified SQL
  columns → needs a deployed Worker + Supabase migration applied (`worker/src/migrations`, `supabase/migrations`).
- Batch 05: Paddle checkout/webhook/portal + signature + durable inbox → needs Paddle sandbox +
  a deployed Worker.
- Batch 07: OCR offline bundling (wasm core + `eng.traineddata` vendored) and the app-side transcript-only
  OCR-PDF rewrite are local-able; cloud conversion parity is not.
- Batch 09: Office/form/edit/sign cloud converters + job leasing/deletion → deployed jobs service.
- Batch 10: public SEO/analytics/redirects → deploy + live crawls.

## 16. Batch 01 hardening — meets the restated acceptance bar (2026-10-10)

The original Batch 01 (§11) shipped raster redaction + a review gate but did NOT yet satisfy
every item in the restated spec. This pass closes the named gaps. Repository files are the
source of truth; the master `.md` mirror is updated in lockstep.

Redaction (`services/pdfService.ts` + `shared/pdf/redactGeometry.ts`):
- **One tested coordinate path.** New `shared/pdf/redactGeometry.ts` centralizes `rasterScale`,
  `topBoxToPdfRect`, `pdfRectToRaster`, `paintOpaqueBlackout`. Rotation + preview scale + PDF
  points + raster pixels all flow through pdf.js's rotation-aware `convertToViewportRectangle`;
  `tests/redactGeometry.test.ts` (5) proves scale clamp, top-origin→PDF flip, 90° stays on-sheet,
  positive-area output.
- **No silent page loss.** The old `if (!ctx) continue;` silently DROPPED a page whose canvas
  failed — replaced with a throw. Any render/paint failure on any page aborts the whole op, so a
  partial document is never returned as a completed redaction.
- **Cancellation.** `redactPdf(file, regions, { signal })` checks between pages and throws
  `AbortError`; the app `redact` handler threads `payload.signal` through it.
- **Disclosed before/at run.** The app handler returns the caveat: searchable text and form
  fields are removed, and an original digital signature is no longer valid.
- **Non-mocked coverage** (`tests/redactionHardening.test.ts`, 5): a TEXT-FREE scanned PDF is
  verified **visually** (render output, sample pixels: redacted region <40 luma, preserved region
  >120 luma) — because text extraction alone cannot prove a redaction; 90°-rotated page preserves
  600×400 orientation and drops the secret; mixed page sizes preserved with the unselected page
  kept; pre-abort and mid-abort both throw and produce no output. Existing
  `tests/redactionRemoval.test.ts` still proves the token is present before / absent after.

Finance gate (`services/documentService.ts` `applyReviewGate`, `services/excelService.ts`,
`src/components/views/ProcessingView.tsx`):
- **Four distinct states** on metadata: `processingComplete`, `validationPassed`,
  `reviewRequired` (=`requiresReview`), and `exportMode` chosen at EXPORT time, never here.
- **Reasons preserved + extended, no duplicates**; added triggers: unreconciled bank ledger
  (carries the "do not reconcile" phrase that disables pass-review), **missing/unparseable
  amounts** (never coerced to 0), **unknown opening/closing balance**, low confidence, parser
  disagreement, raw-text/alignment fallback, validation issues.
- **Acknowledgment ≠ validation.** The "Export with warning" path is now an explicit DRAFT: it no
  longer calls `setReviewConfirmed(true)` nor forces `requiresReview:false`; validation state is
  untouched.
- **Draft is visibly unverified.** `getExcelBlob` stamps an "UNVERIFIED DRAFT" banner row on the
  Transactions sheet and adds Summary rows (Processing / Validation / Review Required / Export
  Type / Review Reasons / source Opening & Closing balances). Draft exports are named
  `UNVERIFIED_DRAFT_*.xlsx`.
- `tests/reviewGate.test.ts` grew to 10 cases (distinct states, missing amount, unknown balance,
  reasons survive processing, no-zero-fill).

Verification (this pass): `npx vitest run` → **627 passed / 2 skipped** (67 files, 1 skipped) exit
0; `npx tsc --noEmit -p tsconfig.json` → **0**; `npm run build` → exit 0 (known oversized-chunk
warning). Worker `tsc` unchanged (§10): 64 errors all in `@cloudflare/workers-types`, 0 in
`worker/src`. Still-required MANUAL check: a real browser run to eyeball rotated/mixed redaction
output and the drafted workbook (sandbox has no display). Nothing deployed.

## 17. Batch 01 recheck across entry points (2026-10-10)

- **App + site redaction both genuinely remove content + abort on partial.** App: rasterize +
  throw on any page failure + AbortError (Batch 01 hardening). Site (`redact-pdf` runner):
  renders → paints black → re-embeds JPEG into a NEW image-only PDF, so matched text is not
  extractable; the per-page render/paint runs in a sequential promise chain, so ANY page
  failure rejects the whole run and the runner shows an error instead of downloading a partial
  document; it also throws when nothing matched rather than emitting an un-redacted copy.
  Feature-depth difference (not a security gap): the site matches per text item only, while the
  app adds cross-item phrase runs + explicit coordinate boxes. A live browser run of the site
  redaction remains a pending manual check.
- **Every finance export path now labels honestly.** `getExcelBlob` is the single writer and
  stamps an `UNVERIFIED DRAFT` banner + Summary rows whenever `validationPassed === false` or
  `requiresReview`/`exportMode:'draft'`. Call-site audit:
  - `toolRegistry` pdf-to-excel result → passes the gated `result.metadata` (labeled).
  - `ProcessingView.confirmReviewExport` (acknowledge path) → explicit DRAFT; does NOT set
    `reviewConfirmed(true)` nor flip `requiresReview`; filename `UNVERIFIED_DRAFT_*`.
  - `ProcessingView` ExtractionReview `onSave` → final only when `validationPassed`; else draft.
  - `ExtractionReview.exportAll` → **was exporting unlabeled**; now derives
    validation from the live `reconcileCanonical` and marks drafts (fixed).
  - `HistoryDashboard.handleDownloadExcel` → **was re-exporting unlabeled**; now reuses the
    stored gate metadata and falls back to a fresh reconciliation (conservatively a draft when
    validation can't be proven) (fixed).
  - Acknowledgment never changes validation status in any path.
- **Tests** — `tests/exportLabeling.test.ts` (2): parse the REAL exceljs output; unverified →
  banner + Summary "UNVERIFIED DRAFT" + reasons present; verified → no banner + "Verified".
- **Verification** — `npx vitest run` → **629 passed / 2 skipped** (68 files, 1 skipped) exit 0;
  app `tsc` → 0; `npm run build` → exit 0. Worker `tsc` → exit 0 (resolved in §10). Pending
  manual: a real browser run of site redaction removal + the drafted workbook appearance.

## 18. Batch 08 — US money/date profiles + integer cents (2026-10-10)

- **`shared/finance/locale.ts`** is the new canonical money/date primitive:
  - `toCents` → **integer cents**; handles `$ R € £`, locale thousands/decimal (incl. EU
    `1.234,56`), accounting parentheses, leading/trailing minus, and Dr/Cr. Returns
    **`null` for missing/unparseable** — never `0`. `formatCents` renders per profile and
    round-trips with `toCents`.
  - `parseDate` → explicit ORDER (`en-US` mdy, `en-ZA` dmy, ISO ymd). Flags **`ambiguous:true`**
    when day/month are each ≤ 12 and the two readings differ, and when a value is
    missing/unparseable. Never silently guesses.
  - `preserveIdentifier` / `normalizeZip` keep leading zeros + length as **strings**
    (`02134`, `0012345`).
  - `PROFILES` keeps US ≠ ZA: `en-US`→USD/mdy, `en-ZA`→ZAR/dmy, so US mode never inherits
    ZAR/dd-mm.
- **Wired into the review gate** (`documentService.applyReviewGate`): missing/unparseable
  amounts now use `toCents` (agrees with the engine) → a review reason; **ambiguous/missing
  dates** now also raise a review reason. A blank is never treated as zero.
- **Tests** — `tests/financeLocale.test.ts` (15): 2-decimal exactness + anti float-drift sums,
  negatives, parentheses, symbols/Dr/Cr, EU decimal-comma, NULL on missing/unparseable/NaN,
  `formatCents` round-trip, ISO/US/ZA resolution, ambiguity, invalid dates, 2-digit-year
  pivot, identifier + ZIP leading-zero preservation, US-not-ZAR profiles.
- **Status — implemented + locally verified; broader wiring pending.** The locale module and
  the gate integration are done and tested. Full region-filtering of the ZA-centric
  `bankRegistry` and routing every one of the 8 bank extractors through `toCents`/`parseDate`
  end-to-end is a larger follow-on (tracked in §15/§20 below) — until then US statements are
  gated on ambiguity but the legacy `parseMoney` still backs some per-bank paths.
- **Verification** — `npx vitest run` → **644 passed / 2 skipped** (69 files, 1 skipped) exit 0;
  app `tsc` → 0; `npm run build` → exit 0. No live data/US fixtures were used (synthetic only).
  Nothing deployed.

## 19. Batch 06 — shared tool catalog + advertised-vs-runner parity (2026-10-10)

- **`shared/catalog/toolCatalog.ts`** reconciles the three namespaces that had drifted:
  the marketing `slug` (`features.data.js`), the site in-browser runner key (`tool.js`
  `TOOLS`), and the app handler id (`toolRegistry.ts`). 43 advertised slugs → canonical
  entries with explicit `siteSlug` / `runner` / `appId` (nullable = a DECLARED gap, never a
  dangling reference).
- **Parity is enforced, not asserted by the list alone** (`tests/toolCatalogParity.test.ts`,
  reads the real files): every catalog siteSlug is advertised; every advertised slug is in
  the catalog; every declared runner exists in `tool.js`; every declared app id exists in
  `toolRegistry`; a tool claiming browser/web-ai MUST have a site runner except an
  explicitly-declared pending set; the test asserts that pending set EXACTLY, so a new gap
  OR an undocumented fix fails the suite.
- **Findings (honest current state):**
  - Site-runner side is CLEAN: all 40 browser/web-ai-capable tools have a real runner; 0
    orphan runners.
  - **Declared pending site capability (3):** `bank-statement-to-xlsx`, `vat-ready-workbooks`,
    `portfolio-statements` advertise web-ai but have NO live browser runner (app/AI only).
  - **Declared desktop-only, no app handler (2):** `per-client-rules-engine`,
    `industry-templates`.
  - These are recorded as gaps in the catalog, not papered over. Wiring the 3 web-ai finance
    tools to a shared typed job (guide §7 "all five missing website capabilities") is follow-on
    work (see §15).
- **Verification** — `npx vitest run` → **650 passed / 2 skipped** (70 files, 1 skipped) exit 0;
  app `tsc` → 0; `npm run build` → exit 0. Catalog parity is file-derived and runs in CI.

## 20. Batch 07 — OCR offline loading + searchable PDF layer (2026-10-10)

Split into what is IMPLEMENTED + LOCALLY VERIFIED vs what is PENDING (needs assets/network/
browser this environment lacks). Not called "verified" while external checks are outstanding.

**Implemented + locally verified**
- `pdfService.createSearchablePdf(pages)` — preserves each scanned page IMAGE (embed +
  full-bleed `drawImage`) and overlays an INVISIBLE (`opacity 0`) positioned text layer per
  word box (pixel→PDF-point mapping with the bottom-origin flip). This replaces the
  transcript-only approach as the app's searchable primitive.
- `tests/searchablePdf.test.ts` (2, non-mocked): a raster page with a black band + supplied
  word boxes → output is 1 page, the words are **extractable** (searchable layer present) AND
  the black band is still **visibly dark** on render (the scanned image was preserved, not
  re-typeset) — directly refuting "transcript PDF". Invalid/zero-size page skipped, no crash.
- `shared/ocr/assets.ts` — the offline asset contract: `resolveOcrAssetPaths(base, offline)`
  (same-origin when offline; explicit CDN only when not offline), `REQUIRED_OCR_ASSETS` (the
  concrete worker + wasm core variants + `eng.traineddata.gz` a build must vendor),
  `missingOcrAssets(...)`. `tests/ocrAssets.test.ts` (5) proves the offline resolver never
  emits a `https:`/jsdelivr URL and that missing files are enumerated.
- Confirmed the SITE `ocr-to-searchable-pdf` runner already preserves the image + overlays
  invisible positioned text (so the app now has parity with the site's approach).

**Pending (external prerequisites — NOT done, NOT claimed verified)**
- Vendoring the actual multi-MB binaries (`tesseract-core*.wasm.js`, `eng.traineddata.gz`,
  worker bundle) under `site/assets/vendor/tesseract/` — requires a network download at build
  time; this sandbox has no egress and binaries must not be hand-fabricated. Exact missing
  files are the `REQUIRED_OCR_ASSETS` list.
- Rewiring the APP `ocr` tool away from the AI transcript path to `createSearchablePdf` with
  local-Tesseract word boxes. Deferred deliberately: the current handler is AI-based and
  exercised by AI-path/stress tests with a mocked transport; switching it to run real
  Tesseract (which needs the vendored wasm) would regress those tests here and cannot be
  verified without a browser. This is a code step to land together with the vendored assets.
- **Verification "with network disabled and an empty browser cache"** and the visual
  searchable-layer check require a real browser (Playwright/devtools) with DevTools network
  offline — cannot run in this environment. Manual + CI-browser check pending.

- **Local verification of what shipped** — `npx vitest run` → **657 passed / 2 skipped**
  (72 files, 1 skipped) exit 0; app `tsc` → 0; `npm run build` → exit 0. Nothing deployed.

## 21. Batch 04 (credit authority) + Batch 05 (billing) backend — local code + isolated-DB smoke (2026-10-10)

**Implemented + locally verified**
- `worker/src/planCatalog.ts` — authoritative server-side plans: `free` = finite 50 credits
  (not zero, not unlimited), `pro` = 1000, `business` = unlimited (-1). `resolveTrustedPlan`
  funnels ALL plan input through a whitelist and collapses anything unrecognized to `free`, so
  a client-forged plan string can never grant a higher tier. `hasCredit` is the pure check.
- `worker/src/creditLedger.ts` — atomic reserve/settle/refund modeled as a serialized critical
  section (mirrors Postgres row locks). `tests/creditLedger.test.ts` (10) proves: never
  oversell under 20 concurrent reserves, idempotent by requestId (replay never double-charges),
  insufficient-credit denial, SUCCESS→used vs ERROR→refund, no double-refund on re-settle,
  business never credit-limited, and the client-forged-plan funnel.
- `worker/src/billing/paddleVerify.ts` — raw-body Paddle HMAC-SHA256 signature verification
  (`ts:<rawBody>`, constant-time compare, never throws on malformed) + a durable-inbox reducer.
  `tests/paddleVerify.test.ts` (7) proves: correct signature accepted, tampered body / wrong
  secret / missing-h1 rejected; duplicate event ignored; OUT-OF-ORDER (older) event cannot
  regress subscription state; payment_failed→past_due, canceled→no entitlement, and a browser
  "checkout completed" with no verified server event grants NOTHING.
- `supabase/migrations/20261010000000_authoritative_plan_credits.sql` — forward, additive,
  idempotent migration: `user_plan` (server-owned, `source` column), `credit_reservations`
  (request_id PK = idempotency, PENDING/SUCCESS/ERROR), `plan_grants` (month credit),
  `reserve_credit` / `settle_credit` (SELECT … FOR UPDATE critical section; ERROR refunds;
  terminal settle is idempotent), RLS (anon no access; authenticated read-own, never write).
- **ISOLATED-DB SMOKE TEST EXECUTED** against a throwaway Docker Postgres 16 (fresh install;
  `auth.uid()` stubbed for vanilla PG) — NOT the linked remote DB:
  - insufficient-credits path: reserve 40 then 20 on a 50-grant → 2nd denied "insufficient". ✅
  - refund + idempotency: replay of a granted requestId → `replay-granted` (no extra hold);
    settle ERROR frees the 40 → a fresh 50-credit reserve succeeds. ✅
  - **concurrency (real parallel connections):** 20 simultaneous `reserve_credit(cost=4)` on a
    50-grant → **12 granted / 8 denied; 12 PENDING holds = 48 ≤ 50 → never oversold.** ✅
  - Container was destroyed after the run.

**Pending (external prerequisites — NOT done, NOT claimed verified)**
- **Prior-schema upgrade run** of the new migration (`upgrade from a representative previous
  schema`) needs the Supabase-local stack (`supabase db start`, not installed here) because the
  prior `20260806140000_unify_usage_ledger.sql` references Supabase-only objects; only the
  fresh-install path was smoke-tested here. Exact requirement: a local Supabase/PG with the
  prior migration applied.
- **RLS role verification with a real `auth.uid()`** (anonymous / authenticated / service_role)
  against a provisioned Supabase — the stub used here returns NULL, so read-own policy was not
  exercised with a real JWT subject.
- **Wiring** `reserve_credit`/`settle_credit` + `planCatalog`/`paddleVerify` into the live
  `worker/src/index.ts` `/api/ai` and a new `/api/paddle/webhook` route, and applying the
  migration — all DEPLOY actions, out of scope.
- **Live Paddle SANDBOX** signature check (needs the sandbox `whsec_…` secret + a test event),
  checkout→webhook→entitlement end-to-end, cancellation/period-end via the Paddle portal.
  Exact missing credential: `PADDLE_WEBHOOK_SECRET` (sandbox) + sandbox API key + a Paddle
  test checkout. The reducer is unit-proven; the live integration is not.

- **Verification of what shipped** — `npx vitest run` → **674 passed / 2 skipped**
  (74 files, 1 skipped) exit 0; app `tsc` → 0; worker `tsc` → 0; isolated Postgres migration +
  concurrency smoke as above. Nothing deployed; no linked remote touched.

## 22. Batch 09 (converter seam) + Batch 10 (SEO) — local (2026-10-10)

**Batch 10 — implemented + locally verified**
- `site/robots.txt` and `site/sitemap.xml` (50 URLs: 7 core + all 43 feature pages) generated
  by `site/tools/generate-sitemap.mjs` from `PRISM.ALL`; canonical origin `PRF_SITE_URL`
  (default `https://prismfilehero.com`) so staging gets a matching sitemap.
- `generate-features.mjs` now emits `<link rel="canonical">`, absolute `og:url`, and absolute
  `og:image`/`twitter:image` (relative OG URLs are invalid to crawlers). All 43 pages
  regenerated.
- `tests/seoMetadata.test.ts` (4): sample page has absolute canonical + og:url; every
  advertised slug has a physical page; sitemap is well-formed and lists every feature + core
  page with balanced `<url>` tags; robots.txt allows-all + points at the sitemap.
- PENDING (deploy-time, cannot run here): a real crawler/`site:` check, Google Search Console
  submission, Lighthouse meta pass, and redirect (www/apex) verification.

**Batch 09 — contract scaffolded; providers pending**
- `worker/src/processing/converterProvider.ts`: ConversionJob catalog (office-to-pdf,
  advanced pdf-to-office, pdf-to-pdfa, pdf-forms, pdf-sign, pdf-edit) each with the engine it
  needs + in-browser flag; `ConversionRegistry` that throws a typed `NOT_CONFIGURED` (never a
  silent corrupt file) when no provider is wired. `tests/converterRegistry.test.ts` (3) proves
  the seam.
- UNAVAILABLE checks (explicit): no conversion engine is bundled (LibreOffice headless,
  Docling, Ghostscript/veraPDF, a signing service, or a commercial API). "Pin and evaluate a
  legally usable engine" + private-upload job leasing + scheduled deletion + malformed/
  encrypted/macro/archive-bomb fixtures are all blocked on selecting/provisioning a provider
  (a deploy + cost decision). No live conversion was performed or claimed.

- **Verification** — `npx vitest run` → **681 passed / 2 skipped** (76 files, 1 skipped) exit 0;
  app `tsc` → 0; worker `tsc` → 0; `npm run build` → exit 0; `node --check site/assets/tool.js`
  → OK. Nothing deployed.

## 23. Consolidated status — four levels, never conflated (updated 2026-10-10)

Levels: **H** = helper/logic implemented · **F** = user flow integrated (handler/route/UI actually
calls it) · **LV** = locally verified (a check was executed here + result recorded) · **EV** =
externally verified (needs deploy / real provider / browser — NOT done unless marked).
"locally verified" NEVER implies "externally verified".

| Area | H | F | LV (executed here) | EV status |
|---|:-:|:-:|---|---|
| Worker typecheck | ✅ | ✅ build | ✅ `tsc` exit 0 + `wrangler --dry-run` 0 | — (nothing to deploy-check beyond build) |
| Batch 01 redaction | ✅ | ✅ app+site handlers | ✅ text/pixel/rotation/mixed/cancel + **headless browser: secret not extractable from the downloaded PDF** | browser eyeball of the rendered scan (PNG saved, not auto-diffed) |
| Batch 01 finance gate + exports | ✅ | ✅ all 5 export paths wired to `getExcelBlob` | ✅ `exportLabeling` parses real xlsx; ack≠validation; 4 states | workbook visually opened in a spreadsheet app (manual) |
| Batch 02 page ops | ✅ | ✅ | ✅ service + parser tests | — |
| Batch 03 AI contract | ✅ | ✅ client processWithAI + consumers | ✅ coverage/partial/retry/compare/malformed (fetch-stubbed) | **EV pending**: live `/api/ai` responses (needs deployed Worker) |
| Batch 04 endpoint/URL | ✅ | ✅ 5 services import single source | ✅ https/no-localhost/report-schema | deployed env config |
| Batch 04 plan+credits | ✅ | ✅ `/api/ai`→reserve/settle RPC (already live path) + `getUserPlan` server-side | ✅ 10 unit + **isolated Postgres concurrency 20→12/8, no oversell** | **EV pending**: full HTTP via local Supabase stack; prior-schema upgrade; RLS roles w/ real JWT |
| Batch 05 billing | ✅ | ✅ `/api/paddle/webhook` route + durable inbox + migration | ✅ sig accept/reject, dedupe/out-of-order, **isolated PG: dedupe survives a NEW connection (restart-survival)**, entitlement lookup | **EV pending**: real Paddle SANDBOX webhook + checkout→entitlement e2e |
| Batch 06 catalog + runtime | ✅ | ✅ app handlers resolve via catalog; site runners | ✅ parity (no exemption) + **runtime: merge/delete/redact handlers produce inspectable correct outputs** | implement the 2 unimplemented (industry-templates, portfolio-statements) |
| Batch 07 OCR/searchable | ✅ | ✅ app `ocr` default = searchable overlay (transcript opt-in) | ✅ placement test + `ocrAssets` resolver; **headless browser ran the site redact flow** | **EV pending**: `vendor:ocr` download (no egress) + network-disabled + empty-cache browser OCR |
| Batch 08 US locale | ✅ | ✅ reconciliation + review gate use integer cents | ✅ 20 parser tests + integration unchanged | region-filter `bankRegistry` + all 8 extractors on real US fixtures |
| Batch 09 converter | ✅ | ✅ LibreOffice adapter in `processing/` jobs svc | ✅ argv/limits/cleanup/PDF-verify; **live conversion SKIPPED (no soffice here)** | **EV pending**: run office→pdf where LibreOffice exists + fixtures |
| Batch 10 SEO | ✅ | ✅ generated into every page | ✅ robots/sitemap/canonical tests | crawler/GSC/redirects (deploy) |

**This session's commits**: worker tsc fix `76e4ecb`; batch-01 recheck `cb4cc85`; batch-08 `0f1c58e`;
batch-06 `af8970f`; batch-07 `d2ec386`; batch-04/05 `a907015`; item-1 `f9a60fc`; item-2 `1beaa54`;
item-3 `c7a0d22`; item-4 `a33eae3`; item-5 `07de53d`; item-6 `6390d07`. Suite is **694 passed / 2
skipped**; app + worker tsc **0**; build **0**; headless browser evidence passes.

## 24. Local staging plan (corrected) — no production deploy

To convert the EV-pending rows to verified, run BOTH the Worker and the database LOCALLY:

- **Local stack via `supabase start`** (Docker): gives local Postgres + PostgREST (`/rest/v1/rpc/...`)
  + GoTrue at `http://127.0.0.1:54321`. Apply migrations with `supabase db push` against the LOCAL
  project only (never the linked remote `vejdrvnymmowvjxleefm`).
- **Worker via `wrangler dev`** pointed at the local stack: set `SUPABASE_URL=http://127.0.0.1:54321`
  + the local service-role key + stub/sandbox AI keys + `PADDLE_WEBHOOK_SECRET` (sandbox).
- **Both local, talking to each other on localhost.** A HOSTED (Cloudflare) Worker CANNOT reach this
  dev machine's `localhost` Postgres — so either both run locally (this plan), or both run on isolated
  HOSTED staging resources (a staging Supabase project + a staging Worker). Do not mix a hosted
  Worker with a localhost DB.
- Tests that turn EV→verified here: `tests/*` already cover logic; add Playwright + `wrangler dev`
  HTTP tests for concurrency/cross-user/duplicate/provider-failure/reservation-recovery, Paddle
  sandbox webhook replay, network-disabled OCR, and `browser:evidence` for the workbook/scan visuals.
- `soffice`/LibreOffice, Tesseract assets, and a headful browser must be installed in the staging/dev
  image for the converter + OCR EV rows.

## 25. Blocker list (unchanged-by-code items)
- Local Docker stack: Postgres available (used here); full `supabase start` (PostgREST/GoTrue) not
  installed — needed for the `/api/ai`+`/api/paddle/webhook` HTTP integration tests.
- `soffice` binary absent → live office→pdf unverified (adapter + skip tested).
- No outbound network in this sandbox → `vendor:ocr` download unrun; OCR-while-offline unverified.
- Paddle SANDBOX `PADDLE_WEBHOOK_SECRET` + test products not supplied → webhook live replay unverified.
- AI provider (NVIDIA/Groq/Mistral) keys for a live `/api/ai` round-trip not exercised (transport stubbed).

## 26. Local staging EXECUTED (2026-10-10) — supersedes the §25 blockers that are now resolved

Ran the isolated LOCAL stack (Docker): `supabase start` + `supabase db reset --local` (never
`--linked`; project_id `prism-file-hero`, NOT the remote `vejdrvnymmowvjxleefm`) and `wrangler dev`
(port 8787) pointed at it via gitignored `worker/.dev.vars`. Both Worker and DB ran locally on
localhost, talking to each other. Exit codes are from actual runs, not claimed.

Promoted from "code only" to LOCALLY VERIFIED by real execution:
- **Migrations** — fresh apply of all 6 (…000004) exit 0; **upgrade from previous schema**
  (20260626+20260806 kept, legacy rows preserved) exit 0. `scripts/backend-integration-check.mjs`.
- **Backend authority (27/27)** — reserve/settle/refund, 20→5 concurrent no-oversell, idempotent
  replay, usage-ledger reserve/settle, billing dedupe/out-of-order, **RLS cross-user isolation with
  real authenticated PostgREST tokens**, and PostgREST-restart durability. Found + fixed 2 real
  defects: (a) `user_plans`/`usage_logs` had RLS DISABLED (any client could read/write all users) →
  migration 000003; (b) `get_user_entitlement` read the orphan `user_plan` and did not demote on
  cancel → migrations 000002 + a cancel-aware rework.
- **Worker routes over HTTP (13/13)** — `scripts/worker-routes-check.mjs`: health; JWT auth (401 +
  200-with-plan via a local Clerk RS256 stand-in `scripts/local-jwks.mjs`); quota preflight;
  `/api/ai` reserve→settle(ERROR) recovery; concurrent 15-way quota with no stranded PENDING;
  webhook bad-sig 401 / good-sig grants the LIVE plan / replay deduped. Surfaced + fixed a LATENT
  SQL bug (only on authenticated requests): `check_usage_limit` "column plan is ambiguous" →
  migration 000004. In-memory `creditLedger.ts` remains a MODEL, not the authority; the authority is
  the Postgres RPCs, now proven.
- **Conversions** — real LibreOffice office→pdf via the actual `libreOfficeProvider.convert()` in a
  container (`prism-lo`, soffice 7.4 + poppler): docx→3-page PDF verified by `pdfinfo`, xlsx→pdf, and
  `pdftotext` confirms rendered text; unsupported/oversize rejected; temp workspace cleaned. Found +
  fixed the provider reading `out.pdf` (engine writes `in.pdf`). 6/6 `tests/libreofficeConversion.test.ts`
  + 5/5 `tests/libreofficeProvider.test.ts`.
- **OCR offline (E)** — vendored pinned Tesseract worker + 4 core WASM + `eng.traineddata` (fixed the
  404 path 0.1.0→1.0.0) with SHA-256 lock; `scripts/offline-ocr-check.mjs` drives the real site OCR
  page with **all non-local network aborted**: searchable text recovered, **0 external requests
  attempted**. The "runs offline" claim is now verified.
- **Browser (F)** — static site (`browser-evidence.mjs`: redact removes secret, merge→5 pages) AND the
  actual built Vite app (`app-evidence.mjs`: React `/merge-pdf` download → 5-page PDF) run headless
  with generated documents inspected. `npm run build` exit 0.
- **G1/G2/G3** — strict integer-cent parser wired through every money path (currencyParser,
  moneyLocale, all named bank extractors, reconciliation, gate) + serialization tests (JSON history
  boundary, xlsx export boundary, out-of-range/foreign/conflicting rejected); US region filtering
  (4 US banks, region-scoped `detectBank`, region→profile) with synthetic fixtures; portfolio-
  statements wired to its real extractor; industry-templates marked `available:false`. Full suite
  **708 passed / 5 skipped**; app + worker `tsc` **0**; `npm run build` **0**.

STILL EXTERNALLY VERIFIED-ONLY (require credentials/deploy — honestly NOT done):
- Real **Paddle SANDBOX** checkout→entitlement replay: harness prepared
  (`scripts/paddle-sandbox-check.mjs`, `npm run check:paddle-sandbox`), GATED to exit 2 (PENDING)
  without a real `PADDLE_WEBHOOK_SECRET`. Needs: a Paddle sandbox secret + test product + a way to
  link Paddle `customer_id → user_id` (billing_customers) at checkout handoff — the customer→user
  linkage is a product gap (checkout must set it; today only the webhook side is wired).
- Real **AI provider** round-trip through `/api/ai` (NVIDIA/Groq/Mistral) — needs paid keys; the
  deterministic stand-in proves the reserve→settle→recovery path, not model output fidelity.
- **Deployed** Worker + **remote** Supabase: prior-schema UPGRADE against the real production dump,
  RLS under real JWT roles, CORS/redirects/crawlers. A hosted Worker cannot reach this dev machine's
  localhost DB — production deploy is a separate authorized decision and was NOT performed.

## 27. Billing provider switch — Paddle → PayPal (2026-10)

Per direction, checkout moved to **direct PayPal Subscriptions** (South African Business account,
**USD** for the US audience). Paddle checkout was **stopped and removed** (`paddleApi.ts`,
`paddleVerify.ts`, `scripts/paddle-sandbox-check.mjs`, the `/api/paddle/webhook` + Paddle checkout/
portal routes, `PADDLE_*` env). PRESERVED and reused: plan catalog, credit ledger, `user_plans`,
RLS, the durable `billing_events`/`billing_subscriptions` inbox, `billing_price_plans` (now a
**PayPal plan-id → tier** allowlist), and `get_user_entitlement`.

- **Trust model unchanged:** entitlement authority is SERVER-only. `begin_paypal_subscription`
  persists the internal user (canonical Clerk `sub`) ↔ PayPal subscription + allowlisted plan id
  BEFORE any browser approval; the browser sends only `{plan, cycle}` and never a user/customer/
  plan id. A browser approval (`SUBSCRIPTIONCreated`/PENDING) grants nothing.
- **Webhook verification is PayPal's documented mechanism** (`/v1/notifications/verify-webhook-signature`,
  cert/transmission based) with an `https://*.paypal.com` cert-host allowlist (SSRF guard) — NOT the
  Paddle HMAC. Non-SUCCESS → 401, no mutation.
- **`apply_paypal_event`** maps the documented access policy: ACTIVE+linked+allowlisted → grant;
  SUSPENDED/CANCELLED/EXPIRED → revoke; PAYMENT.FAILED / CAPTURE.DENIED/REVERSED/REFUNDED → past_due
  (negative event types evaluated BEFORE a status=ACTIVE so a failed/reversed payment never grants);
  duplicate idempotent; out-of-order ignored; unlinked/unknown-plan recorded but grant nothing.
- **Reconcile** route reads authoritative PayPal state for the caller's own linked subs (delayed/
  missing webhook). Account UI shows status + Cancel (ownership checked server-side).

Local verification (real Postgres/Worker; NO PayPal creds → gated scripts exit 2):
- `scripts/paypal-entitlement-check.mjs` **16/16** (state machine + idempotency + ownership).
- `scripts/privilege-escalation-check.mjs` **23/23**, `backend-integration-check` **27/27**,
  `worker-routes-check` **12/12** (unverified webhook 401; subscribe without creds 503 configured:false;
  server-derived entitlement). tests: `paypalVerify` 5, `billingService` (PayPal) 5. Full suite 711/5-skip.

STILL credential-gated (not run — no false pass): `check:paypal-capability` (verify account Subscriptions
+ USD and create sandbox product/plans) and `check:paypal-sandbox` (real subscribe→approve→signed
webhook→entitlement→paid access, duplicates, cross-user). Requires a PayPal **sandbox** app: Client ID,
Client Secret, a registered webhook id, and real sandbox plan ids added to `billing_price_plans` +
`worker/.dev.vars`. Secrets stay server-side (never in chat/Git). Live payments, paid AI, and
production deploy remain separate authorized decisions and were NOT performed.

## 28. PayPal sandbox run + payment-COVERAGE access policy (2026-10)

Access-policy rework per review: for no-trial paid plans, entitlement = **verified payment
coverage**, not an ACTIVE subscription. Migration `20261010000007` adds `billing_payments`
(one row per PAYMENT.SALE captured/refunded/reversed with its paid-through `period_end`) and
rewrites `apply_paypal_event` so SUBSCRIPTION.* events only update status (never grant),
PAYMENT.SALE.COMPLETED records coverage, REFUNDED/REVERSED void the AFFECTED payment (by sale id),
cancel stops renewal but preserves paid-through access, ordering guards status events only (payment
events are never discarded by a newer status), and `get_user_entitlement` derives `entitled` solely
from a captured payment whose `period_end > now()` — so reconciliation on a mere ACTIVE cannot
restore revoked access. Verified locally: `paypal-entitlement-check` **12/12** (incl. older-period
refund keeps current coverage; current-period refund revokes; ACTIVE-without-payment grants nothing).

**Real sandbox (SELLER creds only; secrets in gitignored `.localdev/.paypal.env` + `worker/.dev.vars`):**
- Sandbox capability CONFIRMED LIVE: OAuth token 200; `/v1/billing/plans` + `/v1/catalogs/products` 200.
- Created real sandbox PRODUCT `PROD-5LC38000C0939640E` + 4 USD plans (monthly/annual × pro/business), HTTP 201.
- Registered a real webhook (id saved) with EXPLICIT event names incl. PAYMENT.SALE.COMPLETED /
  .REFUNDED / .REVERSED + the six BILLING.SUBSCRIPTION.* + PAYMENT.CAPTURE.* names (no wildcards).
- LIVE subscribe via the Worker (server-derived identity): created PayPal subscription `I-0AX1GHACSXJG`,
  HTTP 201 + real `approveUrl`; entitlement correctly `false` while pending.

**Not evidenced as REAL payment:** a genuine `PAYMENT.SALE.COMPLETED` requires a **sandbox buyer** to
approve the subscription at the `approveUrl` (an interactive login). No sandbox buyer account was
provided, and simulator/test events are deliberately NOT counted as payment evidence. The
signature-verification request shape assumed here was **wrong** for what the sandbox actually sends
(§29 records the FAILURE investigation, the measured contract, and the regression tests).
LIVE-account capability is NOT tested (no live credentials; live payments not authorized).

## 29. Real webhook FAILURE — root cause and fix (2026-10-12)

**Reported symptom:** the PayPal dashboard showed `FAILURE ERROR` for a real
`BILLING.SUBSCRIPTION.CREATED` delivery at 1:53 PM.

**What the evidence ruled out first.** The event *did* reach the app: the local Worker logged the
deliveries as `POST /api/paypal/webhook 401 Unauthorized` taking 0.46–2.84 s each (a real round trip
to PayPal's verifier — distinguishable from the 1 ms rejects produced by the forged-event test), and
`[paypal-webhook] received 1175 bytes` matched the payload PayPal recorded. Routing, tunnel, event
parsing and the database were therefore not the cause: `billing_events` stayed empty because
**verification runs before anything is written**, and verification is what failed.

**Demonstrated root cause.** The sandbox signs payloads with `paypal-auth-version: v2` and sends
`paypal-transmission-sig`. The Worker posted the legacy field set (`event_body` + `auth_version`) and
PayPal's verifier rejected the whole request with `400 INVALID_REQUEST`, so `verifyWebhook` returned
false and refused every genuine delivery. Probing the live endpoint with an empty body returned the
actual required-field list, which the code had never matched:

```
auth_algo, cert_url, transmission_id, transmission_sig, transmission_time, webhook_id, webhook_event
```

`webhook_event` is the parsed JSON **object**; a raw body string is rejected as
`MALFORMED_REQUEST_JSON`, and `auth_version` is not part of the schema at all (sending it fails
validation). That exact shape, posted with the captured real headers, returns
`verification_status: SUCCESS` — now implemented in `verifyWebhook`
(worker/src/billing/paypalApi.ts).

**The gate was not weakened.** Tamper matrix run against the live verifier over the same real
signature:

| change | answer |
|---|---|
| untampered baseline | `SUCCESS` |
| wrong `webhook_id` | `FAILURE` |
| wrong `transmission_id` | `FAILURE` |
| wrong `transmission_time` | `FAILURE` |
| altered signature | `FAILURE` |
| body edited (`resource.status` → `ACTIVE`) | `FAILURE` |
| missing `cert_url` | `400` (and the cert-host allowlist refuses non-PayPal hosts before any call) |

`BILLING.SUBSCRIPTION.CREATED` remains **non-entitling**: after the first successful delivery
`get_user_entitlement` still answers `f | free | APPROVAL_PENDING` and `billing_payments` holds 0 rows.

**Delivery proven with the REAL event, not a simulator.** The event body carries
`links[].rel = "resend"` → `POST /v1/notifications/webhooks-events/{id}/resend`, which redelivers the
same stored event, re-signed by PayPal (fresh transmission id/time/sig, identical `event.id`).
Sequence: repoint webhook `1KP443353E900800S` from the dead quick-tunnel URL to the live one (HTTP
200), resend → `200 OK` from the Worker, one row in `billing_events`
(`WH-0UN88120D6956305A-0YC89414012419125`, `subscription_id = I-N4ECJF9TG5HX` taken from
`resource.id`) and `billing_subscriptions.last_event_id` pointing at that event. Two further resends
of the same event also returned `200 OK` (apply result `duplicate`) and added no rows. The
`/test-event` simulator was deliberately not used as evidence.

**Identifier resolver, corrected.** Lifecycle events resolve from `resource.id`; `PAYMENT.SALE.*`
events resolve from `billing_agreement_id`. The rule now lives in `resolveSubscriptionId`
(worker/src/billing/paypalApi.ts) with four unit tests, including "a payment event that names no
subscription gets no subscription". The earlier `custom_id` → "whichever subscription is currently
linked" fallback is removed: `custom_id` identifies the user, not the agreement, so it must never
select one. Ownership comes only from the persisted `billing_subscriptions.user_id` link.

**The URL it targeted, and the separate registration 400.** The captured delivery carries
`paypal-transmission-time: 2026-10-12T12:10:04Z` and the Worker logged it as 1175 bytes with a `401`,
so it reached the app through the quick tunnel that was live at that moment — a *different* tunnel
process from the one running now. When this session resumed, the registration still pointed at that
first tunnel's hostname (`frequently-hardcover-cant-ladies…`), which was by then dead (HTTP 530), so
resending required repointing the webhook at the current tunnel first. No delivery ever failed
because of routing or parsing: the `401` is the proof it arrived and was refused at verification.
The earlier webhook-registration `400` was a different failure of mine and created nothing: a shell
variable was passed as a node *argument* instead of exported into the environment, so the URL field
arrived `undefined` and PayPal answered `400` on `/url`. A later request in the same session returned
`201` and created webhook `1KP443353E900800S`; that is the only webhook on the sandbox app (verified
by listing webhooks), so the successful call superseded the failed one rather than both existing.

**Further defects found while re-running the checks** (each demonstrated by a failing assertion first,
then fixed):

1. `20261012000002` — `apply_paypal_event` read only `subscription_id`, so a genuine sale payload
   (which names `billing_agreement_id`) recorded no coverage; and entitlement derived "paid" from a
   captured payment joined through `billing_subscriptions` **without** the plan allowlist, so a
   payment against an unmapped plan id produced `entitled = true` with `plan = free`. Coverage now
   requires an allowlisted plan (returning `unmapped_plan`, recorded but granting nothing) and accepts
   either identifier.
2. `20261012000003` — the sale currency is written `amount.currency` in some PayPal API versions and
   `amount.currency_code` in others; reading one spelling stored a NULL currency and, because coverage
   requires USD, a legitimate payment granted nothing. `PAYMENT.SALE.*` payloads also had their own
   `status` (`"completed"`) copied into `billing_subscriptions.status`, so a paid subscription could be
   reported as `completed` instead of `ACTIVE`; payment events now update only the event
   pointer/timestamp and never restate lifecycle status.
3. `20261012000001` — retirement of `apply_billing_event` (Paddle-era): it was a second writer able to
   set the paid `user_plans` projection from a status-only event with no captured payment, which
   disagrees with the coverage authority and feeds `reserve_usage` caps. `refresh_user_coverage` is now
   the only writer of the paid projection.

**Real behavior found in the cancel route:** PayPal answers `404 RESOURCE_NOT_FOUND` to `/cancel`
while a subscription is `APPROVAL_PENDING` (measured on `I-52RAAXJ7P9FN`). The route now reads the
authoritative state first and returns a truthful `409 nothing-to-cancel` instead of a bare `502`.

**Local totals after the fixes:** `paypal-entitlement-check` 12/12, `backend-integration-check`
32/32, `privilege-escalation-check` 29/29, `worker-routes-check` 15/15, `vitest run` 718 passed /
5 skipped (12 of them in `paypalVerify`), `tsc --noEmit` clean.

**Still open from this incident:** a quick tunnel dies with its process, so any URL in the PayPal
registration is temporary by nature (a named tunnel, or the deployed Worker, removes this whole class
of failure); the sandbox app secret was pasted into chat and should be rotated in the PayPal
dashboard; a real `PAYMENT.SALE.COMPLETED` still requires the sandbox buyer to approve at
`https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-5EG71204MW627823H`
(`I-N4ECJF9TG5HX`, still `APPROVAL_PENDING`).

## 30. Buyer approved for real — payment coverage, and the return URL was wrong (2026-10-12)

**The approval happened and the webhooks were real.** The sandbox buyer approved `I-N4ECJF9TG5HX`;
PayPal reports `ACTIVE`, `billing_info.last_payment = USD 19.00 @ 2026-10-12T13:23:06Z`,
`next_billing_time = 2026-11-12T10:00:00Z`. Two genuine events were delivered, verified and stored:
`WH-9WJ6344699495272U-8AJ98868LV727523T` (`PAYMENT.SALE.COMPLETED`) and
`WH-4WB51450VF3050420-9WB69993J0588970K` (`BILLING.SUBSCRIPTION.ACTIVATED`), each answered `200 OK`.

**A verified payment still granted nothing — and that was our bug, not PayPal's.** The real sale
payload carries `id`, `state`, `amount.{currency,total}`, `create_time`, `subscription_id`,
`billing_agreement_id`, `custom`… and **no** `billing_period_start_date` / `billing_period_end_date`.
Whether renewals include those fields is **not** established by any evidence here (no renewal has
happened yet), so coverage must work for any payment that omits them. Because coverage requires a
future `period_end`, `get_user_entitlement` answered `false | free | ACTIVE` for a user who had
genuinely paid.
The paid-through date exists, but only on PayPal's subscription object. Fix (migration
`20261012000004` + Worker): on a verified `PAYMENT.SALE.COMPLETED` with no period dates, read
`billing_info.next_billing_time` / `last_payment.time` from PayPal (`coverageWindow`) and pass them
through `set_payment_coverage`, a function that can only bound the window of an **existing** payment —
it cannot create one, change amount/currency/status, reassign its subscription, or name a plan.
When PayPal answers nothing, no date is invented (unit-tested); `/reconcile` repairs such a row.

**Proven twice, from real data.** Deleting the payment row and resending the *same real event*
recreated it through the webhook path alone:
`3E514943GY2888425 | USD | 19.00 | 2026-10-12T13:23:06Z → 2026-11-12T10:00:00Z | captured`,
entitlement `true/pro`, `billing_subscriptions.last_event_id` = the real sale event. Independently,
`/api/billing/paypal/reconcile` reported `repaired: 1` and produced the same state.

**Paid-feature access at the enforcement layer:** for the approved user, `reserve_usage` resolves
`plan: pro, ai_pages_limit: 500`; for another user on the same tool, `plan: free, ai_pages_limit: 10`.
No paid AI call was made — this is the quota preflight only.

**The return URL bug the user hit.** `subscribe` built `returnUrl`/`cancelUrl` from the Worker's own
request origin, so PayPal redirected the browser to `127.0.0.1:8787/app?checkout=success` — an API
origin with no such route, hence `{"error":"Not found"}`. Now built only from an explicit
`FRONTEND_URL` (`worker/src/billing/urls.ts`): unset or non-http(s) → `503 {configured:false}`
*before* any PayPal call (demonstrated by removing the variable and calling the route), so a
misconfigured deploy cannot send a buyer to a dead host.

**`checkout=success` grants nothing.** The app reads the parameter only to choose which message to
show, immediately strips it with `history.replaceState`, and asks `/api/billing/entitlement`;
`isPremium` flips **only** on that server answer. `/` → `/app` now carries the query through
(`RedirectToApp`) instead of dropping it.

**Browser verification (`npm run check:checkout`, 13/13, screenshots in `evidence/checkout-return/`):**
unconfirmed return shows "Confirming…" → "Not confirmed yet" with the entitlement request answered
`401` and no "is active" claim; the approved user's return shows "PRO is active" driven by a real
`200 entitled:true plan:pro` from the Worker+DB, and a plain visit afterwards renders no panel at all;
`?checkout=cancelled` says nothing was charged and makes no entitlement claim.
**Boundary of that evidence:** `.env.local` points the browser at a LIVE Clerk instance and the
deployed Worker, so the test runs Vite against the local Worker and substitutes the locally minted
RS256 token for the Clerk *session* only (header injection on `/api/billing/**`). Every entitlement
answer is still the real server's; the signed-out header still shows "Log In", i.e. a complete
Clerk-session browser run is **not** yet evidenced.

**Local totals after this round:** `checkout-return-check` 13/13, entitlement 12/12, backend 32/32,
privilege 29/29, worker routes 15/15, `vitest run` 726 passed / 5 skipped, `tsc --noEmit` clean.

**Open:** renewal (`PAYMENT.SALE.COMPLETED` #2) and a real refund/reversal are still not evidenced —
the next renewal is 2026-11-12; a refund needs the sandbox dashboard. Rotate the sandbox app secret.
A named tunnel or the deployed Worker is needed for delivery evidence that does not depend on a
developer machine staying awake.

## 31. Real cancellation + refund, coverage identity, return messaging (2026-10-12)

### Real provider events (sandbox, business credentials — NOT fixtures)
| action | provider result | our verified event | effect on coverage |
|---|---|---|---|
| cancel via `POST /api/billing/paypal/cancel` (caller owns the sub) | `200 {"status":"canceled"}` | `WH-4CF52940CS8024202-79N66584H6498844B` `BILLING.SUBSCRIPTION.CANCELLED` → `200 OK` | `billing_subscriptions.status = CANCELLED`, payment still `captured`, **entitlement stays `t / pro / CANCELLED`** — paid-through preserved to 2026-11-12 |
| refund of the captured sale `POST /v1/payments/sale/3E514943GY2888425/refund` | `201`, refund `6X5450135V3210505`, state `completed` | `WH-7KP28140N5019114G-5K66177566457025E` `PAYMENT.SALE.REFUNDED` → `200 OK` | payment → `refunded`, `refunded_amount 19.00`, `voided_by_event_id` = that event, **entitlement `f / free / CANCELLED`** |

The cancellation event initially FAILED because the quick tunnel had died (`/api/health` through it
returned nothing). Restoring the tunnel and repointing the webhook, then resending that same stored
event, delivered it for real. Six additional genuine `BILLING.SUBSCRIPTION.CREATED` events from the
route checks were also verified and stored — evidence the verifier holds across separate deliveries.

### Refund identity — a real payload broke our assumption (migration `20261012000006`)
The delivered `PAYMENT.SALE.REFUNDED` resource is
`{ id: <REFUND id>, sale_id: <original SALE id>, amount:{total,currency}, state, create_time, update_time, … }`:
1. `id` is the **refund**, not the payment. `… where payment_id = resource.id` matched nothing, so a
   verified full refund left the payment `captured` and the user entitled. The affected payment is now
   resolved from `sale_id` (falling back to `id` for payloads that name the sale there).
2. The refund names **no subscription at all** (no `subscription_id`, no `billing_agreement_id`), so
   ownership is resolved *through* the payment row it voids.
3. Amount semantics: a reversal always voids; an **unquantified** refund voids (fail closed on
   entitlement); only an explicit partial amount that leaves the period still paid for keeps access —
   cumulative refunds reaching `gross_amount` revoke it. `refunded_amount` + `voided_by_event_id` are
   recorded for traceability.

### Coverage identity and replay guards (migration `20261012000005`)
`billing_payments.captured_at` now stores when the money moved (from the payload's own
`update_time`/`create_time`), which is what makes "this old sale was redelivered" distinguishable from
"this is the payment covering the current period". Rules, each with a regression in
`scripts/paypal-entitlement-check.mjs` (28/28):
* a window is bound only to the payment PayPal identifies as its latest — `canBindWindow(saleTime,
  billing_info.last_payment.time)` requires both to be present and the same instant (4 unit tests);
  anything else logs and stays pending;
* fill-never-extend: `on conflict … period_end = coalesce(billing_payments.period_end, excluded.period_end)`,
  so a redelivery of the same sale under a new event id cannot move the paid-through date;
* `set_payment_coverage` only fills a missing window and answers `already_covered` otherwise, refuses
  `unknown_payment`, and re-derives the owner from the persisted link (`unlinked` grants nothing);
* undated payments leave the user `not entitled` rather than guessing;
* a renewal that also omits `billing_period_*` restores coverage once its own window is bound.
`/api/billing/paypal/reconcile` now reports `repaired` and `coveragePending` separately, so
reconciliation cannot silently attach the newest period to an older payment.

### Return-page copy (`src/components/CheckoutStatus.tsx`, `services/billingService.ts`)
* A session-less return is no longer told "not confirmed": `fetchEntitlement` distinguishes `401`
  (nobody signed in → nothing to check) from a real free answer, and the panel says
  **"Sign in to confirm your subscription"** with a Sign-in action.
* `checkout=cancelled` says **"Checkout cancelled"** and defers the plan to what the server confirms;
  the unsupported "nothing was charged" line is gone (we cannot see what a cancelled session did).
* Every payment/plan statement still originates from `/api/billing/entitlement`; the parameter only
  selects the message and is stripped from the URL on read.
* `npm run check:checkout` is now **20 assertions**, adding case F (signed-in session with no captured
  payment → "Not confirmed yet" + Re-check, no unlock claim) and asserting the absence of unsupported
  claims. Screenshots: `evidence/checkout-return/{A-needs-signin,B-entitled,C-cancelled,F-unconfirmed}.png`.

### Boundary reached on "actual paid-tool output"
Every plan-gated tool in `services/usageConfig.ts` is `category: 'ai'` (9 of them); the plan difference
is the AI-page ceiling (free 10 → pro 500) plus ad suppression, not a distinct non-AI paid tool. The
`ocr` tool's handler does run locally (`src/registry/toolRegistry.ts` → `buildSearchablePdf`), but it
consumes AI pages, so executing it *as a paid user* needs a paid subscription, which after the real
refund above means a fresh approval. Paid AI provider calls remain unauthorized, so no model-backed
output is produced in this session. Reported instead: the ledger/enforcement difference and the local
pipeline's real output once a paid session exists.

### Two more real-payload findings while exporting the deliveries as fixtures
1. The inbox had been storing the Worker-ENRICHED resource, so `billing_events.payload` no longer
   matched what PayPal sent. Migration `20261012000007` separates them: `apply_paypal_event` takes the
   RAW payload plus an optional `p_coverage` object that only the Worker supplies. Re-delivering the
   real capture afterwards stored exactly the delivered keys (`amount, billing_agreement_id, create_time,
   custom, id, invoice_number, links, payment_mode, protection_eligibility*, state, subscription_id,
   transaction_fee, update_time`) with no period fields — and the derived window still bounded coverage.
2. A redelivered `PAYMENT.SALE.COMPLETED` used to flip an already-refunded payment back to `captured`.
   The upsert now preserves `refunded`/`reversed`, proven against the real event: after re-delivery the
   payment stayed `refunded` with `refunded_amount 19.00` and entitlement `f | free`.
3. Measured from the real cancellation: `billing_info` reports `last_payment` but **no**
   `next_billing_time` once cancelled, so paid-through access cannot be re-derived from the subscription
   after cancellation — it must rest on the payment window already stored. Pinned by
   `tests/paypalVerify.test.ts` against three sanitized fixtures
   (`tests/fixtures/paypal-payment-sale-{completed,refunded}.json`,
   `paypal-subscription-cancelled.json`), which also pin that a refund names its payment only via
   `sale_id` and carries no subscription identifier.

**Local totals:** entitlement/coverage 32/32, checkout browser 19/19, backend 32/32, privilege 29/29,
worker routes 13/13 (the two assertions that create a real sandbox subscription are now opt-in via
`PRISM_ALLOW_SANDBOX_SUBSCRIBE=1` and print a NOTE when skipped), vitest 733 passed / 5 skipped,
`tsc --noEmit` clean.

## 32. Clerk instance pairing preflight — and two production findings (2026-10-13)

`npm run check:clerk-pair` (`scripts/clerk-instance-check.mjs`) decodes the publishable key, resolves
its satellite, compares it with the Worker's `CLERK_JWKS_URL`/`CLERK_JWT_ISSUER`, and fetches the JWKS.
Read-only; no key material is printed. It exists because the mismatch below was invisible until
something actually tried to verify a token.

**Finding 1 — the LIVE Clerk satellite has no DNS record.** `.env.local` and the deployed static site
use a `pk_live_…` key whose satellite is `clerk.prismfilehero.com`. That name returns an authoritative
**NXDOMAIN** from three independent resolvers (system resolver, Cloudflare DoH `Status=3`, Google DoH
`Status=3`), while `prismfilehero.com` and `www` resolve normally. `worker/wrangler.toml` sets the
deployed Worker's `CLERK_JWKS_URL` to `https://clerk.prismfilehero.com/.well-known/jwks.json`, which
therefore cannot be fetched — as configured in the repo, the deployed Worker cannot verify any Clerk
JWT and every auth-gated route fails closed with 401. Caveat: a `wrangler secret` override would not be
visible from here, so this must be confirmed against the deployed Worker before being called a defect.
Not acted on: fixing DNS or instance configuration is a production change and needs authorization.

**Finding 2 — the PayPal return target does not exist in production.** `deploy.yml` publishes `./site`
(the static marketing/tools bundle) as the front door, and the React SPA is explicitly no longer
deployed; `https://prismfilehero.com/app` returns 404. The subscribe route builds
`<FRONTEND_URL>/app?checkout=…`, so a production `FRONTEND_URL` must either point at a deployed copy
of the SPA or the return page must be added to the static site. Recorded, not changed.

**Local journey configuration (item 1 of the authenticated journey).** A working **development**
instance was found referenced (commented) in `worker/wrangler.toml`: `innocent-manatee-90.clerk.accounts.dev`,
whose JWKS serves one RS256 key. The local stack is now paired to it and nothing else:
* `worker/.dev.vars` → `CLERK_JWKS_URL` + `CLERK_JWT_ISSUER` = that instance; `FRONTEND_URL=http://127.0.0.1:5173`;
  `ALLOWED_ORIGINS` = the local dev/preview origins.
* `.env.journey` (gitignored) + `vite --mode journey` → `pk_test_…` for the same instance, with the
  Worker pointed at `http://127.0.0.1:8787`. `.env.local` is left untouched so production config cannot
  be confused with local.
* `check:clerk-pair --env=.env.journey` → **6/6**, including "the Worker can actually fetch its JWKS".
* Measured proof the Worker is really bound to Clerk and not to our test tooling: a token minted by the
  local JWKS stand-in (`:8799`) is now **rejected** — `401 {"error":"Invalid token"}` — as are garbage
  and absent tokens. Browser evidence: Clerk mounts, talks only to
  `innocent-manatee-90.clerk.accounts.dev` + `img.clerk.com`, and shows its "Development mode" badge.

**Where the journey stops.** `scripts/clerk-journey-check.mjs --phase=auth` opens the app, mounts the
Clerk form and fills email + password, but that instance's **sign-up** form presents a Cloudflare
"Verify you are human" widget. Circumventing a bot check is not something I will do, and the sign-in
form has no such widget — so the plan (authorized) is to create exactly one test user through Clerk's
Backend API with the development instance's secret key, then continue the journey by signing in from
the browser with no injected headers, no minted tokens and no manual grants.

## 33. Production Clerk verification + the missing /app deployment (2026-10-13)

**Production DNS was completed by the owner and Clerk verified it** (the five Clerk CNAMEs plus
`_dmarc` were all absent when last measured here; nothing was written by this session — the wrangler
OAuth token carries `zone (read)` only and `/zones/<id>/dns_records` answered
`Authentication error (10000)`).

**Production authentication, read-only results:**
| check | result |
|---|---|
| `https://clerk.prismfilehero.com/.well-known/jwks.json` | `200`, one `RSA/RS256` key, `kid=ins_3IDcz3bi87o8HAIIEryVK0SM4ux` |
| `clerk.prismfilehero.com` CNAME | resolves → `frontend-api.clerk.services` |
| deployed Worker `/api/health` | `200 {"status":"ok"}` |
| deployed Worker CORS preflight from `https://prismfilehero.com` | `204`, `Access-Control-Allow-Origin: https://prismfilehero.com`, allows `Authorization` |
| deployed Worker `/api/usage`, `/api/usage/summary` | `401` (routes exist and demand a token) |
| deployed Worker `/api/billing/*`, `/api/paypal/*` | **`404` — the deployed Worker predates this billing work** |
| absent / garbage / forged-signature-with-real-kid / expired / wrong-instance / `alg=none` tokens against `/api/usage/summary` | **all `401`** (`Authentication required` vs `Invalid token`), no token material logged |

**What that row does and does not prove:** every non-trivial token in it was *also* unsigned by a key
the deployed instance publishes, so the signature check is what rejected them. It proves the deployed
Worker refuses unverifiable tokens; it does **not** independently prove the issuer or expiry checks.
Those are proven separately in `worker-routes-check` §7, where each token is **correctly signed** by a
key the (localtest) Worker trusts and only one claim is varied — control accepted `200`, expired `exp`
`401`, wrong `iss` `401`, unknown `kid` `401`, and `sub` taken from the token rather than the caller.
A positive production test still needs a genuine live-session token: `scripts/prod-auth-check.mjs`
performs it against `GET /api/usage` (read-only; verified to be a `usage_logs` select plus a plan read,
no writes), reports authentication separately from any backend error, and exits 2 with instructions
when `PROD_CLERK_TOKEN` is absent — it is not a pass and not a substitute.

So the frontend-authorization settings are right and the rejection paths hold, but a *positive*
production test is impossible until (a) the Worker is redeployed with the billing routes and (b) a
genuine production session token is presented. No credit reservation, tool execution, plan change or
billing write was performed against production.

**The React application was never deployed.** `deploy.yml` published only `./site`, and
`https://prismfilehero.com/app` returned 404 — the product UI, the checkout return page and every
`/app` deep link existed only in dev. Fixed by assembling one artifact (`scripts/build-release.mjs`):
marketing at `/`, app at `/app`, with these measured constraints:
- production build uses `base: '/app/'`, so the document works at any deep link (dev keeps `/`);
- the router is rooted at `import.meta.env.BASE_URL`; `/app` remains an alias route so dev URLs and
  existing scripts keep working;
- **`_redirects` cannot provide the SPA fallback**: measured with `wrangler pages dev`, a rule is
  consulted *before* the static-asset lookup, so `/app/* → /app/ 200` answered the app's own
  JS/CSS with HTML (MIME errors, blank page). The fallback is now a Pages Function
  (`functions/app/[[path]].js`) that hands anything with a file extension back to `env.ASSETS` and
  serves the app document for everything else;
- runtime asset URLs that Vite cannot rewrite (`Brand.tsx` logos, `SEOHelmet` og image,
  `ToolDashboard` sample PDF) were root-absolute and 404'd under `/app`; they are now `BASE_URL`-relative;
- `/api/*` is deliberately not routed by Pages — the bundle calls the Worker by absolute origin
  (`services/apiConfig.ts`, baked from `.env.production`, which is tracked).

**Verified locally, not deployed** (`scripts/release-artifact-check.mjs`, 14/14 against
`wrangler pages dev deploy`): `/` is still the marketing document; `/app`, `/app/merge-pdf`,
`/app/ocr-pdf`, `/app/bank-statement-to-excel` serve the built app **and actually mount** (non-empty
`#root`); refresh on a deep link keeps the app; `/app/?checkout=success` renders the return panel and
asks the real Worker (the bundle's production Worker origin is re-pointed at the local one for this
test — the only substitution, reported by the script); Pages does not serve `/api/*`; zero 4xx asset
responses. `deploy/` is gitignored and the workflow gate that checks both halves pass locally
(150 files, 33 MB).

**Two Worker environments now exist locally, because item 1 and item 3 pull in opposite directions:**
the default (`:8787`) verifies **real Clerk** signatures, and `[env.localtest]` (`:8788`,
`worker/.dev.vars.localtest`) trusts the `:8799` mint stand-in for the synthetic-user HTTP suites.
Measured: the same stand-in token is `200` on `:8788` and `401` on `:8787`. The route/checkout suites
were repointed to `:8788` (and the test dev server to `:5174`); the journey uses `:8787` + `:5173`
with genuine Clerk sessions and no injected headers.

## 34. Corrected release plan, with the recovery claims fixed (2026-10-13)

**Evidence, not assumption** — `npm run check:schema-release` (10/10) runs entirely in throwaway
Postgres containers and shows: all 17 migrations apply to an empty database; the 8 pre-PayPal
migrations apply and then the 9 PayPal-era ones apply **in place**; the upgraded schema is
byte-identical (columns + function signatures) to the freshly installed one; the access-policy
assertions (captured payment → pro; replay cannot extend the window; refund via `sale_id` revokes)
pass on the upgraded database, and again on a second database restored from that database's
`pg_dump`.

**Remote state is still unverified, and the pending list must be derived from it.** `supabase projects
list` / `migration list --linked` both fail here with "Access token not provided", so nothing in this
session has read the remote's `supabase_migrations.schema_migrations`. The earlier claim that the nine
PayPal-era migrations are "the" pending set was an assumption and is withdrawn: the complete pending
list is *every* migration the remote lacks, which may include `20261010000000`–`20261010000005`.
Before any release: `supabase login` then `supabase migration list --linked` (read-only) and take the
diff. Until that is done, treat the migration set as unknown, not as nine files.

**Backup / restore commands actually used (installed tooling):**
```
docker exec <db> pg_dump -U postgres --no-owner --no-privileges postgres > backup.sql
docker exec -i <fresh-db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 < backup.sql
# project database, equivalent:
supabase db dump --local --db-url postgres://postgres:postgres@127.0.0.1:54322/postgres -f backup.sql
supabase db restore backup.sql --local        # or psql into a scratch database to rehearse first
```
Roles are cluster-level and are **not** in the dump: a restore into a fresh cluster needs
`create role anon/authenticated/service_role` first (measured), while the `auth` schema **is** in the
dump and must not be pre-created.

**Deployment-order compatibility, measured both ways:** new Worker + old schema →
`apply_paypal_event` does not exist, so webhook and subscribe calls error out and **nothing is
granted**; old Worker + new schema → `apply_billing_event` was dropped, so its webhook path errors
and again nothing is granted; `get_user_entitlement` exists on both, so plan reads survive either
order. Correct order is therefore **migrations first, then the Worker**, then Pages.

**Withdrawn claim, replaced.** Earlier: "rolling the Worker back cannot strand access because the
billing tables remain". That is wrong, and the mechanism matters:
- Rolling the Worker back to the pre-billing build removes `/api/billing/*` and `/api/paypal/webhook`
  entirely. Buyers cannot upgrade, cancel or reconcile from the UI; PayPal deliveries fail and are
  retried until the endpoint is marked failing, so events accumulate undelivered.
- The pre-billing build answers entitlement from the `user_plans` projection, not from payment
  coverage. After a rollback, a paid user reads whatever `user_plans` held at the moment of
  rollback — which the new code may have set to `free` after a refund, or left stale. **Paid access
  can therefore be lost or, worse, reported from a stale projection.** Roll back the Worker only
  together with the schema state it understands.
- Restoring an older database backup loses every `billing_events` / `billing_payments` row written
  after that backup. Those events are not replayed automatically: PayPal redelivery is manual and
  time-windowed (`POST /v1/notifications/webhooks-events/<id>/resend`), and `/api/billing/paypal/reconcile`
  can restore subscription *status* but can only re-bind a paid-through window for the payment PayPal
  still reports as its latest. So a restore inside a paid period can leave a genuine payment
  unrepresented until it is resent by hand.
- Consequence for recovery procedure: take a fresh `pg_dump` immediately before any migration or
  Worker deploy; record the highest `billing_events.received_at` in it; after a restore, re-run
  `/api/billing/paypal/reconcile` for affected subscriptions and resend any event whose id is missing,
  then re-check `get_user_entitlement` per user rather than trusting the projection.

**Synthetic authentication is isolated and the detector is proven.** `npm run check:auth-isolation`
(13/13) asserts: the default `worker/wrangler.toml` section names no stand-in issuer; the localtest
environment exists only as `[env.localtest.vars]`; no `.dev.vars*`, token or webhook capture is
tracked and each is gitignored; the release artifact contains no stand-in issuer, `/mint` endpoint or
local Worker origin; the deploy workflow cannot select `localtest`; the **deployed** Worker answers
`401` to a locally minted token while the localtest Worker answers `200` to the same token; and no
request-injection code exists in app or Worker sources. Two of those checks initially failed on
*comments* mentioning the stand-in, so they were narrowed to assignment lines and real invocations,
and a negative control (injecting `CLERK_JWKS_URL = "http://127.0.0.1:8799/..."` into the default
section) makes the check fail as it must.

## 35. Remote schema inspected read-only, and the pending migration list corrected (2026-10-13)

`npm run check:remote-schema` (`scripts/remote-schema-probe.mjs`) probes PostgREST with the **anon**
key and prints the remote answer next to a control answer from this session's fully migrated local
database, because a bare remote `404` proves nothing on its own:

| table | remote | local control | reading |
|---|---|---|---|
| `user_plans` | 200 | 200 | present on both |
| `usage_logs` | 200 | 200 | present on both |
| `plan_grants` | 404 PGRST205 | 200 | **absent (or ungranted) remotely** |
| `credit_reservations` | 404 PGRST205 | 200 | **absent (or ungranted) remotely** |
| `billing_events` | 404 PGRST205 | 200 | **absent (or ungranted) remotely** |
| `billing_subscriptions` | 404 PGRST205 | 200 | **absent (or ungranted) remotely** |
| `billing_price_plans` | 404 PGRST205 | 200 | **absent (or ungranted) remotely** |
| `billing_payments` | 404 PGRST205 | 200 | **absent (or ungranted) remotely** |
| `user_plan` (singular, orphaned) | 404 PGRST205 | 200 | present only locally — the two databases have different baselines |

**Corrected conclusion.** The earlier §34 statement "the pending set is unknown" is replaced by
evidence: seven tables that exist on the migrated database are not reachable on the remote, and the
oldest of them (`plan_grants`, `credit_reservations`) is created by
`20261010000000_authoritative_plan_credits`. So the pending migration set **begins at
`20261010000000`** and includes `…000001`–`…000007` and `20261012000001`–`…000007` — sixteen files,
not the nine PayPal-era ones first assumed.

**Two limits, kept explicit rather than glossed.** (1) Anon visibility depends on Supabase default
privileges, so a table that exists but was explicitly `REVOKE`d from `anon` also answers PGRST205;
"absent" here means *absent or ungranted*, settled only by `SUPABASE_ACCESS_TOKEN=… supabase
migration list --linked` or a DB login. (2) RPC probes were run with deliberately invalid arguments so
nothing could execute, and they are reported as **inconclusive**: `get_user_entitlement` answers
`404/PGRST202` identically on the remote and on a database that certainly has it, so this method
cannot distinguish absent from revoked for functions. The earlier table-presence signal is meaningful
only because the local control differs from the remote answer; where they match, no claim is made.

**Journey status, measured rather than assumed.** `scripts/clerk-journey-check.mjs --phase=auth` now
tries **sign-in first** (that path has no human-verification widget) and only falls back to Create
Account. Result: sign-in reports the account is not found, and sign-up produces no session — the
development instance's CAPTCHA still blocks it. No token was minted, substituted or injected to get
past that; the run stops and says so.

## 36. The journey unblocked with the official Clerk CLI (2026-10-13)

`clerk` (the official CLI, v3.4.1) is authenticated as the account owner. `clerk apps list` identifies
one application, `app_3H8CZhKa3N36sYzdAFo64yxnA4G`, with a development instance
`ins_3H8CZi5ovl5DdACzRsmWHlyM5jy` whose publishable key decodes to
`innocent-manatee-90.clerk.accounts.dev` — the same instance this repo's local Worker now verifies
against — and a production instance `ins_3IDcz3bi87o8HAIIEryVK0SM4ux`. Every command below passed
`--app` and `--instance dev` explicitly; production was never targeted.

* `clerk users create --instance dev --file <600-mode body>` created the dedicated journey user
  `user_3KdoIR0BqZIJaW9Yh0aOXxKF13c` (`prismjourney_test_1669831847@example.com`, verified). The first
  attempt failed with `request_body_invalid` because `email_address` was sent as objects; the Backend
  API wants an array of strings. The password is written only to the gitignored
  `.localdev/journey.env`, and `clerk-journey-check.mjs` reads it from there — no hardcoded secret
  remains in the script (the previous default password was removed).
* Sign-in then reached Clerk's **"Check your email"** step: the development instance had
  `auth_password.device_trust.enabled = true`, i.e. new-device verification by email code, which a
  synthetic mailbox cannot receive. Diagnosed with `clerk config pull --instance dev`, fixed with
  `clerk config patch --instance dev --json '{"auth_password":{"device_trust":{"enabled":false}}}'`
  after a `--dry-run`. **Verified afterwards: dev `device_trust.enabled=false`, production still
  `true`** — the change is confined to the development instance.
* Normal browser sign-in now succeeds with no injected header and no minted token. The local Worker
  verifies that session's own token and echoes the identical canonical id
  (`user_3KdoIR0BqZIJaW9Yh0aOXxKF13c`), answering `plan=free, source=server` — 6/6 in `--phase=auth`.
  An anonymous call to the same route is still refused, so the session is doing the work.
* `--phase=upgrade` drives the real UI (`Upgrade → Subscribe to Pro`), the Worker creates
  `I-TMCRBXPWCX8F` server-side, the modal opens PayPal's genuine approval page
  (`…/billing/subscriptions?ba_token=BA-8KK69202GA537760L`), and entitlement stays
  `false/free` while pending — 5/5. PayPal then delivered a **real**
  `BILLING.SUBSCRIPTION.CREATED` for that subscription (`WH-2TU556238B3636924-…`), verified and stored
  with `200`, resolved from `resource.id` to the row linked to this Clerk user.
* Operational finding: the journey's first attempt at the Worker returned `500` because
  `SUPABASE_SERVICE_ROLE_KEY` in `.dev.vars` had expired (`PGRST303 "JWT expired"`) — the local mint
  lasts ~24 h. Re-minting (`npm run tokens:local`) and restarting both Workers fixed it. Any local
  suite that suddenly 500s on a billing route should check that first.

**Paused for the human step:** the sandbox buyer must approve `ba_token=BA-8KK69202GA537760L`. Once
approved, `--phase=verify` continues to payment → entitlement → paid-tool output → refresh /
logout-login / second session / separate free user.

### Journey verification results and the remaining wiring gap

`--phase=verify` is implemented (entitlement poll, payment-row assertions, refresh, logout→login,
second browser session, separate free user, and a free-user attempt to cancel the paid subscription
expecting 403) and runs after the buyer approves.

`paid-tool-output-check --live` now reaches a genuine signed-in browser session — confirmed by the
header showing `Upgrade`/`Sign Out` and the usage badge — but **the uploaded file does not register**
in the OCR landing view: the header counter stays `0/0`, "Start Operation" then routes to `/` with the
upsell screen, and no artifact is produced. `setInputFiles('input[type=file]')` and the
`filechooser` path were both tried; neither registers the file, so this view needs its own
selection wiring. The harness now fails immediately with that reason instead of a bare download
timeout. Item 7's paid artifact therefore remains **outstanding**, and it also depends on the
approval below.

### Paid tool executes, and is finally metered (2026-10-13 late session)

Four separate defects stood between "entitled Pro account" and "the paid tool actually runs". All
four are now demonstrated fixed against the real stack; each statement below is a measured result,
not an inference.

1. **The browser gate contradicted the server.** `checkLimit` read the free tier's AI lockout
   (`AI_PER_TOOL_LIMIT = 0`, `AI_GLOBAL_CAP = 0`) for *every* plan, so a Pro user was denied after
   `/api/execute` had already answered `allowed:true, plan:pro, limit:500`. The ceilings now live in
   one plan-aware table (`DAILY_CEILINGS`) that mirrors `check_usage_limit`, and the helpers default
   to `'free'` so a caller that forgets to name a plan fails closed.
2. **The deployed authority sold what it refused.** `check_usage_limit` applied 2 AI pages per tool
   per day and 6 per day globally to every plan, while Professional sells 500 AI pages a month with
   "Unlimited daily operations" (`site/pricing.html`). Measured on the entitled journey account:
   `allowed=f | reason='Per-tool daily limit reached' | plan=pro | ai_pages_limit=500 | tool_limit=2`.
   Migration `20261013000001_paid_daily_ceiling.sql` makes the daily ceilings plan-aware: free keeps
   exactly what it has (2/6 AI, 5/15 local, 10 AI pages a month — re-measured after the change), paid
   plans get `-1` (no daily ceiling) and stay bounded by the monthly budget the same function already
   enforces. The IP-wide AI net is now scoped to traffic with no account, because every route that
   reaches this function is authenticated, so as written it could only throttle paying customers who
   happen to share an address.
3. **The tool landing page bypassed the workspace intake.** `ToolLandingView.handleFiles` called the
   store's raw `addFiles()`, skipping validation and page counting, so a 2-page scan entered the
   workspace as "0 pages" — the header showed `0/0` and the run asked the server to bill 1 page.
   Both entry points now share `services/fileIntake.ts` (`intakeFiles`), which validates against the
   tool's own constraints and returns the page total the quota is billed against.
4. **Locally-executed AI work was never metered.** `/api/execute` is a non-consuming preflight and
   the only consuming meter lived inside the AI proxy, so a browser-side tool (OCR runs on in-browser
   Tesseract) never deducted a page: two full OCR runs left `aiPagesUsed: 0`. Added
   `POST /api/usage/reserve` and `POST /api/usage/settle` (JWT required, AI tools only, and settle
   verifies the reservation belongs to the caller because `settle_usage()` takes a bare request id).
   The app now reserves for the page count it will really process and settles with the true outcome.
   Measured ledger movement: `aiPagesUsed 0 → 2 → 4 → … → 16`, `byTool.ocr.aiPages` tracking it, rows
   ending `SUCCESS`.

A fifth defect surfaced while proving the fourth: `callRpc` parsed every RPC reply as JSON, and
`settle_usage()` returns void with an empty body, so settlement threw `SyntaxError: Unexpected end of
JSON input` and answered 500 even though the row had settled. Fixed, and `settle` now returns
`{"settled":true,"alreadySettled":false}`.

**Display follow-through:** `UsageBadge` treated any cap as finite, so a paid plan would have rendered
`0/-1`. Unlimited ceilings now read `∞` and the popover shows the monthly budget
(`x of 500 AI pages this month`) instead of a fake daily bar.

**Results:** `paid-tool-output-check --live` 9/9 (file picker *and* native drop → registered file →
`Start Operation` → `scanned-statement_Searchable.pdf` / `dragged-statement_Searchable.pdf`: 2 pages,
1682×2379 page images preserved, 58 positioned words, text matching the scan character-for-character
including its own `R 1,21.40` typo); `checkout-return-check` 25/25, including a new phase G that runs
the return page in the genuine Clerk session with no injected header and asserts the server-derived
plan, the paid-through date, the stripped `?checkout=`, and the working route back to the workspace;
`clerk-journey-check --phase=auth` 6/6; quota unit tests 16/16; `tsc --noEmit` clean for app and Worker.

**Still outstanding:** the app's visual integration onto the `site/` design (item 1), and production
deployment, which remains unauthorised.

### The functional app now wears the site's design (item 1)

The checkout return landed on the app's own purple/indigo interface (`We make document work
simple.` on slate) while the intended look is prismfilehero.com's dark-neutral, red-accent,
rounded-navigation treatment. They were two implementations of one brand: `site/assets/site.css`
carries the identity (tokens + self-hosted Geist/Outfit/Geist Mono + a floating pill nav), and the
React app had **no token layer at all** — Tailwind v4 with no config, no `@theme`, no custom
properties, ~350 hard-coded `indigo-*` utilities and 150 literal `bg-white` / `dark:bg-[#0B0F19]`
surfaces, plus Google Fonts (Manrope/JetBrains Mono) loaded twice.

What changed, and why each piece is safe:

- **`index.css` is now the token layer.** The site's twelve custom properties are copied verbatim
  for `:root` and `.dark`, aliased into Tailwind via `@theme` (`bg-surface`, `text-ink`,
  `border-hairline`, `bg-accent`, `text-credit`, `font-display`…), and the brand ramp lives under
  `--color-brand-*` (600 = `#c8102e` light at 5.8:1 on white; 400 = `#ff5266` dark at 5.3:1 on the
  surface). Tool colours that used to be per-category rainbow (amber/orange/`#E667E6`) are
  neutralised to the brand treatment.
- **Fonts are self-hosted and shared**: the six `site/assets/fonts/*.woff2` files were copied to
  `src/assets/fonts/` and declared in `index.css`; the Google Fonts `<link>` and its duplicate
  `@import` are gone. Vite fingerprints them, so they resolve under the `/app/` base.
- **A real dark mode.** Tailwind v4 defaults `dark:` to `prefers-color-scheme`, so the app's theme
  toggle (which adds `.dark` to `<html>`) changed nothing for utilities. `@custom-variant dark
  (&:where(.dark, .dark *))` binds the variant to the class the app actually sets.
- **The nav is the site's pill.** `App.tsx`'s full-width sticky bar became `.nav-pill` (rounded,
  translucent, blurred, hairline border) with `.nav-link` items and the accent underline for the
  current page, matching `site/assets/site.js`. `ToolLandingView`'s plain bar got the same pill.
- **Shared component classes** (`.btn-run`, `.btn-quiet`, `.btn-run-ink`, `.card-slab`,
  `.wash-accent`) are ported from `site.css` (`.tool-run`, `.auth-cta`, `.demo-window`, the red
  radial wash), replacing ~20 hand-rolled primary-button strings.
- **Account area**: the always-rendered account card used to overflow a fixed-height header; inside
  a flex pill it stretched the nav. It is now a chip (`Account: PRO plan`) that opens the summary as
  a popover, closing on Escape or an outside click. Plan, PayPal status, subscription id, cancel and
  sign-out are unchanged and still server-derived.
- On mobile the pill keeps menu/brand/theme/account; the quota chip and history move behind `sm`
  because the bottom nav already carries them.

Verified after the change, all against the running stack: `tsc --noEmit` clean for app and Worker,
`vite build` clean, 743 unit tests pass (the AccountPanel test updated for the popover, the landing
drop test updated for async intake), `paid-tool-output-check --live` 9/9, `checkout-return-check`
25/25 including the genuine-session phase G, `clerk-journey-check --phase=verify` 13/13 (sign-out
through the new chip, same canonical user on re-login), `release-artifact-check` 20/20 on the
rebuilt bundle. Screenshots: `evidence/design/` (home/workbench/tool-landing × desktop/mobile ×
light/dark, plus `04-pro-account-state.png`, `05-file-selected.png`, `06-searchable-output.pdf`,
`07-completed.png`).

The detector (`impeccable detect.mjs`) flags Geist as an over-used face; that is the brand's pinned
type on both surfaces, so it stays. Production deployment remains unauthorised — `deploy/` is built
and verified locally only.

### Correction: the live site is the flat white "minimal theme", not the dark slab (§ above)

The §-above integration used `site/assets/site.css`'s *base* tokens, which are superseded on the
live site. Measured against https://prismfilehero.com with `getComputedStyle` (desktop, light):

    ground #ffffff · surface #ffffff · ink #10151d · accent #c8102e · line rgba(16,21,29,.10)
    slab #ffffff · slab-ink #10151d            <- "slab" sections are WHITE live, not #0b0f16
    body font  ui-sans-serif, system-ui        <- not Outfit
    h1 font    Geist, Outfit @ 73.6px
    nav        rgba(255,255,255,.85), radius 9999px, color #10151d, position static
    body::after film grain -> display: none

`site.css:166-215` is a later "MINIMAL THEME" `:root` block that overrides the base palette, hides
the grain and the hero photography, strips card shadows, and repaints the nav white; it wins on
source order, so the dark-slab values I first copied are dead code on production. The app is now
re-pointed at the measured live values:

- `:root` carries the live values verbatim; the app's own dark toggle keeps a `.dark` block (live
  has no dark surface, so nothing to match there).
- `--font-sans` is the platform stack and Geist is reserved for `font-display`, exactly as live.
- The hero's red radial wash and the GlitterWrap canvas are gone (live renders neither); the
  headline is Geist at the live scale (73.6px at 1440, verified by comparing computed styles).
- The nav pill is white-translucent with a hairline border and a text wordmark — `BrandHeader`
  stopped rendering the `pfh-horizontal-*.svg` lockup, because live shows only "Prism File Hero"
  in Geist semibold. The vector lockup remains available as `PrismLogo`.
- New shared classes mirror the live surfaces: `.demo-window` + `.demo-bar` (traffic lights,
  `prism · in your browser`, live file count) wrap the workspace, `.dropzone-dashed` is the 1px
  dashed hairline drop target, `.eyebrow` is the mono uppercase label above tool titles, and
  `.btn-run-block` is the full-width red run button from `site.css` `.tool-run`.
- The tool landing page now follows the live tool page layout: eyebrow, oversized left-aligned
  Geist title, muted subtitle, dashed drop card with mono microcopy, full-width red run button.

Measured after the change: local computed tokens are byte-equal to live's for ground/ink/accent/
body-font/h1-font/h1-size/nav-bg/nav-radius; `paid-tool-output-check --live` 9/9, `checkout-return-check`
25/25, `clerk-journey-check --phase=verify` 13/13, 743 unit tests, `release-artifact-check` 20/20.
Five landing tests asserted the old "Drag and drop" wording and now assert live's "Drop files here".

**Remaining local-vs-live drift (not visual):** `site/index.html` and `site/pricing.html` are
byte-identical to live, and `site/assets/site.css` matches live's hash exactly. The 41 generated
`site/features/*.html` differ from live by asset cache-busters (`?v=20261009g` on live, absent
locally because the generator no longer emits it) and by two meta tags the local copy adds
(`<link rel="canonical">`, absolute `og:image`/`twitter:image`). Deploying the local copy would
therefore change live's SEO metadata (arguably for the better) and drop the cache-buster query —
flagging it rather than silently aligning in either direction.

### Correction to the metering section above (same session, later)

The section titled "Paid tool executes, and is finally metered" describes `POST /api/usage/reserve`
and `POST /api/usage/settle` as the fix for unmetered paid work. That fix was reviewed and
**removed** in `fix(quota): one plan definition…`, for two reasons measured after it landed:

1. **Local processing is not cloud consumption.** Offline Tesseract OCR runs entirely in the
   browser; booking cloud pages for it charged provider credits for work that never reached a
   provider. OCR (and PDF to Excel, Redact) are classified `hybrid`: entitled, not metered. Cloud
   pages are booked only where a provider call actually happens — inside `/api/ai` — so cloud work
   is charged exactly once and a hybrid run that escalates mid-flight cannot be double-booked.
2. **A browser-closeable reservation is a self-service refund.** Any client could settle `ERROR`
   after the server finished the work, or simply never settle, and could under-report pages because
   only the browser knew the page count.

The ledger evidence quoted there (0 → 2 → … → 26 AI pages) is therefore superseded: those rows were
produced by the removed path. The current measurement is the opposite and correct one — two full OCR
runs through both upload paths left `aiPagesUsed` unchanged at 26 and created no `feature_type='ai'`
row, while `paid-tool-output-check --live` still passes 9/9 and produces the same verified
searchable PDFs. The free-tier numbers quoted there ("2/6 AI, 5/15 local, 10/month") are also
superseded by `20261014000001`, which makes free cloud AI zero on every layer.

What survives from that section unchanged: the plan-blind browser ceiling bug and its fix, the
landing-page intake bypass and `services/fileIntake.ts`, the `callRpc` empty-body defect, and the
artifact verification.

### Quota resolution and staging preparation (final state of this session)

Six reviewable commits: `fix(db)` ceilings + premium gate, `fix(quota)` one plan definition,
`fix(ocr)` intake, `feat(ui)` live design system, `fix(site)` asset fingerprinting,
`feat(billing)` paid-through coverage, plus `docs(audit)` and `chore(staging)`.

Verified after all of them, against the committed tree: unit 743 pass; `check:quota` 22/22;
`check:worker` 20/20; `check:backend` 32/32; `check:schema-release` 10/10; `check:auth-isolation`
13/13; `check:release` 20/20; `checkout-return-check` 25/25; `clerk-journey-check --phase=verify`
13/13; `paid-tool-output-check --live` 9/9. Before/after screenshots in both themes are in
`evidence/before-after/` (the "before" set rendered from the pre-change commit in a detached
worktree, then removed).

**Pending, not performed:** any production deploy; the staging steps in
`docs/staging-runbook.md` (they create cloud resources and need an explicit go-ahead); a positive
production authentication test, which still needs a live Clerk session token (`PROD_CLERK_TOKEN`);
the remote migration ledger via `SUPABASE_ACCESS_TOKEN`; and rotation of the sandbox PayPal secret
that was exposed earlier in this engagement.
