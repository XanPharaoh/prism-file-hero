# Feature Remediation — Plan (2026-10-19)

Ledger: `.superpowers/sdd/2026-10-19-feature-remediation/progress.md`
Origin: six parallel feature audits (`tests/features/*.test.ts`, `evidence/features/`), each verdict
backed by a produced artifact measured with `pdfinfo` / `pdftotext` / `pdftoppm` / `gs` / `xlsx`
rather than by the service's own return value.

## Ground rules for every task

1. **Write the failing test first.** Every task below names the assertion that must fail before the
   code changes and pass after. No task is complete without one.
2. **Measure the artifact, not the promise.** A fix is proven by re-reading the produced bytes
   (page count, extractable text, pixel coverage, encryption dictionary, workbook cells), never by
   a function returning a Blob.
3. **No silent behaviour.** If an operation cannot honour its description for some input, it must
   say so in the message the user sees. Deleting content, trading a text layer for size, or
   reporting success for work not done are all defects, not trade-offs.
4. **Copy is a specification.** Where code and marketing disagree, either the code becomes true or
   the claim is removed. The change must be stated, never implied.
5. **Gates before commit:** `npx tsc --noEmit`, `npm run typecheck --prefix worker`, `npx vitest run`,
   and any task-specific gate. `check:release` after anything touching the app bundle.
6. **Escalate local reasoning to the connected model when it is genuinely hard** (PDF geometry,
   encryption key derivation, content-stream editing): `http://100.75.214.23:11434` via `/api/chat`,
   cross-check anything it returns against the byte-level oracles. Not available at plan time
   (only `qwen3-vl:4b`, `qwen2.5vl:7b`, `nomic-embed-text` are loaded); retry per task that needs it.

## Task list

### A — Engine correctness (data destruction first)

**A1 `page-numbers` paints literal tokens.** UI sends `page_n_of_m | page_n | n_of_m | n`
(`src/components/views/ProcessingView.tsx:357-370`, `src/types.ts:160`); `services/pdfService.ts:915-960`
recognises none of them, so the output reads `page_n_of_m`.
Intended: `Page 1 of 6`, `Page 1`, `1 / 6`, `1`. Fix the resolver to a total mapping over the union
of UI tokens, `{page}/{total}` templates and `X/Y` templates; unknown formats are an error, not a
literal paint. Test: `tests/features/page-numbers.test.ts` asserts extractable text equals the
expected string on every page, for all four formats and all five positions, plus `startNum`.

**A2 `reorder-pages` silently deletes pages.** `'3,1'` on 4 pages drops 2 and 4.
Intended (registry): "Rearrange the page sequence". Fix: an order that omits pages is refused with
the omitted list, or a documented `appendMissing` option. Test: refusal message + exact resulting
page tokens.

**A3 `split` accepts junk and copies the whole document.** `parsePageSelection(..., { fallback: 'all' })`
makes a bad token mean "everything". Intended: "Extract pages into separate files". Fix: strict
parsing for split; invalid input is an error. Test in `tests/features/page-ops-contract.test.ts`.

**A4 `crop-resize` never scales, and clips content.** `page.setSize()` rewrites boxes only
(`services/pdfService.ts:1276-1280`): A4-growing leaves art at original size in a corner, A5-shrinking
deletes what falls outside. Intended: "Trim margins or resize pages to standard sizes". Fix: apply a
`cm` pre-concat matrix for true fit/scale, keep aspect with explicit fill/fit/clip semantics, and
report clipped content instead of deleting it. Test: ink bounding box scales with the page box
(`pdftoppm` + pixel measurement), and no page loses tokens that were inside the new box.

**A5 `flatten-pdf` deletes form values on a swallowed error.** `form.flatten()` failure is caught and
ignored, then widgets are removed (`services/pdfService.ts:1405-1409`); `/FreeText` stays editable;
`/Annots` left dangling. Intended: "Merge form fields, checkmarks and annotations into static pages".
Fix: propagate flatten failure; bake widget appearance streams and FreeText/Highlight/StrikeOut
annotations into page content; drop the annotation array when empty. Test: values still visible as
text after flatten (`pdftotext`), no orphan `/Annots`, and an unloadable-form case fails loudly.

