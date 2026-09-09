# Web Interface Compliance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve every actionable finding in the approved 2026-09-09 Web Interface Guidelines audit while preserving Prism File Hero’s behavior, visual identity, and deployment state.

**Architecture:** Four dependency-free shared utilities centralize URL parsing, reduced-motion decisions, scrolling, and modal focus behavior. App and dashboard state consume those utilities; existing components retain their styling and business logic while receiving semantic HTML, accessible state, resilient text/layout behavior, and explicit transitions.

**Tech Stack:** React 19, TypeScript 5.8, React Router 7, Zustand 5, Tailwind CSS 4, Vitest 4, Testing Library, Vite 6.

**Spec:** `docs/superpowers/specs/2026-09-09-web-interface-compliance-design.md`

## Global Constraints

- Do not deploy or push any change to production without explicit user approval.
- Preserve existing tool execution, quota, authentication, file handling, and native-platform behavior.
- Add no runtime dependencies.
- Write and run a failing behavioral test before each production behavior change.
- Re-read every changed source file before synchronizing its complete verbatim block into `complete source code with updates.md`.
- Keep dedicated SEO tool routes unchanged.
- Render no more than 50 editable or history-detail rows at once while preserving complete download/export access.

---

### Task 1: URL State, Reduced Motion, and Scrolling Utilities

**Files:**
- Create: `src/utils/appUrlState.ts`
- Create: `src/hooks/useReducedMotion.ts`
- Create: `src/utils/scroll.ts`
- Modify: `src/hooks/index.ts`
- Create: `tests/appUrlState.test.ts`
- Create: `tests/components/useReducedMotion.test.tsx`
- Create: `tests/scroll.test.ts`
- Modify: `complete source code with updates.md`

**Interfaces:**
- Produces: `AppUrlState`, `parseAppUrlState(search)`, `updateAppUrlState(search, patch)`, `appUrlFor(patch)`, and `UrlUpdateMode`.
- Produces: `useReducedMotion(): boolean`.
- Produces: `getScrollBehavior(reducedMotion): ScrollBehavior`, `scrollToTop(reducedMotion)`, and `scrollElementIntoView(element, reducedMotion)`.

- [ ] **Step 1: Write failing URL-state tests**

```ts
expect(parseAppUrlState('?tool=merge&view=history&tab=split&page=3')).toEqual({
  tool: 'merge', view: 'history', tab: 'split', page: 3,
  category: 'All', tools: 'featured', q: '', faq: null, record: null,
});
expect(parseAppUrlState('?tab=invalid&page=-4&faq=nope').tab).toBe('statement');
expect(updateAppUrlState('?tool=merge&q=tax', { q: '', tab: 'edit' })).toBe('?tool=merge&tab=edit');
expect(appUrlFor({ tool: 'split' })).toBe('/app?tool=split');
```

- [ ] **Step 2: Run URL-state tests and confirm failure because the module does not exist**

Run: `npx vitest run tests/appUrlState.test.ts`
Expected: FAIL resolving `src/utils/appUrlState`.

- [ ] **Step 3: Implement typed parsing and default-omitting serialization**

```ts
export type DashboardTab = 'statement' | 'merge' | 'split' | 'edit';
export type AppUrlPatch = Partial<AppUrlState>;
export type UrlUpdateMode = 'push' | 'replace';

export function parseAppUrlState(search: string): AppUrlState;
export function updateAppUrlState(search: string, patch: AppUrlPatch): string;
export function appUrlFor(patch: AppUrlPatch): string;
```

Validate tool IDs with `getToolById`, accept only the four tab values, coerce positive integer page values, and omit `All`, `featured`, empty search, null FAQ/record, and page `1` from serialized URLs.

- [ ] **Step 4: Run URL-state tests and confirm pass**

Run: `npx vitest run tests/appUrlState.test.ts`
Expected: PASS.

- [ ] **Step 5: Write failing reduced-motion and scrolling tests**

