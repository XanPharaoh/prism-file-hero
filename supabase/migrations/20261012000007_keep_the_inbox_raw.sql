-- 20261012000007_keep_the_inbox_raw.sql
-- Integrity fix found while exporting the real payloads as fixtures: the webhook stored the resource
-- the Worker had ENRICHED with a coverage window, so billing_events no longer held what PayPal
-- actually sent. The durable inbox is the evidence trail — it must contain the provider's payload, and
-- anything we add must be attributable.
--
-- apply_paypal_event therefore takes the raw resource plus an optional p_coverage object that only the
-- Worker supplies (from PayPal's own subscription object, after canBindWindow matched the sale). The
-- stored payload is now byte-for-byte what was delivered; the derived window is separate and visible.

begin;

drop function if exists public.apply_paypal_event(text, text, jsonb);

create or replace function public.apply_paypal_event(
  p_event_id text, p_event_type text, p_resource jsonb, p_coverage jsonb default null)
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
  v_period_end timestamptz;
  v_period_start timestamptz;
  prior_occurred timestamptz;
begin
  if p_event_id is null then return 'invalid'; end if;
  if exists (select 1 from public.billing_events where event_id = p_event_id) then return 'duplicate'; end if;

  v_is_payment := p_event_type like 'PAYMENT.SALE%';
  v_is_refund  := p_event_type in ('PAYMENT.SALE.REFUNDED', 'PAYMENT.SALE.REVERSED');
  v_sale := case when v_is_refund
                 then coalesce(nullif(p_resource->>'sale_id', ''), nullif(p_resource->>'id', ''))
                 else coalesce(nullif(p_resource->>'id', ''), nullif(p_resource->>'transaction_id', '')) end;
  v_sub := case when not v_is_payment then p_resource->>'id'
                else coalesce(
                  nullif(p_resource->>'subscription_id', ''),
                  nullif(p_resource->>'billing_agreement_id', ''),
                  case when v_is_refund and v_sale is not null
                       then (select subscription_id from public.billing_payments where payment_id = v_sale) end)
           end;
  v_occurred := coalesce(nullif(p_resource->>'time_updated', ''), nullif(p_resource->>'update_time', ''),
                         nullif(p_resource->>'update_datetime', ''), nullif(p_resource->>'create_time', ''),
                         nullif(p_resource->>'billing_period_end_date', ''), now()::text)::timestamptz;

  -- The inbox keeps the RAW provider payload. Nothing derived is written into it.
  insert into public.billing_events (event_id, event_type, occurred_at, subscription_id, payload)
    values (p_event_id, p_event_type, v_occurred, v_sub, p_resource);

  if v_sub is null then return 'applied'; end if;

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
     where subscription_id = v_sub;
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
    v_period_start := coalesce(nullif(p_resource->>'billing_period_start_date', '')::timestamptz,
                               nullif(p_coverage->>'start', '')::timestamptz, v_captured);
    v_period_end   := coalesce(nullif(p_resource->>'billing_period_end_date', '')::timestamptz,
                               nullif(p_coverage->>'end', '')::timestamptz);
    insert into public.billing_payments
      (payment_id, subscription_id, user_id, currency, gross_amount, period_start, period_end, status, source_event_id, captured_at, updated_at)
      values (v_sale, v_sub, v_user,
              coalesce(nullif(p_resource #>> '{amount,currency}', ''), nullif(p_resource #>> '{amount,currency_code}', '')),
              (coalesce(nullif(p_resource #>> '{amount,total}', ''), nullif(p_resource #>> '{amount,value}', '')))::numeric,
              v_period_start, v_period_end,
              'captured', p_event_id, v_captured, now())
    on conflict (payment_id) do update
      -- A payment PayPal has already refunded/reversed must not be flipped back to 'captured' by a
      -- redelivered capture; only the missing fields are filled.
      set status = case when billing_payments.status in ('refunded', 'reversed')
                        then billing_payments.status else 'captured' end,
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

revoke execute on function public.apply_paypal_event(text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.apply_paypal_event(text, text, jsonb, jsonb) to service_role;

comment on function public.apply_paypal_event(text, text, jsonb, jsonb) is
  'R7/R8: durable PayPal inbox storing the RAW provider payload. p_coverage carries only a Worker-'
  'supplied paid-through window (from PayPal''s subscription object) for payments that omit '
  'billing_period_*; refunds resolve the affected payment through sale_id; a replay can fill but never '
  'extend a bound window; coverage requires an allowlisted plan.';

commit;
