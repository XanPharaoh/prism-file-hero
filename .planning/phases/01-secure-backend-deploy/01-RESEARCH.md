# Phase 01: Secure Backend Deploy — Research

**Researched:** 2025-07-11
**Domain:** Cloudflare Worker proxy, Vite hardening, CI/CD, API key removal
**Confidence:** HIGH — all findings verified against actual source files

---

## Summary

Phase 01 is well-structured but has **one blocking bug** in plan 01-01 that will cause complete failure on first integration test if not fixed. The other two plans (01-02, 01-03) are accurate and match the actual codebase state. App.tsx changes are more extensive than plan 01-02 describes — there are 6+ touch points vs the 2-3 mentioned.

The overall architecture is correct: frontend pre-builds Groq messages (keeps `TOOL_PROMPTS` client-side), sends `{ toolId, messages, response_format }` to the Worker, Worker adds the secret key and proxies to Groq, returns the passthrough response. No changes to response parsing needed.

**Primary recommendation:** Fix the 01-01 Worker validation mismatch before executing. Then execute plans in order: 01-01 → 01-02 → 01-03.

---

## Code Audit Findings

### File: `services/geminiService.ts`

| Line | Issue | Plan That Fixes It |
|------|-------|-------------------|
| 165 | `localStorage.getItem('PRISM_GROQ_API_KEY') \|\| process.env.GROQ_API_KEY \|\| ''` | 01-02 Task 2 |
| 235 | `fetch('https://api.groq.com/openai/v1/chat/completions', ...)` | 01-02 Task 2 |

**Function shape (confirmed):**
```typescript
async function callGroqAPI(toolId: ToolID, images: {...}[], options?: any)
// Builds full messages array internally (system + user with base64 image_url objects)
// Sends complete Groq-shaped requestBody directly to api.groq.com
```

`toolId` IS already in `callGroqAPI` scope — no signature change needed.

---

### File: `vite.config.ts`

| Lines | Issue | Plan That Fixes It |
|-------|-------|-------------------|
| 19-22 | `define: { 'process.env.GROQ_API_KEY': ..., 'process.env.API_KEY': ... }` injects key into bundle | 01-03 Task 1 |
| 28-38 | Chunk splitting exists (`vendor`, `pdf`) but missing `xlsx`/`zip` chunks | 01-03 Task 1 |
| 10 | `base: './'` — relative paths, works for CF Pages (SPA at root) | No change needed |

---

### File: `App.tsx`

**`hasApiKey` touch points — all 6 locations:**

| Line | What it does | Action for web build |
|------|-------------|----------------------|
| 95 | `useState(true)` default | Keep — already `true` |
| 119-127 | `useEffect` with `localStorage.getItem('PRISM_GROQ_API_KEY')` in `else` branch | Remove the `else { localStorage }` branch; keep `window.aistudio` branch |
| 215-226 | `handleOpenKeyDialog`: `window.aistudio.openSelectKey()` OR `prompt()` + `localStorage.setItem` | Remove the `else { prompt(); localStorage.setItem }` branch only |
| 473 | `if (!hasApiKey && ['ocr','compare',...].includes(selectedTool))` gates tool entry | Remove the gate (or make condition always `false`) |
| 551-552 | On API error: `setHasApiKey(false)` + `localStorage.removeItem('PRISM_GROQ_API_KEY')` | Remove both lines (error handling stays, just not key clearing) |
| 932-933 | Same error pattern as 551-552 | Remove both lines |
| 1204 | Button color toggles on `hasApiKey` state | Becomes always green (since `useState(true)` + no clearing) |

**Key insight:** `window.aistudio` blocks are Tauri Desktop paths — leave them entirely intact. Only remove the `else` (web fallback) localStorage branches.

---

## BLOCKING Bug: Plan 01-01 Interface Mismatch

### The Problem

The Worker code in plan 01-01 has **two incompatible approaches in the same file**:

**Validation block** (checks `body.images`):
```typescript
if (!Array.isArray(body.images) || body.images.length === 0) {
  return new Response(JSON.stringify({ error: 'images required' }), { status: 400 });
}
```

