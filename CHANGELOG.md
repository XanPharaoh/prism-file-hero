# Changelog

Notable changes to Prism File Hero, newest first. Every line below describes behaviour that was
measured by a check in this repository, with the commit that carries it. Where a tool deliberately
refuses instead of producing output, that is listed as a behaviour change, not hidden in it.

Numbers come from the gates named in `AGENTS.md`; the audit trail for each is
`docs/audit/baseline.md` and `docs/superpowers/plans/2026-10-19-feature-remediation.md`.

## 2026-10-26 — the app's OCR stops needing the network (remediation D1)

The site's OCR has been genuinely offline since the vendored Tesseract bundle landed; the app was the
half that still fetched its worker, WASM core and language model from jsdelivr on first run. That is
fixed, and the claim is now enforced by a gate rather than by a docstring.

### Fixed — offline OCR in the application

- `services/ocrService.ts` passed no asset paths to tesseract.js at any of its three entry points, so
  the CDN was the only source of the worker, the core and `eng.traineddata`. It now hands over
  same-origin paths from `public/ocr`, which `vite.config.ts` provisions from the **installed**
  `tesseract.js` / `tesseract.js-core` packages before any build or dev server starts — so the app's
  bundled glue and its worker cannot drift apart, and provisioning needs no network. Dev gets `/ocr/`,
  the artifact gets `/app/ocr/`, and `dist-desktop` and the Capacitor copy get the same directory
  because it lives in `public`. SHA-256 of every file is pinned in `shared/ocr/app-assets.lock.json`;
  version drift or a hash mismatch fails the build instead of shipping a swapped binary.
- The app's own feature harness was part of the problem: `tests/features/ocr-extraction.test.ts` loads
  the OCR graph with `document` absent to force tesseract.js's Node code path, where the core is
  `require`d locally but an unset `langPath` resolves to jsdelivr — so the suite had been passing while
  downloading the 2.95 MB language model. `appOcrWorkerOptions` now takes the runtime as an argument
  and gives Node `{ langPath: 'public/ocr/langdata' }`, read off disk.
- **Behaviour change:** the first OCR run on a device with no network now works, and a missing bundle
  fails loudly at the fetch instead of falling back to a CDN. The artifact is 154 files / 49.1 MB
  (app half 21.9 MB) — 14.77 MB of it is the worker, three `-lstm` WASM cores and the language model.

### Added — verification

- `check:offline-ocr` now proves both halves under one shared network abort: the real site page
  produces a searchable PDF, and the app's exact call shape (`createWorker('eng', 1, opts)` +
  `recognize(canvas, {}, { blocks, text })`) recovers text and the nested blocks→paragraphs→lines→words
  tree from `public/ocr`. It asserts the glue it loads is byte-identical to the app's bundled glue.
  Measured: `site: ran=true text=true | app: text=true structure=true glueHashMatch=true`,
  `externalBlocked=0`.
- `check:release` §6b fetches `/app/ocr/{tesseract-worker.min.js, core/tesseract-core-simd-lstm.wasm.js,
  langdata/eng.traineddata.gz}` from a booted artifact and requires each to come back as itself, not as
  the SPA document. Measured: 23 passed, 0 failed.
- `tests/ocrAssets.test.ts` (9/9) pins the resolver for dev, artifact and Node, and fails if any
  `Tesseract.recognize`/`createWorker` call site stops passing the paths. Full suite `check:counts`:
  96 files, 982 tests, 0 failed, 6 skipped. `npx tsc --noEmit`: clean.
- A stale premise in the remediation plan — that pointing the app at the site's 5.1.1 assets "would
  break the worker protocol" — was measured and found false: the site already runs the 7.0.0 glue
  against them. The self-consistent route was taken anyway; the correction is in
  `docs/superpowers/plans/2026-10-19-feature-remediation.md`.

### Not in this release

D1's remaining gap, stated rather than glossed: the new gate drives the asset bundle and the call
shape, not the React UI around them. Still unaddressed: C3 (PDF decryption behind the intake guards),
D4 (`portfolio-statements` multi-file), D6 (document history), and the six cloud tools that have never
produced a verified provider response.

