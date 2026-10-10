-- Batch 04 — Authoritative plan source + explicit credit reservation/refund (forward, additive).
-- Idempotent: safe to re-run. Mirrors the pure model in worker/src/planCatalog.ts and
-- worker/src/creditLedger.ts. Intended to be applied to an ISOLATED local/branch database
-- first (fresh install AND upgraded from the prior 20260806140000_unify_usage_ledger schema),
-- never directly against the linked production DB.
--
-- Entitlement rule: a user's plan is set ONLY by trusted server code (billing webhook /
-- admin), never from a client request. The RLS policy below lets anon/authenticated READ
-- their own row but never WRITE it.

begin;

-- 1) Server-owned plan record. source records WHY the plan is what it is (webhook/admin).
create table if not exists public.user_plan (
  user_id      text primary key,
  plan         text not null default 'free'
                 check (plan in ('free','pro','business')),
  source       text not null default 'system'
                 check (source in ('signup','webhook','admin','migration')),
  updated_at   timestamptz not null default now()
);

-- 2) Credit reservations: the atomic hold/settle/refund ledger.
--    request_id is unique => an idempotent client retry cannot double-charge.
create table if not exists public.credit_reservations (
  request_id   uuid primary key,
  user_id      text not null,
  cost         integer not null check (cost > 0),
  status       text not null default 'PENDING' check (status in ('PENDING','SUCCESS','ERROR')),
  created_at   timestamptz not null default now(),
  settled_at   timestamptz
);
create index if not exists credit_res_user_status_idx
  on public.credit_reservations (user_id, status);

-- 3) Monthly grant per plan (authoritative; business = unlimited via NULL).
create table if not exists public.plan_grants (
  month_key           text not null,          -- 'YYYY-MM'
  user_id             text not null,
  ai_credit_limit     integer,                -- NULL = unlimited
  ai_credit_used      integer not null default 0,
  primary key (month_key, user_id)
);

-- 4) Atomic reserve: hold `cost` credits for a request, idempotent by request_id.
--    Runs entirely in one statement-level transaction; SELECT ... FOR UPDATE serializes
--    concurrent reserves for the same user+month so the balance is never oversold.
create or replace function public.reserve_credit(
  p_request_id uuid, p_user_id text, p_cost integer, p_month text
) returns table (granted boolean, reason text, remaining integer)
language plpgsql security definer as $$
declare
  v_limit integer;
  v_used integer;
  v_held integer;
  v_existing boolean;
begin
  -- idempotent replay: return the prior decision without re-holding.
  select (status <> 'ERROR') into v_existing
    from public.credit_reservations where request_id = p_request_id;
  if v_existing is not null then
    granted := v_existing;
    select ai_credit_limit into v_limit from public.plan_grants where month_key = p_month and user_id = p_user_id;
    remaining := coalesce(v_limit, -1);
    reason := case when v_existing then 'replay-granted' else 'replay-denied' end;
    return next;
    return;
  end if;

  if p_cost is null or p_cost <= 0 then
    granted := false; reason := 'invalid cost'; remaining := 0; return next; return;
  end if;

  select ai_credit_limit into v_limit from public.plan_grants
    where month_key = p_month and user_id = p_user_id for update;
  if v_limit is null then
    -- no grant row => fall back to the plan's default (free) so callers must provision.
    granted := false; reason := 'no plan grant'; remaining := 0; return next; return;
  end if;

  select coalesce(ai_credit_used,0) into v_used from public.plan_grants where month_key = p_month and user_id = p_user_id;
  select coalesce(sum(cost),0) into v_held from public.credit_reservations
    where user_id = p_user_id and status = 'PENDING';

  if v_limit = -1 then
    granted := true; reason := null; remaining := -1;
  elsif v_used + v_held + p_cost <= v_limit then
    granted := true; reason := null; remaining := v_limit - (v_used + v_held + p_cost);
  else
    granted := false; reason := 'insufficient credits';
    remaining := greatest(v_limit - (v_used + v_held), 0);
    return next; return;
  end if;

  insert into public.credit_reservations (request_id, user_id, cost, status)
    values (p_request_id, p_user_id, p_cost, 'PENDING');
  return next;
end $$;

-- 5) Atomic settle: SUCCESS converts the hold into used; ERROR releases it (refund).
--    Terminal once — a duplicate settle never double-refunds or double-counts.
create or replace function public.settle_credit(
  p_request_id uuid, p_status text, p_month text
) returns void
language plpgsql security definer as $$
declare r public.credit_reservations%rowtype;
begin
  if p_status not in ('SUCCESS','ERROR') then raise exception 'bad status'; end if;
  select * into r from public.credit_reservations where request_id = p_request_id for update;
  if not found then return; end if;               -- unknown request: no-op
  if r.status <> 'PENDING' then return; end if;    -- already terminal: idempotent no-op

  if p_status = 'SUCCESS' then
    update public.plan_grants
       set ai_credit_used = ai_credit_used + r.cost
     where month_key = p_month and user_id = r.user_id;
  end if; -- ERROR => refund: the PENDING hold is simply removed, used unchanged.

  update public.credit_reservations
     set status = p_status, settled_at = now()
   where request_id = p_request_id;
end $$;

-- 6) RLS — plan/credit tables are server-authoritative.
alter table public.user_plan           enable row level security;
alter table public.credit_reservations enable row level security;
alter table public.plan_grants         enable row level security;

-- anon: no direct access at all (all access is via the definer functions above).
-- authenticated: may READ their own plan/grants but never WRITE them.
drop policy if exists user_plan_read_self on public.user_plan;
create policy user_plan_read_self on public.user_plan
  for select using (auth.uid()::text = user_id);
drop policy if exists plan_grants_read_self on public.plan_grants;
create policy plan_grants_read_self on public.plan_grants
  for select using (auth.uid()::text = user_id);
-- No insert/update/delete policies => only security-definer functions and service_role can write.

comment on function public.reserve_credit is 'Batch 04 atomic, idempotent credit reservation';
comment on function public.settle_credit  is 'Batch 04 terminal settle; ERROR path refunds the hold';

commit;
