# Codebase Structure

**Analysis Date:** 2026-05-08

## Directory Layout

```
d:/prism-file-hero/
├── services/               # Core business logic & parsers
├── src/                    # UI code and top-level hooks
├── worker/                 # Independent runner scripts/servers
├── zenith/                 # Agentic workflow engine logic
└── .planning/codebase/     # Tech architecture documentation
```

## Directory Purposes

**`services/`:**
- Purpose: Contains all PDF extraction logic, OCR adapters, and bank-specific parsing configurations.
- Contains: Typescript service modules for parsing.
- Key files: 
  - `documentService.ts`
  - `tableExtractor.ts`
  - `fnbExtractService.ts`
  - `capitecExtractService.ts`
  - `nedbankExtractService.ts`
  - `doclingService.ts`
  - `ocrService.ts`

**`src/`:**
- Purpose: Frontend integration and local UI logic. Includes React views interacting with `documentService.ts`.

## Key File Locations

**Entry Points:**
- `services/documentService.ts`: Central orchestration logic for routing PDFs to specific tools.

**Configuration:**
- `services/bankRegistry.ts` (implied): Stores texts used to fingerprint banks from page 1 OCR.

**Core Logic:**
- `services/tableExtractor.ts`: The fallback parsing engine handling statistical consensus column alignments.
- `services/pdfService.ts`: Core PDF modifications, encryption, splitting, watermarking, and compression.

## Where to Add New Code

**New Feature (Bank Parser):**
- Implementation: Add a new file in `services/`, e.g. `services/standardBankExtractService.ts`.
- Orchestration: Call the new feature from `processDocumentExcel` inside `services/documentService.ts`. Add detection keywords to the `bankRegistry`.

## Special Directories

**`zenith/`:**
- Purpose: Looks like an agentic orchestration layer, containing `core/reviewer.ts`, `core/protocols.ts`, `agent.ts`. This orchestrates high-level tasks but is distinctly abstracted from the raw PDF extraction routines.

---

*Structure analysis: 2026-05-08*