## 2026-10-26 — three claims the product was not entitled to make

Working through the remediation plan surfaced defects that were not on it, each found by measuring
instead of trusting a green tick.

### Fixed — a locked PDF could no longer be reported as compressed

- `compressPdf`'s rasterise pass opened the document with a bare pdf.js call inside a `try/catch` that
  logged any failure and fell through to returning the input unchanged. For a password-protected PDF
  the tool therefore **succeeded** and handed back the locked original byte-for-byte, while the
  embedded-image pass beside it correctly re-threw the encrypted refusal. Both passes now open through
  the intake guard (`services/pdf/intake.ts`), so the answer is "this needs the password" — and the
  lossless fallback re-throws an encrypted refusal rather than swallowing it. `convertPdfToDocx` had
  the same bare open and is routed through the guard too, so the UI reports the password problem
  instead of a pdf.js `PasswordException`.
- Found test-first: the new case in `tests/features/page-ops.test.ts` failed against the old code with
  `compressPdf(mode=rasterize) returned 2926 bytes instead of refusing`. Compress block 7/7,
  security family 13 passed / 1 skipped, `npx tsc --noEmit` clean.

### Fixed — Protect PDF copy claimed enforcement that the file does not contain

- `site/features/protect-pdf.html` and `site/assets/features.data.js` advertised "separate permissions
  for opening, editing and printing", "Granular permissions: copy, print, modify, annotate" and
  "Standard AES encryption". Measured on our own output with Poppler:
  `Encrypted: yes (print:yes copy:yes change:yes addNotes:yes algorithm:RC4)` — every operation stays
  allowed once the file is open, and the cipher is PDF 1.4 RC4 128-bit.
  `@pdfsmaller/pdf-encrypt-lite@1.0.2` exposes `encryptPDF(bytes, userPassword, ownerPassword?)` with
  **no permission parameter at all** (`dist/index.d.ts`), and it hard-codes
  `permissions = 0xFFFFFFFC` (`dist/pdf-encrypt.js:276`), which also feeds the key derivation — so the
  bits cannot be corrected after the fact. The copy now states what is true: an opening lock, not a
  permissions editor. Real per-operation restrictions would mean replacing the encryption engine, which
  is a decision for the owner, not a silent swap.
- `tests/features/security.test.ts` gained a claim-parity case in the protect family: it reads the
  measured `Encrypted` flags and the `/Encrypt` dictionary from the file we emit, then fails if the
  shipped page or lede claims separate permissions, granular permissions, a restriction on
  print/copy/edit/annotate, or AES. Verified red first (`[ "a separate-permissions claim",
  "a granular-permissions claim", "an AES cipher claim" ]`), then green after the copy changed.

### Added — the site cannot ship a stale asset URL again

- The pages fingerprint their local assets (`asset.js?v=<sha256[0..10]>`) so a changed file gets a new
  URL and a browser cannot reuse the cached copy. That had silently stopped being true: the
  fingerprints were written on 2026-10-14, `site/assets/tool.js` was edited on 2026-10-19
  (`b021786`, `1aabd38`), and nothing regenerated the pages — so every page advertised
  `tool.js?v=782ff87117` for a file hashing `c93318e537`, and returning visitors could still be
  executing the engine from *before* the encrypted-rebuild refusal and the flatten appearance-bake.
- `npm run check:asset-integrity` (`scripts/asset-fingerprint-check.mjs`) now walks every page,
  hashes what each reference points at, and fails on a stale `?v=`, a reference that satisfies neither
  fingerprint nor `integrity`, or a URL with no file behind it. Vendor bundles are checked by their SRI
  instead (three of them, all matching). Measured: 50 pages, 243 fingerprinted and 200 SRI-pinned
  references, PASS; the gate was also run against a deliberately stale page to prove it catches the
  class rather than passing by construction. Pages and hand-written shells regenerated
  (`site/tools/generate-features.mjs`, `site/tools/asset-version.mjs`) — 51 files, one URL per asset
  (`features.data.js?v=b938766eab` across all 50 references) — and the gate is a step in
  `.github/workflows/deploy.yml` before the artifact is published.

