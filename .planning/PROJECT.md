# Prism File Hero — Web SaaS

## Product

A browser-based PDF & document intelligence SaaS. Users upload PDFs and get:
- **Free tools (client-side, $0 AI cost):** Merge, split, compress, rotate, JPG<->PDF, protect, watermark
- **AI tools (costs Groq tokens):** PDF->Excel, OCR, Compare, Redact, PDF->Word, bank statement extraction

### Unique Niche
Bank statement parser with South African bank intelligence (FNB, Capitec, ABSA). Grows its own bank registry from patterns. This is the primary differentiator.

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19 + TypeScript + Tailwind 4 + Vite 6 |
| PDF engine | pdfjs-dist 4.0.379 + pdf-lib |
| AI | Groq API (Llama 4 Scout 17B) |
| Build | Vite SPA |
| Desktop | Tauri 2 (separate target, not this plan) |

## Current Security Problem

`services/geminiService.ts:165` - API key read from localStorage in browser.
This MUST be moved to a server-side proxy before monetizing.

## Target Hosting Stack (free tiers)

| Service | Role | Free Tier / Cost |
|---------|------|------------------|
| Cloudflare Pages | Frontend hosting | Unlimited free |
| Cloudflare Workers | AI API proxy + usage check | 100k req/day free |
| Supabase | Auth + Postgres | 50k MAU, 500MB free |
| Paddle | Payments (Merchant of Record) | 5% + 50c per transaction, no monthly fee |
| Cloudflare R2 | File temp storage (optional) | 10GB free |

## Why Paddle, Not Stripe

Stripe does not support SA-registered merchants receiving payouts to South African bank accounts directly.
Paddle is a Merchant of Record — they are the legal seller on your behalf, and you receive payouts via SWIFT to any SA bank.

Additional benefits over Stripe for SA:
- Handles global VAT/tax automatically (you never need to register for VAT yourself)
- Supports ZAR pricing for SA customers (Paddle converts currency automatically)
- Webhook API is structurally identical to Stripe (events -> verify signature -> update DB)
- No US company incorporation or US bank account required
- SA merchants fully supported for receiving payouts

## Groq Cost Math

- Llama 4 Scout: ~$0.11/M input + $0.34/M output tokens
- Typical AI page: ~2,000 input + 500 output = $0.00042/page
- Pro 500 pages/month: ~$0.21 AI cost at $15/mo = ~98% AI margin

## Business Model

| Plan | Price | AI Pages/mo | Max File |
|------|-------|-------------|----------|
| Free | $0 | 10 pages | 10 MB |
| Pro | $15/mo | 500 pages | 50 MB |
| Business | $39/mo | Unlimited (fair use) | 100 MB |

Prices can be displayed in USD or ZAR - Paddle handles the conversion per customer location.

## Key SEO Targets

- "pdf to excel online free"
- "bank statement to excel converter"
- "FNB statement to Excel"
- "Capitec PDF converter"
- "OCR PDF online"
- "redact PDF online free"
