# Glossary

Domain and architecture terms used in this repository, in the sense the code uses them. Add a term
when a decision depends on it being understood the same way by everyone; do not add synonyms.

## Documents and their states

**Document intake** — the module at `services/pdf/intake.ts`. The only place a PDF may enter the
product. Every load states an **intent**; intake owns encryption refusal, teardown, and the **visible
page** facts. It does not hide the engines: callers receive the pdf.js document (reading) or the
pdf-lib document (rebuilding).

**Intent** — what the caller will do with the document: `read`, `rebuild`, or `repair`. `repair` is
always explicit; intake never repairs on its own, because a silent repair is indistinguishable from
the silent-loss failures this module exists to prevent.

**Document state** — what the file's own encryption means for this product:

| state | facts | read | rebuild / repair |
| :-- | :-- | :-- | :-- |
| `readable` | no `/Encrypt` entry | allowed | allowed |
| `permission-only` | `/Encrypt` present; opens with an empty password | allowed | refused |
| `user-locked` | `/Encrypt` present; pdf.js raises `PasswordException` code 1 without a password | allowed only with the password | refused |

The presence of `/Encrypt` is read from the file, because pdf.js reports nothing for permission-only
documents — it pads the empty password, renders the content, and does not enforce `/P`. The
user-locked distinction is behavioural because only pdf.js can tell you whether an empty password
opens the file.

`pdfinfo` wording maps as follows: `Encrypted: yes` means this product sees an encrypted document;
`copy:yes` does not make it `readable` (the content is still encrypted and cannot be re-saved by
pdf-lib), and `copy:no` does not by itself require a password. Only an actual password prompt makes a
document `user-locked`.

**Visible page** — the page as a reader sees it: width and height after `/Rotate`, as reported by
`PageFrame`. Placement and resizing decisions use the visible page; the MediaBox does not move when a
page is rotated and is not the frame those decisions are about.

## Architecture

The review vocabulary is the `/codebase-design` skill's: **module**, **interface**, **implementation**,
**depth**, **deep**, **shallow**, **seam**, **adapter**, **leverage**, **locality**. Use those words
exactly; "component", "service", "API", "boundary", and "wrapper" are not substitutes.

See `docs/adr/0001-document-intake-guards-entry.md` for why the intake seam guards entry rather than
hiding the engines.
