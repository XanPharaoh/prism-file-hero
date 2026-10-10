/* Prism File Hero: single source of truth for feature content.
   Consumed in-browser (window.PRISM) and by the Node page generator (globalThis.PRISM). */
(function (g) {
  "use strict";

  // Swap these for direct installer URLs when the builds are published.
  var DOWNLOADS = {
    windows: "https://github.com/XanPharaoh/prism-file-hero/releases",
    linux:   "https://github.com/XanPharaoh/prism-file-hero/releases",
    android: "https://github.com/XanPharaoh/prism-file-hero/releases",
    note: "Windows 10/11 (x64) · Linux AppImage + .deb · Android 10+"
  };

  // runs: where the job executes. demo: a job the marketing site can run live in-browser.
  var TOOLS = [
    // Organize
    { slug: "merge-pdf", name: "Merge PDF", family: "Organize", tag: "Combine multiple PDFs into one document.",
      lede: "Drop two or more PDFs and stack them into a single file, in the order you choose. Page bookmarks and metadata carry over.",
      how: ["Reads each file's page tree and copies pages into one document.", "Reorders by drag before you commit.", "Runs entirely on your machine; the merged file never leaves it."],
      runs: ["browser", "desktop", "offline"], demo: "merge", related: ["split-pdf", "extract-pages", "reorder-pages"] },
    { slug: "split-pdf", name: "Split PDF", family: "Organize", tag: "Extract pages into separate files, zipped.",
      lede: "Break one PDF into many: every page on its own, a set of ranges, or a chosen split point.",
      how: ["Pick per-page, custom ranges, or a fixed chunk size.", "Outputs a folder or ZIP of valid, standalone PDFs.", "Original file is never modified."],
      runs: ["browser", "desktop", "offline"], demo: null, related: ["extract-pages", "delete-pages", "merge-pdf"] },
    { slug: "rotate-pdf", name: "Rotate PDF", family: "Organize", tag: "Fix orientation: 90, 180 or 270 degrees.",
      lede: "Turn pages the right way up. Rotate the whole file or single pages you select.",
      how: ["Applies a page-level rotation, not a re-render, so quality is untouched.", "Per-page override for the odd landscape page in a portrait run."],
      runs: ["browser", "desktop", "offline"], demo: "rotate", related: ["auto-rotate-pages", "crop-and-resize"] },
    { slug: "auto-rotate-pages", name: "Auto-Rotate Pages", family: "Organize", tag: "Standardise mixed landscape and portrait.",
      lede: "Scans each page and stands it upright automatically, so a mixed scan reads as one clean document.",
      how: ["Detects text baseline direction per page.", "Normalises upside-down and sideways pages in one pass."],
      runs: ["desktop", "offline"], demo: null, related: ["rotate-pdf", "scanner-paper-look"] },
    { slug: "delete-pages", name: "Delete Pages", family: "Organize", tag: "Remove unwanted pages or ranges.",
      lede: "Strip the blanks, the cover sheets and the duplicates. Type the ranges, preview, done.",
      how: ["Accepts single pages, ranges and mixed lists (1, 4-6, 9).", "Live thumbnail preview before you commit."],
      runs: ["browser", "desktop", "offline"], demo: null, related: ["extract-pages", "remove-blank-pages"] },
    { slug: "extract-pages", name: "Extract Pages", family: "Organize", tag: "Pull specific pages into a new PDF.",
      lede: "Lift the pages you need into a fresh, self-contained PDF, leaving the original intact.",
      how: ["Select by range or by clicking thumbnails.", "Output is a clean single-purpose file."],
      runs: ["browser", "desktop", "offline"], demo: null, related: ["split-pdf", "delete-pages"] },
    { slug: "reorder-pages", name: "Reorder Pages", family: "Organize", tag: "Rearrange the page sequence.",
      lede: "Drag pages into the order you want. Useful when a scan comes out reversed or interleaved.",
      how: ["Drag-and-drop grid of every page.", "Reverse-all and select-move shortcuts for long documents."],
      runs: ["browser", "desktop", "offline"], demo: null, related: ["merge-pdf", "delete-pages"] },
    { slug: "add-page-numbers", name: "Add Page Numbers", family: "Organize", tag: "Dynamic numbering with format and position.",
      lede: "Stamp page numbers where you want them, in the format you need, starting from any page.",
      how: ["Formats: 1, Page 1 of N, 01, roman numerals.", "Nine positions plus margin and font size."],
      runs: ["desktop", "offline"], demo: null, related: ["header-and-footer", "multi-page-layout"] },
    { slug: "header-and-footer", name: "Header & Footer", family: "Organize", tag: "Stamp counts, dates and titles on every page.",
      lede: "Add running headers and footers with page numbers, dates, file names and custom text.",
      how: ["Token-based: drop in {page}, {total}, {date}, {title}.", "Different first/last page optional."],
      runs: ["desktop", "offline"], demo: null, related: ["add-page-numbers", "watermark"] },
    { slug: "multi-page-layout", name: "Multi-Page Layout (N-Up)", family: "Organize", tag: "Fit 2, 4 or 9 pages onto one sheet.",
      lede: "Imposition for printing: place several pages on one sheet to save paper or make handouts.",
      how: ["2, 4, 6 or 9-up with margins and borders.", "Great for slides and contracts you print double-sided."],
      runs: ["desktop", "offline"], demo: null, related: ["crop-and-resize", "add-page-numbers"] },
    { slug: "add-stamp-badge", name: "Add Stamp Badge", family: "Organize", tag: "Rubber APPROVED, CONFIDENTIAL, RECEIVED.",
      lede: "Drop classic rubber-stamp marks on any page: APPROVED, PAID, DRAFT, CONFIDENTIAL, or your own.",
      how: ["Preset stamps plus custom text, colour and rotation.", "Place once or tile across the document."],
      runs: ["desktop", "offline"], demo: null, related: ["watermark", "header-and-footer"] },

    // Convert
    { slug: "pdf-to-excel", name: "PDF to Excel", family: "Convert", tag: "Table extraction to XLSX, scans or digital.",
      lede: "Turn tables in a PDF into a real spreadsheet, with numbers as numbers. Works on digital PDFs and on scans via OCR.",
      how: ["Detects table grids and column boundaries.", "Preserves headers, merges and number formats into .xlsx."],
      runs: ["desktop", "web-ai"], demo: null, related: ["pdf-to-word", "pdf-to-plain-text"] },
    { slug: "pdf-to-markdown", name: "PDF to Markdown", family: "Convert", tag: "AI reconstruction with formatting kept.",
      lede: "Clean Markdown out of a PDF: headings, lists, tables and links reconstructed, not just dumped as text.",
      how: ["Layout-aware pass keeps structure honest.", "Good for feeding documents into notes or code."],
      runs: ["web-ai", "desktop"], demo: null, related: ["ocr-to-markdown", "pdf-to-word"] },
    { slug: "pdf-to-word", name: "PDF to Word (DOCX)", family: "Convert", tag: "Editable Microsoft Word output.",
      lede: "Get an editable .docx that keeps paragraphs, headings and tables close enough to skip reformatting.",
      how: ["Maps text blocks to Word paragraphs and runs.", "Tables and images carried across where present."],
      runs: ["desktop", "web-ai"], demo: null, related: ["pdf-to-excel", "pdf-to-plain-text"] },
    { slug: "pdf-to-plain-text", name: "PDF to Plain Text", family: "Convert", tag: "Pure readable text, instantly.",
      lede: "Strip a PDF down to clean, readable text with the layout noise removed.",
      how: ["De-hyphenates line breaks and drops running headers.", "Instant and fully local for digital PDFs."],
      runs: ["browser", "desktop", "offline"], demo: null, related: ["pdf-to-markdown", "ocr-to-searchable-pdf"] },
    { slug: "pdf-to-jpg", name: "PDF to JPG", family: "Convert", tag: "One high-quality image per page.",
      lede: "Render every page to a sharp JPG or PNG at the DPI you choose, for sharing or importing.",
      how: ["Selectable resolution and quality.", "Batch export all pages or the current one."],
      runs: ["browser", "desktop", "offline"], demo: null, related: ["jpg-to-pdf", "extract-images"] },
    { slug: "jpg-to-pdf", name: "JPG to PDF", family: "Convert", tag: "Combine images into a single document.",
      lede: "Turn a stack of photos or scans into one tidy PDF, auto-fit to page with the margins straight.",
      how: ["Reorder and crop before building.", "Normalises mixed portrait/landscape onto one page size."],
      runs: ["browser", "desktop", "android", "offline"], demo: null, related: ["pdf-to-jpg", "scanner-paper-look"] },
    { slug: "extract-images", name: "Extract Images", family: "Convert", tag: "Pull every embedded graphic into a ZIP.",
      lede: "Get every image embedded in a PDF out as files, in a ZIP, at their original resolution.",
      how: ["De-duplicates repeated assets.", "Reports which page each image came from."],
      runs: ["desktop", "offline"], demo: null, related: ["pdf-to-jpg", "compress-pdf"] },

    // Optimize
    { slug: "compress-pdf", name: "Compress PDF", family: "Optimize", tag: "Shrink embedded images, keep page size.",
      lede: "Cut file size for email and upload without wrecking readability. Choose how hard to squeeze.",
      how: ["Re-samples and re-compresses embedded images.", "Shows before/after size so you can pick the trade-off."],
      runs: ["desktop", "offline"], demo: null, related: ["crop-and-resize", "remove-blank-pages"] },
    { slug: "repair-pdf", name: "Repair PDF", family: "Optimize", tag: "Recover corrupted, unreadable streams.",
      lede: "Open the PDF that other apps refuse to. Rebuilds broken object streams and cross-reference tables.",
      how: ["Re-parses with error tolerance and re-writes a clean file.", "Recovers from truncated downloads and bad saves."],
      runs: ["desktop", "offline"], demo: null, related: ["sanitize-pdf", "flatten-pdf"] },
    { slug: "crop-and-resize", name: "Crop & Resize", family: "Optimize", tag: "Trim margins or fit A4, Letter, Legal.",
      lede: "Trim wasted margins or resize every page to a standard sheet, so scans print cleanly.",
      how: ["Crop box editing with a live preview.", "Fit or rescale to A4, Letter, Legal or custom."],
      runs: ["desktop", "offline"], demo: null, related: ["compress-pdf", "multi-page-layout"] },
    { slug: "remove-blank-pages", name: "Remove Blank Pages", family: "Optimize", tag: "Detect and drop empty pages.",
      lede: "Finds the blank pages hiding in a scan or export and removes them in one action.",
      how: ["Detects pages with no text or meaningful content.", "Reports how many were dropped."],
      runs: ["desktop", "offline"], demo: null, related: ["delete-pages", "compress-pdf"] },
    { slug: "scanner-paper-look", name: "Scanner / Paper Look", family: "Optimize", tag: "Grain, toner contrast, deskew.",
      lede: "Makes a phone photo of a document look like a clean flatbed scan: straightened, whitened, legible.",
      how: ["Deskew and perspective correction.", "Background removal and toner-style contrast."],
      runs: ["desktop", "android", "offline"], demo: null, related: ["auto-rotate-pages", "jpg-to-pdf"] },
    { slug: "invert-colors", name: "Invert Colors", family: "Optimize", tag: "Dark-mode reading, less eye strain.",
      lede: "Flip a document to a dark background for comfortable reading, without turning it into a negative mess.",
      how: ["Smart inversion keeps images and figures natural.", "Optional for night reading or accessibility."],
      runs: ["desktop", "offline"], demo: null, related: ["scanner-paper-look", "compress-pdf"] },

    // Security
    { slug: "protect-pdf", name: "Protect PDF", family: "Security", tag: "Encrypt the file with a password.",
      lede: "Lock a PDF behind a password, with separate permissions for opening, editing and printing.",
      how: ["Standard AES encryption.", "Granular permissions: copy, print, modify, annotate."],
      runs: ["desktop", "offline"], demo: null, related: ["unlock-pdf", "redact-pdf"] },
    { slug: "unlock-pdf", name: "Unlock PDF", family: "Security", tag: "Remove password and editing locks.",
      lede: "Take the restrictions off a file you own. Removes passwords and permission locks you hold the key to.",
      how: ["Owner-password removal for editing rights.", "User-password removal when you have it."],
      runs: ["desktop", "offline"], demo: null, related: ["protect-pdf", "sanitize-pdf"] },
    { slug: "redact-pdf", name: "Redact PDF", family: "Security", tag: "Detect and permanently remove PII.",
      lede: "Blacks out sensitive data for real. The text and pixels are deleted from the file, not painted over.",
      how: ["Finds IDs, account numbers and addresses, then removes them.", "Verified gone: nothing recoverable underneath."],
      runs: ["desktop", "web-ai"], demo: null, related: ["sanitize-pdf", "edit-metadata"] },
    { slug: "watermark", name: "Watermark", family: "Security", tag: "Tile or stamp text and image marks.",
      lede: "Add a text or image watermark across every page, tiled or centred, to mark ownership or status.",
      how: ["Opacity, rotation, scale and tiling.", "Applies to all pages or a range."],
      runs: ["desktop", "offline"], demo: null, related: ["add-stamp-badge", "protect-pdf"] },
    { slug: "edit-metadata", name: "Edit Metadata", family: "Security", tag: "Rewrite or strip author, title, producer.",
      lede: "See and change a PDF's hidden properties, or scrub them clean before you send it.",
      how: ["Edit title, author, subject, keywords, dates.", "One-click strip for privacy."],
      runs: ["browser", "desktop", "offline"], demo: "meta", related: ["redact-pdf", "sanitize-pdf"] },
    { slug: "flatten-pdf", name: "Flatten PDF", family: "Security", tag: "Lock form fields into static pages.",
      lede: "Freeze interactive form fields and annotations into the page so filled values can't be changed later.",
      how: ["Bakes form data and comments into content.", "Keeps text selectable where possible."],
      runs: ["desktop", "offline"], demo: null, related: ["sanitize-pdf", "repair-pdf"] },
    { slug: "sanitize-pdf", name: "Sanitize PDF", family: "Security", tag: "Strip JavaScript, triggers, attachments.",
      lede: "Remove the parts of a PDF that can misbehave: embedded scripts, launch actions, hidden attachments.",
      how: ["Strips JS, embedded files and automatic actions.", "Leaves a safer, plainer document."],
      runs: ["desktop", "offline"], demo: null, related: ["redact-pdf", "unlock-pdf"] },

    // AI Labs
    { slug: "ocr-to-searchable-pdf", name: "OCR to Searchable PDF", family: "AI Labs", tag: "Turn scans into searchable pages.",
      lede: "Read the text on a scanned page and lay an invisible, selectable text layer under it, so the PDF becomes searchable and copyable.",
      how: ["Local and cloud OCR paths, with automatic failover.", "Keeps the original image, adds the text layer."],
      runs: ["desktop", "web-ai", "offline"], demo: null, related: ["ocr-to-markdown", "pdf-to-plain-text"] },
    { slug: "ocr-to-markdown", name: "OCR to Markdown", family: "AI Labs", tag: "Structured text from scanned documents.",
      lede: "Pull a scan into structured Markdown: headings, lists and tables, not a wall of loose text.",
      how: ["Reads layout, not just characters.", "Ready to paste into notes or a repo."],
      runs: ["web-ai", "desktop"], demo: null, related: ["ocr-to-searchable-pdf", "pdf-to-markdown"] },
    { slug: "compare-pdf", name: "Compare PDF", family: "AI Labs", tag: "Version diff between two documents.",
      lede: "See exactly what changed between two versions, page by page, with additions and deletions highlighted.",
      how: ["Text and visual diff side by side.", "Useful for contracts and revised statements."],
      runs: ["web-ai", "desktop"], demo: null, related: ["pdf-summary", "pdf-qa-assistant"] },
    { slug: "grammar-and-spell-check", name: "Grammar & Spell Check", family: "AI Labs", tag: "AI grammar, spelling and style pass.",
      lede: "Run a document through a grammar and style pass and get clean suggestions in place.",
      how: ["Flags spelling, grammar and awkward phrasing.", "Accept suggestions individually."],
      runs: ["web-ai"], demo: null, related: ["pdf-summary", "pdf-to-markdown"] },
    { slug: "pdf-qa-assistant", name: "PDF Q&A Assistant", family: "AI Labs", tag: "Source-grounded answers about a file.",
      lede: "Ask questions about a document and get answers that cite the passage they came from, so you can check them.",
      how: ["Grounded in the file's own text, with references.", "Works across long PDFs without you skimming."],
      runs: ["web-ai"], demo: null, related: ["pdf-summary", "compare-pdf"] },
    { slug: "pdf-summary", name: "PDF Summary", family: "AI Labs", tag: "Executive summaries and action items.",
      lede: "Compress a long document into a short summary with the key points and any action items pulled out.",
      how: ["Executive summary plus bullet points.", "Surfaces dates, amounts and obligations."],
      runs: ["web-ai"], demo: null, related: ["pdf-qa-assistant", "compare-pdf"] }
  ];

  var FINANCIAL = [
    { slug: "bank-statement-to-xlsx", name: "Bank Statement to XLSX", family: "Financial", tag: "Fourteen profiles, one canonical schema.",
      lede: "A bank statement in any layout comes out as a spreadsheet with the same columns every time, so fourteen different banks finally line up.",
      how: ["Signature-matches the bank, then extracts every line.", "Date, description, category, debit, credit and running balance in one shape."],
      runs: ["desktop", "web-ai"], demo: null, related: ["vat-ready-workbooks", "ledger-guard"] },
    { slug: "vat-ready-workbooks", name: "VAT-Ready Workbooks", family: "Financial", tag: "Nine-column SARS categories, EN & Afrikaans.",
      lede: "Output lands mapped onto SARS VAT 501 boxes, in English and Afrikaans, so the workbook is ready to file rather than ready to tidy.",
      how: ["Rules tuned to how local lines actually read.", "Standard, zero-rated, exempt and imports split correctly."],
      runs: ["desktop", "web-ai"], demo: null, related: ["bank-statement-to-xlsx", "per-client-rules-engine"] },
    { slug: "ledger-guard", name: "Ledger Guard", family: "Financial", tag: "Five deterministic checks before export.",
      lede: "Five plain-arithmetic checks stand between your numbers and a wrong total. If one fails, the export is blocked, not guessed.",
      how: ["Balance recompute, debit/credit isolation, outlier detection, duplicate prevention, closing proof.", "Nothing ships that it cannot re-derive."],
      runs: ["desktop", "web-ai"], demo: null, related: ["bank-statement-to-xlsx", "portfolio-statements"] },
    { slug: "per-client-rules-engine", name: "Per-Client Rules Engine", family: "Financial", tag: "Passive learning with hard isolation.",
      lede: "It learns how each client books their transactions, and keeps those rules walled off so one client never shapes another's ledger.",
      how: ["Corrections you make become rules for that client.", "Hard isolation between books."],
      runs: ["desktop"], demo: null, related: ["industry-templates", "vat-ready-workbooks"] },
    { slug: "industry-templates", name: "Industry Templates", family: "Financial", tag: "Bootstrap rules from real client books.",
      lede: "Start a new client from a template built on real books in their trade, instead of teaching the engine from scratch.",
      how: ["Pre-seeded categories for common industries.", "Refine per client from there."],
      runs: ["desktop"], demo: null, related: ["per-client-rules-engine", "vat-ready-workbooks"] },
    { slug: "portfolio-statements", name: "Portfolio Statements", family: "Financial", tag: "Unit trusts and holdings reconciled.",
      lede: "Unit trust and portfolio statements reconcile too: holdings, purchases and closing units checked against the source.",
      how: ["Reads Old Mutual, Sanlam and Allan Gray formats.", "Units and values balance before export."],
      runs: ["desktop", "web-ai"], demo: null, related: ["bank-statement-to-xlsx", "ledger-guard"] }
  ];

  // Hand-off to the real web app (already built in this repo: React SPA with
  // /tools/:toolId routes backed by services/pdfService + AI/excel services).
  // Set APP_BASE to the app origin when it is served from a different host.
  var APP_BASE = "/";
  var APP_ID = {
    "merge-pdf": "merge", "split-pdf": "split", "rotate-pdf": "rotate", "auto-rotate-pages": "auto-rotate",
    "delete-pages": "delete-pages", "extract-pages": "extract-pages", "reorder-pages": "reorder-pages",
    "add-page-numbers": "page-numbers", "header-and-footer": "header-footer", "multi-page-layout": "n-up",
    "add-stamp-badge": "stamp", "pdf-to-excel": "pdf-to-excel", "pdf-to-markdown": "ocr-to-md",
    "pdf-to-word": "pdf-to-word", "pdf-to-plain-text": "pdf-to-text", "pdf-to-jpg": "pdf-to-jpg",
    "jpg-to-pdf": "jpg-to-pdf", "extract-images": "extract-images", "compress-pdf": "compress",
    "repair-pdf": "pdf-repair", "crop-and-resize": "crop-resize", "remove-blank-pages": "remove-blank-pages",
    "scanner-paper-look": "scan-effect", "invert-colors": "invert-colors", "protect-pdf": "protect",
    "unlock-pdf": "unlock-pdf", "redact-pdf": "redact", "watermark": "watermark", "edit-metadata": "metadata-edit",
    "flatten-pdf": "flatten-pdf", "sanitize-pdf": "sanitize", "ocr-to-searchable-pdf": "ocr",
    "ocr-to-markdown": "ocr-to-md", "compare-pdf": "compare", "grammar-and-spell-check": "grammar-check",
    "pdf-qa-assistant": "pdf-qa", "pdf-summary": "pdf-summary",
    "bank-statement-to-xlsx": "__bank", "vat-ready-workbooks": "__app", "ledger-guard": "__app",
    "per-client-rules-engine": "__app", "industry-templates": "__app", "portfolio-statements": "portfolio-statements"
  };
  function appHref(slug) {
    var id = APP_ID[slug];
    if (!id) return APP_BASE + "app";
    if (id === "__bank") return APP_BASE + "bank-statement-to-excel";
    if (id === "__app") return APP_BASE + "app";
    return APP_BASE + "tools/" + id;
  }

  // Auth wiring: the app uses Clerk (production instance clerk.prismfilehero.com).
  // This is a PUBLIC client key (safe to ship). account.html mounts real Clerk
  // sign-in with it, and the AI tool pages obtain a session JWT from it to call
  // the Cloudflare Worker /api/ai (Premium-gated; free tier AI is locked server-side).
  var WORKER = "https://prism-worker.prismfilehero.workers.dev";
  var AUTH = { clerkPublishableKey: "pk_live_Y2xlcmsucHJpc21maWxlaGVyby5jb20k" };

  g.PRISM = {
    DOWNLOADS: DOWNLOADS,
    APP_BASE: APP_BASE,
    appHref: appHref,
    WORKER: WORKER,
    AUTH: AUTH,
    TOOLS: TOOLS,
    FINANCIAL: FINANCIAL,
    ALL: TOOLS.concat(FINANCIAL),
    bySlug: function (s) { var a = TOOLS.concat(FINANCIAL); for (var i = 0; i < a.length; i++) if (a[i].slug === s) return a[i]; return null; }
  };
})(typeof window !== "undefined" ? window : globalThis);
