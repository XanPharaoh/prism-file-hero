-- ══════════════════════════════════════════════════════════════
-- PRISM FILE HERO — DAILY PAGE-BASED QUOTAS WITH SAST RESET
-- 
-- This migration adds:
--   1. feature_type column to usage_logs ('local' | 'ai')
--   2. page_count column to usage_logs (tracks total pages processed)
--   3. Updated RPCs with SAST (Africa/Johannesburg) timezone logic
--   4. Daily quota enforcement functions
--
-- Idempotent (safe to re-run).
-- Run this in Supabase SQL Editor after v2 migration.
-- ══════════════════════════════════════════════════════════════

-- ── ADD NEW COLUMNS TO usage_logs ──────────────────────────────
-- feature_type: 'local' for local operations, 'ai' for AI operations
ALTER TABLE public.usage_logs
  ADD COLUMN IF NOT EXISTS feature_type text
    CHECK (feature_type IN ('local', 'ai'));

-- page_count: total pages processed in this invocation
ALTER TABLE public.usage_logs
  ADD COLUMN IF NOT EXISTS page_count integer NOT NULL DEFAULT 0;

-- Index on feature_type for efficient aggregation
CREATE INDEX IF NOT EXISTS idx_usage_logs_feature_type
  ON public.usage_logs (feature_type);

-- Composite index for daily SAST queries
CREATE INDEX IF NOT EXISTS idx_usage_logs_tracking_feature_created
  ON public.usage_logs (tracking_key, feature_type, created_at);

-- ── HELPER: Get the UTC timestamp of today's SAST midnight ─────
-- Returns the exact UTC equivalent of "2026-07-06 00:00:00 SAST"
-- for use in WHERE clauses: created_at >= sast_midnight_utc()
CREATE OR REPLACE FUNCTION public.sast_midnight_utc()
RETURNS timestamptz
LANGUAGE sql STABLE
AS $$
  SELECT DATE_TRUNC('day', NOW() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'UTC';
$$;

-- ── HELPER: Get the UTC timestamp of next SAST midnight ────────
-- Useful for UI countdown: "Resets at 12:00 AM SAST"
CREATE OR REPLACE FUNCTION public.next_sast_midnight_utc()
RETURNS timestamptz
LANGUAGE sql STABLE
AS $$
  SELECT (DATE_TRUNC('day', NOW() AT TIME ZONE 'Africa/Johannesburg') + INTERVAL '1 day') AT TIME ZONE 'UTC';
$$;

-- ── UPDATED RPC: get_usage_summary ─────────────────────────────
-- Returns daily usage split by feature_type with SAST reset.
-- Also returns the next SAST midnight timestamp for UI countdown.
DROP FUNCTION IF EXISTS public.get_usage_summary(uuid, text);
DROP FUNCTION IF EXISTS public.get_usage_summary(text, text);

CREATE OR REPLACE FUNCTION public.get_usage_summary(
  p_tracking_key text,
  p_user_id uuid DEFAULT NULL
)
RETURNS TABLE(
  local_pages_used_today bigint,
  ai_pages_used_today bigint,
  next_sast_midnight timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_sast_midnight timestamptz;
  v_next_midnight timestamptz;
BEGIN
  v_sast_midnight := public.sast_midnight_utc();
  v_next_midnight := public.next_sast_midnight_utc();

  RETURN QUERY
  SELECT
    COALESCE(SUM(ul.page_count) FILTER (WHERE ul.feature_type = 'local'), 0)::bigint,
    COALESCE(SUM(ul.page_count) FILTER (WHERE ul.feature_type = 'ai'), 0)::bigint,
    v_next_midnight
  FROM public.usage_logs ul
  WHERE ul.tracking_key = p_tracking_key
    AND ul.created_at >= v_sast_midnight
    AND ul.status = 'SUCCESS';
END;
$$;

-- ── UPDATED RPC: increment_usage ───────────────────────────────
-- Now accepts page_count and feature_type.
-- No return value — fire-and-forget insert.
DROP FUNCTION IF EXISTS public.increment_usage(uuid, text, int, text, text);

CREATE OR REPLACE FUNCTION public.increment_usage(
  p_tracking_key text,
  p_user_id uuid,
  p_tool_id text,
  p_page_count int,
  p_feature_type text,
  p_file_size_bytes bigint DEFAULT 0,
  p_file_name text DEFAULT NULL,
  p_status text DEFAULT 'SUCCESS',
  p_error_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_month text;
BEGIN
  v_month := to_char(NOW(), 'YYYY-MM');
  
  INSERT INTO public.usage_logs (
    tracking_key, user_id, month, tool_id,
    ai_pages, operations, page_count, feature_type,
    file_size_bytes, file_name, status, error_message
  ) VALUES (
    p_tracking_key, p_user_id, v_month, p_tool_id,
    CASE WHEN p_feature_type = 'ai' THEN p_page_count ELSE 0 END,
    CASE WHEN p_feature_type = 'local' THEN 1 ELSE 0 END,
    p_page_count,
    p_feature_type,
    p_file_size_bytes,
    p_file_name,
    p_status,
    p_error_message
  );
END;
$$;

-- ── NEW RPC: check_daily_quota ─────────────────────────────────
-- Pre-flight check: returns whether the user has remaining pages
-- for the given feature_type today in SAST.
CREATE OR REPLACE FUNCTION public.check_daily_quota(
  p_tracking_key text,
  p_feature_type text,
  p_requested_pages int DEFAULT 1
)
RETURNS TABLE(
  allowed boolean,
  pages_used_today bigint,
  pages_limit int,
  next_sast_midnight timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_limit int;
  v_used bigint;
  v_midnight timestamptz;
BEGIN
  -- Determine the daily limit based on feature type
  v_limit := CASE WHEN p_feature_type = 'local' THEN 5 ELSE 2 END;
  v_midnight := public.next_sast_midnight_utc();

  -- Get pages used today
  SELECT COALESCE(SUM(ul.page_count), 0)::bigint INTO v_used
  FROM public.usage_logs ul
  WHERE ul.tracking_key = p_tracking_key
    AND ul.feature_type = p_feature_type
    AND ul.created_at >= public.sast_midnight_utc()
    AND ul.status = 'SUCCESS';

  RETURN QUERY
  SELECT
    (v_used + p_requested_pages) <= v_limit AS allowed,
    v_used AS pages_used_today,
    v_limit AS pages_limit,
    v_midnight AS next_sast_midnight;
END;
$$;