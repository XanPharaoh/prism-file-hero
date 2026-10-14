-- 20261015000001_production_schema_hardening.sql
-- One metering system, one tool catalogue, one privilege boundary.
--
-- Three things were true at the same time in this database:
--   * the Paddle-era ledger (user_plan / plan_grants / credit_reservations + reserve_credit /
--     settle_credit) still existed next to the PayPal-era ledger (user_plans / usage_logs +
--     reserve_usage / settle_usage), so two systems could both claim to have metered a request;
--   * check_usage_limit allowlisted 18 tools while the app registers 38, so pdf-qa, pdf-summary and
--     twenty local tools were refused with `Unknown tool` by the ledger that was supposed to allow them;
--   * settle_usage trusted its caller completely: any PENDING row could be closed by request id, with
--     no check that the row belonged to the session doing the settling.
-- This migration retires the parallel ledger, makes the SQL tool list a mirror of
-- services/usageConfig.ts (enforced by scripts/quota-policy-check.mjs), forces the privilege boundary,
-- and scopes settlement to the tracking key that created the reservation.

begin;

-- ── 1. Retire the Paddle-era parallel ledger ───────────────────────────────────────────────
-- Signatures are taken from pg_get_function_identity_arguments as measured on the running database;
-- a DROP FUNCTION IF EXISTS whose argument list does not match is silently skipped, which would have
-- left functions behind whose tables no longer exist.
drop function if exists public.reserve_credit(p_request_id uuid, p_user_id text, p_cost integer, p_month text);
drop function if exists public.settle_credit(p_request_id uuid, p_status text, p_month text);
drop table if exists public.credit_reservations cascade;
drop table if exists public.plan_grants cascade;
drop table if exists public.user_plan cascade;

-- ── 2. Force the privilege boundary on every live table ────────────────────────────────────
-- `postgres` and `service_role` carry BYPASSRLS (measured in pg_roles), so the security-definer
-- functions that read and write usage_logs keep working; what this closes is the direct PostgREST
-- path, where anon and authenticated previously held table-wide INSERT/UPDATE/DELETE.
do $$
declare t text;
begin
  foreach t in array array[
    'user_plans','usage_logs',
    'billing_customers','billing_subscriptions','billing_price_plans','billing_payments','billing_events'
  ] loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('alter table public.%I enable row level security', t);
      execute format('alter table public.%I force row level security', t);
      execute format('revoke all on table public.%I from public, anon, authenticated', t);
      execute format('grant all on table public.%I to service_role', t);
    end if;
  end loop;
end $$;

-- The browser's only legitimate direct reads are its own plan and its own usage rows. Those stay
-- reachable as SELECT (guarded by the self-scope policies below); no client write is granted.
grant select on table public.user_plans to authenticated;
grant select on table public.usage_logs to authenticated;

-- One self-scope SELECT policy per table. The 20261010000003 names are retired here rather than left
-- stacked alongside new ones, so a reviewer can see a single policy per table.
drop policy if exists user_plans_read_self on public.user_plans;
drop policy if exists usage_logs_read_self on public.usage_logs;

drop policy if exists user_plans_select_own on public.user_plans;
create policy user_plans_select_own on public.user_plans
  for select to authenticated using ((auth.uid())::text = user_id);

drop policy if exists usage_logs_select_own on public.usage_logs;
create policy usage_logs_select_own on public.usage_logs
  for select to authenticated using (user_id = (auth.uid())::text);

-- ── 3. check_usage_limit: the whole catalogue, gated by one plan definition ────────────────
create or replace function public.check_usage_limit(
  p_user_id text,
  p_tracking_key text,
  p_ip_address text,
  p_tool_id text,
  p_ai_pages integer,
  p_operations integer,
  p_page_count integer
)
returns table (
  allowed boolean, reason text, plan text,
  ai_pages_used bigint, ai_pages_limit integer,
  tool_used bigint, tool_limit integer,
  global_used bigint, global_cap integer,
  next_reset timestamptz
)
language plpgsql
security definer
set search_path = 'public'
as $fn$
declare
  v_plan text := 'free';
  v_feature text;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg';
  v_month text := to_char(now(), 'YYYY-MM');
  v_month_ai bigint := 0;
  v_ip_ai bigint := 0;
  v_tool bigint := 0;
  v_global bigint := 0;
  v_month_limit integer := 0;
  v_tool_limit integer;
  v_global_limit integer;
  v_is_premium boolean := false;