**buildGroqPayload** (reads `body.messages`):
```typescript
function buildGroqPayload(body: any): object {
  return {
    model: MODEL,
    messages: body.messages,   // ← reads messages, not images
    temperature: 0.1,
    ...
  };
}
```

**Plan 01-02 says the frontend sends:**
```typescript
{ toolId, messages, response_format }
// NO 'images' field at the Worker level
```

### What Happens Without Fix

1. Frontend sends `{ toolId: "ocr", messages: [...], response_format: {...} }`
2. Worker passes `toolId` check ✓
3. Worker fails `body.images` check → **returns 400 "images required"** ✗
4. Every AI call fails. App is completely broken.

### The Fix

Change the validation in the Worker from checking `body.images` to checking `body.messages`:

```typescript
// WRONG (current plan 01-01):
if (!Array.isArray(body.images) || body.images.length === 0) {
  return new Response(JSON.stringify({ error: 'images required' }), { status: 400 });
}

// CORRECT (fix):
if (!Array.isArray(body.messages) || body.messages.length === 0) {
  return new Response(JSON.stringify({ error: 'messages required' }), { status: 400 });
}
```

**This is a one-line change in the Worker task action block.** The `buildGroqPayload` function and everything else in 01-01 is correct.

---

## Architecture Validation

The proxy architecture is correct and confirmed against actual code:

```
Browser (App.tsx)
  └─ processWithAI(toolId, images, options)          [geminiService.ts]
       └─ callGroqAPI(toolId, batch, options)
            │
            │  Currently: POST api.groq.com + apiKey from localStorage
            │  After 01-02: POST Worker/api/ai (no key)
            ↓
     Cloudflare Worker [worker/src/index.ts]
            │
            │  Adds: Authorization: Bearer ${env.GROQ_API_KEY}
            ↓
     Groq API (api.groq.com)
            │
            ↓
     Response passthrough → extractJSON() [unchanged]
```

The frontend CONTINUES to build the full messages array (system + user + base64 images). Worker receives pre-built messages. No changes to `TOOL_PROMPTS`, `buildSystemMessage`, `mergeResults`, or `extractJSON`.

---

## Plan-by-Plan Verdict

### Plan 01-01: Scaffold Worker
| Aspect | Status |
|--------|--------|
| Worker scaffold (package.json, wrangler.toml, tsconfig) | ✅ Correct |
| Worker handler (CORS, health, /api/ai) | ✅ Correct |
| `buildGroqPayload` function | ✅ Correct — reads `body.messages` |
| Input validation | ❌ **BLOCKING BUG** — checks `body.images`, must check `body.messages` |
| CORS origin check (dev localhost + prod) | ✅ Correct |
| Secret via `env.GROQ_API_KEY` (never hardcoded) | ✅ Correct |

**Action:** Fix the one-line validation bug before executing.

### Plan 01-02: Rewire Frontend
| Aspect | Status |
|--------|--------|
| Create `services/apiConfig.ts` with `WORKER_BASE_URL` | ✅ Correct |
| Remove `localStorage.getItem('PRISM_GROQ_API_KEY')` from geminiService | ✅ Correct |
| Remove direct `api.groq.com` fetch | ✅ Correct |
| Send `{ toolId, messages, response_format }` to Worker | ✅ Correct |
| App.tsx changes described | ⚠️ **INCOMPLETE** — 6 touch points exist, plan mentions ~3 |

**Action:** Expand the App.tsx task to reference all 6 locations listed above.

### Plan 01-03: CI/CD + Vite Hardening
| Aspect | Status |
|--------|--------|
| Remove `define` block (GROQ key injection) | ✅ Correct — confirmed lines 19-22 exist |
| Chunk splitting updates | ✅ Correct — current chunks incomplete |
| `index.html` meta/OG updates | ✅ Correct — existing tags need keyword update |
| GitHub Actions deploy.yml | ✅ Correct |
| VITE_WORKER_URL injected at build time | ✅ Correct |

