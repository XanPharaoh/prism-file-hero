-- supabase/legacy/document_history.pre-clerk.sql
-- NOT APPLIED ANYWHERE. Kept because it is the only specification of a feature that is still wired
-- into the interface.
--
-- services/historyService.ts writes to public.document_history and App.tsx mounts
-- src/components/HistoryDashboard.tsx, but no environment has that table: not production
-- (vejdrvnymmowvjxleefm holds user_plans and usage_logs only), not the local dev container, not the
-- local staging container. Every save logs "[History] Failed to save extraction" and returns null,
-- so the dashboard reads as empty rather than as broken.
--
-- This file cannot simply be moved into supabase/migrations/, because it is pre-Clerk in two ways
-- that matter:
--   * user_id is `uuid references auth.users(id)`. The current ledger stores the Clerk subject as
--     TEXT (see 20260806140000_unify_usage_ledger.sql), and historyService passes `user_...` strings.
--   * all four policies key on `auth.uid()`, which is a Supabase Auth claim. The browser holds a
--     Clerk session and an anon Supabase client, so auth.uid() is null and every insert would be
--     rejected even after the table existed.
--
-- The fix is a decision, not a copy-paste: either history becomes Worker-backed (Clerk-verified
-- request, service_role write, new /api/history routes) or Supabase is taught to accept the Clerk
-- JWT so auth.uid() resolves to the Clerk subject. Until one is chosen this stays out of the
-- migration ledger, so `supabase db push` cannot half-create a table nothing can use.

-- ============================================================
-- Original content, verbatim
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
