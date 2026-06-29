-- ============================================================
-- Migration: Create document_history table for persistent extraction storage
-- Run this in Supabase SQL Editor or via CLI migration
-- ============================================================

-- Enable UUID extension (idempotent)
create extension if not exists "pgcrypto";

-- Document history table: stores every successful extraction
create table if not exists public.document_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filename text not null,
  tool_id text not null default 'pdf-to-excel',
  extracted_data jsonb not null default '{}'::jsonb,
  page_count integer not null default 1,
  confidence numeric(5,2) not null default 0,
  bank_code text,
  created_at timestamptz not null default now()
);

-- Index for fast user queries ordered by recency
create index if not exists idx_document_history_user_created
  on public.document_history (user_id, created_at desc);

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
alter table public.document_history enable row level security;

-- Users can only SELECT their own records
create policy "Users read own extraction history"
  on public.document_history
  for select
  using (auth.uid() = user_id);

-- Users can only INSERT their own records
create policy "Users insert own extraction history"
  on public.document_history
  for insert
  with check (auth.uid() = user_id);

-- Users can only UPDATE their own records
create policy "Users update own extraction history"
  on public.document_history
  for update
  using (auth.uid() = user_id);

-- Users can only DELETE their own records
create policy "Users delete own extraction history"
  on public.document_history
  for delete
  using (auth.uid() = user_id);

-- ============================================================
-- Optional: Auto-cleanup old records (older than 1 year)
-- This is a safety net; users should manage their own data.
-- ============================================================
-- Uncomment to enable:
-- create or replace function public.cleanup_old_extractions()
-- returns void as $$
-- begin
--   delete from public.document_history
--   where created_at < now() - interval '1 year';
-- end;
-- $$ language plpgsql security definer;