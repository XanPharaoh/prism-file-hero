# Global Statement Extraction Platform (Prism v2)

## Vision

**A world-class bank statement extraction engine that reliably converts ANY bank statement (any country, language, format) into clean, reconciled financial data.**

> "No user should ever struggle to extract their bank data. Ever."

---

## Architecture: Universal Statement Extraction Layer

```
PDF Input
  ↓
[1. Bank Detection] → Identify bank/country/format pattern registry
  ↓
[2. Extraction Strategy] → Route to optimal extraction method
  ├── Text extraction (pdf.js)
  ├── OCR (Tesseract)
  └── AI-assisted parsing (Groq/Gemini)
  ↓
[3. Normalization] → Convert to canonical schema (Date, Amount, Balance, Description)
  ↓
[4. Validation] → Reconciliation, anomaly detection
  ↓
[5. Correction UI] → User can verify/adjust before export
  ↓
[6. Export] → Excel with confidence scores, audit trail
```

---

## Core Modules Required

### 1. **Bank Pattern Registry** (NEW)
Identify which bank issued the statement

```typescript
// bankRegistry.ts
interface BankPattern {
  name: string;
  country: string;
  patterns: {
    headerRegex: RegExp[];
    footerRegex: RegExp[];
    columnHeaders: string[];
    dateFormat: string;
    currencySymbol: string;
    headerRowCount: number;
  };
  extractor: 'text-layout' | 'ocr' | 'ai-hybrid';
  confidence: number; // 0-1
}

const BANK_REGISTRY: BankPattern[] = [
  {
    name: 'First National Bank (SA)',
    country: 'ZA',
    patterns: {
      headerRegex: [
        /Tran list no.*Date.*Description.*Debit.*Credit.*Balance/i,
        /Datum.*Beschwriving.*Debiet.*Krediet.*Saldo/i,
      ],
      footerRegex: [
        /Closing Balance.*Cr|Dr/i,
        /Turnover for Statement Period/i,
      ],
      columnHeaders: ['Tran list no', 'Date', 'Description', 'Debit', 'Credit', 'Charges', 'Balance'],
      dateFormat: 'DD MMM',
      currencySymbol: 'R',
    },
    extractor: 'text-layout',
    confidence: 0.95,
  },
  {
    name: 'ABSA Bank (SA)',
    country: 'ZA',
    patterns: {
      headerRegex: [/Posting Date.*Description.*Amount.*Balance/i],
      footerRegex: [/Statement Period|Closing Balance/i],
      columnHeaders: ['Posting Date', 'Description', 'Amount', 'Balance'],
      dateFormat: 'DD/MM/YY',
      currencySymbol: 'R',
    },
    extractor: 'text-layout',
    confidence: 0.90,
  },
  // ... 50+ bank formats
];

export function detectBank(textSample: string): BankPattern | null {
  for (const bank of BANK_REGISTRY) {
    const matchCount = bank.patterns.headerRegex.filter(r => r.test(textSample)).length;
    if (matchCount > 0) return bank;
  }
  return null;
}
```

### 2. **Universal Normalization** (CRITICAL)
Convert ANY format → canonical schema

```typescript
// normalizer.ts
export interface CanonicalStatement {
  metadata: {
    bank: string;
    country: string;
    period: { start: Date; end: Date };
    currency: string;
    dateDetected: boolean;
    language: string; // 'en' | 'af' | 'es' | 'fr' | ...
  };
  openingBalance: number;
  closingBalance: number;
  transactions: CanonicalTransaction[];
  quality: {
    confidence: number; // Overall extraction confidence
    reconciled: number; // % of rows reconciled
    anomalies: string[];
  };
}

export interface CanonicalTransaction {
  date: Date;
  description: string;
  amount: number; // Signed (positive = in, negative = out)
  balance: number;
  charges: number;
  direction: 'In' | 'Out';
  reconciled: boolean;
  source: 'text-extraction' | 'ocr' | 'ai-assisted' | 'user-corrected';
}

// Normalize ANY column format to canonical
function normalizeRow(rawRow: Record<string, any>, bank: BankPattern, language: string): CanonicalTransaction {
  const amount = parseSignedAmount(rawRow, bank);
  const date = parseMultiFormatDate(rawRow.date, language, bank.patterns.dateFormat);
  
  return {
    date,
    description: cleanDescription(rawRow.description),
    amount,
    balance: parseAmount(rawRow.balance),
    charges: parseAmount(rawRow.charges ?? 0),
    direction: amount > 0 ? 'In' : 'Out',
    reconciled: validateRow(amount, rawRow.balance),
    source: 'text-extraction',
  };
}
```

