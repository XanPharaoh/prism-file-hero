## Test Fixtures

This directory contains test data and sample files for the Prism v2 test suite.

### Fixture Structure

```
fixtures/
├── fnb/
│   ├── 02-feb-2024.txt          ✅ FNB statement (Feb 2 file) - contains fragmented columns issue
│   ├── 02-feb-2024.json         Raw extracted text for testing
│   └── expected-output.json     Expected normalizer output (5 clean columns)
├── absa/
│   ├── sample-statement.txt
│   └── expected-output.json
├── nedbank/
│   ├── sample-statement.txt
│   └── expected-output.json
├── icici/
│   ├── sample-statement.txt
│   └── expected-output.json
└── README.md (this file)
```

### FNB Feb 2 File (PRIORITY)

The 02 Feb FNB file is our KEY TEST CASE because it has:
- **Issue**: Fragmented Amount columns (Amount, Amount2, Amount3)
- **Issue**: Footer text bleeding into rows ("Delivery Method...", "No. Credit Transactions")
- **Goal**: Normalize to clean {Date, Description, Amount, Balance} output
- **Expected Output**: 5 clean columns with no fragmentation

**File Path**: `tests/fixtures/fnb/02-feb-2024.txt`
**Format**: Text extracted from PDF (ready for normalizer testing)
**Content**: 
- Header section with statement dates
- Transaction rows with fragmented columns ← TARGET FOR FIX
- Footer section with metadata ← TARGET FOR FILTERING
- Opening/Closing balance markers

### How to Add Fixtures

1. **Save actual statement text** from PDF extraction
2. **Extract raw text** (multiline, as pdf.js extracts it)
3. **Create JSON with structure**:
   ```json
   {
     "bank": "FNB_SA",
     "date": "2024-02-02",
     "rawText": "...",
     "lines": ["line1", "line2", ...],
     "expectedTransactions": [
       {
         "date": "2024-01-06",
         "description": "Test",
         "debit": null,
         "credit": 1000.00,
         "balance": 10000.00
       }
     ]
   }
   ```

### Test Data Generators

Instead of committing large PDF files, prefer using test generators:

```typescript
// In tests/setup.ts
testDataGenerator.generateFNBTransaction()
testDataGenerator.generateCanonicalTransaction()
testDataGenerator.generateParsedAmount()
testDataGenerator.generateParsedDate()
testDataGenerator.generateBankDetection()
```

### Fixture Naming Convention

- **Bank samples**: `bank-name/statement-description.txt`
- **Expected outputs**: `bank-name/statement-description-expected.json`
- **Sensitive data**: Mask account numbers, use placeholder amounts

### TODO: Fixtures to Create

- [ ] FNB 02-Feb-2024 text extraction
- [ ] ABSA sample statement
- [ ] Nedbank sample statement
- [ ] ICICI sample statement
- [ ] Standard Bank sample statement
- [ ] Multilingual samples (Afrikaans, Spanish)
- [ ] Edge case samples (missing balance, fragmented rows, OCR errors)

### Using Fixtures in Tests

```typescript
import { readFixture } from '../setup';

const fnbText = await readFixture('fnb/02-feb-2024.txt');
const result = normalizeRows(fnbText, context);
expect(result).toEqual(expectedOutput);
```

---

**Status**: Awaiting 02-Feb FNB file transfer from Team 1 after extraction fixes complete