begin
  if p_ai_pages < 0 or p_operations < 0 or p_page_count <= 0 then
    return query select false, 'Invalid usage request', v_plan, 0::bigint, v_month_limit, 0::bigint, 0, 0::bigint, 0, v_day_start + interval '1 day'; return;
  end if;

  -- Full catalogue: the 38 ids in src/registry/toolRegistry.ts. Parenthesis-free on purpose --
  -- scripts/quota-policy-check.mjs reads this clause textually to prove the two lists agree.
  if p_tool_id not in (
    'merge','split','compress','rotate','delete-pages','extract-pages','reorder-pages','page-numbers',
    'header-footer','crop-resize','remove-blank-pages','n-up','auto-rotate','stamp','watermark',
    'metadata-edit','pdf-repair','flatten-pdf','pdf-to-jpg','jpg-to-pdf','pdf-to-text','pdf-to-docx',
    'extract-images','scan-effect','invert-colors','portfolio-statements','protect','unlock-pdf',
    'sanitize','redact','pdf-to-excel','ocr','ocr-to-md','pdf-to-word','compare','grammar-check',
    'pdf-qa','pdf-summary'
  ) then
    return query select false, 'Unknown tool', v_plan, 0::bigint, v_month_limit, 0::bigint, 0, 0::bigint, 0, v_day_start + interval '1 day'; return;
  end if;

  -- Premium set mirrors TOOL_COSTS[...].category = 'ai' in services/usageConfig.ts.
  v_is_premium := p_tool_id in (
    'pdf-to-excel','ocr','ocr-to-md','pdf-to-word','redact','compare','grammar-check','pdf-qa','pdf-summary'
  );

  v_feature := case when p_ai_pages > 0 then 'ai' else 'local' end;

  if p_user_id is not null then
    select case when up.plan in ('pro','business') and lower(up.subscription_status) in ('active','trialing') then up.plan else 'free' end
      into v_plan from public.user_plans up where up.user_id = p_user_id limit 1;
    v_plan := coalesce(v_plan, 'free');
    -- A renewal webhook that has not landed yet must not turn a paid customer's request into
    -- "This tool needs a paid plan", so the ledger is re-derived from the payment evidence before
    -- anyone is refused. Only in the refuse direction: re-deriving on every check would put a write
    -- and a row lock on the hot path for customers who are already entitled, and would let a stale
    -- payment table silently override a plan the billing pipeline itself granted.
    -- Contained, because a coverage failure must never take metering down with it.
    if v_plan = 'free' then
      begin
        perform public.refresh_user_coverage(p_user_id);
      exception when others then
        null;
      end;
      select case when up.plan in ('pro','business') and lower(up.subscription_status) in ('active','trialing') then up.plan else 'free' end
        into v_plan from public.user_plans up where up.user_id = p_user_id limit 1;
      v_plan := coalesce(v_plan, 'free');
    end if;
  end if;

  -- Free plan has 0 cloud AI pages and cannot run premium tools.
  v_month_limit := case v_plan when 'pro' then 500 when 'business' then -1 else 0 end;
  -- -1 = no daily ceiling. Free keeps its local ceilings; free cloud AI is zero, so the AI ceilings
  -- below only ever answer for a plan that cannot reach them.
  v_tool_limit := case when v_plan = 'free' then (case v_feature when 'ai' then 0 else 5 end) else -1 end;
  v_global_limit := case when v_plan = 'free' then (case v_feature when 'ai' then 0 else 15 end) else -1 end;

  if v_plan = 'free' and (v_is_premium or p_ai_pages > 0) then
    return query select false, 'This tool needs a paid plan', v_plan, 0::bigint, v_month_limit, 0::bigint, v_tool_limit, 0::bigint, v_global_limit, v_day_start + interval '1 day'; return;
  end if;

  select coalesce(sum(ai_pages), 0) into v_month_ai from public.usage_logs
    where tracking_key = p_tracking_key and month = v_month and status in ('SUCCESS', 'PENDING')
      and (status = 'SUCCESS' or created_at > now() - interval '15 minutes');

  select coalesce(sum(ai_pages), 0) into v_ip_ai from public.usage_logs
    where ip_address = p_ip_address and month = v_month and status in ('SUCCESS', 'PENDING')
      and (status = 'SUCCESS' or created_at > now() - interval '15 minutes');

  select coalesce(sum(page_count), 0) into v_tool from public.usage_logs
    where tracking_key = p_tracking_key and tool_id = p_tool_id and feature_type = v_feature and created_at >= v_day_start
      and status in ('SUCCESS', 'PENDING') and (status = 'SUCCESS' or created_at > now() - interval '15 minutes');

  select coalesce(sum(page_count), 0) into v_global from public.usage_logs
    where tracking_key = p_tracking_key and feature_type = v_feature and created_at >= v_day_start
      and status in ('SUCCESS', 'PENDING') and (status = 'SUCCESS' or created_at > now() - interval '15 minutes');

  if v_tool_limit <> -1 and v_tool + p_page_count > v_tool_limit then
    return query select false, 'Per-tool daily limit reached', v_plan, v_month_ai, v_month_limit, v_tool, v_tool_limit, v_global, v_global_limit, v_day_start + interval '1 day'; return;
  end if;
  if v_global_limit <> -1 and v_global + p_page_count > v_global_limit then
    return query select false, 'Daily global limit reached', v_plan, v_month_ai, v_month_limit, v_tool, v_tool_limit, v_global, v_global_limit, v_day_start + interval '1 day'; return;
  end if;
  if v_month_limit <> -1 and v_month_ai + p_ai_pages > v_month_limit then
    return query select false, 'Monthly plan limit reached', v_plan, v_month_ai, v_month_limit, v_tool, v_tool_limit, v_global, v_global_limit, v_day_start + interval '1 day'; return;
  end if;
  -- The IP-wide net exists to stop unattributed abuse. Every route that reaches this function is
  -- authenticated, so applying it to an account would only throttle paying customers who share an
  -- address; it is kept for the no-account case.
  if p_user_id is null and v_ip_ai + p_ai_pages > 50 then
    return query select false, 'Network usage limit reached', v_plan, v_month_ai, v_month_limit, v_tool, v_tool_limit, v_global, v_global_limit, v_day_start + interval '1 day'; return;
  end if;

  return query select true, null::text, v_plan, v_month_ai, v_month_limit, v_tool, v_tool_limit, v_global, v_global_limit, v_day_start + interval '1 day';