**A6 `remove-blank-pages` deletes sparse real content.** 9 ink pixels counted as blank
(`services/pdfService.ts:1358-1375`). Intended: "eliminate empty or white pages". Fix: a page is
blank only at zero ink unless the user raises the density threshold; expose that threshold in options.
Test: 1-px mark survives; a genuinely blank page is removed.

**A7 `auto-rotate` is not idempotent.** A second pass flips a 300×400 page to 400×300
(`services/pdfService.ts:2045-2048`). Fix: decide orientation from rendered content, and never
rotate an already-portrait page. Test: two passes byte-comparable.

**A8 `metadata-edit` leaves `CreationDate`/`ModDateInfo` behind** while claiming to "completely
sanitize". Fix: clear the trailer/document-info dates and the XMP `xmp:CreateDate` stream when
sanitizing. Test: `pdfinfo` before/after plus raw-byte scan for `/CreationDate`.

**A9 `watermark` has no image path** although the registry says "Stamp images or repeating text
patterns" (`services/pdfService.ts:204-270` rejects images, UI offers no control). Fix: accept an
image watermark (PNG/JPG), tile or centre it, honour opacity; keep the text tiles. Test: embedded
XObject count increases and pixels change where the mark is.

**A10 `compress` can trade the text layer for size** (photo+text page 2.36 MB→0.50 MB, 95 chars→0).
Intended: "…optimizing embedded images while preserving page dimensions". Fix: recompress image
XObjects in place and keep vector/text content; rasterization only as an explicit, named opt-in mode.
Test: digital text page keeps every token after compress; image-only page shrinks.

### B — Conversion fidelity

**B1 `extract-images` renders pages instead of extracting assets.** `services/pdfService.ts:1779-1820`
composites full pages; 5 placements / 4 distinct rasters → 2 files. Intended: "All embedded graphics
… at original resolution". Fix: walk page resources for `/XObject /Subtype /Image`, emit original
bytes per filter (DCTDecode→.jpg, JPXDecode→.jp2, Flate+DecodeParms→.png), dedupe by content hash,
name by page, and only fall back to a page render when the page has no images. Test: counts and byte
equality with the embedded source.

**B2 `pdf-to-jpg` truncates silently at 50 and ignores its advertised controls.**
`src/registry/toolRegistry.ts:292` hard-caps `maxPages`; scale 2.0 and quality 0.90 are fixed at
`:592`/`:612` while copy offers DPI and quality choice. Fix: process every page (chunked), surface
real DPI/quality options from the UI, and refuse-with-a-warning rather than dropping pages. Test:
60-page input yields 60 images; chosen DPI changes measured pixel dimensions.

**B3 `jpg-to-pdf` ignores EXIF orientation** — a phone photo tagged 6 lands sideways. Fix: read the
orientation and apply the matching rotation/swap. Test: orientation-tagged fixture produces the
upright box and matches rendered ink.

**B4 `pdf-to-docx` claims typography and images it does not carry.** No bold/size/`rFonts`, 0 of 6
source images carried, "Page N" headings invented (`ProcessingView.tsx:549`,
`convertPdfToDocx`). Fix: map pdf.js item font/height/width to runs and heading levels, embed page
images, use real page breaks. Test: extracted docx XML contains bold spans, N images, and no fabricated
text.

**B5 `scan-effect` / `invert-colors` claims that measure false.** "Normalises mixed portrait/landscape
onto one page size" (3 distinct boxes measured) and "Smart inversion keeps images natural" (output is
an exact negative, 254.9→0.2). Both rasterize, so digital text layers vanish (4,551→0). Fix: implement
the size normalisation, implement image-preserving inversion (invert vector/text content, re-paint
original image regions un-inverted), and label the raster nature in the tool summary. Test: measured
uniform boxes; image pixels unchanged; text-layer loss disclosed in the result notice.

### C — Security

**C1 Redaction on rotated pages.** `topBoxToPdfRect` and `shared/pdf/redactGeometry.ts` never un-rotate
`/Rotate 90`, so the blackout lands off the content (measured coverage 0.000, 1,790 px visible). Fix:
convert through the rotated viewport and back. Remove the `it.fails` marker in
`tests/features/security.test.ts` as the completion gate.