### Fixed — the OCR bundle is now provisioned for the test harness, not only for builds

The D1 change above broke CI: `deploy.yml` runs `npm test` before any build, `vitest.config.ts` does
not extend `vite.config.ts`, and the app's OCR harness was told to read `public/ocr/langdata` — which
did not exist on a clean checkout. The Tesseract worker never started, so the suite died with two
`Test timed out in 300000ms` plus a cascade of `ENOENT … stat ''`. Every local gate had said green
because my tree had `public/ocr` from earlier builds: the test was passing for the person who last ran
a build, not for CI. `vitest.config.ts` now provisions the bundle the same way `vite.config.ts` does.
Verified by reproducing CI's state rather than arguing from the code: `rm -rf public/ocr` then
`ocr-extraction` 18/18, `tsc` clean, and `check:counts` 96 files / 984 tests accounted for, 0 failed.
Production was never affected — run `40334457398` failed in the build-and-verify job, so no deploy job
ran and the site kept serving `d03e61c`.

### Recorded — two plan entries were stale, and one audit report could not be trusted

- **D3 was already closed.** `toolRegistry.ts:151-161` refuses the cloud-AI escalation without
  `options.allowAIFallback`, says the cost in the message, and `tests/features/ai-consent.test.ts`
  proves all three states. The plan still described it as open; it now carries a status block.
- A subagent tasked with auditing plan-vs-reality cited `docs/audit/claim-parity.md` (112 claims, 14
  false) and a fixed-size canvas shim in `tests/setup.ts`. Neither exists — `docs/audit/` holds two
  files, and `tests/setup.ts:71-96` has backed jsdom's canvas with real `@napi-rs/canvas` since long
  before that report. Everything below was therefore re-verified by hand before being acted on or
  written down; the E4 sweep remains genuinely un-built.

## 2026-10-20 — feature remediation, free-model gateway, and the first CI production deploy

This release goes to production through `.github/workflows/deploy.yml` on push to `main`. Before
this, `origin/main` was last updated 2026-06-29 and the live Worker had been deployed by hand, so
the deploy that ships includes the Worker routes and the billing webhooks that production never had.

### Security

Two credentials were found in the commits being published, both by GitHub push protection, and both
rejected the push rather than reaching the repository. Neither had ever been published: at `a608c0b`
the only variable in `.env.production` was `VITE_WORKER_URL`, and the e2e spec carried the literal
placeholder `gsk_...`.

- `tests/e2e/passive-learning.spec.ts:18` held a real Groq API key where a placeholder used to be.
  The spec now reads `process.env.GROQ_API_KEY` and declares an explicit skip with a reason when it is
  absent, so the cloud-auth flow reports itself untested instead of quietly passing.
- `.env.production:4` held a **PostHog personal API key** (`phx_`), which carries administrative API
  access and is not the public project token (`phc_`). It is now `not-configured`. This changes no
  behaviour: `src/services/analyticsService.ts:9` enables PostHog only for keys beginning `phc_`, so
  production analytics has been disabled until someone supplies a public project key.
- `complete source code with updates.md` — a 122,000-line concatenation of the source that also
  contained a Groq key — and committed `dist-desktop/` bundles, which inlined the PostHog personal
  key, were both already deleted at `HEAD`. They have been removed from the unpublished history so
  no push carries them, and `dist-desktop/` is now gitignored because a committed bundle is a second
  copy of every `VITE_*` value.
- **Both credentials still require rotation by the owner.** They were never published, but each exists
  in the local working tree and in the off-site backup that mirrors this volume, so treating them as
  uncompromised would be a guess.

### Fixed — user-visible tool behaviour

