# Changelog

Notable changes to Prism File Hero, newest first. Every line below describes behaviour that was
measured by a check in this repository, with the commit that carries it. Where a tool deliberately
refuses instead of producing output, that is listed as a behaviour change, not hidden in it.

Numbers come from the gates named in `AGENTS.md`; the audit trail for each is
`docs/audit/baseline.md` and `docs/superpowers/plans/2026-10-19-feature-remediation.md`.

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