**C2 `protect` is weaker than advertised.** RC4-128, every permission bit open (`/P -20`), user
password == owner password, and AES-256 input silently downgraded. Fix: AES-256 where available,
sane default permissions (no modify/assemble, copy controlled by option), distinct user/owner, refuse
silent downgrade. Test: `pdfinfo` reports the expected cipher and flags; owner-only actions need the
owner password.

**C3 PDF decryption — the real fix for encrypted input.** pdf-lib cannot decrypt, so page-ops refuse
permission-encrypted files (4 of 7 real statements). Implement spec key derivation (empty or supplied
user password; RC4-40/128, AES-128, AES-256 R6) and decrypt stream + object streams, exposing
`unlockPdf` and the rebuild paths on top of it. Oracle: decrypted output must match `pdftotext` of
the original page-for-page. Use the connected model for the algorithm derivation review.

**C4 The financial gate must actually gate.** `services/ledgerGuard.ts:51` is `? 'WARN' : 'WARN'`;
BLOCKED needs >30% bad rows; `services/reconciliationService.ts:203-215` "Strategy 2" re-derives an
Amount from a wrong Balance and marks it reconciled; `site/financial.html:44` promises it "refuses to
export a ledger that doesn't reconcile". Fix all three: real status escalation, no amount
re-derivation from an unproven balance, and export refusal (with an explicit, separate "export draft
anyway" user action). Test: the +R9,999 tamper now yields no workbook.

### D — OCR, extraction, AI

**D1 "Offline" OCR is not offline.** `services/ocrService.ts:604` passes no `workerPath`/`corePath`/
`langPath`, so `shared/ocr/assets.ts` CDN resolution is used and `check:offline-ocr` allows 21 external
requests while the vendored bundles go unused. Fix: use the vendored paths, keep CDN as an explicit
fallback only. Gate: `check:offline-ocr` must report `externalRequestsAllowed: 0`.

**D2 OCR replaces the scan with a lossy re-render** (1240×1754 grey Flate → 1682×2379 RGB JPEG ≈98 DPI,
68,780→242,136 B). Intended: searchable PDF that preserves the document. Fix: re-embed the original
image bytes and overlay the invisible text layer; if re-render is unavoidable, do it at the source
resolution and say so. Test: embedded image bytes/hash equal the source, page count and size preserved.

**D3 `pdf-to-excel` on a scan silently spends paid AI.** A 0-row digital attempt escalates to
`processWithAI` at one credit per page (`src/registry/toolRegistry.ts:141-166`). Fix: state the cost
and require an explicit confirm before the provider call, gated by entitlement as elsewhere.
Test: no AI reservation is created without that confirmation.

**D4 `portfolio-statements` cannot aggregate.** `maxFiles: 1` and no batch path, though it promises a
multi-statement view; holdings math itself is correct (units×price = value, Σ = reported total).
Fix: accept multiple files, merge holdings with dedupe by instrument, and reconcile totals.
Test: two synthetic portfolio PDFs → one statement with the summed total.

**D5 Cloud tools have never produced output.** All six are `PARTIAL`: transport, gating and
settlement are verified, provider response is not; `pdf-to-word` delivers `Document_*.md`
(`src/registry/toolRegistry.ts:83,97-99`) while `services/usageConfig.ts:71` sells "PDF to Word", and
`ocr-to-md` routes through the AI path with no Tesseract use. Fix: route a real local provider (the
connected ollama host) through `getProviderChain` behind an explicit non-production switch, run the
six tools end to end, and make the deliverable match the name (`.docx` through the B4 writer).
Gate: `scripts/paid-tool-output-check.mjs --live` against the local provider, with artifacts verified.

**D6 `HistoryDashboard` has no table and no auth path.** `document_history` exists in no environment;
`services/historyService.ts` writes swallow errors; `supabase/legacy/document_history.pre-clerk.sql`
is pre-Clerk (`uuid` + `auth.uid()`). Fix: a text-subject table with RLS owned by the Worker, new
`/api/history` routes (Clerk-verified, service_role write), and the UI pointed at them. Test: save and
list through the HTTP surface; cross-user reads empty; migration in `supabase/migrations/`.

### E — Test and claim hygiene

**E1 No global RTL cleanup.** `tests/setup.ts` doesn't call `cleanup`, so a second `render()` in a
file makes queries ambiguous (hit while writing `tests/components/DashboardUpload.test.tsx`). Fix
centrally, remove the per-file workaround.

**E2 Vacuous canvas assertions.** The `tests/setup.ts` canvas shim returns 300×150 for the conversion
family, so `tests/stressTestAllTools.test.ts:459-472` passes without measuring anything. Fix the shim
to a real canvas (`@napi-rs/canvas`, already used by the page-ops harness) and re-assert.

**E3 jsdom cannot rasterize standard-14 text**, which forced `4a/4b/4c` to `it.skip`. `pdfjs-dist`
ships `standard_fonts/`; wire `standardFontDataUrl` in the test harness (and confirm the built app
carries the same data), then revive the embedded-font proof.

**E4 Claim parity sweep.** Extract every marketing claim from `site/*.html` and `src/registry/toolRegistry.ts`
and mark each true, false, or unproven against a measurement. Fix code or copy per claim, recorded in
a table committed with the sweep script.

**E5 Capitec is unproven** — no fixture exists anywhere. Blocked on a redacted real fixture from the
owner; until then it is reported as unproven, never as supported.

**E6 Intermittent worker-start failure reported as a passing suite with exit 1.** Caught running
`--reporter=verbose tests/features/`: the summary said `Test Files 9 passed (9) / Tests 177 passed |
1 skipped`, yet the process exited 1, because the real signal is an `Unhandled Error` below the
summary — `[vitest-pool]: Failed to start threads worker for test files
/mnt/hdd/Prism/prism-file-hero/tests/features/pdf-to-jpg.test.ts`, caused by
`[vitest-pool-runner]: Timeout waiting for worker to respond`. **No assertion failed**; a file was
never run, and a reader watching only the `Tests` line would conclude the suite is green.
Confirmed not a product or test defect: that file passes 4/4 in isolation and passed inside complete
`tests/features/` runs repeatedly. The failing run took 183 s against ~66 s for the green ones, with
`import 220.07s` — a slow run, so the trigger is environmental; two `rustc` processes and a linker
were active on the box, but load average was 3.66 on 18 cores, so contention is the likely mechanism
and is **not proven**.
Fix belongs in the harness, not the test: fail loudly rather than silently. Options — treat an
unhandled pool error as a named failure in the summary, or bound concurrency in
`vitest.config.ts`. Note that the uncommitted `maxWorkers: 4` in that file is already acting as the
mitigation; whichever direction is chosen, decide it deliberately instead of inheriting an
undeclared cap. Related: E2, and the load-induced pool starvation seen while the owner's model
download was running.

## Sequencing

A2/A3/A5/A6/A10 and B1 (silent loss or wrong output) first, then A1/A4/A7/A8/A9/B2-B5, then C1/C2/C4,
then C3 (unlocks the encrypted corpus for everything else), then D1-D6, then E1-E5. C3 is deliberately
late: it is the largest single item and changes the expected behaviour of every A/B test that currently
asserts a refusal, so those assertions must be written knowing it is coming — each refusal test names
the task that will flip it.

## B3 attempted and withdrawn — read this before implementing it

B3 (jpg-to-pdf ignores EXIF orientation) was worked on and reverted; the change is not in the tree.
Two things were learned, and they are the reason to write this down rather than just retry it.

1. **`createImageBitmap` applies EXIF orientation by default**, so a fix that decodes a camera JPEG to
   a bitmap and then also mirrors/rotates the pixels applies the correction twice and produces the
   original sideways raster again. The symptom is not an error — the mirrored family simply keeps
   failing its own pixel comparison by a constant margin, which reads like a wrong transform table
   and sent one debugging session in circles. Any pixel-level orientation work has to either decode
   with the orientation explicitly suppressed or confirm what the decoder already did.
2. **A test that passes for all eight cases can be comparing one image to itself.** The first version
   tagged fixtures with `magick x.jpg -set orientation N out.jpg`, which does not survive a JPEG
   rewrite: all eight files stayed at orientation 1, all eight reported the same box and the same
   block error, and the test went green while verifying nothing. It was caught only because the
   recorded numbers were identical across cases. A test that sweeps a parameter must assert that the
   parameter *changed something* — the fixed version asserts the tag round-trips and that the eight
   cases produce more than one distinct page box.

What is known to be sound for the retry: the four pure rotations (1/3/6/8, which is what cameras
emit) need no pixel work at all — they are expressible as page size plus a `drawImage` rotation, so
the original JPEG bytes are embedded untouched and nothing is re-encoded. Only the mirrored family
(2/4/5/7) needs pixels, and that is where the double-orientation trap lives. `jpegWithExifOrientation`
in `tests/features/conversion.test.ts` does produce tags that `magick -auto-orient` honours, which is
the oracle to compare against.

## Execution record

Only tasks with a gate result are listed as done. The ledger file under `.superpowers/` is gitignored,
so this section is the record a reader of the repository can verify.

| task | commit | what proves it |
| :-- | :-- | :-- |
| A2 `reorder-pages` | `ad8dcb1` | `tests/features/page-selection-contract.test.ts` 12/12 — reverse range `4-1` emits four pages in that order, an incomplete permutation is refused *naming the missing pages*, verified by reading page tokens back out of the produced bytes |
| A3 `split` junk | `ad8dcb1` | same file — `3-abc` on a 4-page document is a refusal, not a copy of the whole document; `merge`'s documented all-pages fallback is asserted to still exist |
| A1 `page-numbers` | `c4f33fe` | `tests/features/page-numbers.test.ts` 9/9, **7 of which failed before the fix**; stamps read back from the content stream, all four UI tokens plus default, template, `startNum`, position geometry, and an unknown format now throwing |
| A6 `remove-blank-pages` | `89045e6` | measured first: a pure-white page scans as **exactly 0** ink pixels at every darkness threshold, a 2×2 mark as 4 — so "blank = zero ink" separates the two without a density guess. The audit's defect record now proves both pages survive at the default and the sparse page drops only under an explicit `0.001`. 119/119 page-ops + pdfService |
| A5 `flatten-pdf` | this commit | `tests/features/appearance-bake.test.ts` 11/11 pins the §12.5.5 placement math with exact numbers; `tests/features/page-ops.test.ts` flatten block 6/6 — field ink **782 px before → 782 px after** (pixel-identical bake) on both the plain form and the one containing an unsigned `/Sig` that used to zero it out, `pdftotext` now recovers `APPEARANCE-ALPHAVALUE` from the page content, `/Annots` resolves to `[]` with no dangling ref and pdf-lib re-reads the output cleanly, and the two un-bakeable shapes (`no-appearance`, `with-freetext`) throw `FlattenRefusal` naming the field and its value instead of deleting it. Consumers re-run: stressTestAllTools + fullFeatureValidation 99/99, generateUserOutputs real NED (2p/522 chars) and ABSA (16p/4516 chars) |
| A7 `auto-rotate` | this commit | The orientation test read `page.getSize()` — the MediaBox, which does not change when a page is rotated — and ignored the existing `/Rotate`, so every pass flipped the same page again and the tool was not idempotent. The decision now uses the **visible** frame (swapping width/height at 90° and 270°). `auto-rotate` idempotency measured across three passes: 300×400 → 300×400 → 300×400 with `/Rotate` holding at 90. While there: `rotatePdf` accumulated `/Rotate 360`, which the spec forbids, so a 270° page + 90° turn was written out-of-range; it now reduces modulo 360, proven over the full 4×3 sweep of start angle × turn. Feature tests 262/263 (1 known skip), tsc clean |
| A8 sanitize dates | `f0dc9c6` | `sanitizePdf` set `CreationDate`/`ModDate` to `new Date(0)`, so a "completely sanitised" document still reported `Thu Jan 1 02:00:00 1970` through `pdfinfo` — an epoch timestamp is still a statement about the file. The keys are now deleted from pdf-lib's info dictionary. `tests/features/sanitize-metadata.test.ts` 2/2: dates absent after `removeMetadata: true`, and **present** when it is declined (asking to strip JavaScript must not quietly delete dates too). Asserted through `pdfinfo`, because pdf-lib packs the info dict into an object stream and a latin1 byte grep misses a date that every real reader sees. security + pdfService 56/57 (1 known skip), tsc clean |
| B2 `pdf-to-jpg` | `c1bac2a` | The handler passed `maxPages: 50` and `convertPdfToImages` honoured it by quietly returning the first 50, so a 60-page document produced 50 JPEGs and a success message; scale was hardcoded `2.0` and quality `0.90` with no UI writing either option. Now every page converts (a 60-page input emits 60), a >500-page document is **refused out loud** with the page-range field named, and DPI/quality are real controls that reach the service. Fixing this exposed a deeper one: the service called `getContext()` **before** sizing the canvas, which a browser tolerates but any surface-binding shim freezes at the 300×150 default — the audit had already logged that artifact as harness-only ("not a product defect"), and it is exactly what let a DPI slider look implemented while doing nothing. Sizing now happens first. `tests/features/pdf-to-jpg.test.ts` 4/4 with `identify`: 60→60, range `5-8`→4 pages, 501 refused by name, **72 DPI → 200×120 px and 300 DPI → 833×500 px** measured off disk. conversion 35/35, all feature tests 223/224, heavy consumers 105/105, tsc clean |
| D3 paid-AI consent | `a5f2ba1` | `pdf-to-excel` escalated to a cloud provider whenever the local read found no table — which for a scan is *always* — so every scanned statement silently spent one credit per page on a tool chosen as a table converter. The escalation now requires `allowAIFallback`, default off, with a labelled control that names the cost. `tests/features/ai-consent.test.ts` 3/3 with the provider mocked: not reached when unset, not reached when explicitly off, reached exactly once when asked. Limitation stated rather than hidden: the tests stub the local reader, so they prove the gate and not the real scan's route to it; the earlier unmocked run showed a real scan does fail locally with "all pages appear to be blank", which is the condition the gate guards |
| A4 `crop-resize` | `2f9d7d2` | `page.setSize()` rewrote the boxes and left the artwork alone: a 600×800 page grown to A4 kept its drawing at original size, and shrinking the same page to A5 silently deleted what fell outside — `PRISMZ1` gone from the text layer with no complaint. Page content is now lifted into a Form XObject and drawn back through a matrix, so it scales with the box, and the aspect-ratio decision is exposed as `fit` / `fill` / `stretch` / `clip` (margin-only trimming keeps its original box-inset semantics). Measured: ink bounding box **169 px → 118 px**, expected 118.1 at the 0.6992 scale; **all five text tokens survive** the A5 shrink; `fit` keeps the top-of-page text where `clip` (the old behaviour, now chosen by name) drops it from 31 chars to 16. crop-resize 5/5, page-ops + pdfService 123/123, real NED (2p, 518 chars) and ABSA (16p, 4356 chars) survive a resize with their text intact, tsc clean |
| A10 `compress` | `56f73e9` | `compressPdf` no longer re-renders pages by default. New `images` mode re-encodes only the document's own JPEGs in place — including the `/FlateDecode+/DCTDecode` wrapper real statements use — relabelling `/ColorSpace` from the new codestream's actual SOF component count, and always returns the smaller of input and output. Whole-page rasterization survives only as the named `rasterize` opt-in, with UI copy that states text becomes unselectable. Measured: photo+text page **2,357,527 B → 1,375,129 B (−41.7%) with 95 text characters → 95**; digital16 **−13.5% with 16/16 text-bearing pages preserved**; rasterize mode measured at **95 → 0** characters, which is precisely why it is no longer the default. 6/6 compress tests, 153/154 across the feature suites, 144/144 consumers, tsc clean |
| B1 `extract-images` | `77fbce1` | `tests/features/conversion.test.ts` 31/31. The tool was rendering each **page** to a PNG; it now walks `/XObject /Subtype /Image` (recursing into Form XObjects) and hands over what the document carries, with a `manifest.txt` stating for every file whether it is `original`, `reconstructed` or a `page render`, plus every duplicate and every unreadable image with its reason. Measured on the real NED statement: **4 distinct assets at 709×207, 677×435, 1148×160 and 586×528 from 8 placements**, each recovered JPEG independently opened by ImageMagick; on the fixture the JPEGs are byte-for-byte equal to the stored stream and the Flate image round-trips with **0 differing samples out of 43,200**. 220/220 across pdfService, page-ops, stress, fullFeatureValidation, generateUserOutputs |
| encrypted-input guard (C2 precursor) | `5b53016` | `shared/pdf/loadGuard.ts` + `npm run check:site-guard` 4/4 across both engines |
| upload stale-closure | `58f8d0d` | Playwright journey loads 2 files through `ToolDashboard`; `multiple` + input reset proven |
| D5 (part) — free-model gateway | `e3a1dbf` | `tests/omnirouteProviderChain.test.ts` 9/9 and `docs/omniroute-e2e-probe.txt`: a real `wrangler dev` instance holding **no paid keys** answered `/api/ai` for `ocr` (2.9 s) and `pdf-summary` (8.5 s) from `north-mini-code:free`, meter settled with no PENDING, and an unlisted tool correctly reached no provider |

Carried forward, unverified and therefore not claimed: A9, B3–B5, C1/C3/C4/C5, D1, D2, D4, D5 (part), D6, E1–E6.

One more thing B2 changed about how this plan should be read: several defects were logged as
*harness* artifacts when they were really the product ordering its own calls wrongly. The
`getContext()`-before-sizing note is the case in point — a browser hides the bug, so nothing in the
app ever failed, and the DPI control could ship looking correct. Findings that say "this is only true
under test" should be re-tested as product questions, not filed away.

One gap in A5 stated rather than glossed: the bake path is proven on constructed forms that carry
appearance streams exactly as a producer writes them (four variants, ink-compared against poppler),
but **no genuine third-party filled form exists in this repository's corpus** — every fixture was
generated by pdf-lib or is a scanned statement, and none has an `/AcroForm`. The refusal branch is
therefore untested against the shapes real estate and tax software emit. When one is available, add it
as a fixture before claiming the refusal rate is low.

Two facts this pass changed about the plan itself, recorded rather than quietly absorbed:

1. **The survey's long-form grader was wrong before it was right.** It required
   `content.length > 120`, which graded nine *correct, terse* ledger summaries as failures and reported
   1/14 passing. Grading on the four target figures to the cent gives 7/14. See
   `docs/omniroute-model-selection.md` — the lesson (a metric that rewards verbosity on a financial
   tool rewards padding) is written into the doc, and the superseded run's output is left in place
   rather than deleted.
2. **D5's premise is partly obsolete.** The task assumed no provider response had ever been obtained
   and pointed at the connected ollama host. A provider response has now been obtained end to end —
   through OmniRoute, which is the owner's stated production intent. The local ollama route is a
   separate concern, and it cannot run as specified today: `pipeline/ollamaVision.mjs:8-9` defaults to
   `qwen3-vl:4b` and `k2-horizon:3.7b`, while `http://127.0.0.1:11434/api/tags` currently lists only
   `qwen2.5vl:7b`, `qwen2.5vl:latest` and `nomic-embed-text:latest`. That is reported, not worked
   around by editing someone else's model defaults.
3. **B1's fixture work hid a real-data gap.** Against the constructed forms everything passed, then the
   first run on the actual NED statement reported six images "not decodable" because their filter chain
   is `[ /FlateDecode /DCTDecode ]` — a JPEG inside a zlib wrapper, which pdf-lib refuses outright
   ("/DCTDecode stream encoding not supported"). Inflating the wrapper is all it takes, and the bytes
   underneath are the document's own JPEG. The lesson is recorded where it can be read: **a green
   fixture suite is not evidence until a real document has been pushed through it.** Two further bugs
   surfaced the same way — a zlib trailer written with little-endian ADLER32 (libpng rejects the whole
   PNG; the harness's own reader silently returned the image minus its bottom row) and an `/SMask` read
   through a helper that narrowed on `instanceof PDFDict`, which a stream is not, so transparency was
   being dropped without a word. `identify` from ImageMagick is now part of the gate precisely because
   the harness decoder cannot see these failures.
