# Prism File Hero Web Interface Compliance Design

**Date:** 2026-09-09
**Status:** Approved for implementation planning

## Objective

Resolve the complete 2026-09-09 Web Interface Guidelines audit across the public web app and internal desktop shell while preserving the current visual identity, document-processing behavior, subscription behavior, and deployment state.

## Constraints

- Do not deploy or push any change to production without explicit user approval.
- Preserve existing tool execution, quota, authentication, file handling, and native-platform behavior.
- Avoid new runtime dependencies when platform APIs and existing React Router utilities are sufficient.
- Implement behavioral changes test-first and retain the existing Vitest and Testing Library stack.
- After source changes are written and re-read from disk, synchronize every modified file into `complete source code with updates.md` using complete verbatim source blocks.

## Architecture

### Shared accessibility utilities

Create focused utilities rather than duplicating behavior across large components:

- `src/hooks/useReducedMotion.ts` reports the current `prefers-reduced-motion` media-query value and reacts to preference changes.
- `src/utils/scroll.ts` exposes reduced-motion-aware scrolling helpers used by the app shell and dashboard.
- `src/hooks/useAccessibleDialog.ts` provides Escape dismissal, initial focus, focus restoration, and Tab focus containment for modal surfaces.
- `src/utils/appUrlState.ts` parses and updates `/app` query state with typed keys and omission of default values.

These utilities have no service, storage, or network dependencies.

### URL-backed application state

The `/app` route will encode shareable navigation state:

- `tool=<tool-id>` selects a processing tool.
- `view=history` opens extraction history.
- `category=<category>` filters the tool directory.
- `tab=<statement|merge|split|edit>` selects the workbench tab.
- `tools=all` expands the complete tool directory.
- `q=<search>` stores the tool search query.
- `faq=<index>` stores the expanded dashboard FAQ.
- `page=<number>` and `record=<id>` store history pagination and selected detail.

Primary destinations—tool selection and history—push browser history. Transient controls—search, category, tab, directory expansion, pagination, record selection, and FAQ expansion—replace the current history entry. Invalid values fall back to existing defaults and are removed on the next URL update.

Dedicated SEO tool routes remain unchanged. When a landing-page upload transfers the user to `/app`, it includes the selected tool query parameter.

### Semantic navigation and interaction

Controls that change location or select an application destination become React Router links. Controls that perform actions remain buttons. Interactive page cards and table rows gain native button controls or equivalent keyboard-operable semantics where table structure must be preserved.

The workbench tab strip receives `tablist`, `tab`, `aria-selected`, roving keyboard behavior, and stable panel IDs. FAQ triggers receive `aria-expanded`, `aria-controls`, and matching answer IDs. Popovers expose expanded state and use native trigger buttons.

### Dialog behavior

Authentication, upgrade, quota, and edit overlays receive:

- `role="dialog"` and `aria-modal="true"`;
- stable title IDs connected through `aria-labelledby`;
- Escape dismissal;
- initial focus, focus containment, and trigger-focus restoration;
- `overscroll-behavior: contain` on the scrollable overlay;
- semantic backdrop buttons with accessible labels where backdrop dismissal is supported.

The mobile navigation drawer follows the same overlay and keyboard principles and is named as a navigation dialog.

### Forms and asynchronous feedback

Every editable control receives a stable `name`. Text-like non-authentication fields use intentional autocomplete values, generally `off`; the support email uses `email`. Email/code fields disable spellcheck where appropriate. Example placeholders end in an ellipsis and use curly quotation marks.

Loading, processing, error, and completion messages receive suitable `role="status"`, `role="alert"`, or `aria-live` semantics. Submission errors focus an alert summary or the first invalid control. Queue status changes are announced without making decorative spinners independently focusable.

### Motion, touch, theme, and layout

