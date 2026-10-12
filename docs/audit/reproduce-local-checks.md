# Reproducing the local checks from a fresh checkout

Everything here runs **locally only** (Docker containers bound to 127.0.0.1; a local, disposable
Supabase project; a `wrangler dev` Worker reading gitignored `.dev.vars`). No production deploy, no
remote DB writes, no paid AI, no third-party charges. Never point these at the linked remote
(`vejdrvnymmowvjxleefm`).

## 0. Prerequisites
- **Docker** daemon running (the Supabase stack, LibreOffice engine, and Postgres run in containers).
- **Node** 20+ (repo `.nvmrc`/engines) and `npm ci` (both `package-lock.json` and `worker/package-lock.json` are committed → pinned transitive deps).
- **Supabase CLI v2.120.0** — install the pinned binary, e.g.
  `curl -L https://github.com/supabase/cli/releases/download/v2.120.0/supabase_2.120.0_linux_amd64.tar.gz | tar xz` → put `supabase` on PATH.
- **Playwright Chromium** — `npx playwright install chromium` (headless is enough).
- **wrangler 4.69.0** (pinned in `worker/package-lock.json`).

### Pinned versions (reproducibility)
| Component | Pinned | Where recorded |
|---|---|---|
| Supabase CLI | 2.120.0 | this doc |
| wrangler | 4.69.0 | `worker/package-lock.json` |
| Postgres (local) | 17 | `supabase/config.toml` `major_version` |
| LibreOffice engine | 7.4.x (debian bookworm) | `tools/libreoffice/Dockerfile` → image `prism-lo` |
| Tesseract worker/core | 5.1.1 | `scripts/vendor-ocr-assets.mjs` |
| eng.traineddata | 1.0.0 (`4.0.0_best_int`) | `scripts/vendor-ocr-assets.mjs` + lock SHA-256 |

## 1. Start the local DB and apply migrations
```
supabase init                 # once (creates supabase/config.toml — safe to commit, no secrets)
supabase start                # spins the local stack on 127.0.0.1:54321
supabase db reset --local     # FRESH apply of all migrations (verify --local; NEVER bare db push/--linked)
```
Migrations (applied in order): `…0626 rpc_functions` → `…0806 unify_usage_ledger` → `20261010000000`
(plan/credit ledger) → `20261010000001` (billing inbox) → `20261010000002` (billing grants live plan) →
`20261010000003` (RLS on user_plans/usage_logs) → `20261010000004` (fix authenticated plan-ambiguity).

## 2. Local dev secrets (kept OUT of git)
- `worker/.dev.vars` (gitignored) — for `wrangler dev`:
  ```
  SUPABASE_URL=http://127.0.0.1:54321
  SUPABASE_SERVICE_ROLE_KEY=<service_role JWT printed by supabase start>
  CLERK_JWKS_URL=http://127.0.0.1:8799/.well-known/jwks.json   # local Clerk stand-in (tests only)
  PADDLE_WEBHOOK_SECRET=local-dev-...                         # placeholder; real one only for sandbox
  ```
  `.dev.vars`, `.env*` (except `.env.example`), `.localdev/`, `supabase/.temp/`, `/evidence/` are all
  gitignored. Do not `wrangler secret put` for local dev; do not commit generated tokens.
- Mint the test role/user tokens: `npm run tokens:local` → writes `.localdev/tokens.json` from the
  LOCAL jwt secret (env `SUPABASE_JWT_SECRET`, the auth container, or the well-known local default).

## 3. OCR assets (offline bundle)
```
npm run vendor:ocr           # verifies present files against the SHA-256 lock (no network if cached)
npm run vendor:ocr:update    # re-download pinned assets + regenerate the lock (needs network once)
```
Output: `site/assets/vendor/tesseract/**` + `ocr-assets.lock.json` (committed). A mismatch is a hard
fail. The site loader (`site/assets/tool.js` `OCR_OPTS`) points at these same-origin files.

## 4. Run the checks
```
npm run check:backend            # 27 — DB authority vs real PostgREST (needs §1 + tokens)
npm run check:privilege          # 23 — privilege escalation (self-upgrade, credits, privileged fns, cross-user)
npm run check:paypal-entitlement # 16 — PayPal access policy/idempotency/ownership (no PayPal creds needed)
npm run check:worker             # 13 — Worker routes over HTTP (needs §1,§2 + a local JWKS stand-in)
npm run check:conversions        # real office→pdf; AUTO-builds prism-lo; FAILS LOUD if no Docker
npm run check:offline-ocr        # site OCR with all non-local network blocked; 0 external requests
npm run browser:evidence         # static-site redact+merge, saves evidence/
npm run check:app                # built Vite app → real browser download (needs npm run build + vite preview)
npm test                         # 708 passed / 5 skipped (the skips, below, are intentional)
```
For `check:worker` / `check:app`, start the helpers first:
```
node scripts/local-jwks.mjs &                         # local Clerk RS256 stand-in (:8799)
(cd worker && npx wrangler dev --port 8787 --ip 127.0.0.1) &   # Worker on local stack
npm run build && npm run preview -- --port 4173 &     # for check:app only
```

## 5. The five skipped tests (intentional, and how to actually run them)
Running `npx vitest run` alone skips 5 tests in 2 files because it assumes no Docker engine / the
public build. They are **not** gaps in the code:
1–3. `tests/libreofficeConversion.test.ts` — `docx multi-page`, `xlsx`, `pdftotext render`. Gated by
  `sofficeAvailable()`; they SKIP under plain `vitest run` (no `soffice` on PATH) and RUN under
  **`npm run check:conversions`** (installs the shim → 11 passed).
4–5. `tests/internalAiAuth.test.ts` — 2 internal-desktop device-token tests. Gated by
  `isInternalDesktopDistribution` (`VITE_DISTRIBUTION=internal-desktop`); skipped in the public build
  and RUN under **`npm run test:internal-desktop`** (2 passed).

The LibreOffice *provider* unit file (`tests/libreofficeProvider.test.ts`) reports "skipped with a
reason" for its live-conversion case when no binary is present — that case also runs under
`npm run check:conversions`. A skipped conversion is NEVER presented as a passing one.

## 6. Credential/deploy-gated (documented, NOT part of the local run)
- Billing provider is **PayPal Subscriptions** (Paddle removed). Local LOGIC is fully verified via
  `check:paypal-entitlement` (16) + `check:worker` (unverified webhook 401, subscribe-without-creds
  503). The network-dependent steps are gated and exit **2 (PENDING)** without real sandbox creds:
  - `npm run check:paypal-capability` — verifies the account's Subscriptions + USD capability and
    creates/reuses the sandbox PRODUCT + monthly/annual PLANS; prints plan ids.
    Needs `PAYPAL_CLIENT_ID`/`PAYPAL_SECRET` (+ `PAYPAL_ENV=sandbox`) from a developer.paypal.com app.
  - `npm run check:paypal-sandbox` — subscribe → server confirm → verified signed webhook →
    entitlement → paid access, incl. duplicate + cross-user. Needs the above + `PAYPAL_WEBHOOK_ID`
    and the sandbox plan ids registered in `billing_price_plans` + `worker/.dev.vars`.
  Client Secret + webhook verification stay server-side; live payments are a separate decision.
- Live AI (`/api/ai` model output) needs NVIDIA/Groq/Mistral keys (separately authorized).
- Deployed Worker + remote Supabase schema/RLS verification is a separate authorized step
  (`npm run inspect:prod-security`, read-only, gated on a DSN).
