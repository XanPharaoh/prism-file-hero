# Prism File Hero — Homepage Revamp & SEO Architecture Specification
*(Adapted from Smallpdf's proven UX pattern, tailored for Prism File Hero's privacy & statement superpowers)*

**Date:** 2026-09-03  
**Status:** Approved by User  
**Target Domain:** `prismfilehero.com`  
**Reference Benchmark:** `smallpdf.com` (Adapted for editorial calm, freemium quotas, and financial statement extraction)

---

## 1. Core Positioning & Tone

* **Headline Concept:**  
  **"We make document work simple."**  
  *All the tools you need to convert, merge, compress, and sign PDFs right in your browser. Fast, private, and ready when you are.*

* **The Smallpdf Homework (What we adapt):**
  * Vibrant, color-coded squircle tool icons (Blue for Word, Purple for Merge, Coral for Compress, Magenta for Sign, Green for Excel, Indigo for Statement).
  * Prominent, scannable 6-card "Most Popular Tools" grid above the fold with instant 1-click links to dedicated working pages.
  * Alternating feature showcase rows below ("Keep Simple Tasks Simple") highlighting key workflows.
  * Clean Header with a categorized Tools dropdown + transparent Pricing.
  * 2-card transparent Pricing preview (Free vs Pro) instead of an overwhelming matrix.

* **Our Differentiators (Why it’s NOT an obvious clone):**
  * **The Sharp Blade:** A dedicated spotlight row on financial document intelligence: *Bank statements into reconciled spreadsheets* (Standard Bank, FNB, Capitec, ABSA, Nedbank, universal layouts).
  * **Privacy-First:** Core tools run locally in the browser using client-side WebAssembly and `pdf-lib`.
  * **Honest Freemium:** No fake "free forever" promises; clear quota rules (1 free guest task, 3 daily freemium tasks, unlimited Pro).

---

## 2. Ruthless Deletion List

| Element to Delete | Why It Is Being Removed |
| :--- | :--- |
| **Fabricated Testimonials** | Fake CA(SA) and bookkeeper reviews ("Rohan Govender", "Danielle van der Merwe") permanently deleted. |
| **Simulated Live Dashboard** | Fake progress card pretending Chase/Wells Fargo statements are processing in real time deleted. |
| **Exaggerated Claims** | "500+ banks recognised", "0 row errors in 18 months", "Trusted by hundreds of accounting firms" deleted. |
| **Overstuffed 37-Card Catalog Wall** | Replaced with Smallpdf-style 6 Popular Tools + "See All Tools" expandable drawer/modal. |
| **Buzzword Cybersecurity Theater** | "AES-256 deterministic parsing geometry" replaced with clear, truthful statements. |

---

## 3. Account Access & Quota Model

| Tier | Access & Rules | Gated / Locked |
| :--- | :--- | :--- |
| **Guest** (No account) | 1 quick test task to try the tool without friction. | **All Pro features locked.** Second task prompts free sign-in. |
| **Freemium** (Free sign-in) | Daily quota of standard document tasks (e.g., 3 tasks/day, 24-hr reset). | **All Pro features locked.** (No high-volume statement parsing, no heavy OCR/AI). |
| **Pro Tier** (Paid) | Unlimited everyday tasks + full access to heavy features. | **All features unlocked.** (Bank statement to Excel, batch processing, advanced OCR, priority pipeline). |

---

## 4. Homepage Section Architecture (Adapted from Smallpdf)

### 4.1 Header & Navigation
* **Brand Logo:** `Prism File Hero` (with prism facet icon).
* **Navigation Links:**
  * **Tools (Dropdown / Mega Menu):** 4 clean columns:
    * *Organize:* Merge PDF, Split PDF, Rotate, Delete Pages, Reorder Pages, Extract Pages
    * *Convert:* PDF to Word, PDF to Excel, JPG to PDF, PDF to JPG, Text to PDF
    * *Optimize & Secure:* Compress PDF, Redact PII, Protect PDF, Unlock, Sign PDF
    * *Financial:* Bank Statement to Excel (Pro)
  * **Bank Statements:** Direct jump to financial extraction workflow.
  * **Pricing:** Direct link to pricing details.