### 3. **Multilingual Date Parser** (CRITICAL)
Parse dates in ANY language

```typescript
// dateParser.ts
const MONTH_NAMES: Record<string, Record<string, number>> = {
  'en': { 
    'January': 1, 'February': 2, /* ... */
    'Jan': 1, 'Feb': 2,
  },
  'af': { // Afrikaans
    'Januarie': 1, 'Februarie': 2, /* ... */
    'Jan': 1, 'Feb': 2,
  },
  'es': { // Spanish
    'Enero': 1, 'Febrero': 2, /* ... */
  },
  'fr': { // French
    'Janvier': 1, 'Février': 2, /* ... */
  },
  'pt': { // Portuguese
    'Janeiro': 1, 'Fevereiro': 2, /* ... */
  },
  'de': { // German
    'Januar': 1, 'Februar': 2, /* ... */
  },
};

export function parseDate(dateStr: string, language: string, format: string): Date {
  const year = new Date().getFullYear(); // Current year if not specified
  
  // Try patterns: "06 Jan", "Jan 06", "6/1", "06-01", etc.
  const patterns = [
    /(\d{1,2})\s+(\w+)/,           // "06 Jan" or "6 January"
    /(\w+)\s+(\d{1,2})/,           // "Jan 06"
    /(\d{1,2})[\/\-](\d{1,2})/,   // "06/01" or "6-1"
  ];
  
  for (const pattern of patterns) {
    const match = dateStr.match(pattern);
    if (!match) continue;
    
    let day, month;
    const langMonths = MONTH_NAMES[language] || MONTH_NAMES['en'];
    
    if (isNaN(Number(match[2]))) {
      // Format: "06 Jan"
      day = Number(match[1]);
      month = langMonths[match[2]] || 0;
    } else {
      // Format: "06 01"
      day = Number(match[1]);
      month = Number(match[2]);
    }
    
    if (day > 0 && day <= 31 && month > 0 && month <= 12) {
      return new Date(year, month - 1, day);
    }
  }
  
  throw new Error(`Cannot parse date: ${dateStr} (language: ${language})`);
}
```

### 4. **Multilingual Currency Parser**
Handle ZAR, USD, EUR, GBP, etc.

```typescript
// currencyParser.ts
const CURRENCY_FORMATS: Record<string, {
  symbol: string;
  grouping: string;
  decimal: string;
  position: 'prefix' | 'suffix';
}> = {
  'ZAR': { symbol: 'R', grouping: ' ', decimal: '.', position: 'prefix' },
  'EUR': { symbol: '€', grouping: '.', decimal: ',', position: 'prefix' },
  'GBP': { symbol: '£', grouping: ',', decimal: '.', position: 'prefix' },
  'USD': { symbol: '$', grouping: ',', decimal: '.', position: 'prefix' },
};

export function parseAmount(str: string, currency: string): number {
  const fmt = CURRENCY_FORMATS[currency] || CURRENCY_FORMATS['ZAR'];
  
  // Remove currency symbol
  let clean = str.replace(new RegExp('\\' + fmt.symbol), '').trim();
  
  // Handle parentheses as negative
  if (clean.startsWith('(') && clean.endsWith(')')) {
    clean = '-' + clean.slice(1, -1);
  }
  
  // Remove Cr/Dr/Dr/Cr suffixes
  clean = clean.replace(/\b(Cr|Dr|Cr)\b/gi, '').trim();
  
  // Remove grouping separator
  clean = clean.replace(new RegExp('\\' + fmt.grouping, 'g'), '');
  
  // Normalize decimal
  if (fmt.decimal !== '.') {
    clean = clean.replace(fmt.decimal, '.');
  }
  
  const num = parseFloat(clean);
  return Number.isFinite(num) ? num : 0;
}
```

