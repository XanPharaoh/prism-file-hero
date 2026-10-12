-- 20261012000002_coverage_requires_allowlisted_plan.sql
-- Two gaps found by running the real checks against the local DB.
--
-- (1) A PAYMENT.SALE.* resource names its subscription `billing_agreement_id` (PayPal's own field
--     for a sale). apply_paypal_event only read `subscription_id`, so a genuine sale payload landed
--     as an event with no owner and recorded no coverage — the Worker's mapping was the only thing
--     holding that up. The durable layer now reads either name.
-- (2) get_user_entitlement / refresh_user_coverage decided "entitled" from a captured USD payment
--     joined only through billing_subscriptions. A subscription whose plan_id is NOT in the
--     billing_price_plans allowlist therefore produced entitled=true with plan='free': paid status
--     without a server-approved plan. Coverage now requires the allowlisted plan, so an unmapped
--     plan id grants nothing.

begin;

create or replace function public.apply_paypal_event(p_event_id text, p_event_type text, p_resource jsonb)
 returns text
 language plpgsql
 security definer
 set search_path = public
as $$
declare
  v_is_payment boolean;
  v_is_status boolean;
  v_sub text;
  v_user text;
  v_sale text;
  v_tier text;
  v_state text;
  v_occurred timestamptz;
  prior_occurred timestamptz;
begin
  if p_event_id is null then return 'invalid'; end if;
  if exists (select 1 from public.billing_events where event_id = p_event_id) then return 'duplicate'; end if;

  -- PAYMENT.SALE.*: the resource is a SALE; its subscription is billing_agreement_id (or, if a
  -- caller already normalised it, subscription_id). SUBSCRIPTION.*: the resource id IS the subscription.
  v_is_payment := p_event_type like 'PAYMENT.SALE%';
  v_sub := case when v_is_payment
                then coalesce(nullif(p_resource->>'subscription_id', ''), nullif(p_resource->>'billing_agreement_id', ''))
                else p_resource->>'id' end;
  v_occurred := coalesce(nullif(p_resource->>'time_updated', ''), nullif(p_resource->>'update_datetime', ''),
                         nullif(p_resource->>'create_time', ''), nullif(p_resource->>'billing_period_end_date', ''), now()::text)::timestamptz;

  insert into public.billing_events (event_id, event_type, occurred_at, subscription_id, payload)
    values (p_event_id, p_event_type, v_occurred, v_sub, p_resource);

  if v_sub is null then return 'applied'; end if;   -- recorded, nothing to link

  -- Per-subscription STATUS ordering only guards status events; payment events are NEVER dropped
  -- because a newer status event was processed first.
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
    when v_is_status and coalesce(p_resource->>'status', '') <> '' then lower(p_resource->>'status')
    else 'updated' end;

  update public.billing_subscriptions
     set status = coalesce(nullif(p_resource->>'status', ''), status),
         last_event_id = p_event_id, last_occurred_at = greatest(coalesce(last_occurred_at, v_occurred), v_occurred),
         updated_at = now()
   where subscription_id = v_sub;

  -- Resolve the server-side owner. Unlinked → recorded, no payment/coverage change.
  select user_id into v_user from public.billing_subscriptions where subscription_id = v_sub;
  if v_user is null then return 'unlinked'; end if;

  if p_event_type = 'PAYMENT.SALE.COMPLETED' then
    -- Ownership of the paid tier comes from the plan linked SERVER-side at subscribe time, and that
    -- plan must be allowlisted. A sale against an unmapped plan id is recorded but grants nothing.
    select plan into v_tier from public.billing_subscriptions s
      join public.billing_price_plans bp on bp.price_id = s.plan_id
     where s.subscription_id = v_sub;
    if v_tier is null then return 'unmapped_plan'; end if;
    v_sale := p_resource->>'id';
    insert into public.billing_payments (payment_id, subscription_id, user_id, currency, gross_amount, period_start, period_end, status, source_event_id, updated_at)
      values (v_sale, v_sub, v_user,
              p_resource #>> '{amount,currency}', (p_resource #>> '{amount,total}')::numeric,
              nullif(p_resource->>'billing_period_start_date', '')::timestamptz,
              nullif(p_resource->>'billing_period_end_date', '')::timestamptz,
              'captured', p_event_id, now())
    on conflict (payment_id) do update
      set status = 'captured', period_start = excluded.period_start, period_end = excluded.period_end, updated_at = now();
  elsif p_event_type in ('PAYMENT.SALE.REFUNDED', 'PAYMENT.SALE.REVERSED') then
    v_sale := p_resource->>'id';
    update public.billing_payments
       set status = case when p_event_type = 'PAYMENT.SALE.REFUNDED' then 'refunded' else 'reversed' end, updated_at = now()
     where payment_id = v_sale and subscription_id = v_sub;   -- void the AFFECTED payment only
  end if;
  -- SUBSCRIPTION.* (incl. CANCELLED) do NOT grant/void coverage; refresh recomputes from payments.

  perform public.refresh_user_coverage(v_user);
  return 'applied';