* **Header CTAs:**
  * Unauthenticated: "Log In" + "Start Free" (or "Try it Free").
  * Authenticated: Usage badge (e.g., "2/3 tasks left today") + Profile avatar.

---

### 4.2 Hero Section
* **H1:** **We make document work simple.**
* **Subtitle:** *All the tools you need to convert, compress, merge, and sign PDFs right in your browser.*
* **Primary CTAs:**
  * `[ Try it Free ]` (Anchor scrolls to Popular Tools / opens dropzone)
  * `[ Explore All 37 Tools ]` (Opens tool directory)
* **Trust Reassurance:**
  * *"Everyday tools run right in your browser. No files stored or sold."*

---

### 4.3 Most Popular Document Tools (The 6-Card Grid)
A 3-column, 2-row grid of high-contrast, beautiful cards with vibrant rounded-square icon badges:

1. **PDF to Word** (Blue badge `#3D99F5`)  
   *Convert PDFs to editable Word documents with intact formatting.*
2. **Merge PDF** (Purple badge `#7961F2`)  
   *Combine multiple PDFs into one unified document.*
3. **Compress PDF** (Coral/Red badge `#F23030`)  
   *Reduce file size without losing readability or image clarity.*
4. **Sign & Redact** (Pink/Magenta badge `#E667E6`)  
   *Fill out forms, create e-signatures, and black out sensitive data.*
5. **PDF to Excel** (Emerald Green badge `#10B981`)  
   *Extract tables from documents into structured spreadsheets.*
6. **Bank Statement to Excel** (Prism Indigo badge `#4F46E5` + "Pro" badge)  
   *Turn PDF bank statements into reconciled spreadsheets where debits, credits, and balances match.*

* **Button below the grid:** `[ See All 37 PDF Tools ]` (Smoothly expands the remaining categorized tools in-place).

---

### 4.4 Alternating Feature Rows ("Keep Simple Tasks Simple")

Following Smallpdf's signature product-showcase alternating rows:

* **Row 1: Assemble and Organize in Seconds (Left text, Right graphic)**
  * *H3:* Combine, split, and reorder without the headache.
  * *Body:* Drag and drop pages to reorganize reports, delete unwanted sheets, or combine multiple files into a clean submission package.
  * *Action Link:* `Merge a PDF now →`

* **Row 2: The Sharp Blade: Bank Statements That Actually Balance (Right text, Left graphic)**
  * *H3:* Turn statement PDFs into spreadsheets that add up.
  * *Body:* Built specifically for messy financial PDFs from Standard Bank, FNB, Capitec, ABSA, Nedbank, and international banks. Preserves date, description, debit, credit, and balance columns—with automatic math verification.
  * *Action Link:* `Try Bank Statement Converter →`

* **Row 3: Fast, Private, and In-Browser (Left text, Right graphic)**
  * *H3:* Your documents, your business.
  * *Body:* Everyday tools run directly inside your browser. Your sensitive personal documents don't need to be uploaded to a random cloud server just to merge two pages.
  * *Action Link:* `Learn about our privacy →`

---

### 4.5 Plans & Pricing (Clean 2-Card Preview)
* **Headline:** Simple, fair pricing.
* **Subtitle:** Free for everyday tasks. Upgrade to Pro when your business needs unlimited statement conversions.
* **Two Cards:**
  * **Free Plan:** 3 tasks/day • Core PDF tools • 100% in-browser • `[ Start Free ]`
  * **Pro Plan:** Unlimited operations • Bank Statement to Excel parser • Advanced OCR • Batch queue • `[ Upgrade to Pro ]`
* *Link: "Compare all plan features →"*

---