### 5. **Adaptive OCR with Language Detection** (CRITICAL)
For scanned statements

```typescript
// ocrService.ts (improved)
import Tesseract from 'tesseract.js';

export async function extractWithOCR(file: File): Promise<{
  text: string;
  language: string;
  confidence: number;
}> {
  const images = await convertPdfToImages(file, undefined, 100);
  const results = [];
  
  for (const img of images) {
    const { data } = await Tesseract.recognize(img.canvas, 'eng+afr+deu+fra+spa+por', {
      // Multi-language OCR
    });
    results.push(data);
  }
  
  // Detect dominant language
  const allText = results.map(r => r.text).join('\n');
  const language = detectLanguage(allText);
  
  return {
    text: allText,
    language,
    confidence: results[0].confidence,
  };
}

function detectLanguage(text: string): string {
  // Check for Afrikaans
  if (/\b(die|van|en|is|op|met|wat|naar|hij|haar)\b/i.test(text)) return 'af';
  // Check for Spanish
  if (/\b(la|el|de|que|por|para|una|un|es)\b/i.test(text)) return 'es';
  // Check for French
  if (/\b(le|la|de|et|que|pour|une|un|est)\b/i.test(text)) return 'fr';
  // Default to English
  return 'en';
}
```

### 6. **User Correction & Verification UI** (NEW)
If extraction confidence < 85%, show review screen

```typescript
// CorrectionUI Component (React)
interface ExtractionReview {
  transaction: CanonicalTransaction;
  confidence: number;
  issues: string[]; // e.g., ["Ambiguous date format", "Amount sign unclear"]
  suggestion?: Partial<CanonicalTransaction>;
}

function CorrectionModal({ 
  reviews, 
  onApprove, 
  onCorrect 
}: { 
  reviews: ExtractionReview[];
  onApprove: () => void;
  onCorrect: (id: string, corrected: CanonicalTransaction) => void;
}) {
  return (
    <div className="space-y-4">
      <h2>Review Extracted Transactions</h2>
      <p className="text-sm text-slate-500">
        {reviews.filter(r => r.confidence < 0.85).length} transactions need review
      </p>
      
      {reviews.map((review) => (
        <div key={review.transaction.date + review.transaction.amount}>
          {review.confidence < 0.85 && (
            <div className="border-l-4 border-amber-500 pl-4 py-2">
              <div className="flex justify-between">
                <span>{review.transaction.date}</span>
                <span className="text-right font-bold">{review.transaction.amount}</span>
              </div>
              <p className="text-sm">{review.transaction.description}</p>
              
              {review.issues.map(issue => (
                <p key={issue} className="text-xs text-amber-600">⚠️ {issue}</p>
              ))}
              
              <input 
                type="text"
                defaultValue={String(review.transaction.amount)}
                onChange={(e) => {
                  // User can correct
                }}
              />
            </div>
          )}
        </div>
      ))}
      
      <button onClick={onApprove}>✓ Approve & Export</button>
    </div>
  );
}
```

### 7. **Quality Scoring & Audit Trail**
Help users trust the extraction

