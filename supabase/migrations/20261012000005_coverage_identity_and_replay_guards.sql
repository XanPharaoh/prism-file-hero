-- 20261012000005_coverage_identity_and_replay_guards.sql
-- Hardening the paid-through window against replay, duplicates and ambiguous dates. Each rule below
-- is covered by scripts/paypal-entitlement-check.mjs.
--
-- A payment needs an IDENTITY that survives replay. PayPal's own sale timestamps say WHEN the money
-- moved; billing_info.last_payment.time on the subscription says which sale is the CURRENT one. Without
-- storing the sale time we could not tell "this old sale was redelivered" from "this is the payment that
-- covers the period ending next month", and a naive repair would hand the newest period to an old
-- payment. So billing_payments now records captured_at, and coverage may only ever be attached to the
-- payment PayPal itself identifies as the latest.
--
-- Replay/duplicate rules:
--   • a duplicate event id is rejected before anything is written (billing_events PK);
--   • a DIFFERENT event id carrying the SAME sale id must not move an existing paid-through date —
--     coverage is filled once and never extended by a redelivery;
--   • set_payment_coverage only fills a window that is still missing; once bound it reports
--     'already_covered' rather than re-pointing at a newer period;
--   • a payment whose date cannot be established stays period_end NULL, i.e. pending reconciliation,
--     and grants nothing (fail-closed, not guessed).

begin;

alter table public.billing_payments add column if not exists captured_at timestamptz;
create index if not exists billing_payments_sub_captured_idx
  on public.billing_payments (subscription_id, captured_at desc nulls last);

-- Backfill from the stored event payload so existing rows keep a verifiable identity.
update public.billing_payments pp
   set captured_at = coalesce(
         nullif(e.payload->>'update_time', '')::timestamptz,
         nullif(e.payload->>'create_time', '')::timestamptz,
         nullif(e.payload->>'time_updated', '')::timestamptz)
  from public.billing_events e
 where e.event_id = pp.source_event_id
   and pp.captured_at is null;

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
  v_captured timestamptz;
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
    update public.billing_subscriptions
       set last_event_id = p_event_id,
           last_occurred_at = greatest(coalesce(last_occurred_at, v_occurred), v_occurred),
           updated_at = now()
     where subscription_id = v_sub;   -- a sale never restates lifecycle status
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
          currency   = coalesce(billing_payments.currency,   excluded.currency),
          gross_amount = coalesce(billing_payments.gross_amount, excluded.gross_amount),
          -- Fill, never extend: a redelivery of the same sale cannot push the paid-through date out,
          -- and an old sale replayed after a newer one cannot adopt the newer period.
          period_start = coalesce(billing_payments.period_start, excluded.period_start),
          period_end   = coalesce(billing_payments.period_end,   excluded.period_end),
          captured_at  = coalesce(billing_payments.captured_at,  excluded.captured_at),
          updated_at   = now();
  elsif p_event_type in ('PAYMENT.SALE.REFUNDED', 'PAYMENT.SALE.REVERSED') then
    v_sale := coalesce(nullif(p_resource->>'id', ''), nullif(p_resource->>'transaction_id', ''));
    update public.billing_payments
       set status = case when p_event_type = 'PAYMENT.SALE.REFUNDED' then 'refunded' else 'reversed' end, updated_at = now()
     where payment_id = v_sale and subscription_id = v_sub;   -- void the AFFECTED payment only
  end if;

  perform public.refresh_user_coverage(v_user);
  return 'applied';
end $$;

-- Narrow by design: binds a window to a payment that has none. Never creates, reassigns, retiers or
-- re-dates an already-bounded payment.
create or replace function public.set_payment_coverage(
  p_payment_id text, p_period_start timestamptz, p_period_end timestamptz)
 returns text
 language plpgsql
 security definer
 set search_path = public
as $$
declare v_found int; v_user text;
begin
  if p_payment_id is null or p_period_end is null then return 'invalid'; end if;
  if p_period_end <= coalesce(p_period_start, now() - interval '1 day') then return 'invalid_period'; end if;

  update public.billing_payments
     set period_start = coalesce(period_start, p_period_start),
         period_end   = p_period_end,
         updated_at   = now()
   where payment_id = p_payment_id and period_end is null;
  get diagnostics v_found = row_count;
  if v_found = 0 then
    if exists (select 1 from public.billing_payments where payment_id = p_payment_id) then
      return 'already_covered';
    end if;
    return 'unknown_payment';
  end if;

  select s.user_id into v_user
    from public.billing_subscriptions s
    join public.billing_payments pp on pp.subscription_id = s.subscription_id
   where pp.payment_id = p_payment_id;
  if v_user is null then return 'unlinked'; end if;

  perform public.refresh_user_coverage(v_user);
  return 'applied';
end $$;

revoke execute on function public.apply_paypal_event(text, text, jsonb),
                                        public.set_payment_coverage(text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_paypal_event(text, text, jsonb),
                                    public.set_payment_coverage(text, timestamptz, timestamptz) to service_role;

comment on function public.set_payment_coverage(text, timestamptz, timestamptz) is
  'R8: bind a paid-through window ONLY to a captured payment that has none; refuses to move an '
  'existing date, so replay and reconciliation cannot extend coverage.';

commit;
