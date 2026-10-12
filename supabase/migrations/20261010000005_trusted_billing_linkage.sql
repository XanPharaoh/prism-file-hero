-- R2 — Trusted customer→user linkage + server-owned price allowlist + webhook ownership.
--
-- Corrects the earlier Item-4 approach where the webhook trusted a client/event-supplied plan
-- (`p_plan`). Entitlement authority must be SERVER-side only:
--   • a Paddle customer is linked to ONE authenticated app identity (the canonical Clerk `sub`,
--     which is already `user_plans.user_id` / `billing_customers.user_id` — no second identity),
--     persisted by a server/Worker-only definer function (never a browser write, never by email).
--   • a plan tier is resolved ONLY from a server-owned allowlist (price_id → plan). An unknown or
--     un-allowlisted price grants NOTHING.
--   • the verified webhook resolves the event's OWNER via the persisted customer→user mapping and
--     the TIER via the allowlist. Unknown/unlinked/conflicting → the event is still recorded
--     (durable inbox, for investigation/retry) but grants nothing.

begin;

-- 1) Server-owned price→plan allowlist. Sandbox price IDs are placeholders; operators replace them
--    with the real Paddle sandbox/production price IDs before enabling checkout.
create table if not exists public.billing_price_plans (
  price_id text primary key,
  plan     text not null check (plan in ('pro','business')),
  label    text
);
-- Idempotent seeds (change to real price IDs; unknown IDs grant nothing).
insert into public.billing_price_plans(price_id, plan, label) values
  ('pri_SANDBOX_PRO_PLACEHOLDER', 'pro',      'Replace with real Paddle Pro price id'),
  ('pri_SANDBOX_BUSINESS_PLACEHOLDER', 'business', 'Replace with real Paddle Business price id')
on conflict (price_id) do nothing;

-- 2) One Paddle customer per app user (prevents attaching multiple/foreign customers).
create unique index if not exists billing_customers_user_uidx on public.billing_customers (user_id);

-- 3) Allowlist resolver: known price → plan tier, else NULL.
create or replace function public.resolve_plan_for_price(p_price_id text)
returns text language sql stable security definer set search_path = public as $$
  select plan from public.billing_price_plans where price_id = p_price_id;
$$;

-- 4) Persist/validate a customer→user link. Server/Worker (service_role) only; rejects a customer
--    already owned by a different user and a user already bound to a different customer.
create or replace function public.ensure_billing_customer(p_user_id text, p_customer_id text)
returns text
language plpgsql security definer set search_path = public as $$
declare v_owner text; v_their_cust text;
begin
  if p_user_id is null or p_customer_id is null then return 'invalid'; end if;
  select user_id into v_owner from public.billing_customers where customer_id = p_customer_id;
  if v_owner is not null and v_owner <> p_user_id then return 'conflict_customer_owned'; end if;
  select customer_id into v_their_cust from public.billing_customers where user_id = p_user_id;
  if v_their_cust is not null and v_their_cust <> p_customer_id then return 'conflict_user_linked'; end if;
  insert into public.billing_customers (customer_id, user_id) values (p_customer_id, p_user_id)
    on conflict (customer_id) do update set user_id = excluded.user_id;
  return 'ok';
end $$;

-- 5) Rework apply_billing_event: drop the client-trusted p_plan; resolve owner via the persisted
--    link and tier via the allowlist; grant only on a linked user + allowlisted price + active state.
--    Unknown/unlinked/conflicting events are recorded but grant nothing (durable, for retry).
drop function if exists public.apply_billing_event(text, text, timestamptz, text, text, jsonb, text);
create or replace function public.apply_billing_event(
  p_event_id text, p_event_type text, p_occurred_at timestamptz,
  p_subscription_id text, p_customer_id text, p_payload jsonb
) returns text
language plpgsql security definer set search_path = public as $$
declare prior_occurred timestamptz;
        v_status text;
        v_user_id text;
        v_tier text;
        v_price text;
