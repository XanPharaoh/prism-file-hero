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
  PAYPAL_CLIENT_ID=...  PAYPAL_SECRET=...  PAYPAL_ENV=sandbox  PAYPAL_WEBHOOK_ID=...
  PAYPAL_PLAN_PRO_MONTHLY=P-...   # + the other three allowlisted plan ids
  FRONTEND_URL=http://127.0.0.1:5173                    # where PayPal returns the buyer (see §7)
  ALLOWED_ORIGINS=http://127.0.0.1:5173,http://127.0.0.1:4173   # browser origins the Worker accepts
  ```
  Without `FRONTEND_URL` the subscribe route answers `503 {configured:false}` by design — it will not
  send a buyer to a host it guessed. Paddle is gone: no `PADDLE_*` variable is read anywhere.
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
npm run check:backend            # 32 — DB authority vs real PostgREST (needs §1 + tokens)
npm run check:privilege          # 29 — privilege escalation (self-upgrade, credits, privileged fns, cross-user)
npm run check:paypal-entitlement # 12 — PayPal access policy/idempotency/ownership (no PayPal creds needed)
npm run check:worker             # 15 — Worker routes over HTTP (needs §1,§2 + a local JWKS stand-in)
npm run check:checkout           # 13 — both PayPal browser return flows (see the note under §4)
npm run check:conversions        # real office→pdf; AUTO-builds prism-lo; FAILS LOUD if no Docker
npm run check:offline-ocr        # site OCR with all non-local network blocked; 0 external requests
npm run browser:evidence         # static-site redact+merge, saves evidence/
npm run check:app                # built Vite app → real browser download (needs npm run build + vite preview)
npm test                         # 718 passed / 5 skipped (the skips, below, are intentional)
```
For `check:worker` / `check:app`, start the helpers first:
```
node scripts/local-jwks.mjs &                         # local Clerk RS256 stand-in (:8799)
(cd worker && npx wrangler dev --port 8787 --ip 127.0.0.1) &   # Worker on local stack
npm run build && npm run preview -- --port 4173 &     # for check:app only
```

`npm run check:checkout` (13) drives BOTH PayPal browser return flows in Chromium against the local
Worker + DB, so it additionally needs the dev server pointed at the local Worker — `.env.local` in this
repo binds the browser to the DEPLOYED Worker and a live Clerk instance, so override both:
```
VITE_CLERK_PUBLISHABLE_KEY= VITE_WORKER_BASE_URL=http://127.0.0.1:8787 \
VITE_WORKER_URL=http://127.0.0.1:8787 npx vite --port 5173 --strictPort
```
It substitutes the locally minted token for the Clerk *session* only; the entitlement answer it asserts
is the real server's. Screenshots land in `evidence/checkout-return/`.

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
  `check:paypal-entitlement` (12) + `check:worker` (forged webhook → 401 grants nothing; subscribe
  → pending + approve URL grants nothing; cancel ownership 403). The network-dependent steps are
  gated and exit **2 (PENDING)** without real sandbox creds:
  - `npm run check:paypal-capability` — verifies the account's Subscriptions + USD capability and
    creates/reuses the sandbox PRODUCT + monthly/annual PLANS; prints plan ids.
    Needs `PAYPAL_CLIENT_ID`/`PAYPAL_SECRET` (+ `PAYPAL_ENV=sandbox`) from a developer.paypal.com app.
  - `npm run check:paypal-sandbox` — subscribe → server confirm → verified signed webhook →
    entitlement → paid access, incl. duplicate + cross-user. Needs the above + `PAYPAL_WEBHOOK_ID`
    and the sandbox plan ids registered in `billing_price_plans` + `worker/.dev.vars`.
  Client Secret + webhook verification stay server-side; live payments are a separate decision.
  `check:worker` reads `worker/.dev.vars` and asserts the *no-credentials* branch when they are
  absent and the *real sandbox* branch (201 pending, no grant, cancel semantics) when present, so it
  is honest in either environment instead of silently skipping.

## 7. Replaying a REAL PayPal webhook delivery locally (needs sandbox creds + a tunnel)
PayPal signs subscription webhooks with `paypal-auth-version: v2`, which carries
`paypal-transmission-sig`. The verifier request is exactly
`auth_algo, cert_url, transmission_id, transmission_sig, transmission_time, webhook_id, webhook_event`
where `webhook_event` is the **parsed JSON object** — the legacy `event_body` field and an
`auth_version` field are both rejected by the schema. See `docs/audit/baseline.md` §29 for how that was
established and the tamper matrix that proves the gate is still fail-closed.

To redeliver a genuine event instead of trusting a simulator:
```
npx cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate      # note the *.trycloudflare.com URL
# repoint the registration (export the variable; do not pass it as an argv):
node --input-type=module -e ' ... PATCH /v1/notifications/webhooks/<WEBHOOK_ID> [{op:"replace",path:"/url",value:process.env.WH_URL}] ... '
# resend the stored event — PayPal re-signs it and keeps the same event id:
node --input-type=module -e ' ... POST /v1/notifications/webhooks-events/<EVENT_ID>/resend ... '
```
The event id to resend is in the delivery payload's `links[]` (`rel: "resend"`), and the dashboard's
Message Reporting shows the same failures. A stored event id proves durable handling; resending it
again must return HTTP 200 with apply result `duplicate` and must not add a row.
- Live AI (`/api/ai` model output) needs NVIDIA/Groq/Mistral keys (separately authorized).
- Deployed Worker + remote Supabase schema/RLS verification is a separate authorized step
  (`npm run inspect:prod-security`, read-only, gated on a DSN).
