-- Canonical Prism File Hero metering schema. Authentication is provided by Clerk,
-- so user_id deliberately stores Clerk's string subject rather than auth.users UUIDs.
create extension if not exists "pgcrypto";

create table if not exists public.user_plans (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique,
  plan text not null default 'free' check (plan in ('free', 'pro', 'business')),
  paddle_customer_id text,
  paddle_subscription_id text,
  subscription_status text not null default 'inactive',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One append-only row per invocation. PENDING rows reserve quota before an AI
-- provider is called and are settled to SUCCESS or ERROR by the Worker.
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

create index if not exists usage_logs_tracking_month_created_idx
  on public.usage_logs (tracking_key, month, created_at);
create index if not exists usage_logs_ip_month_created_idx
  on public.usage_logs (ip_address, month, created_at);
create index if not exists usage_logs_tracking_tool_created_idx
  on public.usage_logs (tracking_key, tool_id, created_at);

alter table public.user_plans enable row level security;
alter table public.usage_logs enable row level security;