```tsx
render(<Probe />);
expect(screen.getByTestId('motion')).toHaveTextContent('false');
act(() => mediaQuery.dispatch(true));
expect(screen.getByTestId('motion')).toHaveTextContent('true');

expect(getScrollBehavior(false)).toBe('smooth');
expect(getScrollBehavior(true)).toBe('auto');
scrollElementIntoView(element, true);
expect(element.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
```

- [ ] **Step 6: Run motion tests and confirm failure because the hook/helpers do not exist**

Run: `npx vitest run tests/components/useReducedMotion.test.tsx tests/scroll.test.ts`
Expected: FAIL resolving the new modules.

- [ ] **Step 7: Implement media-query lifecycle and scroll helpers**

Use `matchMedia('(prefers-reduced-motion: reduce)')`, subscribe with `addEventListener('change', listener)`, retain `addListener`/`removeListener` fallback, and always remove the installed listener on unmount.

- [ ] **Step 8: Run all Task 1 tests, re-read files, synchronize complete source blocks, and commit locally**

Run: `npx vitest run tests/appUrlState.test.ts tests/components/useReducedMotion.test.tsx tests/scroll.test.ts`
Expected: PASS.

Commit: `feat: add accessible app state utilities`

---

### Task 2: Accessible Dialog Foundation and Modal Surfaces

**Files:**
- Create: `src/hooks/useAccessibleDialog.ts`
- Modify: `src/hooks/index.ts`
- Modify: `src/components/AuthModal.tsx`
- Modify: `src/components/UpgradeModal.tsx`
- Modify: `src/components/QuotaExceededModal.tsx`
- Modify: `src/components/EditModal.tsx`
- Modify: `App.tsx`
- Modify: `tests/components/AuthAndUpgradeModals.test.tsx`
- Create: `tests/components/AccessibleDialogs.test.tsx`
- Modify: `complete source code with updates.md`

**Interfaces:**
- Consumes: `useReducedMotion()` from Task 1 for animation-safe dialog presentation.
- Produces: `useAccessibleDialog({ open, onClose, initialFocusRef? })` returning `{ dialogRef, titleId }`.

- [ ] **Step 1: Write failing dialog contract tests**

```tsx
render(<AuthModal onClose={onClose} />);
const dialog = screen.getByRole('dialog', { name: /access prism file hero/i });
expect(dialog).toHaveAttribute('aria-modal', 'true');
expect(dialog).toHaveFocus();
await user.keyboard('{Escape}');
expect(onClose).toHaveBeenCalledTimes(1);
```

Add a harness that opens the dialog from a trigger, Tabs past the final focusable element, asserts focus wraps to the first element, closes, and asserts focus returns to the trigger.

- [ ] **Step 2: Run dialog tests and confirm role/name/focus failures**

Run: `npx vitest run tests/components/AuthAndUpgradeModals.test.tsx tests/components/AccessibleDialogs.test.tsx`
Expected: FAIL on missing accessible dialog behavior.

- [ ] **Step 3: Implement the reusable focus-management hook**

```ts
export interface AccessibleDialogOptions {
  open: boolean;
  onClose: () => void;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

export function useAccessibleDialog(options: AccessibleDialogOptions): {
  dialogRef: React.RefObject<HTMLDivElement | null>;
  titleId: string;
};
```

Capture `document.activeElement`, focus `initialFocusRef` or the dialog, close on Escape, wrap Tab/Shift+Tab through enabled visible controls, and restore the connected trigger on cleanup.

- [ ] **Step 4: Apply the hook and dialog semantics**

Give all four modal panels `role="dialog"`, `aria-modal="true"`, `aria-labelledby={titleId}`, `tabIndex={-1}`, matching heading IDs, and `overscroll-contain`. Give supported backdrop dismissal a full-inset `button` with a descriptive `aria-label`. Apply the same contract to the mobile navigation drawer in `App.tsx` with the name “Navigation menu” and safe-area padding.

- [ ] **Step 5: Run dialog tests, re-read files, synchronize complete source blocks, and commit locally**

