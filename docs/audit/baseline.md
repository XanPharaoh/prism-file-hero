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
