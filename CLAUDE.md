# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Available Commands

### Development

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server at http://localhost:3000 |
| `npm run build` | Build the Vite frontend app |
| `npm run preview` | Preview the production build locally |
| `npm test` | Run vitest unit/tests in headless mode |
| `npm run test:watch` | Run vitest in watch mode |
| `npm run pipeline` | Run the document processing pipeline (node pipeline/run.mjs) |
| `npm run pipeline:list-clients` | List pipeline clients |
| `npm run pipeline:list-rules` | List extraction rules |
| `npm run tauri` | Run Tauri desktop app |
| `npm run tauri:dev` | Run Tauri in dev mode |
| `npm run tauri:build` | Build Tauri app |

### Architecture & Structure

This is a **full-stack PDF document processing application** with the following architecture:

#### Frontend (React + Vite)
- `src/App.tsx` - Main application shell with Clerk auth, tool routing, processing flow
- `src/types.ts` - Type definitions (ToolID, ToolHandler, CanonicalTransaction, ProcessStatus)
- `src/store/appStore.ts` - Zustand state management for batch processing, auth, UI state
- `src/registry/toolRegistry.ts` - Tool registry with 25+ tool handlers (merge, split, compress, convert, OCR, etc.)
- `src/components/` - React UI components (views, modals, badges, sidebars)
- `src/hooks/` - Custom React hooks (useExtractionState, useTransactionValidation)

#### Backend (Cloudflare Workers)
- `worker/src/index.ts` - API server with auth (JWT/Clerk), usage tracking, AI provider routing
- Handles: AI extraction requests, usage quotas, device activation, Supabase integration

#### Document Processing Pipeline (`services/documentService.ts`)
The core extraction follows a **multi-strategy pipeline**:

1. **Compression normalization** - Fix PDF flate/compression issues via pdf-lib re-encoding
2. **Bank detection** - Identify bank from statement text/patterns (`services/bankRegistry.ts`)
3. **Bank-specific extractors** - FNB, Capitec, Nedbank, TymeBank have dedicated extractors
4. **Spatial alignment rescue** - Coordinate-based table structure recognition fallback
5. **Generic layout rescue** - Layout-classified extraction for known banks
6. **Universal pipeline** - Multi-strategy: text-layer → OCR → normalized AI → Gemini AI → hybrid
7. **Generic table extraction** - Last resort with Docling integration

#### Bank Detection (`services/bankRegistry.ts`)
- Supports 16+ banks (FNB_SA, ABSA_SA, NEDBANK_SA, ICICI_IN, CAPITEC_SA, TYMEBANK_SA, etc.)
- Pattern matching on header/footer text with confidence scoring
- `detectBank(text)` → returns bankCode, bankName, confidence, matchedPatterns

#### Key Data Types
- `CanonicalTransaction` - Unified transaction schema (date, description, debit, credit, balance, currency)
- `ToolHandler` - Each tool has: id, category, name, description, icon, color, requiresAuth, allowedFileTypes, maxFiles, supportsBatchProcessing, handler
- `ProcessStatus` - IDLE | QUEUED | PROCESSING | COMPLETED | ERROR

#### Important Directories
- `services/` - Document extraction services (pdfService, geminiService, ocrService, normalizer, bankRegistry, etc.)
- `tests/` - Vitest test suite (bank detection, extraction services, unit tests)
- `pipeline/` - Node.js pipeline runner for batch processing
- `worker/` - Cloudflare Workers backend

## Development Workflow

1. **Running tests**: `npm test` runs vitest in jsdom environment
2. **Adding a new tool**: Add a handler object to `src/registry/toolRegistry.ts` TOOL_REGISTRY array
3. **Adding bank patterns**: Update `services/bankRegistry.ts` BANK_PATTERNS record and detection logic
4. **Modifying extraction pipeline**: Update `services/documentService.ts` processDocumentExcel function
5. **Running the pipeline**: `npm run pipeline` for batch/document processing tasks

## Code Style

- TypeScript throughout with ES2022 target
- React components use JSX with function components + hooks
- Zustand for state management
- Vite with TailwindCSS for styling
- Follow existing patterns in the codebase — tools are registered as objects in TOOL_REGISTRY with consistent schema
- Tests use vitest with jsdom; see `tests/setup.ts` for polyfills