| Tool | What changed | Measured |
| :-- | :-- | :-- |
| Compress PDF | Optimise no longer re-draws every page. The default mode re-encodes the document's own embedded JPEGs in place (including the `/FlateDecode+/DCTDecode` wrapper real bank statements use) and relabels `/ColorSpace` from the new codestream. Whole-page rasterisation is now the named `rasterize` opt-in, because it destroys the text layer. | photo+text page **2,357,527 B → 1,375,129 B (−41.7%) with 95 text characters → 95**; digital16 **−13.5% with 16/16 text-bearing pages preserved**; `rasterize` measured at **95 → 0** characters `56f73e9` |
| Compress PDF | Progress now completes for a PDF with no embedded JPEGs. The default mode counted progress per image, so a text-only statement reported nothing and the bar never finished. | `tests/localToolHandlers.stress.test.ts` 10/10 `0ba6d57` |
| Extract images | Returns the image assets the document actually carries instead of pictures of its pages, walking `/XObject /Subtype /Image` into Form XObjects, with a `manifest.txt` stating per file whether it is `original`, `reconstructed` or a `page render`, plus duplicates and unreadables with reasons. | real Nedbank statement: **4 distinct assets (709×207, 677×435, 1148×160, 586×528) from 8 placements**; Flate image round-trip with **0 differing samples of 43,200** `77fbce1` |
| PDF to JPG | Converts every page. The handler passed `maxPages: 50` and the service honoured it by quietly returning the first 50 — a 60-page document produced 50 JPEGs and a success message. DPI and quality are now real controls that reach the service. | 60 → 60 images; range `5-8` → 4; **72 DPI → 200×120 px, 300 DPI → 833×500 px** measured with `identify` `c1bac2a` |
| Flatten PDF | Field appearances are baked into the page content instead of the annotation being deleted. Where an appearance cannot be placed by the spec (§12.5.5 matrices), the tool refuses and names the field rather than removing a value the user can still see. | field ink **782 px before → 782 px after**; `pdftotext` recovers the field value from page content; un-bakeable shapes throw `FlattenRefusal` `f2e3bd5` |
| Page numbers | The requested format is resolved or refused. An unknown format used to fall through silently; it now throws. | `tests/features/page-numbers.test.ts` 9/9, **7 of which failed before the fix** `c4f33fe` |
| Remove blank pages | A page is blank at **zero** ink pixels, not at a low density. The old threshold deleted pages that carried content. | pure white page scans as exactly **0** ink at every darkness threshold; a 2×2 mark as 4 `89045e6` |
| Crop & resize | Artwork scales with the box. `page.setSize()` moved the boxes and left the drawing alone, so shrinking a page silently deleted what fell outside. Four named modes (`fit`, `fill`, `stretch`, `clip`); the old behaviour is `clip`. | ink bounding box **169 px → 118 px** (expected 118.1 at scale 0.6992); **all five text tokens survive** an A5 shrink; `fit` keeps top-of-page text where `clip` drops it 31 → 16 chars `2f9d7d2` |
| Reorder pages | A real sequence parser: `4-1` emits four pages in that order, and an incomplete permutation is refused **naming the missing pages**. | `tests/features/page-selection-contract.test.ts` 12/12 `ad8dcb1` |
| Split | `3-abc` on a 4-page document is a refusal, not a copy of the whole document. | same file `ad8dcb1` |
| Auto-rotate | Judges the page a reader sees, not the MediaBox behind it. The old check ignored `/Rotate`, so every pass flipped the same page again. | idempotent across three passes: 300×400 → 300×400 → 300×400 with `/Rotate` holding at 90 `fc8c5c7` |
| Rotate | `/Rotate` is reduced modulo 360; the spec forbids 360. | full 4×3 sweep of start angle × turn `fc8c5c7` |
| Sanitize metadata | `CreationDate` / `ModDate` are deleted, not reset to the epoch. A "sanitised" file used to report `Thu Jan 1 02:00:00 1970` through `pdfinfo`. | dates absent after `removeMetadata: true`, **present** when declined; asserted through `pdfinfo` `f0dc9c6` |
| PDF to Excel | A scan no longer spends a cloud credit by itself. The escalation to a cloud provider fired whenever the local read found no table — which for a scan is always; it now requires `allowAIFallback`, default off. | `tests/features/ai-consent.test.ts` 3/3 with the provider mocked: not reached when unset, reached exactly once when asked `a5f2ba1` |
| Upload | The dashboard loads every file it was handed (stale closure dropped all but the first). | Playwright journey loads 2 files through `ToolDashboard` `58f8d0d` |

### Changed — refusals that replace silent wrong output

