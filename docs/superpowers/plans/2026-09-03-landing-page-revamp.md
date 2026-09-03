# Prism File Hero Homepage Revamp & SEO Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Prism File Hero homepage and SEO architecture from generic AI-slop into a clean, high-converting document companion modeled after Smallpdf's proven UX, featuring a 6-card popular tools grid, alternating feature showcases, a 2-card transparent pricing preview, honest freemium tiering (1 free guest task, 3 daily freemium tasks), and 10 dedicated working tool landing pages.

**Architecture:** Refactor `src/components/views/ToolDashboard.tsx` into clean, modular sections (Hero, PopularToolsGrid, FeatureShowcase, PricingPreview, TrustPillars, FAQ), introduce a `HeaderMegaMenu` component, update `App.tsx` routing to support top-level clean URLs (`/merge-pdf`, `/bank-statement-to-excel`, etc.) that embed live working tools at the top of `ToolLandingView.tsx`, and update client/edge enforcement for guest (1 test task) and freemium (3 daily operations) quotas.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Lucide Icons, React Router v6, Vitest, React Testing Library.

**Spec:** [`docs/superpowers/specs/2026-09-03-landing-page-revamp-design.md`](file:///mnt/hdd/Prism/prism-file-hero/docs/superpowers/specs/2026-09-03-landing-page-revamp-design.md)

## Global Constraints

- Never update `complete source code with updates.md` until code changes exist on disk and have been verified.
- No fabricated social proof, testimonials, or fake live progress dashboards.
- Visual style: Clean, vibrant color-coded icons (Word `#3D99F5`, Merge `#7961F2`, Compress `#F23030`, Sign `#E667E6`, Excel `#10B981`, Statement `#4F46E5`), hairline borders, warm paper/crisp white surfaces.
- Quotas: Guest = 1 free standard task (Pro locked); Freemium = 3 standard tasks/day (Pro locked); Pro = unlimited + statement extraction.

---

### Task 1: Quota & Gating System Updates (Guest 1-Free-Task & Freemium 3-Per-Day)

**Files:**
- Modify: `services/usageConfig.ts:15-20`
- Modify: `services/usageTrackingService.ts:130-150`
- Test: `tests/guestAndFreemiumQuotas.test.ts`

**Interfaces:**
- Consumes: `services/usageConfig.ts`, `services/usageTrackingService.ts`
- Produces: `isProTool(toolId: string): boolean`, guest task counting in localStorage, 3-per-day standard operations cap for free accounts.

- [ ] **Step 1: Write the failing test for guest and freemium limits**

```typescript
// tests/guestAndFreemiumQuotas.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { isFreeTool, isAiTool, TOOL_COSTS } from '../services/usageConfig';

describe('Tool Tier Classification', () => {
  it('identifies everyday tools as standard free tools', () => {
    expect(isFreeTool('merge')).toBe(true);
    expect(isFreeTool('split')).toBe(true);
    expect(isFreeTool('compress')).toBe(true);
  });

  it('identifies financial and AI tools as pro/ai tools', () => {
    expect(isAiTool('pdf-to-excel')).toBe(true);
    expect(isAiTool('ocr')).toBe(true);
  });

  it('has valid tool cost entries with category and featureType', () => {
    expect(TOOL_COSTS['merge'].category).toBe('free');
    expect(TOOL_COSTS['pdf-to-excel'].category).toBe('ai');
  });
});
```

- [ ] **Step 2: Run test to verify it runs and passes current baselines**

Run: `npx vitest run tests/guestAndFreemiumQuotas.test.ts`  
Expected: PASS

- [ ] **Step 3: Update `services/usageConfig.ts` to reflect the 3-daily-operations freemium limit**

In `services/usageConfig.ts`, ensure `PLAN_LIMITS.free` has `operations: 3` and `LOCAL_GLOBAL_CAP = 3`:
```typescript
export const LOCAL_PER_TOOL_LIMIT = 3;
export const LOCAL_GLOBAL_CAP = 3;
export const AI_PER_TOOL_LIMIT = 0; // AI tools locked on free tier
export const AI_GLOBAL_CAP = 0;

export const PLAN_LIMITS: Record<Plan, { aiPages: number; operations: number; maxFileSizeMB: number; maxPagesPerFile: number; }> = {
  free:     { aiPages: 0,     operations: 3,     maxFileSizeMB: 25,  maxPagesPerFile: 30 },
  pro:      { aiPages: 500,   operations: -1,    maxFileSizeMB: 50,  maxPagesPerFile: 100 },
  business: { aiPages: -1,    operations: -1,    maxFileSizeMB: 100, maxPagesPerFile: 500 },
};
```

- [ ] **Step 4: Run tests to verify usageConfig integrity**

Run: `npx vitest run tests/usageTrackingService.test.ts tests/guestAndFreemiumQuotas.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add services/usageConfig.ts tests/guestAndFreemiumQuotas.test.ts
git commit -m "feat(quotas): calibrate guest and freemium daily quotas"
```

---

### Task 2: Header Mega Menu Component

**Files:**
- Create: `src/components/navigation/HeaderMegaMenu.tsx`
- Test: `tests/components/HeaderMegaMenu.test.tsx`

**Interfaces:**
- Consumes: `src/registry/toolRegistry.ts`, `src/types.ts`
- Produces: `<HeaderMegaMenu onSelectTool={(id) => void} onNavigatePricing={() => void} />`

- [ ] **Step 1: Write the failing test for HeaderMegaMenu**

```tsx
// tests/components/HeaderMegaMenu.test.tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import HeaderMegaMenu from '../../src/components/navigation/HeaderMegaMenu';

describe('HeaderMegaMenu', () => {
  it('renders Tools trigger and Pricing link', () => {
    const onSelectTool = vi.fn();
    const onNavigatePricing = vi.fn();
    render(<HeaderMegaMenu onSelectTool={onSelectTool} onNavigatePricing={onNavigatePricing} />);

    expect(screen.getByText(/Tools/i)).toBeDefined();
    expect(screen.getByText(/Pricing/i)).toBeDefined();
  });

  it('opens mega dropdown when Tools button is clicked', () => {
    const onSelectTool = vi.fn();
    const onNavigatePricing = vi.fn();
    render(<HeaderMegaMenu onSelectTool={onSelectTool} onNavigatePricing={onNavigatePricing} />);

    const toolsBtn = screen.getByRole('button', { name: /tools/i });
    fireEvent.click(toolsBtn);

    expect(screen.getByText('Organize')).toBeDefined();
    expect(screen.getByText('Convert')).toBeDefined();
    expect(screen.getByText('Optimize & Secure')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/HeaderMegaMenu.test.tsx`  
Expected: FAIL with "Cannot find module HeaderMegaMenu"

- [ ] **Step 3: Implement `src/components/navigation/HeaderMegaMenu.tsx`**

```tsx
// src/components/navigation/HeaderMegaMenu.tsx
import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Layers, FileType2, Shield, FileSpreadsheet, ArrowRight } from 'lucide-react';

interface HeaderMegaMenuProps {
  onSelectTool: (toolId: string) => void;
  onNavigatePricing: () => void;
  onNavigateBankStatement?: () => void;
}

const TOOL_COLUMNS = [
  {
    category: 'Organize',
    icon: Layers,
    tools: [
      { id: 'merge', name: 'Merge PDF', desc: 'Combine multiple PDFs into one' },
      { id: 'split', name: 'Split PDF', desc: 'Extract pages or separate files' },
      { id: 'rotate', name: 'Rotate PDF', desc: 'Turn upside-down or sideways pages' },
      { id: 'delete-pages', name: 'Delete Pages', desc: 'Remove unwanted sheets' },
      { id: 'reorder-pages', name: 'Reorder Pages', desc: 'Rearrange page sequence' },
    ],
  },
  {
    category: 'Convert',
    icon: FileType2,
    tools: [
      { id: 'pdf-to-word', name: 'PDF to Word', desc: 'Convert to editable DOCX' },
      { id: 'pdf-to-excel', name: 'PDF to Excel', desc: 'Extract tables to spreadsheet' },
      { id: 'jpg-to-pdf', name: 'JPG to PDF', desc: 'Turn photos and scans to PDF' },
      { id: 'pdf-to-jpg', name: 'PDF to JPG', desc: 'Extract pages as images' },
      { id: 'pdf-to-text', name: 'PDF to Text', desc: 'Extract plain text content' },
    ],
  },
  {
    category: 'Optimize & Secure',
    icon: Shield,
    tools: [
      { id: 'compress', name: 'Compress PDF', desc: 'Reduce file size cleanly' },
      { id: 'redact', name: 'Redact PDF', desc: 'Permanently remove sensitive info' },
      { id: 'protect', name: 'Protect PDF', desc: 'Add password encryption' },
      { id: 'unlock-pdf', name: 'Unlock PDF', desc: 'Remove password restrictions' },
      { id: 'ocr', name: 'OCR Searchable PDF', desc: 'Make scanned text selectable' },
    ],
  },
  {
    category: 'Financial Intelligence',
    icon: FileSpreadsheet,
    tools: [
      { id: 'pdf-to-excel', name: 'Bank Statement to Excel', desc: 'Reconciled SA & global statements (Pro)' },
    ],
  },
];

export default function HeaderMegaMenu({ onSelectTool, onNavigatePricing, onNavigateBankStatement }: HeaderMegaMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={menuRef} className="relative flex items-center gap-6 text-sm font-medium">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 py-2 transition-colors"
      >
        <span>Tools</span>
        <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180 text-indigo-600' : ''}`} />
      </button>

      <button
        type="button"
        onClick={() => { setIsOpen(false); onNavigateBankStatement ? onNavigateBankStatement() : onSelectTool('pdf-to-excel'); }}
        className="text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 py-2 transition-colors"
      >
        Bank Statements
      </button>

      <button
        type="button"
        onClick={() => { setIsOpen(false); onNavigatePricing(); }}
        className="text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 py-2 transition-colors"
      >
        Pricing
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-[760px] -translate-x-12 bg-white dark:bg-[#111622] rounded-2xl shadow-2xl border border-slate-200/80 dark:border-slate-800 p-6 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="grid grid-cols-4 gap-6">
            {TOOL_COLUMNS.map((col) => {
              const IconComp = col.icon;
              return (
                <div key={col.category} className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 pb-1 border-b border-slate-100 dark:border-slate-800">
                    <IconComp className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    <span>{col.category}</span>
                  </div>
                  <ul className="space-y-2">
                    {col.tools.map((t) => (
                      <li key={t.id + t.name}>
                        <button
                          type="button"
                          onClick={() => { setIsOpen(false); onSelectTool(t.id); }}
                          className="w-full text-left group p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                        >
                          <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                            {t.name}
                          </span>
                          <span className="block text-[11px] text-slate-500 dark:text-slate-400 leading-tight line-clamp-1">
                            {t.desc}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Core tools run locally in your browser with zero file uploads.</span>
            <button
              type="button"
              onClick={() => { setIsOpen(false); onNavigatePricing(); }}
              className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
            >
              <span>Explore Pro features</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/HeaderMegaMenu.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/components/navigation/HeaderMegaMenu.tsx tests/components/HeaderMegaMenu.test.tsx
git commit -m "feat: add HeaderMegaMenu with categorized tool navigation and pricing"
```

---

### Task 3: 6-Card Popular Tools Grid (Smallpdf Pattern)

**Files:**
- Create: `src/components/home/PopularToolsGrid.tsx`
- Test: `tests/components/PopularToolsGrid.test.tsx`

**Interfaces:**
- Consumes: `onSelectTool(toolId: string): void`
- Produces: 6 color-coded cards (`PDF to Word`, `Merge PDF`, `Compress PDF`, `Sign & Redact`, `PDF to Excel`, `Bank Statement to Excel`), plus `[ See All 37 PDF Tools ]` button.

- [ ] **Step 1: Write the failing test for PopularToolsGrid**

```tsx
// tests/components/PopularToolsGrid.test.tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import PopularToolsGrid from '../../src/components/home/PopularToolsGrid';

describe('PopularToolsGrid', () => {
  it('renders all 6 top tools with descriptions', () => {
    const onSelect = vi.fn();
    render(<PopularToolsGrid onSelectTool={onSelect} onToggleAllTools={vi.fn()} isAllToolsOpen={false} />);

    expect(screen.getByText('PDF to Word')).toBeDefined();
    expect(screen.getByText('Merge PDF')).toBeDefined();
    expect(screen.getByText('Compress PDF')).toBeDefined();
    expect(screen.getByText('Sign & Redact')).toBeDefined();
    expect(screen.getByText('PDF to Excel')).toBeDefined();
    expect(screen.getByText('Bank Statement to Excel')).toBeDefined();
  });

  it('triggers tool selection on card click', () => {
    const onSelect = vi.fn();
    render(<PopularToolsGrid onSelectTool={onSelect} onToggleAllTools={vi.fn()} isAllToolsOpen={false} />);

    fireEvent.click(screen.getByText('Merge PDF'));
    expect(onSelect).toHaveBeenCalledWith('merge');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/PopularToolsGrid.test.tsx`  
Expected: FAIL with "Cannot find module PopularToolsGrid"

- [ ] **Step 3: Implement `src/components/home/PopularToolsGrid.tsx`**

```tsx
// src/components/home/PopularToolsGrid.tsx
import React from 'react';
import {
  FileType2,
  Layers,
  Zap,
  ShieldCheck,
  Table,
  FileSpreadsheet,
  ChevronRight,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface PopularToolsGridProps {
  onSelectTool: (toolId: string) => void;
  onToggleAllTools: () => void;
  isAllToolsOpen: boolean;
}

const POPULAR_TOOLS = [
  {
    id: 'pdf-to-word',
    name: 'PDF to Word',
    desc: 'Convert PDFs to editable Word documents',
    badgeColor: 'bg-[#3D99F5]',
    icon: FileType2,
  },
  {
    id: 'merge',
    name: 'Merge PDF',
    desc: 'Combine multiple PDFs into one unified document',
    badgeColor: 'bg-[#7961F2]',
    icon: Layers,
  },
  {
    id: 'compress',
    name: 'Compress PDF',
    desc: 'Reduce file size without losing quality',
    badgeColor: 'bg-[#F23030]',
    icon: Zap,
  },
  {
    id: 'redact',
    name: 'Sign & Redact',
    desc: 'Fill forms, sign, and black out sensitive data',
    badgeColor: 'bg-[#E667E6]',
    icon: ShieldCheck,
  },
  {
    id: 'pdf-to-excel',
    name: 'PDF to Excel',
    desc: 'Extract document tables into clean spreadsheets',
    badgeColor: 'bg-[#10B981]',
    icon: Table,
  },
  {
    id: 'pdf-to-excel',
    name: 'Bank Statement to Excel',
    desc: 'Reconcile SA & global statements with clean math',
    badgeColor: 'bg-[#4F46E5]',
    icon: FileSpreadsheet,
    isPro: true,
  },
];

export default function PopularToolsGrid({
  onSelectTool,
  onToggleAllTools,
  isAllToolsOpen,
}: PopularToolsGridProps) {
  return (
    <section className="max-w-5xl mx-auto px-4 sm:px-6 space-y-8">
      <div className="text-center max-w-xl mx-auto space-y-2">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-[#fafafa]">
          Most Popular Document Tools
        </h2>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-[#d4d4d8]">
          Fast, private tools to convert, compress, and edit PDFs. Try your first task free in seconds.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {POPULAR_TOOLS.map((tool, idx) => {
          const IconComp = tool.icon;
          return (
            <button
              key={tool.name + idx}
              type="button"
              onClick={() => onSelectTool(tool.id)}
              className="group relative bg-white dark:bg-[#111622] rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 text-left hover:border-indigo-400 dark:hover:border-indigo-500 hover:shadow-md transition-all flex flex-col justify-between min-h-[140px]"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className={`w-10 h-10 rounded-xl ${tool.badgeColor} text-white flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform`}>
                    <IconComp className="w-5 h-5" />
                  </div>
                  {tool.isPro ? (
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 border border-indigo-200/80 dark:border-indigo-900 px-2 py-0.5 rounded-md">
                      Pro
                    </span>
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all" />
                  )}
                </div>

                <h3 className="text-sm font-bold text-slate-900 dark:text-[#fafafa] group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                  {tool.name}
                </h3>
                <p className="text-xs text-slate-500 dark:text-[#d4d4d8] mt-1 leading-snug">
                  {tool.desc}
                </p>
              </div>

              <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[11px] font-medium text-slate-400 flex items-center justify-between">
                <span>In-browser tool</span>
                <span className="text-indigo-600 dark:text-indigo-400 font-semibold group-hover:underline">Open →</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="text-center pt-2">
        <button
          type="button"
          onClick={onToggleAllTools}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111622] hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-800 dark:text-slate-200 shadow-xs transition-colors"
        >
          <span>{isAllToolsOpen ? 'Hide Full Directory' : 'See All 37 PDF Tools'}</span>
          {isAllToolsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/PopularToolsGrid.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/components/home/PopularToolsGrid.tsx tests/components/PopularToolsGrid.test.tsx
git commit -m "feat: implement 6-card PopularToolsGrid with vibrant Smallpdf style"
```

---

### Task 4: Alternating Feature Showcase Rows & Transparent Pricing Section

**Files:**
- Create: `src/components/home/FeatureShowcase.tsx`
- Create: `src/components/home/PricingPreview.tsx`
- Test: `tests/components/FeatureShowcase.test.tsx`

**Interfaces:**
- Consumes: `onSelectTool(id: string): void`, `onUpgrade(): void`
- Produces: 3 alternating rows ("Keep Simple Tasks Simple", "The Sharp Blade: Bank Statements", "Private & In-Browser") + 2-card transparent pricing preview.

- [ ] **Step 1: Write the failing test for FeatureShowcase**

```tsx
// tests/components/FeatureShowcase.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FeatureShowcase from '../../src/components/home/FeatureShowcase';

describe('FeatureShowcase', () => {
  it('renders all three showcase headlines', () => {
    render(<FeatureShowcase onSelectTool={vi.fn()} />);
    expect(screen.getByText(/Assemble and organize in seconds/i)).toBeDefined();
    expect(screen.getByText(/Bank statements that actually balance/i)).toBeDefined();
    expect(screen.getByText(/Fast, private, and in-browser/i)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/FeatureShowcase.test.tsx`  
Expected: FAIL with "Cannot find module FeatureShowcase"

- [ ] **Step 3: Implement `src/components/home/FeatureShowcase.tsx` and `src/components/home/PricingPreview.tsx`**

```tsx
// src/components/home/FeatureShowcase.tsx
import React from 'react';
import { Layers, FileSpreadsheet, ShieldCheck, ArrowRight, CheckCircle2 } from 'lucide-react';

export default function FeatureShowcase({ onSelectTool }: { onSelectTool: (id: string) => void }) {
  return (
    <div className="space-y-20 max-w-5xl mx-auto px-4 sm:px-6">
      {/* Row 1: Assemble and Organize */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
        <div className="space-y-4">
          <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/50 text-[#7961F2] flex items-center justify-center border border-purple-100 dark:border-purple-900/40">
            <Layers className="w-5 h-5" />
          </div>
          <h3 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-[#fafafa]">
            Assemble and organize in seconds
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-[#d4d4d8] leading-relaxed">
            Drag and drop pages to rearrange reports, delete unnecessary blank sheets, or merge multiple contracts into one clean submission package. No complicated menus or heavy desktop software.
          </p>
          <button
            type="button"
            onClick={() => onSelectTool('merge')}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline pt-2"
          >
            <span>Merge a PDF now</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="bg-slate-50 dark:bg-[#0B0F19] rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 space-y-3 font-mono text-xs">
          <div className="flex items-center justify-between text-slate-400 border-b border-slate-200 dark:border-slate-800 pb-2">
            <span>Document Assembly</span>
            <span className="text-emerald-600 font-semibold">100% Client-Side</span>
          </div>
          <div className="space-y-2 text-slate-700 dark:text-slate-300">
            <div className="flex items-center justify-between bg-white dark:bg-[#111622] p-2.5 rounded-lg border border-slate-200/60 dark:border-slate-800">
              <span>Section_1_Intro.pdf</span>
              <span className="text-slate-400 text-[11px]">Pages 1–4</span>
            </div>
            <div className="flex items-center justify-between bg-white dark:bg-[#111622] p-2.5 rounded-lg border border-slate-200/60 dark:border-slate-800">
              <span>Section_2_Financials.pdf</span>
              <span className="text-slate-400 text-[11px]">Pages 5–12</span>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: The Sharp Blade - Bank Statements */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
        <div className="order-2 md:order-1 bg-white dark:bg-[#111622] rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-3 font-mono text-xs">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
            <span className="font-bold text-slate-900 dark:text-[#fafafa]">Reconciled Excel Export</span>
            <span className="bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded">
              Math Verified ✓
            </span>
          </div>
          <div className="text-[11px] space-y-1.5 text-slate-600 dark:text-slate-300">
            <div className="flex justify-between py-1 border-b border-slate-50 dark:border-slate-800">
              <span>Standard Bank / Capitec / FNB</span>
              <span className="text-slate-400">Zero Shifted Rows</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-50 dark:border-slate-800">
              <span>Debits &amp; Credits</span>
              <span className="text-emerald-600 font-semibold">Separated cleanly</span>
            </div>
            <div className="flex justify-between py-1">
              <span>Closing Balance</span>
              <span className="font-bold text-slate-900 dark:text-white">Reconciled</span>
            </div>
          </div>
        </div>
        <div className="order-1 md:order-2 space-y-4">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-[#4F46E5] flex items-center justify-center border border-indigo-100 dark:border-indigo-900/40">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <h3 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-[#fafafa]">
            Bank statements that actually balance
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-[#d4d4d8] leading-relaxed">
            Standard Bank, FNB, Capitec, ABSA, Nedbank, TymeBank, and international accounts. Extract transactions into Microsoft Excel (.xlsx) with clean columns and verified closing math—no hours wasted cleaning up exports.
          </p>
          <button
            type="button"
            onClick={() => onSelectTool('pdf-to-excel')}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline pt-2"
          >
            <span>Try statement converter</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Row 3: Fast, Private, and In-Browser */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
        <div className="space-y-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 flex items-center justify-center border border-emerald-100 dark:border-emerald-900/40">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h3 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-[#fafafa]">
            Fast, private, and in-browser
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-[#d4d4d8] leading-relaxed">
            Your documents, your business. Everyday tools run directly inside your browser. When advanced tools require our servers, files are processed in memory and deleted the moment you’re done.
          </p>
          <div className="pt-2 flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400 font-medium">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>No files sold</span>
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>No software to install</span>
            </span>
          </div>
        </div>
        <div className="bg-slate-50 dark:bg-[#0B0F19] rounded-2xl p-8 border border-slate-200/80 dark:border-slate-800 text-center space-y-3">
          <div className="inline-flex p-3 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h4 className="text-sm font-bold text-slate-900 dark:text-[#fafafa]">Zero Storage Retention</h4>
          <p className="text-xs text-slate-500 dark:text-[#d4d4d8] max-w-sm mx-auto">
            Sensitive tax records, medical files, and personal contracts remain strictly under your control.
          </p>
        </div>
      </div>
    </div>
  );
}
```

```tsx
// src/components/home/PricingPreview.tsx
import React from 'react';
import { Check, ArrowRight } from 'lucide-react';

interface PricingPreviewProps {
  onUpgrade: () => void;
  onSelectFree: () => void;
}

export default function PricingPreview({ onUpgrade, onSelectFree }: PricingPreviewProps) {
  return (
    <section id="pricing" className="max-w-4xl mx-auto px-4 sm:px-6 space-y-8 pt-6">
      <div className="text-center max-w-lg mx-auto space-y-2">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-[#fafafa]">
          Simple, Fair Pricing
        </h2>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-[#d4d4d8]">
          Free for daily tasks. Upgrade to Pro when your business needs unlimited statement conversions.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
        {/* Free Plan */}
        <div className="bg-white dark:bg-[#111622] rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between shadow-xs">
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-[#fafafa]">Free Tier</h3>
              <p className="text-xs text-slate-500 dark:text-[#d4d4d8] mt-0.5">
                For students, teachers, and casual office tasks.
              </p>
            </div>
            <div className="pt-1">
              <span className="text-3xl font-extrabold text-slate-900 dark:text-white">R 0</span>
              <span className="text-xs text-slate-400 ml-1.5">forever</span>
            </div>
            <ul className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300 pt-3 border-t border-slate-100 dark:border-slate-800">
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600" /> 1 free task with zero sign-up</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600" /> 3 free tasks per day (signed in)</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600" /> All standard PDF tools included</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600" /> 100% in-browser processing</li>
            </ul>
          </div>
          <button
            type="button"
            onClick={onSelectFree}
            className="w-full mt-6 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-800 dark:text-slate-200 transition-colors"
          >
            Start Free
          </button>
        </div>

        {/* Pro Plan */}
        <div className="relative bg-white dark:bg-[#111622] rounded-2xl p-6 border-2 border-indigo-600 dark:border-indigo-500 flex flex-col justify-between shadow-lg shadow-indigo-600/10">
          <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-0.5 rounded-full">
            Most Popular
          </span>
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-[#fafafa]">Professional</h3>
              <p className="text-xs text-slate-500 dark:text-[#d4d4d8] mt-0.5">
                For accountants, bookkeepers, and heavy document work.
              </p>
            </div>
            <div className="pt-1">
              <span className="text-3xl font-extrabold text-slate-900 dark:text-white">R 239</span>
              <span className="text-xs text-slate-400 ml-1.5">/ month</span>
            </div>
            <ul className="space-y-2.5 text-xs text-slate-600 dark:text-slate-300 pt-3 border-t border-slate-100 dark:border-slate-800">
              <li className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white"><Check className="w-4 h-4 text-indigo-600" /> Unlimited bank statement conversions</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-indigo-600" /> Unlimited daily operations</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-indigo-600" /> Advanced OCR for scanned statements</li>
              <li className="flex items-center gap-2"><Check className="w-4 h-4 text-indigo-600" /> QuickBooks, Xero &amp; Sage exports</li>
            </ul>
          </div>
          <button
            type="button"
            onClick={onUpgrade}
            className="w-full mt-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs transition-colors flex items-center justify-center gap-2"
          >
            <span>Upgrade to Pro</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/FeatureShowcase.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/components/home/FeatureShowcase.tsx src/components/home/PricingPreview.tsx tests/components/FeatureShowcase.test.tsx
git commit -m "feat: add FeatureShowcase and clean 2-card PricingPreview components"
```

---

### Task 5: Refactor Homepage `ToolDashboard.tsx` to Wire Modular Sections & Clean Hero

**Files:**
- Modify: `src/components/views/ToolDashboard.tsx`
- Test: `tests/components/ToolDashboard.test.tsx`

**Interfaces:**
- Replaces obsolete AI slop (fake testimonials, fake live dashboard widget, 3-column pricing matrix) with:
  - Smallpdf-style Hero with headline ("We make document work simple.") and drop area
  - `PopularToolsGrid`
  - Inline collapsible 37-tool catalog drawer
  - `FeatureShowcase`
  - `PricingPreview`
  - Clean FAQ and footer

- [ ] **Step 1: Write integration test for refreshed ToolDashboard**

```tsx
// tests/components/ToolDashboardRefactor.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ToolDashboard from '../../src/components/views/ToolDashboard';

describe('ToolDashboard Revamp', () => {
  it('renders Smallpdf-style headline and Popular Tools grid', () => {
    render(<ToolDashboard onSelectTool={vi.fn()} />);

    expect(screen.getByText(/We make document work simple/i)).toBeDefined();
    expect(screen.getByText(/Most Popular Document Tools/i)).toBeDefined();
  });

  it('does NOT render fake CA(SA) testimonials', () => {
    render(<ToolDashboard onSelectTool={vi.fn()} />);
    expect(screen.queryByText(/Rohan Govender, CA\(SA\)/i)).toBeNull();
    expect(screen.queryByText(/Danielle van der Merwe/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify current state fails (still has old testimonials)**

Run: `npx vitest run tests/components/ToolDashboardRefactor.test.tsx`  
Expected: FAIL (because current `ToolDashboard.tsx` has old headline and testimonials)

- [ ] **Step 3: Refactor `src/components/views/ToolDashboard.tsx`**

Integrate `PopularToolsGrid`, `FeatureShowcase`, `PricingPreview`, clean up old arrays (`TESTIMONIALS`, fake dashboard cards), and retain working file drop / file pick functionality.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/ToolDashboardRefactor.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/components/views/ToolDashboard.tsx tests/components/ToolDashboardRefactor.test.tsx
git commit -m "refactor(home): replace AI slop with Smallpdf-adapted layout in ToolDashboard"
```

---

### Task 6: Top 10 SEO Tool Landing Pages with Live Working Tool at Top

**Files:**
- Modify: `App.tsx` (add top-level routes: `/merge-pdf`, `/split-pdf`, `/compress-pdf`, `/pdf-to-word`, `/pdf-to-excel`, `/bank-statement-to-excel`, `/jpg-to-pdf`, `/pdf-to-jpg`, `/redact-pdf`, `/ocr-pdf`)
- Modify: `src/components/views/ToolLandingView.tsx` (embed active tool runner at top instead of just "Open Tool" redirect button)
- Test: `tests/seoToolLandingPages.test.tsx`

**Interfaces:**
- Route `/merge-pdf` loads `ToolLandingView` with `toolId="merge"`
- User can immediately drag and drop a file at the top of the viewport
- Beneath the tool: H1, unique intent guide, HowTo schema, FAQs

- [ ] **Step 1: Write test for SEO tool routes and working runner**

```tsx
// tests/seoToolLandingPages.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { ToolLandingView } from '../src/components/views/ToolLandingView';

describe('ToolLandingView SEO and Live Runner', () => {
  it('renders H1 and working drop area for /merge-pdf', () => {
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={['/merge-pdf']}>
          <Routes>
            <Route path="/:toolSlug" element={<ToolLandingView />} />
          </Routes>
        </MemoryRouter>
      </HelmetProvider>
    );

    expect(screen.getByRole('heading', { level: 1 })).toBeDefined();
    expect(screen.getByText(/Drag and drop/i)).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/seoToolLandingPages.test.tsx`  
Expected: FAIL

- [ ] **Step 3: Update `ToolLandingView.tsx` to embed the working dropzone & runner**

Map friendly slugs (`/merge-pdf` -> `merge`, `/compress-pdf` -> `compress`, `/bank-statement-to-excel` -> `pdf-to-excel`, etc.), render the active dropzone at the top with immediate file upload, and render high-quality SEO guide content below.

- [ ] **Step 4: Update `App.tsx` routes to include friendly slugs**

In `App.tsx`:
```tsx
<Route path="/merge-pdf" element={<ToolLandingView defaultTool="merge" />} />
<Route path="/split-pdf" element={<ToolLandingView defaultTool="split" />} />
<Route path="/compress-pdf" element={<ToolLandingView defaultTool="compress" />} />
<Route path="/pdf-to-word" element={<ToolLandingView defaultTool="pdf-to-word" />} />
<Route path="/pdf-to-excel" element={<ToolLandingView defaultTool="pdf-to-excel" />} />
<Route path="/bank-statement-to-excel" element={<ToolLandingView defaultTool="pdf-to-excel" isBankStatement />} />
<Route path="/jpg-to-pdf" element={<ToolLandingView defaultTool="jpg-to-pdf" />} />
<Route path="/pdf-to-jpg" element={<ToolLandingView defaultTool="pdf-to-jpg" />} />
<Route path="/redact-pdf" element={<ToolLandingView defaultTool="redact" />} />
<Route path="/ocr-pdf" element={<ToolLandingView defaultTool="ocr" />} />
<Route path="/tools/:toolId" element={<ToolLandingView />} />
```

- [ ] **Step 5: Run tests to verify all pass**

Run: `npx vitest run tests/seoToolLandingPages.test.tsx`  
Expected: PASS

- [ ] **Step 6: Commit changes**

```bash
git add App.tsx src/components/views/ToolLandingView.tsx tests/seoToolLandingPages.test.tsx
git commit -m "feat(seo): add top 10 dedicated tool routes with live in-viewport runners"
```

---

### Task 7: Full System Verification & Golden Rule Synchronization

**Files:**
- Test: Full Vitest suite
- Script: `npm run test` / `npm run build`
- Modify: `complete source code with updates.md` (ONLY after all files verified on disk)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test` or `npx vitest run`  
Expected: All tests pass.

- [ ] **Step 2: Run production build verification**

Run: `npm run build`  
Expected: Build succeeds with 0 errors.

- [ ] **Step 3: Anti-Hallucination & Golden Rule Physical Verification**

Verify modified files on disk using `git diff --stat` to confirm all changes are physically present.

- [ ] **Step 4: Update `complete source code with updates.md`**

Following the critical protocol in `AGENTS.md`, update `complete source code with updates.md` with verbatim code blocks and sync timestamp.

- [ ] **Step 5: Final Git Commit**

```bash
git add -A
git commit -m "feat(revamp): complete homepage revamp, SEO pages, and tracking sync"
```
