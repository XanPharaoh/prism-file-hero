# Tauri Desktop App Implementation Plan

## Overview

**Project:** Convert Prism File Hero web application to a native Windows executable using Tauri framework.

**Why:** Enable standalone desktop usage with better file system integration while maintaining all existing AI/PDF processing functionality.

---

## Project Type

**WEB** → React-based web application being packaged as native desktop app

---

## Success Criteria

| Criterion | Metric |
|-----------|--------|
| `.exe` file generated | Windows installer created in `src-tauri/target/release` |
| App launches | Window opens and displays React UI within 3 seconds |
| PDF tools functional | Merge, split, compress, protect, watermark, rotate work |
| AI features functional | OCR, PDF-to-Excel, PDF-to-Word, redact, compare work |
| File dialogs work | Native open/save dialogs function correctly |
| Bundle size | < 50MB (vs ~150MB+ for Electron) |

---

## Tech Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Framework | Tauri 2.x | System WebView (Edge), smaller bundle, Rust backend |
| Frontend | React 19 + Vite | Existing codebase, no changes needed |
| Styling | Tailwind CSS 4.x | Existing codebase |
| PDF Processing | pdf-lib, pdfjs-dist | Client-side, browser-compatible |
| Excel Export | xlsx (SheetJS) | Existing dependency |
| AI Integration | Groq API (Llama 4) | Unchanged - browser-based HTTP calls |
| Build | Tauri CLI | Produces Windows .exe |

---

## File Structure

```
prism-file-hero/
├── src/                          # React frontend (existing)
│   ├── App.tsx
│   ├── index.tsx
│   ├── services/
│   │   ├── pdfService.ts
│   │   ├── excelService.ts
│   │   └── geminiService.ts
│   └── ...
├── src-tauri/                    # NEW: Tauri backend
│   ├── src/
│   │   └── main.rs              # Rust entry point
│   ├── Cargo.toml               # Rust dependencies
│   ├── tauri.conf.json          # Tauri configuration
│   ├── icons/                   # App icons
│   └── capabilities/            # Permissions config
├── public/                      # Static assets
├── package.json                 # Node dependencies + scripts
├── vite.config.ts               # Vite configuration (update)
├── tsconfig.json
└── tauri-desktop-app.md         # This plan
```

---

## Task Breakdown

### Phase 1: Foundation Setup

#### Task 1.1: Install Tauri Dependencies

- **Agent:** `frontend-specialist`
- **Priority:** P0
- **Dependencies:** None
- **INPUT:** Empty src-tauri folder
- **OUTPUT:** Tauri CLI installed, project initialized
- **VERIFY:** `npm run tauri --version` returns version

```bash
npm install -D @tauri-apps/cli@latest
npm install @tauri-apps/api@latest
npm run tauri init -- --app-name "Prism File Hero" --window-title "Prism File Hero" --dev-url "http://localhost:3000" --before-dev-command "npm run dev" --before-build-command "npm run build" --frontend-dist "../dist"
```

---

#### Task 1.2: Update package.json Scripts

- **Agent:** `frontend-specialist`
- **Priority:** P0
- **Dependencies:** Task 1.1
- **INPUT:** Existing package.json
- **OUTPUT:** Added tauri scripts
- **VERIFY:** `npm run tauri dev` starts app

Add to package.json:
```json
{
  "scripts": {
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  }
}
```

---

#### Task 1.3: Configure Vite for Tauri

- **Agent:** `frontend-specialist`
- **Priority:** P0
- **Dependencies:** Task 1.1
- **INPUT:** vite.config.ts
- **OUTPUT:** Updated vite.config.ts with base path
- **VERIFY:** Build produces correct asset paths

Update vite.config.ts:
```typescript
export default defineConfig(({ mode }) => {
  // ...
  base: './',  // Required for Tauri file:// protocol
  build: {
    target: 'esnext',  // Ensure modern JS output
    outDir: 'dist',
  },
  // ...
});
```

---

### Phase 2: Tauri Backend Configuration

#### Task 2.1: Configure tauri.conf.json

- **Agent:** `frontend-specialist`
- **Priority:** P0
- **Dependencies:** Task 1.1
- **INPUT:** Default tauri.conf.json
- **OUTPUT:** Proper window, security, and build config
- **VERIFY:** Config validates with `npm run tauri info`

Key configurations:
- Window title: "Prism File Hero"
- Window size: 1280x800 (default), resizable
- devtools: enabled (for debugging)
- Build target: nsis (Windows installer)

---

#### Task 2.2: Setup Tauri Permissions

- **Agent:** `security-auditor`
- **Priority:** P0
- **Dependencies:** Task 2.1
- **INPUT:** Default capabilities
- **OUTPUT:** File dialog permissions enabled
- **VERIFY:** Native dialogs work in dev mode