end $$;

-- Entitlement is PAYMENT COVERAGE on an ALLOWLISTED plan — never mere ACTIVE, never a payment on an
-- unmapped plan id.
create or replace function public.get_user_entitlement(p_user_id text)
 returns table (entitled boolean, plan text, subscription_status text)
 language sql stable security definer set search_path = public as $$
  select
    exists (select 1 from public.billing_subscriptions s
              join public.billing_price_plans bp on bp.price_id = s.plan_id
              join public.billing_payments pp on pp.subscription_id = s.subscription_id
             where s.user_id = p_user_id and pp.status = 'captured' and pp.currency = 'USD' and pp.period_end > now()) as entitled,
    coalesce((select bp.plan from public.billing_subscriptions s
                join public.billing_price_plans bp on bp.price_id = s.plan_id
                join public.billing_payments pp on pp.subscription_id = s.subscription_id
               where s.user_id = p_user_id and pp.status = 'captured' and pp.currency = 'USD' and pp.period_end > now()
               order by pp.period_end desc limit 1), 'free') as plan,
    coalesce((select s.status from public.billing_subscriptions s where s.user_id = p_user_id
              order by s.updated_at desc limit 1), 'inactive') as subscription_status;
$$;

create or replace function public.refresh_user_coverage(p_user_id text)
 returns void
 language sql security definer set search_path = public as $$
  insert into public.user_plans (user_id, plan, subscription_status, updated_at)
  select p_user_id,
    coalesce((select bp.plan from public.billing_subscriptions s
                join public.billing_price_plans bp on bp.price_id = s.plan_id
                join public.billing_payments pp on pp.subscription_id = s.subscription_id
               where s.user_id = p_user_id and pp.status = 'captured' and pp.currency = 'USD' and pp.period_end > now()
               order by pp.period_end desc limit 1), 'free'),
    case when exists (select 1 from public.billing_subscriptions s
                        join public.billing_price_plans bp on bp.price_id = s.plan_id
                        join public.billing_payments pp on pp.subscription_id = s.subscription_id
                       where s.user_id = p_user_id and pp.status = 'captured' and pp.currency = 'USD' and pp.period_end > now())
         then 'active' else coalesce((select s.status from public.billing_subscriptions s
                                        where s.user_id = p_user_id order by s.updated_at desc limit 1), 'inactive') end,
    now()
  on conflict (user_id) do update
    set plan = excluded.plan, subscription_status = excluded.subscription_status, updated_at = now();
$$;

revoke execute on function public.apply_paypal_event(text, text, jsonb),
                                        public.get_user_entitlement(text),
                                        public.refresh_user_coverage(text) from public, anon, authenticated;
grant execute on function public.apply_paypal_event(text, text, jsonb),
                                    public.get_user_entitlement(text),
                                    public.refresh_user_coverage(text) to service_role;

comment on function public.apply_paypal_event(text, text, jsonb) is
  'R7/R8: durable PayPal inbox. Payments resolve their subscription from billing_agreement_id, '
  'lifecycle events from resource.id; owner comes from the persisted link; coverage requires an '
  'allowlisted plan id; unlinked/unmapped events are recorded and grant nothing.';

commit;
