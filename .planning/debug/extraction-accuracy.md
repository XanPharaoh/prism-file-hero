---
status: awaiting_human_verify
trigger: "Extraction accuracy - Capitec/Nedbank/FNB precision fixes"
created: 2025-01-28T10:00:00Z
updated: 2025-01-28T11:00:00Z
---

## Current Focus

hypothesis: Three root causes fixed and verified against test PDFs
test: User verifies in production with same test files
expecting: All banks extract correctly
next_action: Await user confirmation

## Symptoms

expected: Excel output matches bank statement data exactly
actual: Capitec missing 65-70% rows, Nedbank 0% working, FNB missing 3-6 rows per statement

## Evidence

- Capitec: PostDate+TransDate+Description rendered as single text item. Rewritten parser extracts dates with regex.
- Nedbank: Built dedicated position-based extractor. Handles both English and Afrikaans statements.
- FNB: Removed aggressive noise filter phrases that matched real transaction descriptions.
- Verified: Capitec 5121: 6/6, 8699: 42/42, 8892: 159/159 transactions
- Verified: Nedbank 10. January: 30 transactions (was 1), January: 21 transactions (was 1)
- Build succeeded, deployed to Cloudflare Pages production

## Resolution

root_cause: |
  1. Capitec: PostDate+TransDate+Description arrive as single text item. isDateToken() requires exact match → fails → rows lost
  2. Nedbank: No dedicated extractor. Position-based layout incompatible with generic extractor
  3. FNB: Noise filter phrases ("absa bank", "page ", "account type", etc.) matched legitimate transaction descriptions
fix: |
  1. Rewrote capitecExtractService.ts - parse combined date+desc with regex, zone-based column assignment
  2. Created nedbankExtractService.ts - position-based extraction, handles English + Afrikaans
  3. Fixed fnbExtractService.ts noise filter - removed aggressive phrases, changed to startsWith matching
  4. Added Nedbank routing in documentService.ts
verification: Python simulation verified against all test PDFs. Build succeeded. Deployed.
files_changed:
  - services/capitecExtractService.ts
  - services/nedbankExtractService.ts (new)
  - services/documentService.ts
  - services/fnbExtractService.ts
