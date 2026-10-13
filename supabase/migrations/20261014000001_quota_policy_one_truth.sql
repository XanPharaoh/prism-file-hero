-- 20261014000001_quota_policy_one_truth.sql
-- One authoritative plan definition, measured against what the product actually sells.
--
-- Before this change three places disagreed about the free tier:
--   browser (services/usageConfig.ts)  free AI pages 0, AI locked out
--   database (check_usage_limit)       free AI pages 10/month, 2 per tool/day, 6/day
--   worker (src/planLimits.ts)         free aiPagesPerMonth 10, aiTools: true   <- dead file, deleted
-- so a free visitor was told "Premium, 0 pages" by the UI while the ledger would have happily
-- granted 10 cloud pages a month. The pricing page makes no free-cloud-AI promise at all
-- ("One free task, zero sign-up / Three tasks a day signed in / All standard PDF tools"),
-- therefore free cloud AI is zero everywhere. A future free cloud trial is a separate,
-- budgeted product decision and is not enabled here.
--
-- The premium gate also moves server-side. Hybrid tools (OCR, PDF to Excel, Redact) run in the
-- browser and consume no provider call, so they must not be metered against the AI-page budget;
-- they are entitled features instead. Enforcement belongs here, not in the browser, because the
-- browser's own check is a display convenience that any client can skip.

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
begin
  if p_ai_pages < 0 or p_operations < 0 or p_page_count <= 0 then
    return query select false, 'Invalid usage request', v_plan, 0::bigint, v_month_limit, 0::bigint, 0, 0::bigint, 0, v_day_start + interval '1 day'; return;
  end if;
  if p_tool_id not in ('merge','split','compress','rotate','protect','watermark','jpg-to-pdf','pdf-to-jpg','fnb-statement','pdf-to-excel','ocr','ocr-to-md','pdf-to-word','redact','compare','grammar-check','portfolio-statements') then
    return query select false, 'Unknown tool', v_plan, 0::bigint, v_month_limit, 0::bigint, 0, 0::bigint, 0, v_day_start + interval '1 day'; return;
  end if;

  v_feature := case when p_ai_pages > 0 then 'ai' else 'local' end;

  if p_user_id is not null then
    select case when up.plan in ('pro', 'business') and up.subscription_status in ('active', 'trialing') then up.plan else 'free' end
      into v_plan from public.user_plans up where up.user_id = p_user_id limit 1;
    v_plan := coalesce(v_plan, 'free');
  end if;

  -- Premium set mirrors TOOL_COSTS[...].category = 'ai' in services/usageConfig.ts;
  -- scripts/quota-policy-check.mjs fails if the two lists drift.
  if v_plan = 'free' and p_tool_id in ('pdf-to-excel','ocr','ocr-to-md','pdf-to-word','redact','compare','grammar-check') then
    return query select false, 'This tool needs a paid plan', v_plan, 0::bigint, v_month_limit, 0::bigint, 0, 0::bigint, 0, v_day_start + interval '1 day'; return;
  end if;

  v_month_limit := case v_plan when 'pro' then 500 when 'business' then -1 else 0 end;
  -- -1 = no daily ceiling. Free keeps its local ceilings; free cloud AI is zero, so the AI
  -- ceilings below only ever answer for a plan that cannot reach them.
  v_tool_limit := case when v_plan = 'free' then (case v_feature when 'ai' then 0 else 5 end) else -1 end;
  v_global_limit := case when v_plan = 'free' then (case v_feature when 'ai' then 0 else 15 end) else -1 end;

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

revoke all on function public.check_usage_limit(text, text, text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.check_usage_limit(text, text, text, text, integer, integer, integer) to service_role;

-- Settlement is decided by the server that ran the work. A settled row must never move again, so
-- a client cannot refund consumed cloud work by claiming failure after the provider answered.
create or replace function public.settle_usage(p_request_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $fn$
declare v_status text;
begin
  if p_status not in ('SUCCESS', 'ERROR') then raise exception 'Invalid settlement status'; end if;
  update public.usage_logs set status = p_status, updated_at = now()
    where request_id = p_request_id and status = 'PENDING';
  if not found then
    select status into v_status from public.usage_logs where request_id = p_request_id limit 1;
    if v_status is null then raise exception 'Usage reservation not found'; end if;
    -- Already settled (by the AI worker, or by a retry): leave the recorded outcome untouched.
    return;
  end if;
end
$fn$;

revoke all on function public.settle_usage(uuid, text) from public, anon, authenticated;
grant execute on function public.settle_usage(uuid, text) to service_role;