- Replace every `transition-all` with explicit color, opacity, transform, shadow, or border transitions.
- JavaScript scrolling uses instant behavior when reduced motion is requested.
- `GlitterWrap` switches to its static rendering path under reduced motion.
- Add global `touch-action: manipulation` and intentional tap-highlight styling.
- Add `color-scheme` declarations and keep the document `theme-color` synchronized with light/dark state.
- Fixed mobile navigation and full-bleed overlays consume safe-area inset values.
- Modal and drawer scroll containers contain overscroll.

### Images, content resilience, and rendering limits

The brand image receives intrinsic dimensions and high fetch priority when used above the fold. Generated PDF thumbnails receive dimensions and lazy loading. Dynamic notification and error text can wrap safely.

Editable extraction tables and history detail tables render at most 50 rows per page. Existing pagination/download behavior preserves access to the complete dataset without adding a virtualization dependency.

### Typography and heading structure

Loading copy uses the ellipsis character. Visible straight quotation marks become typographic quotation marks where they are prose rather than syntax. Page-level views contain one `<h1>`, lower headings follow hierarchy, and display headings use balanced or pretty wrapping. Anchored sections use scroll margins sufficient for the sticky header.

## Component Scope

Expected source changes include:

- Shell and global presentation: `App.tsx`, `index.html`, `index.css`, `Prism File Hero Desktop/index.html`.
- Shared behavior: new reduced-motion, dialog, scrolling, and URL-state utilities.
- Modal and form surfaces: `AuthModal.tsx`, `UpgradeModal.tsx`, `QuotaExceededModal.tsx`, `EditModal.tsx`, `BugReportForm.tsx`, `InternalActivationGate.tsx`.
- Data interaction: `HistoryDashboard.tsx`, `ExtractionReview.tsx`, `TransactionRow.tsx`, `PDFPageGrid.tsx`, `TableAlignmentReview.tsx`, `ProcessingView.tsx`.
- Navigation and discovery: `ToolSidebar.tsx`, `MobileBottomNav.tsx`, `HeaderMegaMenu.tsx`, `ToolDashboard.tsx`, `ToolLandingView.tsx`, `UsageBadge.tsx`.
- Shared visuals: `Icon.tsx`, `Brand.tsx`, `BentoCard.tsx`, `GlitterWrap.tsx`, and heading/transition fixes in home-section components.

## Error Handling

- Invalid URL query values never throw; they resolve to defaults.
- Dialog hooks tolerate missing focusable children and disconnected trigger elements.
- Media-query listeners support the modern `addEventListener` API with a compatibility fallback.
- URL changes do not clear active file batches unless the user explicitly leaves the selected tool, matching current behavior.
- Existing service errors remain visible and additionally become accessible to assistive technology.

## Testing Strategy

Use Vitest and Testing Library with focused red-green cycles:

1. Unit-test URL parsing, serialization, invalid-value fallback, push-versus-replace intent, and reduced-motion scroll selection.
2. Test modal roles, accessible names, Escape dismissal, initial focus, focus containment, and restoration.
3. Test keyboard activation and accessible names for page tiles, history records, table rows, icon buttons, and divider controls.
4. Test workbench tabs, FAQ relationships, popover expanded state, form names/autocomplete, and live regions.
5. Test URL-backed dashboard/history state and landing-page transfer URLs.
6. Add static regression checks for forbidden `transition-all`, visible triple-dot loading copy, missing image dimensions, and required global safe-area/theme rules.
7. Run the complete Vitest suite and `npm run build` after focused tests pass.

## Acceptance Criteria

- Every actionable finding from the 2026-09-09 audit is either fixed or documented with a verified codebase-specific reason for exclusion.
- Keyboard-only users can reach, identify, activate, and dismiss every interactive UI reviewed.
- Modal focus cannot escape while a modal is open and returns to the invoking control after close.
- Reduced-motion users receive no smooth scrolling or perpetual canvas animation.
- `/app` navigation/filter state is restorable by reload and shareable by URL.
- No source UI file contains `transition-all` or visible loading copy using three periods.
- All modified source files are re-read from disk before tracking-file synchronization.
- Focused tests, the full test suite, and the production build complete successfully.
- No deployment, production push, or remote release action occurs.