Create/Update `src-tauri/capabilities/default.json`:
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capabilities for Prism File Hero",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:default",
    "dialog:allow-open",
    "dialog:allow-save",
    "dialog:allow-message",
    "dialog:allow-ask",
    "fs:default",
    "fs:allow-read-text-file",
    "fs:allow-write-text-file",
    {
      "identifier": "fs:scope",
      "allow": [
        "$DOCUMENT/**",
        "$DOWNLOAD/**",
        "$DESKTOP/**",
        "$HOME/**"
      ]
    }
  ]
}
```

---

#### Task 2.3: Fix PDF.js Worker for Production

- **Agent:** `frontend-specialist`
- **Priority:** P1
- **Dependencies:** Task 1.3
- **INPUT:** services/pdfService.ts
- **OUTPUT:** PDF.js worker loads correctly in Tauri
- **VERIFY:** PDF conversion works in production build

Update pdfService.ts to handle Tauri environment:
```typescript
// Add worker configuration for Tauri
const isTauri = window.__TAURI__ !== undefined;

pdfjsLib.GlobalWorkerOptions.workerSrc = isTauri
  ? 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs'
  : new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
```

Or copy worker to public folder and reference as local asset.

---

### Phase 3: Native File Integration

#### Task 3.1: Create Preload API for File Dialogs

- **Agent:** `frontend-specialist`
- **Priority:** P2
- **Dependencies:** Task 2.2
- **INPUT:** App.tsx (current file handling)
- **OUTPUT:** Native file dialog integration
- **VERIFY:** Clicking "Select Files" opens native dialog

The browser's `<input type="file">` works in Tauri, but native dialogs provide better UX. This is optional - browser dialogs work out of the box.

---

### Phase 4: Build & Verification

#### Task 4.1: Test Development Mode

- **Agent:** `test-engineer`
- **Priority:** P0
- **Dependencies:** Tasks 1.1, 1.2, 1.3, 2.1
- **INPUT:** Completed setup
- **OUTPUT:** Running Tauri app in dev mode
- **VERIFY:** App launches, UI displays, basic interactions work

```bash
npm run tauri:dev
```

Manual verification checklist:
- [ ] Window opens at correct size
- [ ] React UI renders correctly
- [ ] PDF tools can be selected
- [ ] File drag-and-drop works
- [ ] Browser dev tools accessible (F12)

---

#### Task 4.2: Build Production Executable

- **Agent:** `frontend-specialist`
- **Priority:** P0
- **Dependencies:** Task 4.1
- **INPUT:** Working dev build
- **OUTPUT:** Windows .exe installer
- **VERIFY:** .exe exists in target folder

```bash
npm run tauri:build
```

Output location: `src-tauri/target/release/bundle/nsis/`

---

#### Task 4.3: Verify AI Functionality

- **Agent:** `test-engineer`
- **Priority:** P1
- **Dependencies:** Task 4.2
- **INPUT:** Running production .exe
- **VERIFY:** All AI tools work

Test each AI feature:
- [ ] OCR - Extract text from scanned PDF
- [ ] PDF to Excel - Table extraction
- [ ] PDF to Word - Document reconstruction
- [ ] Redact - PII detection
- [ ] Compare - Document comparison

---

## Phase X: Final Verification

### Pre-Completion Checklist

| Check | Command | Status |
|-------|---------|--------|
| Lint | `npm run lint` (if exists) | - |
| Type Check | `npx tsc --noEmit` | - |
| Dev Build | `npm run tauri:dev` | - |
| Production Build | `npm run tauri:build` | - |
| EXE Exists | Check `src-tauri/target/release/bundle/nsis/` | - |
| AI Tools Work | Manual test each feature | - |
| File Operations | Test open/save dialogs | - |

### Build Output Expectations

```
src-tauri/target/release/
├── Prism File Hero.exe          # Main executable (~10-15MB)
└── bundle/
    └── nsis/
        └── Prism_File_Hero_x.x.x_x64-setup.exe  # Installer (~20-30MB)
```

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| PDF.js worker fails in production | High | Use CDN fallback or bundle worker |
| AI API calls blocked | Medium | Ensure network access, check CSP |
| Large file handling | Medium | 50MB limit already in place |
| WebView2 not installed | Low | Pre-installed on Win10/11, auto-download |

---

## Dependencies Summary

### New Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| @tauri-apps/cli | ^2.x | Build tooling |
| @tauri-apps/api | ^2.x | Frontend bindings |

### Existing Dependencies (Unchanged)

- React 19
- Vite 6
- Tailwind CSS 4
- pdf-lib, pdfjs-dist
- xlsx
- lucide-react
- Groq SDK (for AI)

---

## Implementation Notes

### Why Tauri Over Electron?

1. **Smaller bundle**: ~15MB vs ~150MB
2. **Faster startup**: Uses system WebView2
3. **More secure**: Rust sandbox, smaller attack surface
4. **Same DX**: React + Vite works identically

### AI Functionality Preservation

The AI features use browser-based HTTP calls to Groq API:
- Runs in WebView (Edge)
- No Node.js required
- Works identically to browser version
- Only change: env var handling for production

### File Access

- Browser `<input type="file">` works out of the box
- Optional: Add native dialogs via Tauri API
- All existing file processing (PDF.js, xlsx) runs in WebView

---

## ✅ PHASE X COMPLETE

- [ ] Plan created
- [ ] Tasks defined
- [ ] Dependencies documented
- [ ] Risk assessment complete
- [ ] Ready for implementation

**Date:** 2026-02-13
