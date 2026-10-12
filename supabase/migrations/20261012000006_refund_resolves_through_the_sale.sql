-- 20261012000006_refund_resolves_through_the_sale.sql
-- Measured on a REAL sandbox refund (refund 6X5450135V3210505 of sale 3E514943GY2888425).
-- The delivered PAYMENT.SALE.REFUNDED resource is:
--   { id: <REFUND id>, sale_id: <original SALE id>, amount:{total,currency}, state, create_time,
--     update_time, refund_to_payer, total_refunded_amount, … }
-- Two things follow, and the previous code got both wrong:
--   1. `id` is the REFUND, not the payment. Voiding "where payment_id = resource.id" matched nothing,
--      so a verified full refund left the payment captured and the user entitled.
--   2. The refund payload names NO subscription at all (no subscription_id, no billing_agreement_id),
--      so ownership must be resolved THROUGH the affected sale row.
-- Partial refunds are also handled: coverage is revoked only when the period stops being paid for,
-- i.e. cumulative refunds reach the captured gross (a REVERSED payment always revokes).

begin;

alter table public.billing_payments add column if not exists refunded_amount numeric not null default 0;
alter table public.billing_payments add column if not exists voided_by_event_id text;

create or replace function public.apply_paypal_event(p_event_id text, p_event_type text, p_resource jsonb)
 returns text
 language plpgsql
 security definer
 set search_path = public
as $$
declare
  v_is_payment boolean;
  v_is_status boolean;
  v_is_refund boolean;
  v_sub text;
  v_user text;
  v_sale text;
  v_tier text;
  v_state text;
  v_captured timestamptz;
  v_occurred timestamptz;
  v_refund numeric;
  prior_occurred timestamptz;
