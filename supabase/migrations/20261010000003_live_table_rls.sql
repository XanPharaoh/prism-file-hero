-- Item 4 / Check 2 — Enforce cross-user isolation on the LIVE tables.
--
-- The local-stack probe found `user_plans` and `usage_logs` had Row Level Security DISABLED
-- (relrowsecurity=false, zero policies), so ANY anon/authenticated PostgREST caller could read
-- every user's plan and usage rows and write to user_plans. Batch-04 only protected the orphan
-- singular tables. The Worker is unaffected because it authenticates as `service_role` (which has
-- BYPASSRLS); this only locks down direct client access. Forward + idempotent.

begin;

alter table public.user_plans enable row level security;
alter table public.usage_logs enable row level security;

-- authenticated: read ONLY their own rows. No insert/update/delete policies exist, so those are
-- denied to non-bypass roles; the definer functions + service_role remain the only writers.
drop policy if exists user_plans_read_self on public.user_plans;
create policy user_plans_read_self on public.user_plans
  for select to authenticated using ((auth.uid())::text = user_id);

drop policy if exists usage_logs_read_self on public.usage_logs;
create policy usage_logs_read_self on public.usage_logs
  for select to authenticated using (user_id = (auth.uid())::text);

commit;
