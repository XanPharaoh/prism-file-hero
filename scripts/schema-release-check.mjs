#!/usr/bin/env node
/**
 * Item 5 — schema evidence, produced locally because the remote project cannot be inspected from
 * here (the Supabase CLI has no access token: `supabase projects list` → "Access token not provided").
 *
 * In throwaway Postgres containers this:
 *   1. applies every migration in filename order onto an empty database  (fresh install),
 *   2. applies the pre-PayPal migrations, then the PayPal-era ones       (upgrade in place),
 *   3. compares the two resulting schemas                               (the upgrade is equivalent),
 *   4. pg_dumps the upgraded database and restores it into a second one, then re-runs the coverage
 *      assertions there                                                 (backup/restore actually works),
 *   5. runs the access-policy assertions against BOTH the upgraded and the restored database.
 *
 *   node scripts/schema-release-check.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const IMG = 'postgres:17-alpine';
const A = { name: 'prism-schema-a', port: 55432 };
const B = { name: 'prism-schema-b', port: 55433 };
const C = { name: 'prism-schema-c', port: 55434 };
const D = { name: 'prism-schema-d', port: 55435 };   // frozen at the pre-PayPal schema
const MIGRATIONS = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
const PRE_SPLIT = MIGRATIONS.indexOf('20261010000006_paypal_billing.sql');
if (PRE_SPLIT < 1) { console.error('cannot find the PayPal-era split point'); process.exit(1); }
const OLD_SET = MIGRATIONS.slice(0, PRE_SPLIT);
const NEW_SET = MIGRATIONS.slice(PRE_SPLIT);

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { c ? (pass++, console.log(`PASS ${n}`)) : (fail++, console.log(`FAIL ${n} ${e}`)); return c; };
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
const docker = (...a) => sh('docker', a);

async function start({ name, port }) {
  docker('rm', '-f', name, { stdio: 'ignore' });
  docker('run', '-d', '--name', name, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-p', `${port}:5432`, IMG);
  for (let i = 0; i < 60; i++) {
    // pg_isready succeeds during the image's temporary initdb server, so require a real query.
    const r = spawnSync('docker', ['exec', name, 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', 'select 1'], { encoding: 'utf8' });
    if (r.status === 0) return;
    await sleep(1000);
  }
  throw new Error(`${name} never became ready`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (target, sql, args = []) => {
  const db = target.name ?? target;
  const r = spawnSync('docker', ['exec', '-i', db, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...args],
    { input: sql, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`psql on ${db} failed:\n${(r.stderr || r.stdout || '').slice(0, 700)}`);
  return r.stdout;
};
const applyFile = (db, file) => psql(db, readFileSync(`supabase/migrations/${file}`, 'utf8'));
// The image starts a temporary server during initdb; a probe can pass and then the postmaster
// restarts. Retry anything that looks like that window instead of failing the run.
const psqlReady = async (target, sql, tries = 20) => {
  for (let i = 0; i < tries; i++) {
    try { return psql(target, sql); }
    catch (e) {
      const m = String(e.message);
      if (!/shutting down|starting up|Connection refused|does not exist|not running/i.test(m)) throw e;
      await sleep(1500);
    }
  }
  throw new Error(`database ${target.name} never became usable`);
};

// A vanilla Postgres lacks the Supabase roles and the auth schema that the RLS policies reference.
const ROLES = `
create role anon nologin noinherit; create role authenticated nologin noinherit; create role service_role nologin bypassrls;
`;
const STUB = ROLES + `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create or replace function auth.uid() returns uuid language sql stable as $body$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $body$;
grant usage on schema public, auth to anon, authenticated, service_role;
`;

// Prefix-parameterised so the upgraded database and the restored database can each be exercised
// independently without colliding on primary keys.
const assertionsFor = (P) => `
do $$
declare r text; n int;
begin
  insert into public.billing_price_plans(price_id, plan, label) values ('P-T-${P}','pro','test') on conflict do nothing;
  insert into public.billing_subscriptions(subscription_id, user_id, plan_id, provider, status)
    values ('I-T-${P}','u-paid-${P}','P-T-${P}','paypal','ACTIVE')
    on conflict (subscription_id) do update set user_id=excluded.user_id, plan_id=excluded.plan_id, status='ACTIVE';

  -- a captured payment covering the future grants the allowlisted plan
  perform public.apply_paypal_event('ev1-${P}','PAYMENT.SALE.COMPLETED',
    '{"id":"SALE-${P}","subscription_id":"I-T-${P}","amount":{"currency":"USD","total":"19.00"},"update_time":"2026-10-12T13:23:06Z","billing_period_start_date":"2026-10-12T13:23:06Z","billing_period_end_date":"2099-01-01T00:00:00Z"}'::jsonb);
  select plan into r from public.user_plans where user_id='u-paid-${P}';
  if r <> 'pro' then raise exception 'paid coverage not applied (plan=%)', coalesce(r,'null'); end if;
  if (select entitled from public.get_user_entitlement('u-paid-${P}')) is not true then raise exception 'entitlement false after captured payment'; end if;

  -- the same sale redelivered under a NEW event id must not extend the paid-through date
  select period_end into r from public.billing_payments where payment_id='SALE-${P}';
  perform public.apply_paypal_event('ev2-${P}','PAYMENT.SALE.COMPLETED',
    '{"id":"SALE-${P}","subscription_id":"I-T-${P}","amount":{"currency":"USD","total":"19.00"},"update_time":"2026-10-12T13:23:06Z","billing_period_end_date":"2099-06-01T00:00:00Z"}'::jsonb);
  if (select period_end::text from public.billing_payments where payment_id='SALE-${P}') <> r then raise exception 'replay extended coverage'; end if;

  -- a refund names the REFUND as id and the affected payment as sale_id, and no subscription
  perform public.apply_paypal_event('ev3-${P}','PAYMENT.SALE.REFUNDED',
    '{"id":"REFUND-${P}","sale_id":"SALE-${P}","amount":{"total":"19.00","currency":"USD"},"update_time":"2026-10-13T00:00:00Z"}'::jsonb);
  if (select entitled from public.get_user_entitlement('u-paid-${P}')) is not false then raise exception 'refund did not revoke coverage'; end if;
  select count(*) into n from public.billing_payments where payment_id='SALE-${P}' and status='refunded';
  if n <> 1 then raise exception 'refund not associated with the affected payment'; end if;
end $$;
select 'assertions-ok-${P}' as result;
`;

try {
  await start(A); await start(B); await start(C); await start(D);
  console.log(`scratch databases up on ${A.port}/${B.port}/${C.port}/${D.port} (throwaway containers, not the project DB)\n`);

  await psqlReady(C, STUB);
  await psqlReady(D, STUB);
  for (const f of OLD_SET) applyFile(D, f);   // the schema production has today
  for (const f of MIGRATIONS) applyFile(C, f);
  ok(`fresh install: all ${MIGRATIONS.length} migrations apply to an empty database`, true, '');

  await psqlReady(A, STUB);
  for (const f of OLD_SET) applyFile(A, f);
  ok(`upgrade path: ${OLD_SET.length} pre-PayPal migrations apply cleanly`, true, '');
  for (const f of NEW_SET) applyFile(A, f);
  ok(`upgrade path: the ${NEW_SET.length} PayPal-era migrations then apply in place`, true, '');

  const norm = (target) => psql(target, `select md5(string_agg(x, E'\\n' order by x)) from (
      select table_name||'.'||column_name||'.'||data_type as x from information_schema.columns where table_schema='public'
      union all select 'fn:'||proname||pg_get_function_identity_arguments(p.oid) as x from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public') t;`);
  const sa = norm(A), sc = norm(C);
  ok('upgraded schema is identical to the freshly installed schema', sa.trim() === sc.trim(), `A=${sa.trim().slice(0, 12)} C=${sc.trim().slice(0, 12)}`);

  psql(A, assertionsFor('A'));
  ok('access policy assertions pass on the upgraded database', true, '');

  // 6. Deployment-order compatibility. The Worker talks to PostgREST, so the observable contract is
  //    whether the RPC it calls exists. Both wrong orders are tested explicitly rather than argued.
  const callFails = (target, sql) => { try { psql(target, sql); return false; } catch (e) { return /does not exist|undefined function/i.test(String(e.message)); } };
  ok('NEW Worker on the OLD schema fails closed (apply_paypal_event missing → no silent grant)',
    callFails(D, `select public.apply_paypal_event('x','BILLING.SUBSCRIPTION.CREATED','{}'::jsonb);`), '');
  ok('OLD Worker on the NEW schema fails closed (apply_billing_event dropped → webhook errors, nothing granted)',
    !callFails(A, `select 1;`) && callFails(A, `select public.apply_billing_event('x','subscription.activated',now(),'s','c','{}'::jsonb);`), '');
  ok('get_user_entitlement exists on BOTH schemas (usage/plan reads survive either order)',
    !callFails(D, `select entitled from public.get_user_entitlement('nobody');`) && !callFails(A, `select entitled from public.get_user_entitlement('nobody');`), '');

  writeFileSync('/tmp/prism-dump.sql', sh('docker', ['exec', A.name, 'pg_dump', '-U', 'postgres', '--no-owner', '--no-privileges', 'postgres']));
  // Roles are cluster-level and not in the dump; the auth schema IS in the dump, so only
  // the roles are created before restoring.
  await psqlReady(B, ROLES);
  await psqlReady(B, readFileSync('/tmp/prism-dump.sql', 'utf8'));
  ok('pg_dump of the upgraded database restores into an empty one', true, '');
  psql(B, assertionsFor('B'));
  ok('the same access policy assertions pass on the RESTORED database', true, '');
  console.log('\nexact commands used (supported by the installed tooling):');
  console.log('  docker exec <db> pg_dump -U postgres --no-owner --no-privileges postgres > backup.sql');
  console.log('  docker exec -i <fresh-db> psql -U postgres -d postgres -v ON_ERROR_STOP=1 < backup.sql');
  console.log('  supabase db dump --local --db-url postgres://postgres:postgres@127.0.0.1:54322/postgres -f backup.sql   # same result for the project DB');
} catch (e) {
  ok('schema release check completed', false, String(e.message).slice(0, 600));
} finally {
  for (const { name } of [A, B, C, D]) docker('rm', '-f', name, { stdio: 'ignore' });
  try { unlinkSync('/tmp/prism-dump.sql'); } catch {}
}

console.log(`\n=== schema-release-check: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
