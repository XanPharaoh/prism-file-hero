-- Item 4 / Check C — fix a latent SQL defect only reachable on AUTHENTICATED requests.
--
-- Running the real Worker route (/api/ai, /api/execute) returned HTTP 400 from PostgREST:
--   42702: column reference "plan" is ambiguous.
-- check_usage_limit's `if p_user_id is not null` branch SELECTs `plan`/`subscription_status`
-- from user_plans unqualified; because the function also declares an OUT column named `plan`,
-- PL/pgSQL cannot tell the table column from the OUT variable. Prior tests always passed
-- p_user_id = NULL, so this branch never executed. Qualify every user_plans reference.

begin;

create or replace function public.check_usage_limit(
  p_user_id text, p_tracking_key text, p_ip_address text, p_tool_id text,
  p_ai_pages integer, p_operations integer, p_page_count integer
) returns table (
  allowed boolean, reason text, plan text, ai_pages_used bigint, ai_pages_limit integer,
  tool_used bigint, tool_limit integer, global_used bigint, global_cap integer, next_reset timestamptz
) language plpgsql security definer set search_path = public as $$
declare
  v_plan text := 'free';
  v_feature text;
  v_day_start timestamptz := date_trunc('day', now() at time zone 'Africa/Johannesburg') at time zone 'Africa/Johannesburg';
  v_month text := to_char(now(), 'YYYY-MM');
  v_month_ai bigint := 0;
  v_ip_ai bigint := 0;
  v_tool bigint := 0;
  v_global bigint := 0;
  v_month_limit integer := 10;
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
    -- ALL references qualified to the table (up) so they cannot collide with the OUT column `plan`.
    select case when up.plan in ('pro', 'business') and up.subscription_status in ('active', 'trialing') then up.plan else 'free' end
    into v_plan from public.user_plans up where up.user_id = p_user_id limit 1;
    v_plan := coalesce(v_plan, 'free');
  end if;
  v_month_limit := case v_plan when 'pro' then 500 when 'business' then -1 else 10 end;
  v_tool_limit := case v_feature when 'ai' then 2 else 5 end;
  v_global_limit := case v_feature when 'ai' then 6 else 15 end;
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
  if v_tool + p_page_count > v_tool_limit then
    return query select false, 'Per-tool daily limit reached', v_plan, v_month_ai, v_month_limit, v_tool, v_tool_limit, v_global, v_global_limit, v_day_start + interval '1 day'; return;
  end if;
  if v_global + p_page_count > v_global_limit then
    return query select false, 'Daily global limit reached', v_plan, v_month_ai, v_month_limit, v_tool, v_tool_limit, v_global, v_global_limit, v_day_start + interval '1 day'; return;
  end if;
  if v_month_limit <> -1 and v_month_ai + p_ai_pages > v_month_limit then
    return query select false, 'Monthly plan limit reached', v_plan, v_month_ai, v_month_limit, v_tool, v_tool_limit, v_global, v_global_limit, v_day_start + interval '1 day'; return;
  end if;
  if v_plan <> 'business' and v_ip_ai + p_ai_pages > 50 then
    return query select false, 'Network usage limit reached', v_plan, v_month_ai, v_month_limit, v_tool, v_tool_limit, v_global, v_global_limit, v_day_start + interval '1 day'; return;
  end if;
  return query select true, null::text, v_plan, v_month_ai, v_month_limit, v_tool, v_tool_limit, v_global, v_global_limit, v_day_start + interval '1 day';
end $$;

commit;
