# FNB Statement Extraction Fix - Phase 2

## Problem Analysis

### Current Issues (02 Feb Statement)
```
❌ Multiple Amount columns: Amount, Amount 2, Amount 3
❌ Header/footer text in row descriptions
❌ Balance values with "Cr" suffix not normalized
❌ Row boundaries broken (footer text merged into last row)
❌ Charges (Amount 3) misaligned with actual fee data
```

### Root Causes
1. **Column Detection**: X-position clustering misidentifies fragmented numbers as separate columns
2. **Row Boundary Detection**: Missing logic to exclude header repeats and footer sections
3. **Text Normalization**: "Cr" suffix not stripped from balance; description overflow not handled
4. **FNB-Specific Parsing**: Generic table extractor doesn't understand FNB statement structure

---

## Solution Architecture

### Phase 1: Improve FNB-Specific Extraction (P0 - CRITICAL)
**Goal**: Make FNB statements extract cleanly with proper column mapping

**Tasks**:
- [ ] **T1.1**: Detect FNB header patterns more robustly (multi-language, variations)
- [ ] **T1.2**: Extract opening/closing balance from statement header (not data rows)
- [ ] **T1.3**: Identify and skip "Delivery Method...", "FN NS/01/WV..." footer repeats
- [ ] **T1.4**: Normalize "Cr"/"Dr" in Balance column to numeric signs
- [ ] **T1.5**: Merge fragmented Amount columns into unified structure

### Phase 2: Improve Generic Table Extraction
**Goal**: Fix column detection and row boundary logic

**Tasks**:
- [ ] **T2.1**: Add "footer signature" detection (Closing Balance, Turnover lines)
- [ ] **T2.2**: Deduplicate repeated header rows across pages
- [ ] **T2.3**: Merge columns that are clearly fragments (Amount, Amount 2, Amount 3 → single Amount)
- [ ] **T2.4**: Post-process descriptions to clean overflow text

### Phase 3: Desktop App Integration
**Goal**: Auto-select best extraction method

**Tasks**:
- [ ] **T3.1**: Detect statement type (FNB vs generic) automatically
- [ ] **T3.2**: Route to FNB extractor if FNB patterns detected
- [ ] **T3.3**: Fall back to improved generic extractor
- [ ] **T3.4**: Add extraction quality score to Excel Summary sheet

---

## Implementation Plan

### T1.1: Detect FNB Headers (fnbExtractService.ts)

**Current Problem**:
```typescript
const FNB_HEADER_PATTERNS = [
    /date.*description.*amount.*balance/i,
    // ... only 4 patterns
];
```

**Fix - Add patterns for header repeats**:
```typescript
const FNB_HEADER_PATTERNS = [
    /date.*description.*amount.*balance/i,
    /datum.*beschwriving.*bedrag.*saldo/i,  // Afrikaans
    /date.*narrative.*debit.*credit.*balance/i,
];

const FNB_FOOTER_PATTERNS = [
    /^Delivery Method.*DDA AA/,  // Footer repeat
    /^Closing Balance/,
    /^Turnover for Statement/,
    /^No\. Credit Transactions/,
    /^No\. Debit Transactions/,
    /^Please contact us within 30 days/,
];
```

**Impact**: Lines matching footer patterns are skipped, preventing merged data.

---

### T1.2-T1.3: Extract Metadata from Header

**Current Problem**: Statement metadata (opening/closing balance, period) mixed into data rows

**Fix**: Parse header section separately
```typescript
// Before tokenizing data rows:
let openingBalance = '';
let closingBalance = '';
let statementPeriod = '';

// Scan first 5 lines for metadata
for (const y of sortedY.slice(0, 5)) {
    const text = lineMap.get(y)!.map(i => i.str).join(' ');
    if (text.includes('Opening Balance')) {
        openingBalance = extractNumber(text);
    }
    if (text.includes('Closing Balance')) {
        closingBalance = extractNumber(text);
    }
}
```

---

### T1.4: Normalize Balance Column

**Current Problem**: `Balance: "235,554.49Cr"` should be `235554.49`

**Fix** (in reconciliationService.ts):
```typescript
export function normalizeCrDr(value: string): { amount: number; sign: string } {
    const str = String(value).trim();
    const hasCr = /\bCr\b/i.test(str);
    const hasDr = /\bDr\b/i.test(str);
    
    let num = parseFloat(str.replace(/[R$£€\s,]/g, '').replace(/\bCr\b|\bDr\b/gi, ''));
    
    return {
        amount: Math.abs(num),
        sign: hasDr ? 'Dr' : 'Cr'
    };
}
```

