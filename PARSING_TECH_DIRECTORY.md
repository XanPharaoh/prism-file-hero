# Document Parsing Technology - Reusability Directory

To recreate or reuse the document parsing and extraction technology in another project, you will need the core files located in the `services/` directory. These files handle everything from PDF ingestion and bank detection to specific coordinate-based extraction and OCR fallbacks.

Here is the complete directory of exact files you need to copy over, grouped by their function:

### 1. The Core Orchestrator (The Entry Point)
This file is the main router. It takes a PDF, detects the bank, routes it to the specific extractor, and falls back to generic solutions if needed.
* **Master Service:** `d:\prism-file-hero\services\documentService.ts` (Contains `processDocumentExcel`, the master function that orchestrates the entire extraction pipeline).

### 2. Bank Detection
These files are responsible for reading the first few lines of a document to figure out which bank it belongs to.
* **Registry Rules:** `d:\prism-file-hero\services\bankRegistry.ts` (Contains the rules, keywords, and logic to reliably fingerprint a document).
* **Fingerprinting Logic:** `d:\prism-file-hero\services\fingerprintService.ts` (Additional fingerprinting logic for identifying documents).

### 3. Bank-Specific Extractors (High-Fidelity)
These files contain the exact math, regex patterns, coordinates, and noise-filtering needed to extract tables from specific banks perfectly.
* **FNB:** `d:\prism-file-hero\services\fnbExtractService.ts` (Specialized FNB extraction parsing dynamic headers, merging fragmented lines, and preventing footer data bleeding).
* **Capitec:** `d:\prism-file-hero\services\capitecExtractService.ts` (Handles Capitec's unified description/date block formats using regex and precise X-coordinates).
* **Nedbank:** `d:\prism-file-hero\services\nedbankExtractService.ts` (Handles Nedbank's fixed column alignments and bilingual noise reduction).

### 4. Secondary & Fallback Extractors
These are the safety nets. If a document isn't from a supported bank, or if the PDF is severely corrupted, these services are triggered.
* **Generic Fallback Engine:** `d:\prism-file-hero\services\tableExtractor.ts` (The "Set and Forget" generic heuristic extractor. Assigns types to text blocks and pulls consensus patterns).
* **OCR Fallback Engine:** `d:\prism-file-hero\services\ocrService.ts` (The Tesseract/OCR engine adapter. Parses flattened image PDFs into usable text items with X/Y coordinates).
* **AI/Vision Fallback Engine:** `d:\prism-file-hero\services\doclingService.ts` (The AI/Vision fallback. Hands the document to an AI model specializing in visual table layouts).

### 5. Utility & Data Structuring
These files support the extraction process by classifying data, reconciling totals, manipulating PDFs, and exporting formats.
* **Classifier:** `d:\prism-file-hero\services\transactionClassifier.ts` (Classifies transaction rows securely).
* **Reconciliation:** `d:\prism-file-hero\services\reconciliationService.ts` (Ensures extracted totals match balances, normalizes broken money strings via `parseMoney`).
* **PDF Engine:** `d:\prism-file-hero\services\pdfService.ts` (Contains low-level `pdf-lib` and `pdfjs-dist` utilities. Handles decrypting, splitting pages, watermarking, compressing).
* **Excel Exporter:** `d:\prism-file-hero\services\excelService.ts` (Converts extracted JSON transaction arrays into clean Excel rows/workbooks).
* **String Normalizer:** `d:\prism-file-hero\services\normalizer.ts` (Helper functions to clean up encoding issues, unicode artifacts).
* **Schema Definition:** `d:\prism-file-hero\services\statementSchema.ts` (Schema structures).
* **Gemini AI Service:** `d:\prism-file-hero\services\geminiService.ts` (For extracting using LLM API if utilized anywhere in pipeline).
* **Ledger Guard:** `d:\prism-file-hero\services\ledgerGuard.ts` (Validations and protections on output).

### External Dependencies
Ensure your new project's `package.json` installs these key packages that power the logic:
* `pdfjs-dist`: For reading text items and their strict geometric coordinates.
* `pdf-lib`: For structural modification of the PDF.
* Any required NLP/OCR library (e.g. `tesseract.js` or backend API references).