```typescript
// qualityScore.ts
export function calculateQuality(statement: CanonicalStatement): {
  score: number; // 0-100
  reasoning: string[];
  warnings: string[];
} {
  const checks = [];
  const warnings = [];
  
  // Check 1: Reconciliation
  const reconciledCount = statement.transactions.filter(t => t.reconciled).length;
  const reconciliationRate = reconciledCount / statement.transactions.length;
  checks.push({
    name: 'Reconciliation Rate',
    score: reconciliationRate * 100,
    weight: 40,
    reasoning: `${Math.round(reconciliationRate * 100)}% of rows matched expected balance`,
  });
  
  // Check 2: Opening/closing balance agreement
  const balanceMatch = Math.abs(statement.closingBalance - statement.openingBalance 
    - statement.transactions.reduce((sum, t) => sum + t.amount, 0)) < 0.01;
  checks.push({
    name: 'Balance Match',
    score: balanceMatch ? 100 : 0,
    weight: 30,
    reasoning: balanceMatch 
      ? 'Opening + transactions = closing balance ✓'
      : 'Balance mismatch detected',
  });
  
  // Check 3: Data completeness
  const completeness = (
    statement.transactions.filter(t => t.date && t.description && t.amount).length 
    / statement.transactions.length
  ) * 100;
  checks.push({
    name: 'Data Completeness',
    score: completeness,
    weight: 20,
    reasoning: `${Math.round(completeness)}% of fields populated`,
  });
  
  // Check 4: Detection confidence
  const detectionConfidence = (
    statement.transactions.filter(t => t.reconciled).length > statement.transactions.length * 0.9
  ) ? 100 : 50;
  checks.push({
    name: 'Detection Confidence',
    score: detectionConfidence,
    weight: 10,
  });
  
  // Calculate weighted score
  const totalScore = checks.reduce((sum, c) => sum + (c.score * c.weight / 100), 0) / 
    (checks.reduce((sum, c) => sum + c.weight, 0) / 100);
  
  if (totalScore < 70) {
    warnings.push('Low extraction confidence. Please verify critical amounts before use.');
  }
  if (!balanceMatch) {
    warnings.push(`Balance discrepancy: ${Math.abs(statement.closingBalance - statement.openingBalance - statement.transactions.reduce((sum, t) => sum + t.amount, 0))} ${statement.metadata.currency}`);
  }
  
  return {
    score: Math.round(totalScore),
    reasoning: checks.map(c => c.reasoning),
    warnings,
  };
}
```

---

## Implementation Roadmap

### Phase 1: Core Framework (2 weeks)
- [ ] Bank registry with 15-20 major banks (SA, US, EU, AU)
- [ ] Universal normalization schema
- [ ] Multilingual date/amount parsing
- [ ] Extract-route-normalize pipeline

### Phase 2: Quality Assurance (1 week)
- [ ] Reconciliation engine (balance validation)
- [ ] Quality scoring system
- [ ] User correction UI
- [ ] Audit trail (source metadata)

### Phase 3: Global Expansion (2 weeks)
- [ ] Add 30+ more bank formats
- [ ] Support 10+ languages
- [ ] Multi-currency support
- [ ] OCR improvements

### Phase 4: AI Enhancement (1 week)
- [ ] Fallback to AI-assisted parsing for ambiguous statements
- [ ] Smart description normalization
- [ ] Duplicate transaction detection

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Extraction success rate | >98% (1 failure per 50 statements) |
| Quality score avg | >85/100 |
| No user manual intervention | >95% of cases |
| Time to export | <30 seconds per statement |
| Supported banks | 50+ globally |
| Supported languages | 10+ |

---

## Key Principles

✅ **User Trust**: Quality scores, audit trails, correction UI  
✅ **Global Ready**: Multi-language, multi-currency, any bank  
✅ **Fail Gracefully**: OCR fallback, AI-assisted parsing, user review  
✅ **Transparent**: Show confidence, explain issues, allow corrections  
✅ **Scalable**: Registry-based (easy to add new banks)  

---

## File Structure

```
services/
├── bankRegistry.ts          [Detect bank by header pattern]
├── normalizer.ts            [Convert → canonical schema]
├── dateParser.ts            [Multilingual date parsing]
├── currencyParser.ts        [Multilingual currency parsing]
├── qualityScore.ts          [Confidence & validation]
├── correctionService.ts     [User correction tracking]
└── extractionPipeline.ts    [Orchestrate all above]

components/
├── ExtractionReview.tsx     [User verification UI]
├── QualityScore.tsx         [Display confidence]
└── AuditTrail.tsx           [Show data source]

types/
├── bank.ts                  [BankPattern interface]
├── canonical.ts             [CanonicalStatement]
└── extraction.ts            [ExtractionReview]
```

---

## Next Steps

1. **Build Bank Registry** - Add 20+ major banks (SA priority)
2. **Implement Normalizer** - Convert any format → canonical
3. **Add Correction UI** - Let users verify before export
4. **Test Globalization** - Afrikaans, Spanish, other languages
5. **Quality Metrics** - Score each extraction
6. **Launch v2.0** - Global-ready statement extractor