---

### T1.5: Merge Fragment Columns

**Current Problem**: One Amount split into 3 columns
- Column A: Transaction amount (3000, 800, 1000, etc.)
- Column B: Running balance (230,439.56Cr)
- Column C: Charges (3, 3, 39.2, etc.)

**Fix** (in tableExtractor.ts):
```typescript
// After column detection, merge "Amount-like" columns
function mergeFragmentColumns(headers: string[], rows: any[][]): {
    headers: string[],
    rows: any[][]
} {
    const amountIndices = headers
        .map((h, i) => normKey(h).includes('amount') ? i : -1)
        .filter(i => i >= 0);
    
    if (amountIndices.length > 1) {
        // Likely fragmented: keep first amount, move others to Fees/Balance
        const primaryAmountIdx = amountIndices[0];
        const chargesIdx = amountIndices[amountIndices.length - 1];
        
        // Rename Amount 2 → Charges, Amount 3 → Balance (if balance missing)
        headers[chargesIdx] = 'Charges';
        
        return { headers, rows };
    }
    
    return { headers, rows };
}
```

---

### T2.1-T2.2: Footer Detection & Deduplication

**Current Problem**: Last row includes entire footer section

**Fix**:
```typescript
// Before building final rows, filter footer patterns
const isFooter = (raw: string) => 
    FNB_FOOTER_PATTERNS.some(p => p.test(raw)) ||
    /^Delivery Method|^No\. |^Please contact|^For more information|^For the latest/.test(raw);

// Deduplicate header repeats
function deduplicateHeaders(lines: Line[]): Line[] {
    const seen = new Set<string>();
    return lines.filter(line => {
        const norm = line.raw.toLowerCase().replace(/\s+/g, '');
        if (isHeaderLine(line.raw) && seen.has(norm)) {
            return false; // Skip duplicate header
        }
        if (isHeaderLine(line.raw)) seen.add(norm);
        return !isFooter(line.raw);
    });
}
```

---

### T3.1-T3.2: Auto-Route Extraction

**In App.tsx** (case 'pdf-to-excel'):
```typescript
// Try FNB extraction first
let result;
let usedFNB = false;

try {
    const fnbResult = await extractFNBStatement(item.file);
    if (fnbResult.transactions.length > 0) {
        // Validate: check if extraction quality is high
        const badRows = fnbResult.transactions.filter(t => 
            !t._reconciled
        ).length;
        
        if (badRows / fnbResult.transactions.length < 0.1) {
            result = {
                rows: convertToExcelRows(fnbResult.transactions),
                metadata: { source: 'fnb-optimized', ...fnbResult.metadata }
            };
            usedFNB = true;
        }
    }
} catch (fnbError) {
    console.log('FNB extraction failed, trying generic:', fnbError);
}

// Fallback to improved generic extractor
if (!result || result.rows.length === 0) {
    result = await processDocumentExcel(item.file, toolOptions);
}
```

---

## Verification Checklist

- [ ] **T1 Complete**: FNB statement extracts with 5-6 columns (Date, Description, Amount, Balance, Charges, not Amount 2/3)
- [ ] **T2 Complete**: Generic extractor filters headers/footers
- [ ] **T3 Complete**: Desktop app auto-selects FNB route
- [ ] **Data Quality**: 02 Feb file extracts cleanly, no merged footer text
- [ ] **All Tests Pass**: `vitest run`
- [ ] **Excel Output**: 
  - Transactions sheet: 45-50 clean rows
  - Summary sheet: shows "FNB-Optimized" source
  - No "Amount 2" or "Amount 3" columns

---

## Files to Modify

| File | Changes | Priority |
|------|---------|----------|
| `services/fnbExtractService.ts` | Add footer patterns, metadata extraction | P0 |
| `services/reconciliationService.ts` | Add normalizeCrDr() | P0 |
| `services/tableExtractor.ts` | Column merge, footer filtering | P1 |
| `services/documentService.ts` | Route selection logic | P1 |
| `App.tsx` | Auto-route FNB vs generic | P2 |
| `services/excelService.ts` | Add extraction method to summary | P2 |
| `tests/integration.test.ts` | Add 02 Feb statement test | P2 |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Columns in output | 5 (Date, Desc, Amount, Balance, Charges) |
| Merged footer text | 0 rows |
| Balance reconciliation | >95% pass rate |
| Extraction quality score | >85% |

---

## Timeline
- **T1** (FNB): 30 mins
- **T2** (Generic): 45 mins  
- **T3** (App): 15 mins
- **Verify**: 15 mins
- **Total**: ~2 hours

