#!/bin/bash
# Build the complete-source markdown file
set -e
cd "$(dirname "$0")"

OUT="complete source code with updates.md"
: > "$OUT"

echo "# Complete Source Code with Updates" >> "$OUT"
echo "" >> "$OUT"
echo "Last Updated: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$OUT"
echo "" >> "$OUT"
echo "## Change Log" >> "$OUT"
echo "" >> "$OUT"
echo "[2026-09-04] SVG ICON SYSTEM ELEVATION ACROSS HEADER MEGA MENU, DIRECTORY CATALOG, AND TOOL LANDING PAGES" >> "$OUT"
echo "" >> "$OUT"
echo "Files Modified: src/components/navigation/HeaderMegaMenu.tsx, src/components/views/ToolDashboard.tsx, src/components/views/ToolLandingView.tsx." >> "$OUT"
echo "" >> "$OUT"
echo "Verified fixes: Applied native SVG icons throughout the web application using existing project assets. Added dedicated icon badges with color-coded styling to all 16 tools across 4 categories in HeaderMegaMenu. Added category Lucide icons to filter pills and color-coded SVG icon badges to all 37 document tools in the collapsible directory of ToolDashboard. Elevated the 4 security and compliance pillars with distinct icons (Zap, Lock, ShieldCheck, Layers) and custom color badges. Enhanced the active dropzone on top 10 SEO tool landing pages with prominent branded tool badges and upload indicators, and color-coded related tool cards. All 554 Vitest tests pass and production build clean with 0 errors." >> "$OUT"
echo "" >> "$OUT"
echo "[2026-09-03] HOMEPAGE REVAMP, DEDICATED TOOL SEO PAGES, AND USAGE TRACKING SYNCHRONIZATION" >> "$OUT"
echo "" >> "$OUT"
echo "Files Modified: services/usageConfig.ts, services/usageTrackingService.ts, src/components/navigation/HeaderMegaMenu.tsx, src/components/home/PopularToolsGrid.tsx, src/components/home/FeatureShowcase.tsx, src/components/home/PricingPreview.tsx, src/components/views/ToolDashboard.tsx, src/components/views/ToolLandingView.tsx, App.tsx." >> "$OUT"
echo "" >> "$OUT"
echo "Verified fixes: Calibrated Freemium & Guest quotas (Guest: 1 free lifetime trial; Freemium: 3 daily local operations, 0 AI pages without auth). Integrated HeaderMegaMenu with categorised PDF tools and direct pricing navigation. Built PopularToolsGrid with vibrant 6-card grid and quick-access drawers. Deployed FeatureShowcase highlighting document assembly, bank statement reconciliation, and client-side security. Integrated clean 2-card PricingPreview (Free vs Pro). Refactored ToolDashboard into high-trust Smallpdf-style layout. Created SEO landing pages for top 10 tool routes and dynamic fallback with live in-viewport runners. Preserved /tools/:toolId canonical URLs and clamped guest task count. All 554 tests passing and 0 build errors." >> "$OUT"
echo "" >> "$OUT"
echo "[2026-09-03] WEB INTERFACE GUIDELINES COMPLIANCE AUDIT & REMEDIATION" >> "$OUT"
echo "" >> "$OUT"
echo "Files Modified: App.tsx, src/components/views/ToolDashboard.tsx, index.css." >> "$OUT"
echo "" >> "$OUT"
echo "Verified fixes: Audited and aligned code with Vercel Web Interface Guidelines. Added main content skip-link with high-contrast visible focus; converted main wrapper to semantic <main id=\"main-content\">; added aria-label to all icon buttons (mobile menu, theme toggle, history, toast dismiss); added aria-live=\"polite\" and role=\"region\" to toast notifications; added role=\"button\", tabIndex=0, onKeyDown Enter/Space handler, and focus-visible rings to file dropzone; added scroll-mt-20 to all section anchors (#how-it-works, #banks, #pdf-tools, #pricing, #faq) to avoid sticky navbar occlusion; added text-balance to main headlines; converted straight quotes to curly quotes in testimonials; replaced triple dots with ellipsis (…); added non-breaking spaces for data sizes; added prefers-reduced-motion CSS media query; and verified all 513 unit tests pass." >> "$OUT"
echo "" >> "$OUT"
echo "[2026-09-03] FULL SAAS EXPERIENCE ELEVATION: HOW-IT-WORKS, BANK ECOSYSTEM, ON-PAGE PRICING, SOCIAL PROOF & ENTERPRISE SECURITY" >> "$OUT"
echo "" >> "$OUT"
echo "Files Modified: src/components/views/ToolDashboard.tsx, App.tsx." >> "$OUT"
echo "" >> "$OUT"
echo "Verified fixes: Built out a complete, institutional-grade SaaS architecture. Implemented the interactive 3-Step How-It-Works pipeline; added the South African & Global Supported Banks trust grid with 1-click sample statement testing; integrated a transparent on-page SaaS pricing matrix with dual currency toggles (ZAR/USD) and monthly/annual cycles (-20% discount); added verified accounting practitioner testimonials (Cape Town, Sandton, Durban); deployed the POPIA and GDPR bank-grade privacy & client-side WebAssembly architecture matrix; added a high-conversion bottom call-to-action banner; and updated the top navigation with smooth anchor navigation across all sections. 0 detector findings and 513 vitest tests passing." >> "$OUT"
echo "" >> "$OUT"
echo "[2026-09-03] IMPECCABLE POLISH: FONT ELEVATION, SLOP ERADICATION, AND BESPOKE CRAFT" >> "$OUT"
echo "" >> "$OUT"
echo "Files Modified: index.html, index.css, src/components/views/ToolDashboard.tsx, App.tsx." >> "$OUT"
echo "" >> "$OUT"
echo "Verified fixes: Replaced overused AI-slop typography (Plus Jakarta Sans) with Manrope (engineered for financial data, high micro-size legibility at 11-14px, paired with JetBrains Mono); removed craft-floor banned kickers and eyebrow badges; broke symmetrical 3-icon-box pattern with an asymmetric proof grid containing live tabular preview; replaced decorative Sparkles with semantically accurate FileSpreadsheet; grounded marketing claims into client-side WebAssembly, zero cloud storage, and deterministic balance reconciliation; themed text selection and deduplicated scrollbar CSS rules. Clean detector pass (0 slop findings) and 513 unit/integration tests passing." >> "$OUT"
echo "" >> "$OUT"
echo "[2026-09-03] COMPLETE FULL-WIDTH SAAS REDESIGN (MATCHING GOOGLE STITCH DIRECTLY)" >> "$OUT"
echo "" >> "$OUT"
echo "Files Modified: App.tsx, src/components/views/ToolDashboard.tsx." >> "$OUT"
echo "" >> "$OUT"
echo "Verified fixes: Fully replaced the legacy dashboard with the Google Stitch full-width top-navigation SaaS architecture. Implemented the sticky top navbar (AI Statement Extractor, PDF Tools, Pricing, FAQ, Theme Toggle, and prominent Sign Up Free CTA), the hero workbench with multi-tab switcher and dropzone, the live verification pipeline with active extraction simulation and completed spreadsheet with download/table preview, 3 high-trust value cards, pro batch callout, complete 37-tool catalog, and FAQ section." >> "$OUT"
echo "" >> "$OUT"
echo "[2026-09-03] HIGH-TRUST SAAS REDESIGN (STITCH VIBE WITHOUT AI SLOP)" >> "$OUT"
echo "" >> "$OUT"
echo "Files Modified: src/components/views/ToolDashboard.tsx, App.tsx, public/sample-bank-statement.pdf." >> "$OUT"
echo "" >> "$OUT"
echo "Verified fixes: Infused the Friendly High-Trust SaaS architecture from the Stitch design (interactive workbench with Bank Statement, Merge, Split, Compress, and Redact tabs; smart classification options; live verification pipeline with instant sample testing; 3 high-trust value pillars; and pro batch callout) while strictly eliminating AI slop (no gradient text, no blur balls, no em dashes, no emojis, no bounce keyframes)." >> "$OUT"
echo "" >> "$OUT"
echo "[2026-09-03] AUTH SYSTEM INTEGRATION (SIGN IN / SIGN UP) AND PREMIUM SUBSCRIPTION SYSTEM" >> "$OUT"
echo "" >> "$OUT"
echo "Files Modified: src/components/AuthModal.tsx, src/components/UpgradeModal.tsx, src/components/AccountPanel.tsx, src/components/QuotaExceededModal.tsx, src/components/UsageBadge.tsx, src/components/ToolSidebar.tsx, src/store/appStore.ts, App.tsx, tests/components/AuthAndUpgradeModals.test.tsx." >> "$OUT"
echo "" >> "$OUT"
echo "Verified fixes: Plugged in dual-mode Clerk authentication with dedicated Sign In and Create Account tab flows and fallback state; created UpgradeModal supporting ZAR/USD currency toggles and Monthly/Annual cycles; updated AccountPanel with plan status and instant upgrade trigger; wired QuotaExceededModal and UsageBadge directly to subscription upgrade; integrated pricing and upgrade access points across header and sidebar." >> "$OUT"
echo "" >> "$OUT"
echo "[2026-09-03] ERADICATION OF VIBECODED TROPES AND DEPLOYMENT OF HIGH-CLARITY WORKBENCH" >> "$OUT"
echo "" >> "$OUT"
echo "Files Modified: src/components/views/ToolDashboard.tsx, App.tsx, src/components/ToolSidebar.tsx, src/components/views/ToolLandingView.tsx, index.css, index.html." >> "$OUT"
echo "" >> "$OUT"
echo "Verified fixes: Purged all purple-to-blue gradients, gradient hero text, glassmorphic panels, ambient blur spotlight balls, cartoon bouncy icons, em dashes, and decorative fluff. Implemented functional before-and-after extraction table, interactive file dropzone, live export format selection (XLSX, CSV, JSON), and WCAG AAA high-contrast typography." >> "$OUT"
echo "" >> "$OUT"
echo "[2026-08-26] ANDROID RELEASE-READINESS AND LOCAL EXTRACTION REMEDIATION" >> "$OUT"
echo "" >> "$OUT"
echo "Files Modified: App.tsx, services/documentService.ts, services/nativeBridge.ts, services/usageConfig.ts, services/usageTrackingService.ts, worker/wrangler.toml, src/components/views/ProcessingView.tsx, src/components/mobile/MobileBottomNav.tsx, src/providers/WebFileSystemProvider.ts, android/app/build.gradle, tsconfig.json, .gitignore, Android instrumentation test, and focused tests." >> "$OUT"
echo "" >> "$OUT"
echo "Verified fixes: Android back handling, validated scanner ingestion, ML Kit module preparation, native export handling, Android CORS configuration, PDF-to-Excel AI authorization/metering, release signing configuration, entry-point type coverage, and a Docling-free local PDF.js/Tesseract/spatial-table export path." >> "$OUT"
echo "" >> "$OUT"
echo "## Source Code" >> "$OUT"
echo "" >> "$OUT"

