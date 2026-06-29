# Faithful Extraction Plan v1.1 (iLovePDF Philosophy)

## Overview
We are pivoting the extraction engine to match professional tools like iLovePDF. The engine will be "dumb and faithful", mirroring the PDF structure 1:1. "Smart" interpretation (reconciliation, unified amounts) is removed from the core path to maximize reliability and user trust.

## Success Criteria (iLovePDF Level)
1.  **Exact Headers**: Headers preserved exactly (e.g., `Fees (R)`).
2.  **No Transaction Loss**: No rows dropped due to logic/math errors.
3.  **Wrapped Description Stitching**: Descriptions spanning multiple lines are automatically joined.
4.  **Trust-Building Shell**: Export includes `Transactions`, `Summary` (with Quality Score), and `RawLines` (no data loss) sheets.
5.  **Multi-Page Stability**: Consistent column boundaries across all pages.

## Tech Stack
- `pdfjs-dist` (Text layer)
- `tesseract.js` (Local OCR fallback)
- `XLSX` (Excel export)
- **Algorithm**: Global X-coordinate clustering (Voting) across all document lines.

## Task Breakdown

### Phase 1: Core Engine (P0)
- [ ] **Task 1.1: Implement `tableExtractor.ts`**
    - [ ] Global X-center voting for column detection.
    - [ ] Wrapped description stitching (post-pass).
    - [ ] Multi-page header repetition handling.
    - [ ] Confidence scoring (Money in last col, date detection, etc.).
- [ ] **Task 1.2: Simplify `documentService.ts`**
    - [ ] Remove reconciliation/canonicalization layers.
    - [ ] Implement Silent Fallback Ladder: Text-layer -> local OCR (Tesseract.js).
- [ ] **Task 1.3: Update `excelService.ts`**
    - [ ] Implement multi-sheet export: `Transactions`, `Summary`, `RawLines`.
    - [ ] Format numeric cells safely (strip currency/asterisks but don't reinterpret).

### Phase 2: User Interface (P1)
- [ ] **Task 2.1: Update `App.tsx`**
    - [ ] Remove ledger guard blocking for Excel flow.
    - [ ] Update tool handler to use new streamlined `processDocumentExcel`.

### Phase 3: Verification (P2)
- [ ] **Task 3.1: Regression Testing**
    - [ ] Verify against `10. January 2026.pdf`.
    - [ ] Assert headers match: `Tran list no`, `Date`, `Description`, `Fees (R)`, `Debits (R)`, `Credits (R)`, `Balance (R)`.
- [ ] **Task 3.2: Quality Audit**
    - [ ] Run `analyze_excel_detailed.py` and confirm high confidence scoring.

## Phase X: Completion
- [ ] Transactions sheet is clean and professional.
- [ ] RawLines sheet provides "safety net" for any messy data.