Run: `npx vitest run tests/components/AuthAndUpgradeModals.test.tsx tests/components/AccessibleDialogs.test.tsx`
Expected: PASS.

Commit: `feat: make overlays keyboard accessible`

---

### Task 3: URL-Backed App and Dashboard Navigation

**Files:**
- Modify: `App.tsx`
- Modify: `src/components/views/ToolDashboard.tsx`
- Modify: `src/components/views/ToolLandingView.tsx`
- Modify: `src/components/HistoryDashboard.tsx`
- Modify: `src/components/ToolSidebar.tsx`
- Modify: `src/components/mobile/MobileBottomNav.tsx`
- Modify: `src/components/navigation/HeaderMegaMenu.tsx`
- Create: `tests/components/AppNavigationState.test.tsx`
- Modify: `tests/components/ToolDashboardRefactor.test.tsx`
- Modify: `tests/seoToolLandingPages.test.tsx`
- Modify: `complete source code with updates.md`

**Interfaces:**
- Consumes: `parseAppUrlState`, `updateAppUrlState`, `appUrlFor`, and reduced-motion scroll helpers from Task 1.
- AppShell uses React Router `useLocation` and `useNavigate`; primary tool/history destinations push, transient dashboard/history controls replace.
- ToolDashboard receives `urlState: AppUrlState` and `onUrlStateChange(patch: AppUrlPatch, mode?: UrlUpdateMode)`.
- HistoryDashboard receives `page`, `selectedRecordId`, `onPageChange`, and `onRecordChange`.

- [ ] **Step 1: Write failing URL navigation integration tests**

```tsx
renderAppAt('/app?tool=merge');
expect(await screen.findByRole('heading', { name: /merge pdf/i })).toBeInTheDocument();

renderAppAt('/app?tab=split&q=invoice&tools=all');
expect(screen.getByRole('tab', { name: /split pdf/i })).toHaveAttribute('aria-selected', 'true');
expect(screen.getByRole('searchbox')).toHaveValue('invoice');

await user.click(screen.getByRole('button', { name: /view processing history/i }));
expect(window.location.search).toContain('view=history');
```

Add landing-page upload coverage asserting navigation to `/app?tool=<id>`.

- [ ] **Step 2: Run navigation tests and confirm state is not restored from the URL**

Run: `npx vitest run tests/components/AppNavigationState.test.tsx tests/components/ToolDashboardRefactor.test.tsx tests/seoToolLandingPages.test.tsx`
Expected: FAIL on URL restoration and transfer assertions.

- [ ] **Step 3: Wire AppShell primary destination state to React Router**

Parse `location.search`; synchronize `selectedTool` and `showHistory` without clearing an active batch unless the destination changes. Replace direct destination state setters with `navigate({ pathname: '/app', search }, { replace: mode === 'replace' })`. Home, tool, and history destinations become actual Router links where no confirmation/action logic is required.

- [ ] **Step 4: Wire transient dashboard/history controls to URL replacement**

Initialize tab, category, search, full-directory expansion, FAQ, history page, and selected record from the parsed query. Send tab/category/search/tools/FAQ/page/record changes through `onUrlStateChange(..., 'replace')`; clear invalid values on the next update. Use `appUrlFor({ tool })` when an SEO landing-page upload transfers into the app.

- [ ] **Step 5: Run navigation tests, re-read files, synchronize complete source blocks, and commit locally**

Run: `npx vitest run tests/components/AppNavigationState.test.tsx tests/components/ToolDashboardRefactor.test.tsx tests/seoToolLandingPages.test.tsx`
Expected: PASS.

Commit: `feat: persist app navigation in the URL`

---

### Task 4: Semantic Controls, Forms, Live Regions, and Bounded Data Views

