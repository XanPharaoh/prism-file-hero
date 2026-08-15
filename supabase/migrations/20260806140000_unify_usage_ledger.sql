-- Canonical metering ledger. Clerk subject IDs are strings, not auth.users UUIDs.
create extension if not exists "pgcrypto";

create table if not exists public.user_plans (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  plan text not null default 'free' check (plan in ('free', 'pro', 'business')),
  subscription_status text not null default 'inactive',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Remove Supabase-auth foreign keys before converting legacy UUID identities.
alter table public.user_plans drop constraint if exists user_plans_user_id_fkey;
alter table public.user_plans alter column user_id type text using user_id::text;
alter table public.user_plans add column if not exists subscription_status text;
update public.user_plans set subscription_status = coalesce(subscription_status, 'inactive');
alter table public.user_plans alter column subscription_status set default 'inactive';
alter table public.user_plans alter column subscription_status set not null;

create table if not exists public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  tracking_key text not null,
  user_id text,
  ip_address text not null,
  month text not null,
  tool_id text not null,
  ai_pages integer not null default 0 check (ai_pages >= 0),
  operations integer not null default 0 check (operations >= 0),
  page_count integer not null default 0 check (page_count >= 0),
  feature_type text not null check (feature_type in ('ai', 'local')),
  file_size_bytes bigint not null default 0,
  file_name text,
  status text not null default 'PENDING' check (status in ('PENDING', 'SUCCESS', 'ERROR')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.usage_logs drop constraint if exists usage_logs_user_id_fkey;
alter table public.usage_logs alter column user_id drop not null;
alter table public.usage_logs alter column user_id type text using user_id::text;
alter table public.usage_logs add column if not exists request_id uuid;
alter table public.usage_logs add column if not exists tracking_key text;
alter table public.usage_logs add column if not exists ip_address text;
alter table public.usage_logs add column if not exists ai_pages integer not null default 0;
alter table public.usage_logs add column if not exists operations integer not null default 0;
alter table public.usage_logs add column if not exists page_count integer not null default 0;
alter table public.usage_logs add column if not exists feature_type text;
alter table public.usage_logs add column if not exists file_size_bytes bigint not null default 0;
alter table public.usage_logs add column if not exists file_name text;
alter table public.usage_logs add column if not exists status text;
alter table public.usage_logs add column if not exists error_message text;
alter table public.usage_logs add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'usage_logs' and column_name = 'pages') then
    execute $sql$
      update public.usage_logs
      set request_id = coalesce(request_id, gen_random_uuid()),
          tracking_key = coalesce(tracking_key, user_id, 'ip:' || coalesce(ip_address, 'unknown')),
          ip_address = coalesce(ip_address, 'unknown'),
          ai_pages = coalesce(ai_pages, pages, 0),
          page_count = coalesce(page_count, pages, 0),
          feature_type = coalesce(feature_type, case when coalesce(ai_pages, pages, 0) > 0 then 'ai' else 'local' end),
          status = coalesce(status, 'SUCCESS')
    $sql$;
  else
    update public.usage_logs
    set request_id = coalesce(request_id, gen_random_uuid()),
        tracking_key = coalesce(tracking_key, user_id, 'ip:' || coalesce(ip_address, 'unknown')),
        ip_address = coalesce(ip_address, 'unknown'),
        feature_type = coalesce(feature_type, case when ai_pages > 0 then 'ai' else 'local' end),
        status = coalesce(status, 'SUCCESS');
  end if;
end;
$$;

alter table public.usage_logs alter column request_id set not null;
alter table public.usage_logs alter column tracking_key set not null;
alter table public.usage_logs alter column ip_address set not null;
alter table public.usage_logs alter column feature_type set not null;
alter table public.usage_logs alter column status set not null;
alter table public.usage_logs drop constraint if exists usage_logs_user_id_month_key;
alter table public.usage_logs drop constraint if exists usage_logs_request_id_key;
alter table public.usage_logs add constraint usage_logs_request_id_key unique (request_id);
alter table public.usage_logs drop constraint if exists usage_logs_status_check;
alter table public.usage_logs add constraint usage_logs_status_check check (status in ('PENDING', 'SUCCESS', 'ERROR'));
alter table public.usage_logs drop constraint if exists usage_logs_feature_type_check;
alter table public.usage_logs add constraint usage_logs_feature_type_check check (feature_type in ('ai', 'local'));

create index if not exists usage_logs_tracking_month_created_idx on public.usage_logs (tracking_key, month, created_at);
create index if not exists usage_logs_ip_month_created_idx on public.usage_logs (ip_address, month, created_at);
create index if not exists usage_logs_tracking_tool_created_idx on public.usage_logs (tracking_key, tool_id, created_at);

drop function if exists public.check_execution_context(uuid, text, text);
drop function if exists public.check_execution_context(text, text, text);
drop function if exists public.get_usage_summary(uuid, text);
drop function if exists public.get_usage_summary(text, text);
drop function if exists public.increment_usage(uuid, text, integer, text, text);
drop function if exists public.increment_usage(text, text, integer, text, text);

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
  if p_tool_id not in ('merge','split','compress','rotate','protect','watermark','jpg-to-pdf','pdf-to-jpg','fnb-statement','pdf-to-excel','ocr','ocr-to-md','pdf-to-word','redact','compare','grammar-check') then
    return query select false, 'Unknown tool', v_plan, 0::bigint, v_month_limit, 0::bigint, 0, 0::bigint, 0, v_day_start + interval '1 day'; return;
  end if;
  v_feature := case when p_ai_pages > 0 then 'ai' else 'local' end;
  if p_user_id is not null then
    select case when plan in ('pro', 'business') and subscription_status in ('active', 'trialing') then plan else 'free' end
    into v_plan from public.user_plans where user_id = p_user_id limit 1;
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
end;
$$;

create or replace function public.reserve_usage(
  p_request_id uuid, p_user_id text, p_tracking_key text, p_ip_address text, p_tool_id text,
  p_ai_pages integer, p_operations integer, p_page_count integer
) returns table (
  allowed boolean, reason text, plan text, ai_pages_used bigint, ai_pages_limit integer,
  tool_used bigint, tool_limit integer, global_used bigint, global_cap integer, next_reset timestamptz
) language plpgsql security definer set search_path = public as $$
declare v_result record;
begin
  -- Serialize both the account and network budgets to close parallel-request races.
  perform pg_advisory_xact_lock(hashtext(p_tracking_key));
  perform pg_advisory_xact_lock(hashtext(p_ip_address));
  update public.usage_logs set status = 'ERROR', error_message = 'reservation expired', updated_at = now()
    where status = 'PENDING' and created_at < now() - interval '15 minutes'
      and (tracking_key = p_tracking_key or ip_address = p_ip_address);
  select * into v_result from public.check_usage_limit(p_user_id, p_tracking_key, p_ip_address, p_tool_id, p_ai_pages, p_operations, p_page_count);
  if v_result.allowed then
    insert into public.usage_logs (request_id, tracking_key, user_id, ip_address, month, tool_id, ai_pages, operations, page_count, feature_type, status)
    values (p_request_id, p_tracking_key, p_user_id, p_ip_address, to_char(now(), 'YYYY-MM'), p_tool_id, p_ai_pages, p_operations, p_page_count, case when p_ai_pages > 0 then 'ai' else 'local' end, 'PENDING');
  end if;
  return query select v_result.allowed, v_result.reason, v_result.plan, v_result.ai_pages_used,
    v_result.ai_pages_limit, v_result.tool_used, v_result.tool_limit, v_result.global_used,
    v_result.global_cap, v_result.next_reset;
end;
$$;

create or replace function public.settle_usage(p_request_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('SUCCESS', 'ERROR') then raise exception 'Invalid settlement status'; end if;
  update public.usage_logs set status = p_status, updated_at = now() where request_id = p_request_id and status = 'PENDING';
  if not found then raise exception 'Usage reservation not found'; end if;
end;
$$;

revoke all on function public.check_usage_limit(text, text, text, text, integer, integer, integer) from public;
revoke all on function public.reserve_usage(uuid, text, text, text, text, integer, integer, integer) from public;
revoke all on function public.settle_usage(uuid, text) from public;
