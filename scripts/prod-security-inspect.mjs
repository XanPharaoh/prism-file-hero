#!/usr/bin/env node
/**
 * Item 6 — READ-ONLY production security inspection. Prepares (does not perform) an inspection of the
 * DEPLOYED schema's RLS flags, policies, table grants, and privileged-function permissions, so the
 * locally-demonstrated RLS finding can be confirmed or refuted against production evidence.
 *
 * HARD LIMITS: metadata/catalog only. It NEVER reads customer documents or row data, and runs every
 * statement in a READ ONLY transaction (default_transaction_read_only=on). No mutations. It requires
 * an operator-supplied connection string and changes nothing.
 *
 * Usage: PG_SSLMODE=require postgresql://user:pass@host:5432/postgres node scripts/prod-security-inspect.mjs
 * (pass the DSN via env/argument, NEVER commit it). Exits 2 (PENDING) if no DSN is provided.
 */
import { spawnSync } from 'node:child_process';

const DSN = process.env.PROD_PG_URL || process.argv[2] || '';
const TABLES = ['user_plans', 'user_plan', 'usage_logs', 'credit_reservations', 'plan_grants', 'billing_events', 'billing_subscriptions', 'billing_customers', 'billing_price_plans'];
const PRIV_FUNCS = ['apply_paypal_event', 'begin_paypal_subscription', 'refresh_user_coverage', 'ensure_billing_customer', 'get_user_entitlement', 'reserve_usage', 'settle_usage', 'check_usage_limit', 'reserve_credit', 'settle_credit', 'resolve_plan_for_price'];

if (!DSN) { console.error('PENDING: provide a read-only production DSN via PROD_PG_URL (or as argv). Not run — no connection, no changes.'); process.exit(2); }
if (/\b(vejdrvnymmowvjxleefm\.supabase\.co)\b/.test(DSN) === false && !/supabase/i.test(DSN)) {
  console.warn('NOTE: DSN does not look like the Supabase project host; confirm you intend to inspect the intended production DB.');
}

const inList = (arr) => `('${arr.join("','")}')`;
const queries = {
  'RLS enabled per table': `select relname, relrowsecurity, relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname in ${inList(TABLES)} order by relname;`,
  'Policies (name, table, cmd, roles, qual)': `select tablename, policyname, cmd, array_to_string(roles,',') roles, coalesce(qual,'(none)') using, coalesce(with_check,'(none)') check from pg_policies where schemaname='public' and tablename in ${inList(TABLES)} order by tablename, policyname;`,
  'Table grants to anon/authenticated': `select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name in ${inList(TABLES)} and grantee in ('anon','authenticated') order by table_name, grantee;`,
  'Privileged function EXECUTE grantees': `select p.proname, pg_catalog.pg_get_userbyid(p.proowner) owner, (select array_agg(distinct ac.privilege_type) from information_schema.routine_privileges ac where ac.routine_name=p.proname and ac.grantee in ('PUBLIC','anon','authenticated')) non_service_grants from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ${inList(PRIV_FUNCS)} order by p.proname;`,
};

const run = (label, sql) => {
  const r = spawnSync('psql', [DSN, '-v', 'ON_ERROR_STOP=1', '-c', 'SET default_transaction_read_only = on;', '-c', sql], { encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on' } });
  console.log(`\n### ${label}`);
  if (r.status !== 0) { console.log('ERROR:', (r.stderr || r.stdout).trim().split('\n').slice(0, 3).join(' | ')); }
  else console.log(r.stdout.trim() || '(no rows)');
};

let psql = spawnSync('psql', ['--version'], { encoding: 'utf8' });
if (psql.status !== 0) { console.error('PENDING: psql client not available in this environment. Install psql or run these read-only queries via your DB client. Queries below.'); }
for (const [label, sql] of Object.entries(queries)) {
  if (psql.status !== 0) { console.log(`\n### ${label}\n${sql}`); continue; }
  run(label, sql);
}
console.log('\n(Read-only inspection only. No row data, no mutations. Compare against the local finding: user_plans/usage_logs must have relrowsecurity=true with a read-self policy; privileged fns must NOT grant EXECUTE to PUBLIC/anon/authenticated.)');
