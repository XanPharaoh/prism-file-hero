# Prism File Hero — Homepage Revamp & SEO Architecture Specification

**Date:** 2026-09-03  
**Status:** Approved by User  
**Target Domain:** `prismfilehero.com`

---

## 1. Positioning & Conversion Intent

* **Single-Sentence Positioning Statement:**  
  *Prism File Hero is a calm, reliable document companion for office workers, students, teachers, and bookkeepers that solves everyday PDF tasks in seconds and cleanly converts bank statements into reconciled spreadsheets—with fair freemium limits and zero deceptive marketing.*

* **Primary Conversion Action:**  
  *Dropping a file directly into the clean hero workbench surface or clicking a Quick Strip tool (Merge, Compress, Convert, Sign) with instant 1-click execution.*

---

## 2. Ruthless Deletion List (Killing the AI Slop)

The following elements from the previous iteration are permanently removed:

| Element to Delete | Why It Is Being Removed |
| :--- | :--- |
| **Fabricated Testimonials** | Fake CA(SA) and bookkeeper reviews ("Rohan Govender", "Danielle van der Merwe", etc.) destroy trust. Replaced with authentic product capability and verifiable results. |
| **Simulated Live Dashboard** | Fake progress card pretending Chase/Wells Fargo statements are processing in real time. Deceptive and gimmicky. |
| **Exaggerated Claims** | "500+ banks recognised", "0 row errors in 18 months", "Trusted by hundreds of accounting firms". |
| **Giant 3-Column Homepage Pricing Matrix** | Clutters the top conversion path. Pricing is relocated to the Header Mega Menu and a dedicated `/pricing` view. |
| **The 37-Card Catalog Wall** | Causes severe choice overload. Replaced with the 6-tool Quick Strip on the homepage and a well-structured Mega Menu + Search. |
| **Buzzword Security Theater** | Jargon like "AES-256 deterministic parsing geometry" replaced with clear, truthful statements. |

---

## 3. Account Access & Quota Model

No false "100% free forever" claims. The platform operates on a transparent, dignified freemium ladder:

```
[ Visitor / Guest ]
  │
  ├── 1 Free Standard Task (No account, no credit card)
  │   - Experience immediate value with zero friction
  │   - All Pro features locked
  │
  ▼ (Prompts Free Sign-In on 2nd Task)
[ Freemium Member (Signed In) ]
  │
  ├── 3 Standard Operations / Day (24-Hour Rolling Quota)
  │   - Clear daily counter & reset countdown in account panel
  │   - Perfect for students, teachers, and casual office workers
  │   - All Pro features locked
  │
  ▼ (Optional Upgrade for Heavy Work)
[ Pro Tier (Paid Subscription) ]
  │
  └── Unlimited Standard Operations + Full Pro Feature Access
      - Bank Statement to Excel extraction (SBSA, FNB, Capitec, ABSA, Nedbank, TymeBank, Universal)
      - Multi-page OCR for scanned/photo PDFs
      - High-volume batch processing queue
      - QuickBooks, Xero & Sage formatted exports
```

---

## 4. Visual Identity & Design Tokens ("The Paper Desk")

The aesthetic shifts from dark cyberpunk/neon gradients to a clean, tactile physical stationery feel:

* **Surfaces & Backgrounds:**
  * Background: Warm off-white / light paper tone (`#FBFBFA` light / `#121417` dark)
  * Cards / Workbench: Crisp white (`#FFFFFF` light / `#1A1D21` dark)
  * Borders: Hairline 1px border (`#E7E7EB` / `border-stone-200`)
  * Shadows: Restrained, functional elevation (`shadow-xs`, `shadow-sm`)
* **Color Roles:**
  * **Ink / Headings:** Deep graphite (`#18191B` / `#F3F4F6`)
  * **Body Text:** Muted dark slate (`#4B5563` / `#9CA3AF`)
  * **Primary Accent:** Calm Prism Navy (`#2A3A60` or `#354AC4`) for primary CTAs and active states
  * **Success / Complete:** Quiet forest green (`#16794C`) strictly for verified outputs and completed tasks
* **Typography:**
  * Headings: Confident humanist sans (e.g. *Plus Jakarta Sans* / *Outfit*) with natural character, tight tracking
  * UI / Body: Neutral system sans with tabular numbers for file sizes and page counts
* **Motion:**
  * Snappy 150ms ease transitions; zero ambient floating cards or pulsing background blobs.

---

## 5. Homepage Layout & Section Specification

### 5.1 Header & Mega Menu
* **Brand:** Minimalist `Prism File Hero` logo.
* **Navigation Links:**
  * **Tools (Mega Menu):** Categorized dropdown with 4 clean columns:
    * *Organize:* Merge PDF, Split PDF, Rotate, Delete Pages, Reorder Pages, Extract Pages
    * *Convert:* PDF to Word, PDF to Excel, JPG to PDF, PDF to JPG, Text to PDF
    * *Optimize & Secure:* Compress PDF, Redact PII, Protect PDF, Unlock, Watermark
    * *Financial:* Bank Statement to Excel (Pro)
  * **Bank Statements:** Direct link to the dedicated `/bank-statement-to-excel` workflow.
  * **Pricing:** Direct link to the dedicated pricing modal/page.
