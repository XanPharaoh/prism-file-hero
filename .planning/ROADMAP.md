# Roadmap — Prism File Hero Web SaaS

## Goal

Ship a monetized web SaaS from the existing Tauri/desktop codebase with minimum infrastructure cost and maximum revenue potential.

---

## Phase 01: Secure Backend + Deploy

**Goal:** Remove client-side API key, proxy all AI calls through a Cloudflare Worker, and deploy the frontend to Cloudflare Pages. The app is publicly live but free-only at this stage.

**Requirements:** DEPLOY-01, DEPLOY-02, SECURITY-01

**Plans:**
- [ ] 01-01-PLAN.md — Cloudflare Worker: Groq AI proxy
- [ ] 01-02-PLAN.md — Remove client-side key, wire frontend to Worker
- [ ] 01-03-PLAN.md — Cloudflare Pages deployment config + CI

---

## Phase 02: Auth + Metering

**Goal:** Users can sign up, log in, and the system tracks + enforces per-plan usage limits. Free tier gates enforced server-side.

**Requirements:** AUTH-01, AUTH-02, METER-01, METER-02

**Plans:**
- [ ] 02-01-PLAN.md — Supabase schema: users, plans, usage_logs
- [ ] 02-02-PLAN.md — Auth UI (sign up, login, account modal)
- [ ] 02-03-PLAN.md — Usage middleware in Worker + frontend enforcement

---

## Phase 03: Payments (Paddle)

**Goal:** Users can subscribe to Pro or Business plans. Paddle Checkout handles payments; Paddle webhook activates the plan in Supabase. Paddle acts as Merchant of Record so SA bank payouts work natively.

**Requirements:** PAY-01, PAY-02, PAY-03

**Plans:**
- [ ] 03-01-PLAN.md — Paddle checkout session + Worker endpoint
- [ ] 03-02-PLAN.md — Paddle webhook handler + pricing UI


---

## Phase 04: Landing Page + SEO

**Goal:** Public landing page targeting high-intent keywords. Separate from the app UI. Drives free signups → Pro conversions.

**Requirements:** SEO-01, SEO-02

**Plans:**
- [ ] 04-01-PLAN.md — Landing page component + routing
- [ ] 04-02-PLAN.md — Pricing page + privacy/terms pages

---

## Requirements Registry

| ID | Description |
|----|-------------|
| DEPLOY-01 | Cloudflare Worker handles all Groq API calls |
| DEPLOY-02 | Frontend deployed to Cloudflare Pages, CI on push |
| SECURITY-01 | No API key in client bundle or localStorage |
| AUTH-01 | Users can register via email/password (Supabase) |
| AUTH-02 | Users can log in and see their current plan + usage |
| METER-01 | Worker checks usage before processing (DB lookup) |
| METER-02 | Worker increments usage_logs after successful AI call |
| PAY-01 | Stripe Checkout session created for Pro/Business upgrade |
| PAY-02 | Stripe webhook updates Supabase plan on payment |
| PAY-03 | Cancelled/expired subscriptions degrade back to Free |
| SEO-01 | Landing page with H1/H2 targeting primary keywords |
| SEO-02 | Meta tags, sitemap, robots.txt, OG image |
