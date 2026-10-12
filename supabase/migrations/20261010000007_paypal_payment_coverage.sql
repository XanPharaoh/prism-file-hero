-- R7 access-policy rework — entitlement from VERIFIED PAYMENT COVERAGE, not ACTIVE status.
--
-- Paid plans have no trial, so access must reflect that a real, un-reversed payment covers "now".
-- Adds billing_payments (one row per PAYMENT.SALE captured/refunded/reversed, with its coverage
-- window) and rewrites apply_paypal_event so:
--   • SUBSCRIPTION.* events update subscription STATUS only and NEVER grant paid access by themselves;
--   • PAYMENT.SALE.COMPLETED records coverage (period_end from the sale's billing period);
--   • PAYMENT.SALE.REFUNDED / .REVERSED void the AFFECTED payment (by sale id) → coverage shrinks;
--   • cancelling stops renewal but does NOT revoke already-paid coverage through period_end;
--   • ordering is per subscription STATUS stream only; PAYMENT.SALE events are never discarded
--     because a newer status event was processed first.
-- get_user_entitlement now derives "entitled" from an existing captured payment whose period_end
-- is in the future, so reconciliation on a mere ACTIVE cannot restore revoked access.

begin;

create table if not exists public.billing_payments (
  payment_id      text primary key,                 -- PayPal sale / transaction id
  subscription_id text not null,
  user_id         text,
  currency        text,
  gross_amount    numeric,
  period_start    timestamptz,
  period_end      timestamptz,                      -- paid-through date for THIS payment
  status          text not null default 'captured' check (status in ('captured','refunded','reversed')),
  source_event_id text,
  updated_at      timestamptz not null default now()
);
create index if not exists billing_pay_sub_idx on public.billing_payments (subscription_id);
create index if not exists billing_pay_user_idx on public.billing_payments (user_id, period_end);

-- Authoritative recomputation of a user's plan+status from captured payment coverage.
create or replace function public.refresh_user_coverage(p_user_id text)
returns void language sql security definer set search_path = public as $$
  insert into public.user_plans (user_id, plan, subscription_status, updated_at)
  select p_user_id,
    coalesce((select bp.plan from public.billing_price_plans bp
                join public.billing_subscriptions s on s.plan_id = bp.price_id
                join public.billing_payments pp on pp.subscription_id = s.subscription_id
               where s.user_id = p_user_id and pp.status = 'captured' and pp.currency = 'USD' and pp.period_end > now()
               order by pp.period_end desc limit 1), 'free'),
    case when exists (select 1 from public.billing_subscriptions s
                        join public.billing_payments pp on pp.subscription_id = s.subscription_id
                       where s.user_id = p_user_id and pp.status = 'captured' and pp.currency = 'USD' and pp.period_end > now())
         then 'active' else coalesce((select s.status from public.billing_subscriptions s
                                        where s.user_id = p_user_id order by s.updated_at desc limit 1), 'inactive') end,
    now()
  on conflict (user_id) do update
    set plan = excluded.plan, subscription_status = excluded.subscription_status, updated_at = now();
$$;

create or replace function public.apply_paypal_event(
  p_event_id text, p_event_type text, p_resource jsonb
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_sub text; v_user text; v_sale text; v_state text; v_occurred timestamptz; prior_occurred timestamptz;
  v_is_payment boolean; v_is_status boolean;
begin
  if p_event_id is null then return 'invalid'; end if;
  if exists (select 1 from public.billing_events where event_id = p_event_id) then return 'duplicate'; end if;

  -- PAYMENT.SALE.*: the resource is a SALE; its subscription_id links to the subscription.
  -- SUBSCRIPTION.*: the resource id IS the subscription id.
  v_is_payment := p_event_type like 'PAYMENT.SALE%';
  v_sub := case when v_is_payment then p_resource->>'subscription_id' else p_resource->>'id' end;
  v_occurred := coalesce(nullif(p_resource->>'time_updated',''), nullif(p_resource->>'update_datetime',''),
                         nullif(p_resource->>'create_time',''), nullif(p_resource->>'billing_period_end_date',''), now()::text)::timestamptz;

  insert into public.billing_events (event_id, event_type, occurred_at, subscription_id, payload)
    values (p_event_id, p_event_type, v_occurred, v_sub, p_resource);

  if v_sub is null then return 'applied'; end if;   -- recorded, nothing to link

  -- Per-subscription STATUS ordering only guards status events; payment events are NEVER dropped.
  v_is_status := not v_is_payment;
  if v_is_status then
    select last_occurred_at into prior_occurred from public.billing_subscriptions where subscription_id = v_sub for update;
    if prior_occurred is not null and v_occurred < prior_occurred then return 'out_of_order'; end if;
  end if;

  v_state := case
    when p_event_type in ('BILLING.SUBSCRIPTION.SUSPENDED') then 'suspended'
    when p_event_type in ('BILLING.SUBSCRIPTION.CANCELLED') then 'canceled'
    when p_event_type in ('BILLING.SUBSCRIPTION.EXPIRED')   then 'expired'
    when p_event_type = 'BILLING.SUBSCRIPTION.PAYMENT.FAILED' then 'past_due'
    when v_is_status and coalesce(p_resource->>'status','') <> '' then lower(p_resource->>'status')
    else 'updated' end;

  update public.billing_subscriptions
     set status = coalesce(nullif(p_resource->>'status',''), status),
         last_event_id = p_event_id, last_occurred_at = greatest(coalesce(last_occurred_at, v_occurred), v_occurred),
         updated_at = now()
   where subscription_id = v_sub;

  -- Resolve the server-side owner. Unlinked → recorded, no payment/coverage change.
  select user_id into v_user from public.billing_subscriptions where subscription_id = v_sub;
  if v_user is null then return 'unlinked'; end if;

  if p_event_type = 'PAYMENT.SALE.COMPLETED' then
    v_sale := p_resource->>'id';
    insert into public.billing_payments (payment_id, subscription_id, user_id, currency, gross_amount, period_start, period_end, status, source_event_id, updated_at)
      values (v_sale, v_sub, v_user,
              p_resource #>> '{amount,currency}', (p_resource #>> '{amount,total}')::numeric,
              nullif(p_resource->>'billing_period_start_date','')::timestamptz,
              nullif(p_resource->>'billing_period_end_date','')::timestamptz,
              'captured', p_event_id, now())
    on conflict (payment_id) do update
      set status = 'captured', period_start = excluded.period_start, period_end = excluded.period_end, updated_at = now();
  elsif p_event_type in ('PAYMENT.SALE.REFUNDED','PAYMENT.SALE.REVERSED') then
    v_sale := p_resource->>'id';
    update public.billing_payments
       set status = case when p_event_type = 'PAYMENT.SALE.REFUNDED' then 'refunded' else 'reversed' end, updated_at = now()
     where payment_id = v_sale and subscription_id = v_sub;   -- void the AFFECTED payment only
  end if;
  -- SUBSCRIPTION.* (incl. CANCELLED) do NOT grant/void coverage; refresh recomputes from payments.

  perform public.refresh_user_coverage(v_user);
  return 'applied';
end $$;

-- Entitlement is PAYMENT COVERAGE only (never mere ACTIVE).
create or replace function public.get_user_entitlement(p_user_id text)
returns table (entitled boolean, plan text, subscription_status text)
language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from public.billing_subscriptions s
              join public.billing_payments pp on pp.subscription_id = s.subscription_id
             where s.user_id = p_user_id and pp.status = 'captured' and pp.currency = 'USD' and pp.period_end > now()) as entitled,
    coalesce((select bp.plan from public.billing_price_plans bp
                join public.billing_subscriptions s on s.plan_id = bp.price_id
                join public.billing_payments pp on pp.subscription_id = s.subscription_id
               where s.user_id = p_user_id and pp.status = 'captured' and pp.currency = 'USD' and pp.period_end > now()
               order by pp.period_end desc limit 1), 'free') as plan,
    coalesce((select s.status from public.billing_subscriptions s where s.user_id = p_user_id
              order by s.updated_at desc limit 1), 'inactive') as subscription_status;
$$;

-- Coverage must never be granted via subscription_status; keep plan/RLS authoritative.
revoke execute on function public.apply_paypal_event(text, text, jsonb)        from public, anon, authenticated;
revoke execute on function public.refresh_user_coverage(text)                  from public, anon, authenticated;
revoke execute on function public.get_user_entitlement(text)                   from public, anon, authenticated;
grant  execute on function public.apply_paypal_event(text, text, jsonb)        to service_role;
grant  execute on function public.refresh_user_coverage(text)                  to service_role;
grant  execute on function public.get_user_entitlement(text)                   to service_role;

commit;
