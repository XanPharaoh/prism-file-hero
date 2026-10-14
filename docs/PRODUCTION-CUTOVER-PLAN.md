# Prism File Hero — Production Cutover Plan

Approved by the product owner on 2026-10-14. Executed from commit `bcb8607` on `main`.

This document is the executable contract. The commands below are the ones that actually run against
this repository; where the original specification conflicted with the code on disk, the conflict is
recorded in §0 and the corrected command is used. Nothing was silently substituted.

## 0. Reconciliations against the code as measured

Every item was verified by querying the running local stack or reading the file, not assumed.

| # | The specification said | The code says | What is done instead |
| :--- | :--- | :--- | :--- |
| R1 | `drop function if exists public.reserve_credit(text, text, text, integer, text)` | `pg_proc` reports `reserve_credit(p_request_id uuid, p_user_id text, p_cost integer, p_month text)` | Drop by the real identity. A mismatched `DROP FUNCTION IF EXISTS` is silently skipped and would have left a live function pointing at a dropped table. |
| R2 | `drop function if exists public.settle_credit(text, text, text)` | `settle_credit(p_request_id uuid, p_status text, p_month text)` | Same: real signature. |
| R3 | Keep both `settle_usage(uuid, text)` and `settle_usage(uuid, text, text)` and revoke each | PostgREST answers `300 AmbiguousFunction` for overloaded RPCs when a call matches more than one — already hit once with `apply_paypal_event` | The 2-arg overload is dropped; one `settle_usage(uuid, text, text default null)` remains. Omitting `p_tracking_key` still resolves. |
| R4 | `settle_usage` raises `'not found or already settled'` whenever the UPDATE matches no row | `scripts/quota-policy-check.mjs:126` asserts a second settlement is **accepted without changing the outcome**, and `worker/src/index.ts:875,890` settles after the provider already answered | Three distinct outcomes: no row → raise; row belongs to another tracking key → raise; row already settled → return quietly. Refunds of completed work stay impossible, duplicate settlement stays harmless, cross-user settlement becomes impossible. |
| R5 | 38-tool allowlist omits `fnb-statement`; the verification step expects it to answer `Unknown tool` | `fnb-statement` appears only inside SQL migrations, never in TS (`portfolio-statements` is the registered id) | Drop it, as specified. Safe. |
| R6 | Premium gate covers 7 tools | `services/usageConfig.ts` marks 9 tools `category: 'ai'` (`pdf-qa`, `pdf-summary` included) | Gate all 9 — the specification's list, which is the one that matches the shared table. |
| R7 | `create policy user_plans_select_own`, leaving the old policy in place | `20261010000003_live_table_rls.sql` created `user_plans_read_self` on `user_plans` and `usage_logs_read_self` on `usage_logs` | Drop the legacy names in the same transaction so exactly one self-scope SELECT policy exists per table. |
| R8 | `alter table … force row level security` on all live tables | `pg_roles` shows `postgres` and `service_role` have `rolbypassrls = true` | `FORCE` is applied as specified and is safe here: the `security definer` functions execute as `postgres`, which bypasses RLS, so metering reads and writes keep working. Verified by running the ledger checks after the migration. |
| R9 | `grant all on table … to service_role` while revoking from `anon`/`authenticated`, then only re-grant SELECT on `user_plans` | `services/authService.ts` creates a browser Supabase client; the self-scope SELECT policies on `user_plans` **and** `usage_logs` are the app's own read path | Revoke all direct access from `anon`/`authenticated`, then re-grant SELECT only (never INSERT/UPDATE/DELETE) on `user_plans` and `usage_logs` so the two self-scope policies remain reachable while every client write path is closed at the privilege layer as well as the policy layer. |
| R10 | `subscription_status in ('active','trialing','ACTIVE')` | `user_plans` stores lowercase (`refresh_user_coverage` writes `'active'`) | Compare on `lower(subscription_status)`, which covers the uppercase case without a magic list. |
| R11 | `perform public.refresh_user_coverage(p_user_id)` inside `check_usage_limit` | That function exists (`refresh_user_coverage(text)`), is `security definer`, and **overwrites** `user_plans.plan` from payment evidence — an unconditional call puts a write plus a row lock on every quota check for already-entitled customers, and `scripts/backend-integration-check.mjs:99,119` prove ledger mechanics against a seeded plan row | Re-derive in the refuse direction only: read the stored plan, and if it answers `free`, refresh and re-read. A lagged renewal webhook can no longer cost a paid customer a request, metering stays read-only for entitled traffic, and the case is pinned by a new live assertion in `check:quota` rather than left to a comment |
| R12 | `PAYPAL_CLIENT_SECRET` | `worker/src` reads `env.PAYPAL_SECRET` (`PAYPAL_CLIENT_ID`, `PAYPAL_ENV`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_PLAN_{PRO,BUSINESS}_{MONTHLY,ANNUAL}`) | Secrets are set under the names the code reads. A secret named `PAYPAL_CLIENT_SECRET` would be silently ignored and billing would fail at runtime. |
| R13 | `git rm worker/src/billing/paddleVerify.ts` and `tests/paddleVerify.test.ts` | `worker/src/billing/` contains only `paypalApi.ts` and `urls.ts`; the test file is `tests/paypalVerify.test.ts` | The `paddleVerify` paths are no-ops (`--ignore-unmatch`). Retiring `user_plan`/`plan_grants`/`credit_reservations` does break `tests/creditLedger.test.ts`, `scripts/backend-integration-check.mjs` §1–2 and `scripts/privilege-escalation-check.mjs` R4 — all three are updated in Phase 1, not Phase 4, so no gate is left red. |
| R14 | `settleUsage` callers pass `userId`/`clientIp` | `worker/src/index.ts:875,881,890` call `settleUsage(env, reservation.requestId, status)` | The reservation already carries its tracking key, so `settleUsage` takes the key from the reservation returned by `reserveUsage` rather than re-deriving it from the request. |
| R15 | Phase 3 makes every push to `main` deploy production | Production currently serves a 404 at `/app/` and an August Worker build | The workflow is written and committed but **not pushed**. Pushing it turns "commit" into "ship", which is a production action reserved for Phase 6. |
| R16 | Delete `complete source code with updates.md` and rewrite `AGENTS.md` | `AGENTS.md` §1–6 make that 150,419-line markdown mirror mandatory | Both happen together in Phase 4: the mirror rule is replaced by executable gates. `docs/CODEBASE-DUMP.md` (generated by `scripts/source-dump.mjs`) stays untracked — it is a review artifact, not a source of truth. |
| R17 | "`[env.staging]` restates everything because env vars are not inherited" | Measured, wrangler 3.114 prints exactly this warning for `env.localtest`: *"vars configuration is not inherited by environments"* — so **no** env inherits `[vars]`, `[vars]` is the production default set only | `ENVIRONMENT` and `CLERK_JWT_ISSUER` are set explicitly in every environment, and `env.localtest` gained `ENVIRONMENT = "localtest"` — without it `resolveTrustedIssuer` refuses the local http stand-in issuer and every route test 401s. Localtest's `SUPABASE_URL`/key come from `.dev.vars.localtest`, not from `[vars]`. |
| R18 | (discovered while restarting) Two `wrangler dev` instances on one host | Both bind the miniflare inspector at `127.0.0.1:9229`; whichever starts second dies with `Address already in use` and an esbuild deadlock dump | Start `--env localtest` (:8788) first, then the default env (:8787). Recorded in the runbook because the failure looks like a code error. |
| R19 | "production must not set `ALLOWED_ORIGIN_SUFFIXES`" | `tests/workerCorsConfig.test.ts` asserted the opposite, and the suffix matcher is already strict (https, no port, exactly one label) — so the allowance only ever accepted previews **of this same Pages project** | Followed the plan and updated the test, because the risk is not the preview origin but what it can reach: an unreviewed branch preview talking to live PayPal subscribe endpoints with live credentials. Preview traffic now belongs on the staging Worker. One line in `worker/wrangler.toml` restores the old posture if the team prefers it. |
| R20 | Delete `docsuitekit/` with the other "duplicate directories" | `docsuitekit` is a Python package with 45 tracked files, its own tests (`tests/unit/`), `requirements.txt`, `packaging/` (PyInstaller + WiX MSI), and it is the *only* job in `.github/workflows/build.yml` — the one CI that runs on pull requests | **Kept, with its CI untouched.** Deleting it means deleting a working Windows installer pipeline and the repo's only PR gate, which is a product decision, not hygiene. Say the word and it goes in one commit including `packaging/`, `requirements.txt`, `tests/unit/` and `build.yml`. Everything else on the Phase 4 list was verified unreferenced and is gone. |
| R21 | `worker/src/migrations/002_document_history.sql` is a duplicate schema copy to delete | It is the **only** definition of `document_history`, which `services/historyService.ts` writes to and `App.tsx:610` mounts `HistoryDashboard` for — and the table exists in no environment (not production, not local dev, not local staging). Its `user_id uuid references auth.users` and four `auth.uid()` policies are also pre-Clerk: the ledger moved to text Clerk subjects in `20260806140000`, and a Clerk session gives `auth.uid()` nothing | Moved to `supabase/legacy/document_history.pre-clerk.sql` (never applied by `db push`) with the gap documented, instead of being deleted or silently promoted into the ledger. Making history work is a decision between Worker-backed history routes and a Clerk→Supabase JWT exchange; it is reported as a finding, not fixed by copying SQL. The three genuinely-superseded root `migrations/*.sql` and `worker/src/schema.sql` are deleted. |
| R22 | Phase 6.4 seeds live plans with `insert into public.billing_price_plans (provider, price_id, plan, billing_interval, currency, unit_amount_cents, active)` | `information_schema.columns` reports exactly three columns on that table: `price_id`, `plan`, `label` | Phase 6.4 step 2 has to become `insert into public.billing_price_plans (price_id, plan, label) values ('<LIVE_PRO_MONTHLY>','pro','Pro monthly'), ('<LIVE_PRO_ANNUAL>','pro','Pro annual') on conflict (price_id) do update set plan = excluded.plan, label = excluded.label`. As written it fails on the first unknown column. Money is not stored here at all — PayPal is the price authority, so a `unit_amount_cents` in this table would have been the database lying about a live product. **Not executed; recorded for Phase 6.** |

## 1. Baseline vs. target

| Surface | Measured baseline (`main` @ `bcb8607`) | Target |
| :--- | :--- | :--- |
| Pages `prismfilehero.com` | `/` = 200 (marketing only); `/app/` = 404 — `deploy.yml` uploads `./site`, never `./deploy` | `./deploy`: `/` marketing + `/app/` workspace + `_worker.js` router |
| Worker `prism-worker` | Early-August build: `/api/ai`, `/api/execute`, `/api/usage/report` live (401), `/api/billing/*` and `/api/paypal/webhook` = 404; Groq×3 / Mistral×3 / NVIDIA keys present; no `PAYPAL_*`; `SUPABASE_JWT_SECRET` and `SUPABASE_JWK_PUBLIC_KEY` unused | Deployed from `main` with `AI_PROXY_ENABLED`, pinned `CLERK_JWT_ISSUER`, PayPal secrets, unused Supabase JWT secrets deleted |
| Supabase `vejdrvnymmowvjxleefm` | `usage_logs` + `user_plans` only | Full migration ledger incl. `20261015000001` |
| Local ledger functions | `check_usage_limit` allowlists 18 of 38 tools → `pdf-qa`, `pdf-summary`, 20 local tools answer `Unknown tool`; Paddle-era `user_plan`, `plan_grants`, `credit_reservations` still live | 38-tool parity, 9-tool premium gate, legacy objects retired, RLS forced |
| PayPal renewal binding | `canBindWindow` requires exact equality of `sale.create_time` and `billing_info.last_payment.time` | Tolerates ±15 minutes of drift while `next_billing_time` is in the future |

## 2. Phase 1 — Database schema consolidation, 38-tool parity, RLS hardening

1. Author `supabase/migrations/20261015000001_production_schema_hardening.sql`.
2. Apply it to the local dev container and the local staging container with `ON_ERROR_STOP=1`.
3. Verify with `psql`:
   - `free + pdf-qa` → `allowed = f`, reason `This tool needs a paid plan`
   - `free + delete-pages` → `allowed = t`
   - `free + fnb-statement` → `allowed = f`, reason `Unknown tool`
4. Retire the credit-ledger assertions in `scripts/backend-integration-check.mjs` (its §1–2 were
   proving the parallel Paddle metering system) and the `credit_reservations`/`plan_grants` rows in
   `scripts/privilege-escalation-check.mjs`, replacing them with assertions about the live ledger.
5. Add 3-way parity to `scripts/quota-policy-check.mjs`: `src/registry/toolRegistry.ts` ≡
   `services/usageConfig.ts` ≡ the SQL allowlist, and `category: 'ai'` ≡ the SQL premium set.

Gates: `npm run check:backend && npm run check:privilege && npm run check:quota && npm run check:schema-release`.

## 3. Phase 2 — Worker security and billing hardening

1. `worker/src/index.ts`: `resolveTrustedIssuer(env)` — `CLERK_JWT_ISSUER` is required unless
   `ENVIRONMENT === 'localtest'`; the JWKS-derived issuer is no longer a trusted fallback on a
   deployed Worker, removing the single-variable trust anchor.
2. `worker/src/index.ts`: `AI_PROXY_ENABLED` circuit breaker ahead of any provider call in
   `POST /api/ai`, so paid spend can be halted with one `wrangler secret put`.
3. `worker/src/usageTracker.ts`: `settleUsage` sends `p_tracking_key`.
4. `worker/src/billing/paypalApi.ts`: `canBindWindow` / `coverageWindow` drift tolerance.
5. `worker/wrangler.toml`: `ENVIRONMENT` and `CLERK_JWT_ISSUER` explicit per environment; production
   sets no `ALLOWED_ORIGIN_SUFFIXES`.
6. `tests/paypalVerify.test.ts`: a 45-second renewal drift binds `[sale.create_time, next_billing_time]`;
   a sale from the previous cycle (30 days back) is refused.

## 4. Phase 3 — CI/CD cutover

`.github/workflows/deploy.yml` builds `./deploy` with `npm run release:build`, verifies it under
Playwright with `npm run check:release`, typechecks app + worker, runs the test suite, deploys
`prism-worker`, then deploys `./deploy` to Pages. Written and committed in Phase 3; **not pushed**
(see R15).

## 5. Phase 4 — Repository hygiene

`git rm` the duplicate schema copies (`migrations/` × 4, `worker/src/schema.sql`), the Paddle-era
modules (`worker/src/planCatalog.ts`, `worker/src/creditLedger.ts`) and their test,
`src/components/originkit/` and its test, the legacy experiment directories (`site-v2/`,
`pdf_toolkit/`, `docling-hf-space/`, and the 36 tracked files of `Prism File Hero Desktop/`), and the
150,419-line `complete source code with updates.md`, plus the empty `USAGE_SYSTEM_DIAGNOSIS.md` and
the stale `SOURCE-MANIFEST.txt`. `tsconfig.json` loses the exclude entry for a directory that no
longer exists. `AGENTS.md` is rewritten around executable gates.

Two deviations, both recorded above: `docsuitekit/` + `packaging/` + `build.yml` stay (R20 — it is a
separate Python product with the only PR-running CI), and `document_history` is preserved in
`supabase/legacy/` with its gap documented rather than deleted or promoted (R21).

`git rm` never touches ignored files, so the 6.1 GB of ignored build output under
`Prism File Hero Desktop/` is still on disk. Deleting it is not recoverable from git, so it is left
for the owner to remove deliberately.

## 6. Phase 5 — Gate battery

`npx tsc --noEmit`, `worker` typecheck, `npx vitest run`, `check:schema-release`, `check:backend`,
`check:privilege`, `check:worker`, `check:quota`, `check:auth-isolation`, then both release artifacts
(`release:build:staging` + `PRISM_ARTIFACT_ENV=staging check:release`, `release:build` + `check:release`).
Commit only when every gate reports zero failures.

## 7. Phase 6 — Staging rehearsal and production cutover (PAUSED)

Phase 6.1 (delete unused `SUPABASE_JWT_*` secrets from the live Worker), 6.2 (hosted staging project +
rotated PayPal sandbox credentials), 6.3 (production backup and `db push`), 6.4 (live PayPal secrets,
production deploy) and 6.5 (post-cutover verification and rollback) are **not executed**. They need an
interactive `supabase login` and rotated PayPal credentials from the product owner, and 6.3–6.4 mutate
production. The plan stops here on instruction.

Rollback for anything already applied locally: `git revert` the phase commit; for the local database,
re-apply the previous function definitions from `20261014000001_quota_policy_one_truth.sql`.
