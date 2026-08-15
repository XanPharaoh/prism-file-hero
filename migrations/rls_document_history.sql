-- ══════════════════════════════════════════════════════════════
-- PRISM FILE HERO — USAGE TRACKING SCHEMA v2
-- Run this in Supabase SQL Editor. Idempotent (safe to re-run).
-- ══════════════════════════════════════════════════════════════

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ── USAGE LOGS v2 (per-tool granular tracking) ────────────────
create table if not exists public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  tracking_key text not null,           -- "user_id" or "ip:x.x.x.x"
  user_id uuid references auth.users(id) on delete set null,
  month text not null,                   -- "2026-06"
  tool_id text not null,                 -- "pdf-to-excel", "merge", etc.
  ai_pages integer not null default 0,   -- AI pages consumed
  operations integer not null default 0, -- Free operation count
  file_size_bytes bigint not null default 0,
  file_name text,
  status text not null check (status in ('SUCCESS', 'ERROR')),
  error_message text,
  created_at timestamptz not null default now()
);

-- ── INDEXES (critical for fast aggregation) ────────────────────
create index if not exists idx_usage_logs_tracking_month
  on public.usage_logs (tracking_key, month);

create index if not exists idx_usage_logs_user_month
  on public.usage_logs (user_id, month)
  where user_id is not null;

create index if not exists idx_usage_logs_tool_month
  on public.usage_logs (tool_id, month);

-- ── RLS: users see only their own data ────────────────────────
alter table public.usage_logs enable row level security;

drop policy if exists "Users read own usage" on public.usage_logs;
create policy "Users read own usage"
  on public.usage_logs for select using (auth.uid() = user_id);

-- Note: INSERT on usage_logs uses service_role key (bypasses RLS)
-- because the Worker inserts on behalf of users (including anonymous).