These are behaviour changes a user can hit. Each names the reason and the way through.

- **Encrypted documents are refused instead of rebuilt empty.** pdf-lib reads an encrypted
  document's *structure* but cannot decrypt its page content, so copying or re-saving one produced a
  file with the correct page count and nothing inside. Measured on the real corpus: Standard Bank in
  14,476 characters, output 8. `5b53016`
- **A password-protected input is reported as such**, not as a generic processing error.
- **A PDF over 500 pages is refused for PDF→JPG** with the page-range field named, rather than
  quietly converting a prefix. `c1bac2a`
- **A flatten with an un-placeable appearance refuses** naming the field and its value. `f2e3bd5`

### Added — cloud AI

- **A free-model gateway in front of the paid chain**, per tool, on the existing OmniRoute server:
  keyless free models are tried first, and the chain falls through to a paid provider on a spent free
  connection (402), a rate limit (429), a request shape the provider refuses (400 / 413 / 422) or any
  5xx. `AI_PROXY_ENABLED` is a kill switch checked before authentication, before any reservation and
  before the provider chain.
  Proven against a real `wrangler dev` holding **no paid keys**: `ocr` answered in 2.9 s and
  `pdf-summary` in 8.5 s from `north-mini-code:free`, with the meter settled and no PENDING left.
  `tests/omnirouteProviderChain.test.ts` 9/9, `docs/omniroute-e2e-probe.txt` `e3a1dbf`
- **A per-provider timeout**, so one stalled provider falls through instead of ending the request,
  and the response body is read *inside* that guard so a stalled stream cannot hang the request
  either. `69988c3`, `b90f7a9`
- Measured load, stated rather than promised: at 16 concurrent the gateway served **158/158 correct**
  responses at ~1.95 req/s and **no failure mode was reached**, so the ceiling is above 16 concurrent
  and still unlocated. One `nemotron-3-super` request took **52,795 ms** at only 4 concurrent — read
  the published p50s as p50s with an unbounded upper tail. `45f044d`, `5175f69`

### Added — verification

- `npm run check:counts` prints one row per test file (pass/fail/skip/total/ms) and exits 1 when a
  file on disk reported nothing, when a file reported zero tests, or when any test failed, naming the
  failures. It exists because two commit messages carried counts read off a combined total, and
  because a run once exited 1 while printing `Test Files 9 passed` with a file that never ran.
  First full run: **94 files, 943 passed, 6 skipped, 949 total**. `675d9af`
- The deploy workflow builds the artifact and boots it against a real Worker and real Postgres before
  publishing (`npm run release:build && npm run check:release`), and no longer deploys from a pull
  request. `954d6ea`

### Platform

- Production schema hardening, with the parallel credit ledger retired (`20261015000001_*`), one
  metering path (`usage_logs` + `reserve_usage` / `settle_usage` / `check_usage_limit`), and
  `npm run check:schema-release` proving fresh install, upgrade path and backup/restore. `d995011`
- Tool catalogue, processing class and plan ceilings are checked equal to the SQL allowlist in both
  directions by `npm run check:quota`. `d995011`
- Repository hygiene: one schema truth, one tool list, and 145 stale files removed. `a3e9bb8`

### Not in this release

Reported as open rather than implied as done — see the plan for the per-item gates:

- A9 (page-operations remainder), B3–B5 (conversion fidelity: EXIF orientation was attempted and
  **withdrawn** — `b760fe5` records why), C1/C3/C4/C5 (security and the encrypted corpus; C3 is the
  large one that changes what every A/B refusal test asserts), D1/D2/D4/D6 and E1–E5.
- Capitec extraction is **unproven**: no fixture exists anywhere. Blocked on a redacted real fixture.
- The free-model gateway's **concurrency ceiling is still unlocated** (16 concurrent was the top level
  tested, and nothing failed), and whether the paid fallback stays reachable when the free upstream is
  down has never been measured. Both are named as open, not assumed closed.
- Offline OCR asset delivery (D1) and the desktop vision models (`k2-horizon:3.7b`, `qwen3-vl:4b` are
  not installed in the local Ollama) are blocked on owner-supplied artifacts.
