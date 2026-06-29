# Robust Extraction Plan - Nedbank Failure Remediation

## Overview
The extraction for `10. January 2026.pdf` failed silently. While metadata was generated (claiming 32 rows processed), the output Excel file contains no transaction data in the `Transactions` sheet. This indicates a critical failure in the row parsing logic where data was identified but discarded or failed to write.

## Success Criteria (Verifiable)
1.  **Output File**: `10. January 2026_Extracted.xlsx` must have >0 rows in the `Transactions` sheet.
2.  **Specific Row**: Must contain the transaction `25/12/2025 MTN R5 Airtime` with amount `5.00` and `358.14`.
3.  **Audit**: `_math_reconciled` column must be present and mostly TRUE.
4.  **Automated Check**: `analyze_excel_detailed.py` running on **Sheet 0** must report correct column stats.

## Task Breakdown

### Phase 1: Reproduction & Diagnosis (P0)
- [ ] Create `reproduce_issue.ts` verification script.
    - **Input**: Reads `c:/Users/Philander/Downloads/Test accounts/10. January 2026.pdf`.
    - **Action**: Calls `extractTableDeterministically` and `processDocumentExcel` logic directly.
    - **Output**: Logs JSON of extracted rows to console.
- [ ] Run reproduction script to confirm failure mode.
    - If output is empty array `[]`: Extraction logic failure.
    - If output has rows but Excel is empty: Excel write failure.

### Phase 2: Core Logic Hardening (P1)
- [ ] **Data Sink Debugging**:
    - Trace where rows are dropped. Is it `hasNumericContent` check?
    - Is it `tryRescueRow` failing silently and returning null?
- [ ] **Fix**:
    - Implement "Permissive Mode": If strict parsing fails, dump raw line content to a `_raw` column instead of discarding.
    - Improve `tryRescueRow` patterns to handle wider variety of spacing.

### Phase 3: Verification (P2)
- [ ] **Unit Test**: Create a robust test case in `tests/extraction.test.ts` with the raw text from the PDF.
- [ ] **Integration Test**: Run `reproduce_issue.ts` again and verify JSON output.
- [ ] **Excel Verification**: Generate a dummy Excel via script and check via `analyze_excel_detailed.py`.

### Phase 4: Production Build (P3)
- [ ] Run `npm run tauri:build` only AFTER Phase 3 passes.

## File Structure
- `reproduce_issue.ts`: Standalone reproduction script.
- `services/deterministicExtractService.ts`: Core logic to update.

## Execution Plan
I will execute Phase 1 immediately to pinpoint the exact failure line.
