-- R7 — PayPal Subscriptions on the PRESERVED durable billing infrastructure.
--
-- We stop Paddle checkout but REUSE: billing_events (durable, event_id PK → restart-surviving
-- idempotency), billing_subscriptions, billing_price_plans (now PayPal plan_id → internal plan
-- allowlist), user_plans + get_user_entitlement, RLS, credit ledger, plan catalog.
-- Entitlement authority stays SERVER-side: the owner comes from a server-created
-- subscription→user mapping (billing_subscriptions.user_id set at begin_paypal_subscription), and
-- the tier ONLY from the allowlist. A browser approval (SUBSCRIPTIONCreated/PENDING) grants nothing;
-- only an ACTIVE, verified, linked, allowlisted subscription grants paid access.

begin;

-- 1) Extend the durable subscription record to carry the PayPal owner + plan + provider.
alter table public.billing_subscriptions add column if not exists user_id   text;
alter table public.billing_subscriptions add column if not exists plan_id    text;
alter table public.billing_subscriptions add column if not exists provider   text not null default 'paypal';
create index if not exists billing_sub_user_idx on public.billing_subscriptions (user_id);
create index if not exists billing_sub_provider_idx on public.billing_subscriptions (provider, subscription_id);

-- 2) Allowlist now holds PAYPAL recurring plan ids (P-…). Real sandbox/live ids are inserted by the
--    operator (see scripts/paypal-capability-check.mjs); unknown ids grant nothing.
insert into public.billing_price_plans(price_id, plan, label) values
  ('P-SANDBOX-PRO-MONTHLY',      'pro',      'PayPal sandbox Pro monthly'),
  ('P-SANDBOX-PRO-ANNUAL',       'pro',      'PayPal sandbox Pro annual'),
  ('P-SANDBOX-BUSINESS-MONTHLY', 'business', 'PayPal sandbox Business monthly'),
  ('P-SANDBOX-BUSINESS-ANNUAL',  'business', 'PayPal sandbox Business annual')
on conflict (price_id) do nothing;

-- 3) Server records the subscription attempt + owner BEFORE the browser approves. Service-role only.
create or replace function public.begin_paypal_subscription(
  p_user_id text, p_subscription_id text, p_plan_id text
) returns text
language plpgsql security definer set search_path = public as $$
declare owner text; tier text;
begin
  if p_user_id is null or p_subscription_id is null or p_plan_id is null then return 'invalid'; end if;
  select plan into tier from public.billing_price_plans where price_id = p_plan_id;
  if tier is null then return 'unknown_plan'; end if;                      -- never a browser-chosen plan id
  select user_id into owner from public.billing_subscriptions where subscription_id = p_subscription_id;
  if owner is not null and owner <> p_user_id then return 'conflict_owner'; end if;  -- refuse to adopt another's subscription
  insert into public.billing_subscriptions (subscription_id, user_id, plan_id, provider, status, updated_at)
    values (p_subscription_id, p_user_id, p_plan_id, 'paypal', 'pending', now())
    on conflict (subscription_id) do update
      set user_id = excluded.user_id, plan_id = excluded.plan_id, provider = 'paypal', updated_at = now();
  return 'ok';
end $$;