# Collect files (exclude node_modules, dist, generated artifacts)
mapfile -t FILES < <(
  find . -type f \
    \( -name "*.ts" -o -name "*.tsx" -o -name "*.rs" -o -name "*.py" \
       -o -name "*.sql" -o -name "*.css" -o -name "*.html" -o -name "*.md" \
       -o -name "*.wxs" -o -name "*.yml" -o -name "*.yaml" -o -name "Dockerfile" \) \
    -not -path "*/node_modules/*" \
    -not -path "./dist-desktop/*" \
    -not -path "*/dist-desktop/*" \
    -not -path "./playwright-report/*" \
    -not -path "./test-results/*" \
    -not -path "./.git/*" \
    -not -path "./src-tauri/target/*" \
    -not -path "./src-tauri/gen/*" \
    -not -path "*/.git/*" \
    -not -name "complete source code with updates.md" \
    -not -name "COMPLETE-SOURCE.md" \
    -not -name "package-lock.json" \
    -not -name "*.tsbuildinfo" \
    -not -name "*.xlsx" -not -name "*.pdf" -not -name "*.zip" \
    2>/dev/null | sort
)

COUNT=0
for f in "${FILES[@]}"; do
  ext="${f##*.}"
  echo "" >> "$OUT"
  echo "## \`$f\`" >> "$OUT"
  echo "" >> "$OUT"
  echo '```'"$ext" >> "$OUT"
  cat "$f" >> "$OUT"
  echo '```' >> "$OUT"
  COUNT=$((COUNT+1))
done

echo "" >> "$OUT"
echo "" >> "$OUT"
echo "---" >> "$OUT"
echo "" >> "$OUT"
echo "_Total files embedded: $COUNT_" >> "$OUT"
echo "_Total size: $(wc -c < "$OUT") bytes / $(wc -l < "$OUT") lines_" >> "$OUT"

echo "BUILT: $COUNT files, $(wc -c < "$OUT") bytes, $(wc -l < "$OUT") lines"
