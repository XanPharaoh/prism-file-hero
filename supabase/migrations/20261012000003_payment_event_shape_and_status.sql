-- 20261012000003_payment_event_shape_and_status.sql
-- Follow-ups on the same two functions, found by driving real and fixture PAYMENT.SALE payloads
-- through the durable inbox:
--
-- (1) Currency. PayPal writes the sale currency as `amount.currency` in some API versions and
--     `amount.currency_code` in others. Reading only one key stored a NULL currency, and since
--     coverage requires USD, a legitimate payment then granted nothing. Both spellings are read.
-- (2) A PAYMENT.SALE resource describes a SALE, not the subscription lifecycle. Its own `status`
--     (e.g. "completed") was being copied into billing_subscriptions.status, so a paid subscription
--     could end up reported as status "completed" instead of ACTIVE. Payment events now update only
--     the event pointer/timestamp; lifecycle status is written by status events alone.

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

  v_is_payment := p_event_type like 'PAYMENT.SALE%';
  v_sub := case when v_is_payment
                then coalesce(nullif(p_resource->>'subscription_id', ''), nullif(p_resource->>'billing_agreement_id', ''))
                else p_resource->>'id' end;
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
    -- Payment event: record progress, never restate the subscription's lifecycle status.
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
    v_sale := coalesce(nullif(p_resource->>'id', ''), nullif(p_resource->>'transaction_id', ''));
    if v_sale is null then return 'applied'; end if;
    insert into public.billing_payments (payment_id, subscription_id, user_id, currency, gross_amount, period_start, period_end, status, source_event_id, updated_at)
      values (v_sale, v_sub, v_user,
              coalesce(nullif(p_resource #>> '{amount,currency}', ''), nullif(p_resource #>> '{amount,currency_code}', '')),
              (coalesce(nullif(p_resource #>> '{amount,total}', ''), nullif(p_resource #>> '{amount,value}', '')))::numeric,
              nullif(p_resource->>'billing_period_start_date', '')::timestamptz,
              nullif(p_resource->>'billing_period_end_date', '')::timestamptz,
              'captured', p_event_id, now())
    on conflict (payment_id) do update
      set status = 'captured', currency = excluded.currency, gross_amount = excluded.gross_amount,
          period_start = excluded.period_start, period_end = excluded.period_end, updated_at = now();
  elsif p_event_type in ('PAYMENT.SALE.REFUNDED', 'PAYMENT.SALE.REVERSED') then
    v_sale := coalesce(nullif(p_resource->>'id', ''), nullif(p_resource->>'transaction_id', ''));
    update public.billing_payments
       set status = case when p_event_type = 'PAYMENT.SALE.REFUNDED' then 'refunded' else 'reversed' end, updated_at = now()
     where payment_id = v_sale and subscription_id = v_sub;   -- void the AFFECTED payment only
  end if;

  perform public.refresh_user_coverage(v_user);
  return 'applied';
end $$;

comment on function public.apply_paypal_event(text, text, jsonb) is
  'R7/R8: durable PayPal inbox. Payment events resolve their subscription from subscription_id or '
  'billing_agreement_id and never restate lifecycle status; lifecycle events use resource.id. Owner '
  'comes from the persisted link; coverage requires an allowlisted plan id and a USD amount read from '
  'either currency spelling. Unlinked/unmapped events are recorded and grant nothing.';

commit;
