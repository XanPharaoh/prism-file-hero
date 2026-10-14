# AGENTS.md — Repository Engineering Protocol

## 1. Authoritative sources of truth

| Concern | The one place it lives | What enforces it |
| :--- | :--- | :--- |
| Database schema, RLS, ledger RPCs | `supabase/migrations/` | `npm run check:schema-release` (fresh install, upgrade path, backup/restore) |
| Tool catalogue, processing class, plan ceilings | `src/registry/toolRegistry.ts` + `services/usageConfig.ts` | `npm run check:quota` proves both lists equal the SQL allowlist in `check_usage_limit` |
| Billing state | `billing_events` (raw inbox) → `apply_paypal_event` → `billing_payments` → `refresh_user_coverage` → `user_plans` | `npm run check:backend`, `npm run check:privilege` |
| Release packaging | `npm run release:build` (production) / `release:build:staging` assemble `./deploy` | `npm run check:release` boots the artifact in a Pages runtime against a real Worker + real Postgres |
| Environment bindings | `worker/wrangler.toml` — every environment restates its own `vars`, because wrangler does **not** inherit `[vars]` into `[env.*]` | `npm run check:clerk-pair`, `scripts/staging-probe.mjs` |

There is exactly **one** metering system: `usage_logs` + `reserve_usage` / `settle_usage` / `check_usage_limit`.
A parallel credit ledger is how the Paddle-era tables ended up unread and unreconciled against PayPal.
`supabase/migrations/20261015000001_production_schema_hardening.sql` retired it; nothing may bring a
second one back.

`supabase/legacy/` is not a migration directory and `supabase db push` never applies it. Files there
are dead features' specifications kept on purpose — read the header before using one.

## 2. Mandatory verification gates

Run, in this order, before committing anything that touches schema, billing, quota, auth or UI:

1. `npx tsc --noEmit` and `npm run typecheck --prefix worker`
2. `npm test` (vitest)
3. `npm run check:schema-release` — when `supabase/migrations/` changed
4. `npm run check:backend`, `npm run check:privilege`, `npm run check:quota`, `npm run check:auth-isolation`,
   `npm run check:worker` — these need the local stack: `supabase start`, `node scripts/local-jwks.mjs`
   (:8799), `npm run tokens:local`, and `wrangler dev --env localtest` on :8788
5. `npm run release:build && npm run check:release` — needs the default-env Worker on :8787
6. Staging work: `npm run release:build:staging && PRISM_ARTIFACT_ENV=staging npm run check:release`,
   then `node scripts/staging-probe.mjs` against the deployed staging URLs

Start `wrangler dev` for `--env localtest` **before** the default environment: both bind the miniflare
inspector at `127.0.0.1:9229`, and the second one dies with `Address already in use` plus an esbuild
deadlock dump that looks like a code error.

## 3. THE GOLDEN RULE: no ghost claims

Nothing may be recorded as done — in a commit message, a changelog, `docs/audit/`, or a report to the
user — that has not been verified to exist on disk and to pass the gate that proves it works.

1. **READ** the file from disk. 2. **EDIT**. 3. **VERIFY** by re-reading or running the check.
4. **DOCUMENT** only after step 3 passes.

## 4. Anti-hallucination checks before claiming completion

- Did I actually write this, or did I plan to?
- If I grep for the new symbol right now, does it return a result?
- Did the gate that would catch this class of bug actually run, and what was its pass count?
- Is every claim about an environment backed by a probe of that environment (never by reading config
  and assuming)?

If any answer is "no" or "unsure", stop and do the missing work. A check that was never run is not a
pass.

## 5. Error recovery

If a claim turns out to be wrong (documented but not on disk, "fixed" but the gate still fails):

1. Halt new feature work. 2. Read the real state from disk. 3. Fix the real state. 4. Verify.
5. Correct the record in `docs/audit/baseline.md` with a dated entry saying what was wrong, what was
measured, and what the corrected result is.

## 6. Strict prohibitions

- Do not summarize a change where the reader needs the code, and do not present a plan as a result.
- Do not assume file state from an earlier context window; read it fresh.
- Do not add a second copy of a schema, a plan table, a tool list, or a quota rule "for convenience"
  — the parity checks exist so the lists can be kept equal.
- Do not put secrets in tracked files: `worker/.dev.vars*`, `.env.*`, `evidence/**/*token*` are
  ignored for that reason; neither are credentials to be pasted into chat, commits, or logs.
- Do not mutate production resources, push code, or deploy without an explicit, scoped instruction.
  The production deploy is `.github/workflows/deploy.yml` running on push to `main`.
- Do not delete an untracked directory to free disk space without asking: 6 GB of ignored build
  output is not recoverable from git.