**Action:** None — execute as written.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| CORS headers per-request | Manual header logic | Already in Worker plan — reuse it |
| API key secret management | `.env` committed to repo | Wrangler secrets (`wrangler secret put`) |
| Frontend env config | Runtime config file | `import.meta.env.VITE_*` (Vite handles this) |

---

## Common Pitfalls

### Pitfall 1: `base: './'` vs `base: '/'` on Cloudflare Pages
**What goes wrong:** `base: './'` uses relative asset paths. If Cloudflare Pages ever serves the `index.html` from a non-root path (e.g., a preview URL with a path prefix), assets 404.  
**Current status:** Safe — CF Pages serves SPAs from root and relative paths resolve correctly. No change needed.  
**Warning sign:** If assets fail to load on the Pages preview URL, switch to `base: '/'`.

### Pitfall 2: `wrangler dev` vs deployed Worker CORS
**What goes wrong:** Localhost dev hits `http://localhost:8787` but the Worker CORS check may fail if `ALLOWED_ORIGIN` var isn't set during dev.  
**Prevention:** The Worker plan already handles this: `origin.startsWith('http://localhost:')` is explicitly allowed regardless of `ALLOWED_ORIGIN`.

### Pitfall 3: `response_format: { type: 'json_object' }` retry
**What goes wrong:** Some Groq model configs reject `response_format`. The current `callGroqAPI` has retry logic that removes it on failure (line 245-248 in geminiService.ts).  
**After 01-02:** This retry logic moves to the Worker side — but the current plan leaves retry logic in the frontend and just passes `response_format` through. This is acceptable for Phase 01.

### Pitfall 4: `process.env.GROQ_API_KEY` in bundle
**What goes wrong:** If `.env` has `GROQ_API_KEY=gsk_...` and `vite.config.ts` still has the `define` block, the key is embedded as a string literal in the compiled JS bundle.  
**Verification:** After plan 01-03, run: `Select-String -Path dist\assets\*.js -Pattern "gsk_|PRISM_GROQ"` → must return no matches.

---

## Pre-Execution Checklist

Before starting 01-01:
- [ ] Fix Worker validation: `body.images` → `body.messages` in 01-01-PLAN.md Task 2 action block
- [ ] Confirm `wrangler` is installed or will be installed via `npm install` in worker/

Before starting 01-02:
- [ ] 01-01-SUMMARY.md exists (Worker deploys cleanly to `wrangler dev`)
- [ ] Note all 6 `hasApiKey` locations in App.tsx when editing

Before starting 01-03:
- [ ] 01-02-SUMMARY.md exists (`npm test` still passes with Worker calls)
- [ ] Have Cloudflare account ready for Pages project creation

---

## Minor Issues (Non-Blocking)

- **ROADMAP.md requirements registry**: PAY-01, PAY-02, PAY-03 descriptions still reference "Stripe" (should say "Paddle"). Cosmetic only — fix separately.

---

## Sources

**All findings verified against actual source files:**
- [services/geminiService.ts](../../../services/geminiService.ts) — lines 1-295 read and audited
- [App.tsx](../../../App.tsx) — lines 88-135, 460-940 read and audited (hasApiKey touch points)
- [vite.config.ts](../../../vite.config.ts) — lines 1-40 read and audited
- [.planning/phases/01-secure-backend-deploy/01-01-PLAN.md](01-01-PLAN.md) — full audit
- [.planning/phases/01-secure-backend-deploy/01-02-PLAN.md](01-02-PLAN.md) — full audit
- [.planning/phases/01-secure-backend-deploy/01-03-PLAN.md](01-03-PLAN.md) — full audit

**Confidence:** HIGH — no external sources needed; all findings are direct code reads.

---

## Metadata

**Research date:** 2025-07-11
**Valid until:** Until any of the above files are modified
**Confidence breakdown:**
- Bug identification: HIGH — verified in source code
- Architecture: HIGH — confirmed against actual callGroqAPI implementation
- App.tsx touch points: HIGH — grepped and line-verified
