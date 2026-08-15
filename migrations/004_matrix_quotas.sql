-- ══════════════════════════════════════════════════════════════
-- PRISM FILE HERO — MATRIX QUOTA SYSTEM (v4)
-- 
-- Evolves from simple daily limits to a dual-layered Matrix Quota:
--   Local Tier:  Per-Tool = 5 pages/day, Global Cap = 15 pages/day
--   AI Tier:     Per-Tool = 2 pages/day, Global Cap = 6 pages/day
--   Reset:       00:00:00 SAST (Africa/Johannesburg, UTC+2)
--
-- Idempotent (safe to re-run).
-- Run this in Supabase SQL Editor after v3 migration.
-- ══════════════════════════════════════════════════════════════

-- ── MATRIX QUOTA CONSTANTS ────────────────────────────────────
-- Local tier: per-tool limit = 5, global cap = 15
-- AI tier: per-tool limit = 2, global cap = 6

-- ── UPDATED RPC: get_usage_summary (Matrix Quota) ─────────────
-- Returns a JSON object with:
--   - local_global_used, local_global_cap (15)
--   - ai_global_used, ai_global_cap (6)
--   - tool_breakdown: { tool_id: pages_used_today, ... }
--   - next_reset_utc: ISO timestamp of next SAST midnight
DROP FUNCTION IF EXISTS public.get_usage_summary(text, uuid);

CREATE OR REPLACE FUNCTION public.get_usage_summary(
  p_tracking_key text,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_sast_midnight timestamptz;
  v_next_midnight timestamptz;
  v_local_global bigint;
  v_ai_global bigint;
  v_tool_breakdown jsonb;
BEGIN
  v_sast_midnight := public.sast_midnight_utc();
  v_next_midnight := public.next_sast_midnight_utc();

  -- Global tier sums
  SELECT
    COALESCE(SUM(ul.page_count) FILTER (WHERE ul.feature_type = 'local'), 0),
    COALESCE(SUM(ul.page_count) FILTER (WHERE ul.feature_type = 'ai'), 0)
  INTO v_local_global, v_ai_global
  FROM public.usage_logs ul
  WHERE ul.tracking_key = p_tracking_key
    AND ul.created_at >= v_sast_midnight
    AND ul.status = 'SUCCESS';

  -- Per-tool breakdown
  SELECT jsonb_object_agg(ul.tool_id, ul.total_pages)
  INTO v_tool_breakdown
  FROM (
    SELECT ul.tool_id, SUM(ul.page_count)::bigint AS total_pages
    FROM public.usage_logs ul
    WHERE ul.tracking_key = p_tracking_key
      AND ul.created_at >= v_sast_midnight
      AND ul.status = 'SUCCESS'
    GROUP BY ul.tool_id
  ) ul;

  IF v_tool_breakdown IS NULL THEN
    v_tool_breakdown := '{}'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'local_global_used', v_local_global,
    'local_global_cap', 15,
    'ai_global_used', v_ai_global,
    'ai_global_cap', 6,
    'tool_breakdown', v_tool_breakdown,
    'next_reset_utc', v_next_midnight
  );
END;
$$;

-- ── UPDATED RPC: check_daily_quota (Matrix Quota) ─────────────
-- Checks BOTH per-tool limit AND global tier cap.
-- Returns JSON: { allowed, reason, tool, tier, pages_used, pages_limit }
-- reason: 'tool_limit' | 'global_cap' | null (null = allowed)
DROP FUNCTION IF EXISTS public.check_daily_quota(text, text, int);

CREATE OR REPLACE FUNCTION public.check_daily_quota(
  p_tracking_key text,
  p_tool_id text,
  p_feature_type text,
  p_requested_pages int DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_per_tool_limit int;
  v_global_cap int;
  v_tool_used bigint;
  v_global_used bigint;
  v_midnight timestamptz;
BEGIN
  -- Set limits based on feature type
  IF p_feature_type = 'local' THEN
    v_per_tool_limit := 5;
    v_global_cap := 15;
  ELSE
    v_per_tool_limit := 2;
    v_global_cap := 6;
  END IF;

  v_midnight := public.next_sast_midnight_utc();

  -- Get per-tool usage today
  SELECT COALESCE(SUM(ul.page_count), 0)::bigint INTO v_tool_used
  FROM public.usage_logs ul
  WHERE ul.tracking_key = p_tracking_key
    AND ul.tool_id = p_tool_id
    AND ul.created_at >= public.sast_midnight_utc()
    AND ul.status = 'SUCCESS';

  -- Check per-tool limit first
  IF (v_tool_used + p_requested_pages) > v_per_tool_limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'tool_limit',
      'tool', p_tool_id,
      'tier', p_feature_type,
      'pages_used', v_tool_used,
      'pages_limit', v_per_tool_limit,
      'next_reset_utc', v_midnight
    );
  END IF;

  -- Get global tier usage today
  SELECT COALESCE(SUM(ul.page_count), 0)::bigint INTO v_global_used
  FROM public.usage_logs ul
  WHERE ul.tracking_key = p_tracking_key
    AND ul.feature_type = p_feature_type
    AND ul.created_at >= public.sast_midnight_utc()
    AND ul.status = 'SUCCESS';

  -- Check global tier cap
  IF (v_global_used + p_requested_pages) > v_global_cap THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'global_cap',
      'tool', p_tool_id,
      'tier', p_feature_type,
      'pages_used', v_global_used,
      'pages_limit', v_global_cap,
      'next_reset_utc', v_midnight
    );
  END IF;

  -- Allowed
  RETURN jsonb_build_object(
    'allowed', true,
    'reason', null::text,
    'tool', p_tool_id,
    'tier', p_feature_type,
    'pages_used', v_tool_used,
    'pages_limit', v_per_tool_limit,
    'next_reset_utc', v_midnight
  );
END;
$$;

-- ── UPDATED RPC: increment_usage (unchanged signature, but stores page_count) ──
-- Already updated in v3 migration. No changes needed.