end
$fn$;

-- ── 4. settle_usage: scoped to the session that reserved, and final ───────────────────────
-- The 2-argument overload is dropped rather than kept beside the new one: PostgREST answers
-- `300 AmbiguousFunction` when a named-argument call matches two signatures, and the Worker calls
-- this RPC by name. Omitting p_tracking_key still resolves to the single remaining function.
drop function if exists public.settle_usage(p_request_id uuid, p_status text);

create or replace function public.settle_usage(
  p_request_id uuid,
  p_status text,
  p_tracking_key text default null
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $fn$
declare v_row public.usage_logs%rowtype;
begin
  if p_status not in ('SUCCESS', 'ERROR') then raise exception 'Invalid settlement status'; end if;

  update public.usage_logs set status = p_status, updated_at = now()
    where request_id = p_request_id
      and status = 'PENDING'
      and (p_tracking_key is null or tracking_key = p_tracking_key);

  if found then return; end if;

  select * into v_row from public.usage_logs where request_id = p_request_id limit 1;
  if not found then raise exception 'Usage reservation not found'; end if;
  if p_tracking_key is not null and v_row.tracking_key <> p_tracking_key then
    -- The row is real and still open, but it belongs to somebody else's session.
    raise exception 'Usage reservation belongs to a different session';
  end if;
  -- Already settled, by the AI worker or by a retry: the recorded outcome stands. A client cannot
  -- refund consumed cloud work by claiming failure after the provider answered, and a duplicate
  -- close is harmless rather than an error the Worker would have to swallow mid-request.
end
$fn$;

-- ── 5. Executable-only surface ─────────────────────────────────────────────────────────────
revoke all on function public.check_usage_limit(text, text, text, text, integer, integer, integer) from public, anon, authenticated;
grant  execute on function public.check_usage_limit(text, text, text, text, integer, integer, integer) to service_role;

revoke all on function public.settle_usage(uuid, text, text) from public, anon, authenticated;
grant  execute on function public.settle_usage(uuid, text, text) to service_role;

commit;
