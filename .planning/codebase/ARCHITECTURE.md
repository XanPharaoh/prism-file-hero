# Architecture

**Analysis Date:** 2026-05-08

## Pattern Overview

**Overall:** Multi-stage Router & Fallback Pipeline for Document Extraction

**Key Characteristics:**
- **Dynamic Routing:** Intercepts PDF bytes, reads the first page, detects the bank via `bankRegistry`, and routes to bank-specific exact coordinate parsing routines.
- **Fail-Safe Fallbacks:** If bank-specific parsing fails, it falls back to a generalized type-inference table extractor, then to an AI-driven Docling service, and finally drops raw OCR text lines.
- **Heuristic Tokenization:** Generic extraction categorizes parsed blocks into abstract data types (Date, Money, Text) to determine structural patterns instead of relying blindly on physical column alignment on unpredictable PDFs.

## Layers

**Router Layer:**
- Purpose: Directs documents and manages fail-safes.
- Location: `services/documentService.ts`
- Contains: `processDocumentExcel`, which controls the fallback logic cascade.
- Depends on: Custom bank extractors, generic extractors, and OCR.

**Bank-Specific Extraction Layer:**
- Purpose: High-fidelity, coordinate-accurate extraction for known structures.
- Location: 
  - `services/fnbExtractService.ts`
  - `services/capitecExtractService.ts`
  - `services/nedbankExtractService.ts`
- Contains: Rules targeting header text positions, physical X-coordinate limits, and explicit noise/regex rejection sets.
- Used by: `documentService.ts` Router.

**Generic Table Extraction Layer (Heuristics):**
- Purpose: Attempt table extraction when no explicit known constraints match.
- Location: `services/tableExtractor.ts`
- Contains: Line tokenizers that assign types (D=Date, M=Money, etc.) to calculate pattern occurrences and force remaining text into consensus shapes.

**AI/OCR Rescue Layer:**
- Purpose: Attempt vision-based parsing for flattened images/scans or deeply mangled tables.
- Location: `services/doclingService.ts`, `services/ocrService.ts`
- Depends on: Tesseract (via OCR), Docling (Advanced vision model).
- Used by: Router layer when generic extraction yields 0 rows.

## Data Flow

**PDF Parsing & Bank Detection Flow:**

1. **Upload & Read:** PDF document (`File`) is ingested via `processDocumentExcel` in `documentService.ts`.
2. **Text Extraction/OCR Check:** Uses `pdfjs-dist` to scrape page 1. If length of parsed tokens `< 10`, it assumes an image scan and attempts `ocrPdfToTextItems` (Tesseract) just to detect text patterns.
3. **Register Bank:** Passes initial scrape to `detectBank` (in `bankRegistry`), returning a bank code (e.g., `'CAPITEC_SA'`, `'NEDBANK_SA'`).
4. **Trigger Specific Service:** 
   - Calls matching service like `extractFNBStatement(file)`.
5. **Validation/Conversion:** If it works, rows are wrapped in `convert[Bank]ToExcelRows` to prep for sheet packaging. If it throws an error or returns zero rows, flow continues to fallbacks.
6. **Fallback Pipeline:**
   - **Gen 1 Fallback:** `extractTable(file)` from `tableExtractor.ts`. Calculates a consensus type pattern for the document and aligns all tokens.
   - **Gen 2 Fallback:** `extractWithDocling`. Sends file off to Docling to interpret via computer vision.
   - **Last Resort:** Returns raw text strings for manual analysis.

## Key Abstractions

**Custom Extractors (FNB / Capitec / Nedbank):**
- Purpose: Handle unique visual structures.
- Examples: 
  - FNB `fnbExtractService.ts`: Uses actual PDF headers to define exact positional `xLeft` / `xRight` boundaries per column dynamically. Merges fragmented 'amount' columns.
  - Capitec `capitecExtractService.ts`: Focuses on deep regex grouping (e.g. `DATE_PREFIX_RE`) because descriptions, post date, and transaction date are generated in the PDF as a single merged block by the bank.
  - Nedbank `nedbankExtractService.ts`: Hardcoded column widths based on fixed coordinates (`x~96`, `x~142`). Handles Afrikaans & English simultaneously via bi-lingual `isNoiseLine()` arrays.

**TableExtractor Tokenizer:**
- Purpose: Defines logical row structures as strings without grid coordinates.
- Examples: `services/tableExtractor.ts`
- Pattern: Maps components to `Tokens` (`D` for Date, `M` for Money, `N` for ID, `T` for Text). Identifies that `DTMM` (Date, Text, Money, Money) is the primary pattern occurring on page and forces fuzzy rows into this mold.

## Entry Points

**`processDocumentExcel`:**
- Location: `services/documentService.ts`
- Triggers: UI uploading file to extraction view.
- Responsibilities: Master controller for parsing sequence and format selection.

## Error Handling

**Strategy:** Silenced Failovers & Transparent Fallbacks

**Patterns:**
- Try/catch wrapped around specific bank service handlers. If `extractCapitecStatement` crashes, the router silently catches the error and moves on to the Generic Table extraction.
- Password trapping: Both `tableExtractor.ts` and `fnbExtractService.ts` monitor standard PDFJS `PasswordException` messages and re-throw user-facing messages advising configuration inputs.

## Cross-Cutting Concerns

**Logging:** Standard `console.log` heavily used at branch transition points (e.g. `console.log('[DocumentService] Running generic table extraction...')`).
**Validation:** Post-processing verification likely occurs via downstream reconciler steps (`services/reconciliationService.ts`).
**Security:** Password-protected PDFs are handled upstream during `pdfjs` initialization in `loadingTask.promise`.

---

*Architecture analysis: 2026-05-08*