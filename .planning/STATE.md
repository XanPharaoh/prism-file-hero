# State — Prism File Hero Web SaaS

## Current Position

**Phase:** 01 — Secure Backend + Deploy  
**Status:** Planning  
**Date:** 2026-03-02

## Locked Decisions

- **AI provider:** Groq (Llama 4 Scout 17B) — already wired, not changing
- **Frontend:** React + TypeScript + Vite + Tailwind — existing, not rewriting
- **Proxy layer:** Cloudflare Workers — free tier covers launch
- **Auth/DB:** Supabase — free tier covers 50k MAU
- **Payments:** Paddle (Merchant of Record)
- **Frontend deploy:** Cloudflare Pages

## Deferred Ideas

- Mobile app wrapper (React Native / Capacitor)
- Team seats / multi-user workspace (Phase 4+)
- Custom API access for developers
- White-label licensing
- Offline-first PWA (Tauri handles offline separately)

## Open Questions

- Domain name: not yet chosen
- Pricing confirmed: Free($0), Pro($15), Business($39)
- Groq API key: currently user-provided, will move to server-owned in Phase 01
- BYOK mode: deferred — decide after launch

## Known Issues

- `services/geminiService.ts:165` — API key read from localStorage (SECURITY-01 fixes this)
- `services/pdfService.ts:7` — Tauri mode loads pdf.worker from CDN (offline risk for desktop, not web scope here)
