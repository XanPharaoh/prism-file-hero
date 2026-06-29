# Extraction Evolution Plan - Robust Unified Amount & Fee Fixing

## Overview
The current extraction pipeline is failing to meet "bank-grade" standards: fees are missed, math reconciliation is unreliable, and the column layout (split Debits/Credits) is sub-optimal for modern accounting workflows. This plan evolves the system to prioritize **Balance-Centric Reconciliation** and **Unified Amount Streams**, leveraging the user's suggestion for more robust parsing logic.

## Goal
- **Unified Amount**: One `Amount` column (positive = in, negative = out).
- **Ironclad Fees**: Correct isolation of fee components.
- **Perfect Recon**: Math verification that actually blocks/flags errors accurately.
- **Robust Parsing**: Evaluating a transition to a more powerful document understanding approach.

## Proposed Changes

### 1. Data Schema Refactor
- **Modify** `reconciliationService.ts`: Change the output from `Debits`/`Credits` to a single `Amount` field.
- **Modify** `excelService.ts`: Update Excel generation to show `Date`, `Description`, `Amount`, `Balance`, `_math_reconciled`.
- **Modify** `statementSchema.ts`: Add `Amount` to the `CanonicalRow` interface.

### 2. Reconciliation Logic Evolution ("Trust the Balance")
- **Core Logic Upgrade**:
    - Instead of just comparing `runningBalance + Amount == statedBalance`, we will calculate `Delta = statedBalance - runningBalance`.
    - We will then attempt to match the `Delta` against the numbers found on that line (Debits, Credits, Fees).
    - If `Delta` matches the sum/diff of parsed numbers -> **RECONCILED**.
    - If `Delta` does NOT match but is non-zero -> **DISCREPANCY** (Likely a missed fee).
    - **Self-Healing**: If only one number is missing (the fee), we can derive it from the `Delta`.

### 3. Fee Isolation Hardening
- **Nedbank Special Case**: Improve `tryRescueRow` to specifically look for the "Double Number" pattern (Amount + Fee) and the `*` suffix.
- **Permissive Extraction**: If deterministic splitting is ambiguous (overlapping columns), extract ALL found numbers and let the Reconciliation engine "solve the puzzle" against the balance change.

### 4. Robust Parser Research (Sidecar Approach)
- **Phase 1**: Create a Python shim using `Docling` or `pdfplumber` (often more reliable for tables than pdf.js).
- **Phase 2**: If the sidecar exists, Taur-side logic will call it as a fallback if deterministic math fails > 10% of rows.

## Success Criteria (Verifiable)
1. **Verification Script**: `reproduce_issue.ts` must show a unified `Amount` column where a R100 withdrawal with a R2 fee results in `-102.00` (or `-100.00` Amount and a populated `-2.00` Fee field).
2. **Reconciliation Test**: `tests/reconciliation.test.ts` must pass with 100% accuracy on the January 2026 statement.
3. **Excel Output**: Single-file check with `analyze_excel_detailed.py` showing no `Amount` or `Balance` errors.

## Task Breakdown
- [ ] **Task 1: Schema Refactor** (Modify types and Excel output).
- [ ] **Task 2: Implement "Balance-Centric" Recon Engine**.
- [ ] **Task 3: Implement "Puzzle Solver" Extraction** (Collect all numbers, don't just assign to columns blindly).
- [ ] **Task 4: Sidecar Prototype** (Python script for Docling/PdfPlumber).

> [!IMPORTANT]
> This plan moves away from "Column-First" parsing to "Reconciliation-First" parsing. We use the balance as the ground truth to resolve extraction ambiguities.