begin
  if p_event_id is null then return 'invalid'; end if;
  if exists (select 1 from public.billing_events where event_id = p_event_id) then return 'duplicate'; end if;

  v_is_payment := p_event_type like 'PAYMENT.SALE%';
  v_is_refund  := p_event_type in ('PAYMENT.SALE.REFUNDED', 'PAYMENT.SALE.REVERSED');
  -- The sale a refund refers to, when it names one (measured: sale_id).
  v_sale := case when v_is_refund
                 then coalesce(nullif(p_resource->>'sale_id', ''), nullif(p_resource->>'id', ''))
                 else coalesce(nullif(p_resource->>'id', ''), nullif(p_resource->>'transaction_id', '')) end;

  v_sub := case when not v_is_payment then p_resource->>'id'
                else coalesce(
                  nullif(p_resource->>'subscription_id', ''),
                  nullif(p_resource->>'billing_agreement_id', ''),
                  -- A refund names no subscription: resolve it through the payment it voids.
                  case when v_is_refund and v_sale is not null
                       then (select subscription_id from public.billing_payments where payment_id = v_sale) end)
           end;
  v_occurred := coalesce(nullif(p_resource->>'time_updated', ''), nullif(p_resource->>'update_time', ''),
                         nullif(p_resource->>'update_datetime', ''), nullif(p_resource->>'create_time', ''),
                         nullif(p_resource->>'billing_period_end_date', ''), now()::text)::timestamptz;

  insert into public.billing_events (event_id, event_type, occurred_at, subscription_id, payload)
    values (p_event_id, p_event_type, v_occurred, v_sub, p_resource);

  if v_sub is null then return 'applied'; end if;   -- recorded, nothing to link

  v_is_status := not v_is_payment;
  if v_is_status then
    select last_occurred_at into prior_occurred from public.billing_subscriptions where subscription_id = v_sub for update;
    if prior_occurred is not null and v_occurred < prior_occurred then return 'out_of_order'; end if;
    v_state := case
      when p_event_type = 'BILLING.SUBSCRIPTION.SUSPENDED' then 'suspended'
      when p_event_type = 'BILLING.SUBSCRIPTION.CANCELLED' then 'canceled'
      when p_event_type = 'BILLING.SUBSCRIPTION.EXPIRED'   then 'expired'
      when p_event_type = 'BILLING.SUBSCRIPTION.PAYMENT.FAILED' then 'past_due'
      when coalesce(p_resource->>'status', '') <> '' then lower(p_resource->>'status')
      else 'updated' end;
    update public.billing_subscriptions
       set status = coalesce(nullif(p_resource->>'status', ''), status),
           last_event_id = p_event_id,
           last_occurred_at = greatest(coalesce(last_occurred_at, v_occurred), v_occurred),
           updated_at = now()
     where subscription_id = v_sub;
  else
    update public.billing_subscriptions
       set last_event_id = p_event_id,
           last_occurred_at = greatest(coalesce(last_occurred_at, v_occurred), v_occurred),
           updated_at = now()
     where subscription_id = v_sub;   -- a sale/refund never restates lifecycle status
  end if;

  select user_id into v_user from public.billing_subscriptions where subscription_id = v_sub;
  if v_user is null then return 'unlinked'; end if;

  if p_event_type = 'PAYMENT.SALE.COMPLETED' then
    select plan into v_tier from public.billing_subscriptions s
      join public.billing_price_plans bp on bp.price_id = s.plan_id
     where s.subscription_id = v_sub;
    if v_tier is null then return 'unmapped_plan'; end if;
    if v_sale is null then return 'applied'; end if;
    v_captured := coalesce(nullif(p_resource->>'update_time', '')::timestamptz,
                           nullif(p_resource->>'create_time', '')::timestamptz,
                           nullif(p_resource->>'time_updated', '')::timestamptz);
    insert into public.billing_payments
      (payment_id, subscription_id, user_id, currency, gross_amount, period_start, period_end, status, source_event_id, captured_at, updated_at)
      values (v_sale, v_sub, v_user,
              coalesce(nullif(p_resource #>> '{amount,currency}', ''), nullif(p_resource #>> '{amount,currency_code}', '')),
              (coalesce(nullif(p_resource #>> '{amount,total}', ''), nullif(p_resource #>> '{amount,value}', '')))::numeric,
              coalesce(nullif(p_resource->>'billing_period_start_date', '')::timestamptz, v_captured),
              nullif(p_resource->>'billing_period_end_date', '')::timestamptz,
              'captured', p_event_id, v_captured, now())
    on conflict (payment_id) do update
      set status = 'captured',
          currency = coalesce(billing_payments.currency, excluded.currency),
          gross_amount = coalesce(billing_payments.gross_amount, excluded.gross_amount),
          period_start = coalesce(billing_payments.period_start, excluded.period_start),
          period_end   = coalesce(billing_payments.period_end,   excluded.period_end),
          captured_at  = coalesce(billing_payments.captured_at,  excluded.captured_at),
          updated_at   = now();
  elsif v_is_refund then
    v_refund := (coalesce(nullif(p_resource #>> '{amount,total}', ''), nullif(p_resource #>> '{amount,value}', '')))::numeric;
    update public.billing_payments
       set refunded_amount = case when v_refund is null then coalesce(gross_amount, 0)
                                  else billing_payments.refunded_amount + v_refund end,
           -- A reversal always voids; an unquantified refund voids too (fail closed on entitlement).
           -- Only an EXPLICIT partial amount that leaves the period still paid for keeps access.
           status = case when p_event_type = 'PAYMENT.SALE.REVERSED' then 'reversed'
                         when v_refund is null then 'refunded'
                         when v_refund <= 0 then billing_payments.status
                         when billing_payments.refunded_amount + v_refund
                              >= coalesce(billing_payments.gross_amount, 0) then 'refunded'
                         else billing_payments.status end,
           voided_by_event_id = p_event_id,
           updated_at = now()
     where payment_id = v_sale and subscription_id = v_sub;
  end if;

  perform public.refresh_user_coverage(v_user);
  return 'applied';
end $$;

revoke execute on function public.apply_paypal_event(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_paypal_event(text, text, jsonb) to service_role;

comment on function public.apply_paypal_event(text, text, jsonb) is
  'R7/R8: durable PayPal inbox. Refunds resolve the affected payment through sale_id and the payment '
  'row itself (a refund payload names no subscription); partial refunds keep coverage until the period '
  'stops being paid for; a replayed payment cannot extend a bound window; coverage requires an '
  'allowlisted plan and a USD amount from either currency spelling.';

commit;