### 4.6 Why Choose Prism File Hero? (4-Pillar Trust Grid)
1. **Runs in Your Browser:** Core tools run locally on your device for maximum speed and privacy.
2. **Reconciled Financial Data:** Our statement parser verifies that debits and credits match before you export.
3. **No Bloatware:** No desktop installation required; open your browser and get straight to work.
4. **Fair Freemium:** Start your first task instantly with zero account required.

---

### 4.7 FAQs & Bottom CTA
* **FAQ 1:** Can I use Prism File Hero without an account? (1st task free, then free sign-in).
* **FAQ 2:** Are my files kept private? (In-browser execution for core tools, memory-only for server tools).
* **FAQ 3:** Which banks are supported? (Standard Bank, FNB, Capitec, ABSA, Nedbank, TymeBank, and universal layouts).
* **FAQ 4:** What happens when I hit my daily free quota? (Resets every 24 hours, or upgrade to Pro for unlimited).
* **Final Banner:** *"Ready to sort your documents?"* `[ Try Prism File Hero Free ]`

---

## 5. SEO Architecture & First 10 Dedicated Tool Pages

Each dedicated tool page mirrors Smallpdf's high-converting structure: **working tool widget right at the top**, followed by high-intent how-to guides and FAQs below.

| Route | Primary Keyword / Intent | H1 | Unique Value & Intent Hook |
| :--- | :--- | :--- | :--- |
| `/merge-pdf` | Merge PDF online free | Merge PDF Files Online | Reorder pages visually before merging; 100% in-browser security for sensitive contracts. |
| `/split-pdf` | Split PDF pages | Split PDF Pages Online | Visual page picker with custom range extraction (`1-3, 5, 8`) and zip export. |
| `/compress-pdf` | Compress PDF file | Compress PDF Document | Instant size estimation slider (Low, Medium, Extreme) with clean typography retention. |
| `/pdf-to-word` | Convert PDF to Word editable | Convert PDF to Word (DOCX) | High-fidelity table and heading preservation without scrambled text boxes. |
| `/pdf-to-excel` | Convert PDF table to Excel | Convert PDF to Excel Spreadsheet | Automatic column and row detection; exports to `.xlsx` and `.csv`. |
| `/bank-statement-to-excel` | Bank statement to Excel converter | Convert Bank Statement PDF to Excel (.xlsx) | Tailored parsers for South African banks (SBSA, FNB, Capitec, ABSA, Nedbank, TymeBank) + automated balance reconciliation math. |
| `/jpg-to-pdf` | Convert JPG to PDF | Convert JPG & Images to PDF | Multi-image collage, orientation correction, and standard A4 packaging. |
| `/pdf-to-jpg` | Convert PDF to JPG images | Convert PDF Pages to High-Res JPG | Extract single pages or full document image galleries in zip format. |
| `/redact-pdf` | Redact PDF online free | Redact Sensitive Information in PDF | Permanent sanitization removing underlying vector text streams (not decorative black rectangles). |
| `/ocr-pdf` | OCR PDF searchable | Make Scanned PDFs Searchable (OCR) | Dual-layer OCR generating selectable, copyable text over scanned pages. |

---

## 6. Implementation Architecture

1. **Routing (`App.tsx`):**
   * Top-level clean paths (`/`, `/merge-pdf`, `/compress-pdf`, `/bank-statement-to-excel`, `/pricing`).
   * `/` renders the revamped Smallpdf-style homepage.
2. **Homepage Component (`src/components/views/HomeView.tsx` or revamped `ToolDashboard.tsx`):**
   * Header with Tools Mega Menu & Pricing.
   * Hero with primary CTAs.
   * 6 Popular Tool cards with color-coded icons that immediately launch or route.
   * Expandable 37-tool drawer for full catalog access.
   * 3 alternating feature showcase sections.
   * 2-card transparent pricing preview.
   * 4-pillar trust grid + FAQ + footer.
3. **Working Tool Pages (`ToolLandingView.tsx`):**
   * Embeds the actual active tool runner right at the top so visitors can drag & drop immediately, backed by rich SEO metadata and guides below.