**Files:**
- Modify: `src/components/views/ToolDashboard.tsx`
- Modify: `src/components/views/ProcessingView.tsx`
- Modify: `src/components/HistoryDashboard.tsx`
- Modify: `src/components/ExtractionReview.tsx`
- Modify: `src/components/TransactionRow.tsx`
- Modify: `src/components/PDFPageGrid.tsx`
- Modify: `src/components/TableAlignmentReview.tsx`
- Modify: `src/components/BugReportForm.tsx`
- Modify: `src/components/InternalActivationGate.tsx`
- Modify: `src/components/UsageBadge.tsx`
- Modify: `src/components/ui/Icon.tsx`
- Modify: `src/components/ui/BentoCard.tsx`
- Create: `tests/components/UiSemantics.test.tsx`
- Modify: `tests/components/ExtractionReview.test.tsx`
- Modify: `tests/components/ProcessingView.test.tsx`
- Modify: `complete source code with updates.md`

**Interfaces:**
- Workbench uses `role="tablist"`; each tab has `role="tab"`, `aria-selected`, `aria-controls`, roving `tabIndex`, and ArrowLeft/ArrowRight/Home/End behavior.
- FAQ buttons expose `aria-expanded` and `aria-controls`; answers use matching IDs.
- History and extraction detail views show at most `ROWS_PER_PAGE = 50` rows while export/download consumes the full arrays.

- [ ] **Step 1: Write failing semantic and form tests**

```tsx
expect(screen.getByRole('tablist', { name: /document workflow/i })).toBeInTheDocument();
await user.keyboard('{ArrowRight}');
expect(screen.getByRole('tab', { name: /merge pdf/i })).toHaveAttribute('aria-selected', 'true');
expect(screen.getByLabelText(/email/i)).toHaveAttribute('name', 'email');
expect(screen.getByLabelText(/activation code/i)).toHaveAttribute('spellcheck', 'false');
expect(screen.getByRole('status')).toHaveTextContent(/processing/i);
```

Add keyboard activation assertions for page tiles, transaction rows, and history records; accessible-name assertions for icon-only controls and divider handles; and a 75-row fixture asserting only 50 rows render while the export callback receives all 75.

- [ ] **Step 2: Run semantic tests and confirm failures on keyboard, form metadata, and row bounds**

Run: `npx vitest run tests/components/UiSemantics.test.tsx tests/components/ExtractionReview.test.tsx tests/components/ProcessingView.test.tsx`
Expected: FAIL on the newly specified behavior.

- [ ] **Step 3: Implement native keyboard and ARIA contracts**

Use nested native buttons for clickable table/card content where valid; otherwise add `tabIndex={0}` plus Enter/Space handling to existing table rows. Remove click handlers from bare SVG icons and keep icon components presentational with `aria-hidden` unless a caller supplies an explicit accessible SVG title. Give divider controls keyboard increments and `aria-valuenow`, `aria-valuemin`, and `aria-valuemax`.

- [ ] **Step 4: Implement form and asynchronous-feedback resilience**

Add stable `name`, intentional `autoComplete`, and `spellCheck` props to every editable field. Use `role="alert"` for errors and `role="status"`/`aria-live="polite"` for loading and completion. Focus the first invalid input or alert summary after failed submission. Prevent duplicate submissions while sending.

- [ ] **Step 5: Bound data rendering and stabilize images**

Paginate extraction/history detail rows at 50 per page without truncating export data. Give PDF thumbnail images `width={240}`, `height={320}`, and `loading="lazy"`. Add `overflow-wrap-anywhere`/`min-w-0` to dynamic filenames, errors, and notifications.

- [ ] **Step 6: Run semantic tests, re-read files, synchronize complete source blocks, and commit locally**

Run: `npx vitest run tests/components/UiSemantics.test.tsx tests/components/ExtractionReview.test.tsx tests/components/ProcessingView.test.tsx`
Expected: PASS.

Commit: `feat: harden interactive UI semantics`

---

### Task 5: Global Motion, Theme, Safe Areas, Typography, and Final Compliance Sweep

