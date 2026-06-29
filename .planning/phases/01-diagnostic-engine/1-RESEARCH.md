# Phase 1: Diagnostic Engine & Fallbacks - Research

**Researched:** 2026-03-01
**Domain:** Unstructured & tabular data extraction from PDF buffers, password-protection handling, and OCR fallback management.
**Confidence:** HIGH

---

## Summary
To fix the immediate extraction failures, our primary blocker is missing data due to unhandled edge cases (password-protections bypassing UI and scanned components), not just "bad pattern matchers". We ran a diagnostic script against the failed files:
- `TymeBank_Business_bank_statement_2026_02_02.pdf`: **Password protected** - `pdfjs-dist` immediately throws an error locking the file. 
- `First Nation 2026-01.pdf`: **Scanned Document** - Returned exactly 0 text items. Needs robust OCR routing.
- `Account Statement_5121...`: **Capitec Bank Statement** - Non-standard table headers prevented the strictly-typed generic matcher from building rows.

**Primary recommendation:** Build a strong `Router` pattern into `processDocumentExcel` that correctly traps `No password given` and prompts the user, seamlessly routes 0-item PDFs to Tesseract/GenAI, and adds a loose `CapitecBank` extractor.

## Architecture Patterns

### Recommended Extraction Flow
```
PDF Input
 ├── Check password? 
 │    └── If encrypted, throw descriptive error instructing user to provide password.
 ├── Extract Text Tokens (`pdfjs-dist`)
 ├── Text Item count == 0?
 │    └── Route to OCR / GenAI image reconstruction.
 ├── Identify Bank (by looking at page 1 text cluster)
 │    ├── Capitec -> `extractCapitecStatement()`
 │    ├── FNB -> `extractFNBStatement()`
 │    └── Unknown -> Generic `extractTable()`
 └── If row count == 0 after attempt
      └── Dump raw lines into an "Unclassified Result" map so users have *some* data.
```

### Pattern 1: Smart OCR Routing
**What:** Image-based PDFs bypass `pdfjs-dist`. 
**When to use:** Text items < 15. We must verify that `ocrPdfToTextItems` correctly executes and doesn't get swallowed by timeouts.

## Common Pitfalls

### Pitfall 1: Silent Password Protection Rejection
**What goes wrong:** `pdfjs-dist` throws an `UnknownErrorException` or `PasswordException` which is currently caught in the overarching try/catch and results in the UI skipping the file silently or failing generic "Operation failed" state.
**Prevention:** Catch error name `PasswordException` at the top level and mark the specific Batch Item natively showing "🔒 Locked: Needs Password" on the preview instead of halting execution for the whole batch.

### Pitfall 2: Over-reliance on "Consensus Pattern"
**What goes wrong:** The generic extractor looks for `[Date, Text, Money, Money]`. Capitec bank frequently spaces out its columns `[Date, Action, Debit, Credit, Balance]` with huge X gaps, meaning `pdfjs` often splits them so the consensus cannot be identified safely.
**Prevention:** Allow a loose `[Date, ... , Money]` fallback before terminating the row matcher.

## Code Examples

### Graceful Password Catch
```typescript
try {
  const loadingTask = pdfjs.getDocument({ data: bytes, password });
  pdf = await loadingTask.promise;
} catch (err: any) {
  if (err.name === 'PasswordException') {
    return { error: 'PASSWORD_REQUIRED', message: 'Enter password in advanced options' };
  }
  throw err;
}
```

## Validation Architecture
- Implement a batch evaluation script (similar to our `inspect-pdfs.mjs`) that loops over the test sets and asserts row_count > 0.