-- 4) Process a VERIFIED PayPal event durably + idempotently, applying the documented access policy.
--    resource = the webhook `resource` object (has id, status, plan_id, custom_id).
--    Returns: duplicate | out_of_order | applied | unlinked | unknown_plan
create or replace function public.apply_paypal_event(
  p_event_id text, p_event_type text, p_resource jsonb
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_sub text := p_resource->>'id';
  v_status text := coalesce(p_resource->>'status', '');
  v_plan text := coalesce(p_resource #>> '{plan_id}', p_resource #>> '{plan,id}');
  v_user text; v_tier text; v_state text; v_entitled boolean; v_occurred timestamptz;
  prior_occurred timestamptz;
begin
  if p_event_id is null then return 'invalid'; end if;
  -- One authoritative timestamp: cast PayPal's text time to timestamptz (text, never text-vs-timestamptz).
  v_occurred := coalesce(nullif(p_resource->>'last_updated_time', ''), now()::text)::timestamptz;
  if exists (select 1 from public.billing_events where event_id = p_event_id) then return 'duplicate'; end if;

  insert into public.billing_events (event_id, event_type, occurred_at, subscription_id, payload)
    values (p_event_id, p_event_type, v_occurred, v_sub, p_resource);

  -- Access policy → state + whether paid features are granted. NEGATIVE event types are evaluated
  -- BEFORE a raw status of 'ACTIVE' (PayPal keeps a subscription ACTIVE during payment retries, and
  -- refunds/reversals arrive while the resource may still read ACTIVE) so a failed/reversed payment
  -- on an ACTIVE subscription never grants access.
  case
    when p_event_type in ('BILLING.SUBSCRIPTION.PAYMENT.FAILED','PAYMENT.CAPTURE.DENIED','PAYMENT.CAPTURE.REVERSED','PAYMENT.CAPTURE.REFUNDED') then
      v_entitled := false; v_state := 'past_due';
    when v_status = 'SUSPENDED' or p_event_type = 'BILLING.SUBSCRIPTION.SUSPENDED' then
      v_entitled := false; v_state := 'suspended';
    when v_status = 'CANCELLED' or p_event_type = 'BILLING.SUBSCRIPTION.CANCELLED' then
      v_entitled := false; v_state := 'canceled';
    when v_status = 'EXPIRED' or p_event_type = 'BILLING.SUBSCRIPTION.EXPIRED' then
      v_entitled := false; v_state := 'expired';
    when v_status = 'ACTIVE' or p_event_type in ('BILLING.SUBSCRIPTION.ACTIVATED','BILLING.SUBSCRIPTION.RENEWED','PAYMENT.CAPTURE.COMPLETED') then
      v_entitled := true;  v_state := 'active';
    else v_entitled := (v_status = 'ACTIVE'); v_state := lower(coalesce(nullif(v_status,''),'pending'));
  end case;

  if v_sub is not null then
    select last_occurred_at into prior_occurred from public.billing_subscriptions where subscription_id = v_sub for update;
    if prior_occurred is not null and v_occurred < prior_occurred then return 'out_of_order'; end if;
    update public.billing_subscriptions set status = v_status, last_event_id = p_event_id, last_occurred_at = v_occurred, updated_at = now()
      where subscription_id = v_sub;
  end if;

  -- Resolve the SERVER-side owner (never from the browser). Unknown → record, grant nothing (reconcile later).
  select user_id into v_user from public.billing_subscriptions where subscription_id = v_sub;
  if v_user is null then return 'unlinked'; end if;

  if v_entitled then
    -- tier comes ONLY from the allowlist; an un-allowlisted plan grants nothing.
    select plan into v_tier from public.billing_price_plans where price_id = v_plan;
    if v_tier is null then return 'unknown_plan'; end if;
    insert into public.user_plans (user_id, plan, subscription_status, updated_at)
      values (v_user, v_tier, 'active', now())
    on conflict (user_id) do update set plan = v_tier, subscription_status = 'active', updated_at = now();
  else
    insert into public.user_plans (user_id, plan, subscription_status, updated_at)
      values (v_user, 'free', v_state, now())
    on conflict (user_id) do update set subscription_status = v_state, updated_at = now();
  end if;

  return 'applied';
end $$;

-- 5) Entitlement is derived from the SERVER-maintained user_plans row only (written by the verified
--    webhook), coalesced to a real boolean — provider-agnostic and never trusts a customer join.
create or replace function public.get_user_entitlement(p_user_id text)
returns table (entitled boolean, plan text, subscription_status text)
language sql stable security definer set search_path = public as $$
  select
    coalesce(up.plan in ('pro','business') and up.subscription_status in ('active','trialing'), false) as entitled,
    coalesce(up.plan, 'free') as plan,
    coalesce(up.subscription_status, 'inactive') as subscription_status
  from (select 1) _
  left join public.user_plans up on up.user_id = p_user_id;
$$;

-- 6) Privileges: these authority functions are service_role/Worker only.
revoke execute on function public.begin_paypal_subscription(text, text, text) from public, anon, authenticated;
revoke execute on function public.apply_paypal_event(text, text, jsonb)        from public, anon, authenticated;
grant  execute on function public.begin_paypal_subscription(text, text, text) to service_role;
grant  execute on function public.apply_paypal_event(text, text, jsonb)        to service_role;

comment on function public.apply_paypal_event is 'R7: verified PayPal event → durable idempotent entitlement per access policy; grants only for linked+allowlisted+ACTIVE';

commit;