**Files:**
- Modify: `index.css`
- Modify: `index.html`
- Modify: `Prism File Hero Desktop/index.html`
- Modify: `App.tsx`
- Modify: `src/components/originkit/GlitterWrap.tsx`
- Modify: `src/components/ui/Brand.tsx`
- Modify: all remaining source components reported by `rg -l 'transition-all' App.tsx src`
- Modify: visible loading/example copy reported by `rg -n '\.\.\.' App.tsx src --glob '*.{tsx,ts}'`
- Create: `tests/components/GlobalUiCompliance.test.tsx`
- Modify: `tests/components/GlitterWrap.test.tsx`
- Modify: `complete source code with updates.md`

**Interfaces:**
- Consumes: `useReducedMotion()` and scrolling helpers from Task 1.
- Theme synchronization updates `<meta name="theme-color">` to `#0b0f19` in dark mode and `#f8fafc` in light mode.
- GlitterWrap renders a static decorative layer and starts no animation frame loop when reduced motion is active.

- [ ] **Step 1: Write failing behavior tests for theme and reduced animation**

```tsx
render(<GlitterWrap particleCount={10}><span>Content</span></GlitterWrap>);
expect(requestAnimationFrame).not.toHaveBeenCalled();

render(<ThemeHarness dark />);
expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute('content', '#0b0f19');
```

Add a test rendering `BrandHeader` and asserting its image has numeric `width`/`height` attributes and `fetchpriority="high"`.

- [ ] **Step 2: Run behavior tests and confirm failures on animation/theme/image metadata**

Run: `npx vitest run tests/components/GlobalUiCompliance.test.tsx tests/components/GlitterWrap.test.tsx`
Expected: FAIL on the new assertions.

- [ ] **Step 3: Implement reduced animation, theme metadata, image dimensions, and global interaction CSS**

Use the reduced-motion hook to select GlitterWrap’s static path and all programmatic scroll behavior. Synchronize the theme-color meta element from AppShell. Add `color-scheme: light dark`, `touch-action: manipulation`, visible tap highlight, safe-area variables/padding, `overscroll-behavior: contain`, `overflow-wrap: anywhere`, sticky-header scroll margins, balanced headings, and a reduced-motion CSS fallback.

- [ ] **Step 4: Replace broad transitions and non-typographic copy**

Replace every `transition-all` with the exact properties the element animates: colors, border-color, box-shadow, opacity, or transform. Replace visible loading `...` with `…`; change example placeholders to begin with “e.g.,” and end in `…`; use curly quotation marks only in prose. Preserve JavaScript spread/rest syntax and diagnostic strings where three periods are semantic data rather than displayed copy.

- [ ] **Step 5: Run focused behavior tests**

Run: `npx vitest run tests/components/GlobalUiCompliance.test.tsx tests/components/GlitterWrap.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the one bounded Impeccable detector pass and fix its actionable findings in one batch**

Run: `node /home/philander/.agents/skills/impeccable/scripts/detect.mjs --json App.tsx index.css index.html src/components`
Expected: JSON report with no unresolved high-confidence violations in changed targets.

- [ ] **Step 7: Run static audit queries**

Run: `rg -n 'transition-all|scroll(To|IntoView).*smooth|Loading\.\.\.|Processing\.\.\.|Resetting now\.\.\.' App.tsx index.css src --glob '*.{tsx,ts,css}'`
Expected: no matches for forbidden UI patterns.

- [ ] **Step 8: Run full regression and build verification**

Run: `npm test`
Expected: all Vitest files and tests pass with exit code 0.

Run: `npm run build`
Expected: Vite production build exits 0.

- [ ] **Step 9: Re-read all changed files and synchronize the tracking file**

Replace each modified file’s entire embedded source block in `complete source code with updates.md`, append complete blocks for new files, update this plan’s checked steps, set a single matching UTC timestamp, and verify every embedded block byte-for-byte against disk.

- [ ] **Step 10: Commit the verified final compliance sweep locally**

Commit: `feat: complete web interface compliance remediation`

Do not push, deploy, create a release, or invoke any production command.