begin
  if exists (select 1 from public.billing_events where event_id = p_event_id) then
    return 'duplicate';
  end if;

  insert into public.billing_events (event_id, event_type, occurred_at, subscription_id, customer_id, payload)
    values (p_event_id, p_event_type, p_occurred_at, p_subscription_id, p_customer_id, p_payload);

  v_status := case
    when p_event_type = 'subscription.canceled' then 'canceled'
    when p_event_type = 'subscription.paused'   then 'paused'
    when p_event_type = 'subscription.payment_failed' then 'past_due'
    when p_event_type in ('subscription.activated','transaction.paid','subscription.renewed','subscription.resume') then 'active'
    else coalesce(p_payload #>> '{status}', 'unknown')
  end;

  if p_subscription_id is not null then
    select last_occurred_at into prior_occurred
      from public.billing_subscriptions where subscription_id = p_subscription_id for update;
    if prior_occurred is not null and p_occurred_at < prior_occurred then
      return 'out_of_order';
    end if;
    insert into public.billing_subscriptions
      (subscription_id, customer_id, status, last_event_id, last_occurred_at, updated_at)
    values (p_subscription_id, p_customer_id, v_status, p_event_id, p_occurred_at, now())
    on conflict (subscription_id) do update
      set status = excluded.status, last_event_id = excluded.last_event_id,
          last_occurred_at = excluded.last_occurred_at, updated_at = now();
  end if;

  if p_customer_id is not null then
    select user_id into v_user_id from public.billing_customers where customer_id = p_customer_id;

    if v_user_id is not null and v_status in ('canceled','past_due','paused') then
      -- demote a linked user on lifecycle-down events (status only; plan tier preserved for history)
      insert into public.user_plans (user_id, plan, subscription_status, updated_at)
        values (v_user_id, 'free', v_status, now())
      on conflict (user_id) do update set subscription_status = v_status, updated_at = now();
    elsif v_user_id is not null and v_status in ('active','trialing') then
      -- tier comes ONLY from the server allowlist via the event's price id (never a client plan)
      v_price := coalesce(p_payload #>> '{data,price_id}',
                          p_payload #>> '{data,items,0,price,id}',
                          p_payload #>> '{data,subscription,items,0,price,id}');
      v_tier := public.resolve_plan_for_price(v_price);
      if v_tier is not null then
        insert into public.user_plans (user_id, plan, subscription_status, updated_at)
          values (v_user_id, v_tier, v_status, now())
        on conflict (user_id) do update set plan = v_tier, subscription_status = v_status, updated_at = now();
      end if;
      -- v_tier null ⇒ unknown/un-allowlisted price: recorded above, grants NOTHING (no silent upgrade)
    end if;
    -- v_user_id null ⇒ no persisted customer→user link: event recorded, grants nothing (browser
    -- checkout alone can never grant; only a linked customer via a verified webhook can).
  end if;

  return 'applied';
end $$;

-- Privilege hygiene: these authority functions are server/Worker (service_role/definer) only.
revoke execute on function public.ensure_billing_customer(text, text) from public, anon, authenticated;
revoke execute on function public.resolve_plan_for_price(text) from public, anon, authenticated;
revoke execute on function public.apply_billing_event(text, text, timestamptz, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ensure_billing_customer(text, text) to service_role;
grant execute on function public.resolve_plan_for_price(text) to service_role;
grant execute on function public.apply_billing_event(text, text, timestamptz, text, text, jsonb) to service_role;

-- Also lock the credit-ledger + entitlement functions to service_role. They are SECURITY DEFINER
-- and were created with the default PUBLIC EXECUTE grant, so an authenticated user could otherwise
-- call them directly. The Worker calls them as service_role; no browser should.
revoke execute on function public.reserve_credit(uuid, text, integer, text)   from public, anon, authenticated;
revoke execute on function public.settle_credit(uuid, text, text)             from public, anon, authenticated;
revoke execute on function public.get_user_entitlement(text)                  from public, anon, authenticated;
grant execute on function public.reserve_credit(uuid, text, integer, text)    to service_role;
grant execute on function public.settle_credit(uuid, text, text)              to service_role;
grant execute on function public.get_user_entitlement(text)                   to service_role;

-- The metering functions were only ever `revoke … from public` in the unify migration; Supabase's
-- default privileges also grant EXECUTE to anon/authenticated, so those grants SURVIVED. Close the
-- gap the privilege-escalation check found: authenticated must not call the metering functions
-- directly (the Worker calls them as service_role).
revoke execute on function public.check_usage_limit(text, text, text, text, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.reserve_usage(uuid, text, text, text, text, integer, integer, integer) from public, anon, authenticated;
revoke execute on function public.settle_usage(uuid, text) from public, anon, authenticated;
grant execute on function public.check_usage_limit(text, text, text, text, integer, integer, integer) to service_role;
grant execute on function public.reserve_usage(uuid, text, text, text, text, integer, integer, integer) to service_role;
grant execute on function public.settle_usage(uuid, text) to service_role;

comment on function public.apply_billing_event is 'R2: grants only via a persisted customer→user link + a server-allowlisted price; unknown/unlinked grant nothing but are recorded';
comment on function public.ensure_billing_customer is 'R2: server-only customer→user link (Clerk sub); rejects conflicting ownership; one customer per user';

commit;
