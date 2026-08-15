# Golden corpus skeleton (Phase A Gold)

Place real PDF fixtures here as they become available:

| File | Purpose |
|------|---------|
| `tyme-business-01.pdf` | TymeBank digital statement |
| `tyme-business-01.expected.json` | Expected rows / balances |
| `fnb-gold-01.pdf` | FNB gold (post-compression fix) |
| `fnb-gold-01.expected.json` | |
| `capitec-01.pdf` | Capitec sample |
| `capitec-01.expected.json` | |
| `unknown-layout-01.pdf` | Digital, no brand |
| `unknown-layout-01.expected.json` | |
| `corrupted-compression-01.pdf` | Must fail-fast (`canExtract: false`) |
| `corrupted-compression-01.expected.json` | |

Sidecar schema:

```json
{
  "bankCode": "TYMEBANK_SA",
  "expectedRowCount": 47,
  "openingBalance": 35.13,
  "closingBalance": 0.00,
  "sampleRows": [
    { "date": "2025-11-01", "descriptionContains": "PayShap", "moneyIn": 227.73 }
  ]
}
```

Until PDFs are checked in, unit tests use embedded text samples.
