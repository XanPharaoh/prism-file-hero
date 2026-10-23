# ADR-0001 — Document intake guards entry; it does not hide the PDF engines

- **Status:** accepted, 2026-10-23
- **Context:** two PDF engines, `pdf-lib` (rebuild, copy, save) and `pdfjs-dist` (render, text,
  page geometry). Encrypted inputs were entering both without consistent guards: pdf-lib rebuilds
  produced documents with the right page count and no content (Standard Bank: 14,476 characters in,
  8 out), and one registry handler loaded pdf-lib with `ignoreEncryption: true` purely to read page
  sizes. Teardown was remembered in some services and forgotten in others. A remediation plan item
  (C3) will add real decryption later, underneath whatever seam exists.

## Decision

The single **document intake** module (`services/pdf/intake.ts`) is the only place a PDF may be
loaded. Callers state an **intent** (`read`, `rebuild`, `repair`), and intake:

- classifies the document's **state** (`readable`, `permission-only`, `user-locked`) from the file's
  `/Encrypt` entry plus pdf.js's response to an empty password;
- refuses intent-by-state (reading is allowed for permission-only, rebuilding is not; user-locked
  reading requires the password);
- owns teardown for reader documents, via a scope form (`withReadDocument`) or an idempotent
  `release()` on the handle;
- provides the **visible page** frame per page, so no caller needs a second load to know page sizes.

It does **not** introduce a third document abstraction. A reading caller gets the `pdfjs-dist`
document; a rebuilding caller gets the `pdf-lib` document.

## Consequences

- Engine-specific APIs remain available; migration is per call site rather than a rewrite.
- C3 (decryption) changes intake's implementation behind `openForRead`/`openForRebuild` and the
  `password` parameter, not the 20-plus call sites already migrated.
- A caller that genuinely needs `ignoreEncryption` for a structure-only read must now delete the
  second load and use intake's frame facts; the plan's own note that structure-only readers may keep
  `ignoreEncryption` is superseded for anything reachable from the app.
- The shipped site bundles (`site/assets/tool.js`, `site/assets/site.js`) keep their own loads and are
  out of scope here; they have a separate build and no shared module system. Treating them as part of
  this seam would require a build change, not an import.

## Alternatives rejected

- **Hide the engines behind one document interface.** Every reader and rebuild call site would be
  rewritten at once, the two engines' capabilities (text layer, rendering, saving) are not a common
  shape, and nothing in the recorded defects requires it. Revisit only if a third engine appears.
- **Refuse everything encrypted on the reader side.** pdf.js cannot see permission-only encryption,
  and `tests/features/security.test.ts:364-381` is a deliberate tripwire asserting owner-restricted
  documents still open. Refusing would break a measured behaviour and misclassify the normal case for
  South African bank statements.
- **Automatic repair inside intake.** Repairing silently would let a "compress" request return a
  repaired document with no attribution. Repair is an explicit intent.