* **Auth Controls:**
  * Unauthenticated: "Sign In" link + "Get Started" button.
  * Authenticated: Compact Usage Badge (e.g., "2/3 free tasks today") + Account Avatar.

### 5.2 Hero Section (The Everyday Workbench)
* **Eyebrow:** *Private, in-browser document tools*
* **Headline:** **Your Everyday Document Companion.**
* **Subtitle:** *Merge, compress, convert, and sign your PDFs right in your browser. Fast, private, and ready when you are.*
* **Quick Strip (Above/Within Dropzone):**
  * `[ Merge PDF ]` • `[ Compress PDF ]` • `[ PDF to Word ]` • `[ Sign & Redact ]` • `[ Statement to Excel (Pro) ]`
* **Workbench Drop Area:**
  * Clean, inviting drop surface: *"Drop your file here, or browse from your computer"*.
  * Accepts PDF, JPG, PNG up to 50MB.
  * Sub-note: *"First task is free with zero sign-up required."*
* **Truthful Privacy Callout:**
  * *"Everyday PDF tools run right on your computer. When advanced tools require our servers, files are processed in memory and deleted the moment you're done."*

### 5.3 Quick-Access Tool Grid
* A curated 8-tool grid for instant access:
  1. **Merge PDF** — Combine multiple documents into one.
  2. **Split PDF** — Extract pages or split into chapters.
  3. **Compress PDF** — Reduce file size for email or uploads.
  4. **PDF to Word** — Convert read-only PDFs into editable DOCX.
  5. **PDF to Excel** — Turn document tables into spreadsheets.
  6. **JPG to PDF** — Turn photos and scans into clean documents.
  7. **Redact PDF** — Black out sensitive personal details permanently.
  8. **Sign PDF** — Add signature and date stamp.
* Includes a search bar (*"Find any tool..."*) and a *"View all 37 tools"* trigger that opens the full categorized directory.

### 5.4 The Subtle Bank Statement Spotlight
Positioned tastefully below the everyday tools:
* **Headline:** *"Also built for tricky financial PDFs: Bank statements into tidy spreadsheets."*
* **Body:** *"Turn PDF statements from Standard Bank, FNB, Capitec, ABSA, Nedbank, TymeBank, and international banks into clean Excel files where debits, credits, and balances reconcile."*
* **CTA:** `[ Explore Bank Statement Converter → ]` (routes directly to `/bank-statement-to-excel`).

### 5.5 Honest FAQ
1. **Can I try it without an account?**  
   *Yes. Your first standard task is 100% free with zero registration. To continue using everyday tools with your daily free quota, simply create a free account.*
2. **Do my documents stay private?**  
   *Everyday tools process files directly inside your browser. For advanced tasks that require server processing, files are handled in memory and deleted immediately after conversion. We never store or sell your data.*
3. **What is included in the free tier?**  
   *Free accounts receive 3 daily document operations that reset every 24 hours. High-volume statement parsing and heavy batch jobs require a Pro plan.*
4. **Which bank statements are supported?**  
   *Dedicated extractors exist for Standard Bank, FNB, Capitec, Nedbank, ABSA, and TymeBank, plus universal table extraction for international banks.*

---

## 6. SEO Architecture & Dedicated Tool Pages

To capture high-intent organic traffic and prevent bounce rates, the top 10 tool jobs are given dedicated, indexable landing pages. Each page features **the live, working tool at the top of the viewport**, followed by high-quality intent-matched content below.

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

### Technical SEO Requirements
* **Clean URLs:** Directly accessible at `/merge-pdf`, `/compress-pdf`, etc., replacing `/tools/:toolId` redirection hops.
* **Pre-rendered Metadata:** Server/SSR or pre-rendered `<title>`, `<meta name="description">`, and `canonical` tags via `SEOHelmet`.
* **Structured Data:** Valid JSON-LD schema on each tool page (`SoftwareApplication` and genuine `HowTo` steps).
* **Internal Linking:** Every tool page links to 3 related tools (e.g. Merge links to Split and Compress).
* **Conversion Hook:** Immediate dropzone on page load allows users to solve their search intent in one click.

---

## 7. Implementation Plan Overview

* **Phase 1: Component Refactoring**
  * Strip obsolete code from `ToolDashboard.tsx` (delete testimonials, fake live dashboard, 3-column pricing table).
  * Build the new `HeaderMegaMenu` component with categorized tool links and pricing.
  * Implement the streamlined `HeroWorkbench` with Quick Strip.
* **Phase 2: Freemium Quota Enforcement**
  * Update `edgeEnforcement.ts` and `usageTrackingService.ts` to strictly handle Guest (1 free standard task), Freemium (3 tasks/day), and Pro gating.
* **Phase 3: Dedicated SEO Tool Pages**
  * Create dedicated routes in `App.tsx` (`/merge-pdf`, `/compress-pdf`, `/bank-statement-to-excel`, etc.) loading the live tool directly.
  * Enrich each tool page with unique H1, intent-focused guides, FAQs, and JSON-LD schema.
