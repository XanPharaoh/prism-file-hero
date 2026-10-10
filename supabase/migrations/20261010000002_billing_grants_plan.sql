-- Item 4 — Close the billing→entitlement loop and eliminate the plan-table split-brain.
--
-- Problem found by running the local stack: the live quota/plan authority reads `user_plans`
-- (plural; worker/db.getUserPlan + check_usage_limit), but Batch-05's get_user_entitlement read
-- the ORPHAN `user_plan` (singular) that nothing wrote, and apply_billing_event updated only
-- billing_subscriptions — so a verified webhook granted NOTHING on the live path. This migration
-- makes a verified, active Paddle subscription project onto the SAME table the Worker uses, and
-- repoints the entitlement lookup there. Forward + additive + idempotent; never touches data.

begin;

-- The projection needs the customer→user link (set at checkout handoff / by admin). The table
-- exists from Batch-05; ensure it is present so this migration is safe on a partial schema.
create table if not exists public.billing_customers (
  customer_id text primary key,
  user_id     text not null
);

-- Re-define apply_billing_event to (a) keep the durable inbox + subscription projection and the
-- 'duplicate'/'out_of_order' idempotency that survive restarts, and (b) NEW: project the plan
-- onto the LIVE user_plans table so the Worker's own getUserPlan/check_usage_limit reflect it.
-- Drop the prior 6-arg signature FIRST: adding a defaulted param via create-or-replace would
-- otherwise leave an overload and make the unqualified name ambiguous to PostgREST/comment.
drop function if exists public.apply_billing_event(text, text, timestamptz, text, text, jsonb);
create or replace function public.apply_billing_event(
  p_event_id text, p_event_type text, p_occurred_at timestamptz,
  p_subscription_id text, p_customer_id text, p_payload jsonb,
  p_plan text default 'pro'
) returns text
language plpgsql security definer as $$
declare prior_occurred timestamptz;
        v_status text;
        v_user_id text;
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
      set status = excluded.status,
          last_event_id = excluded.last_event_id,
          last_occurred_at = excluded.last_occurred_at,
          updated_at = now();
  end if;

  -- NEW: grant on the LIVE plan table via the customer→user link. A missing link means the
  -- event is recorded but cannot grant (no user is known) — the safe default; nothing self-grants.
  if p_customer_id is not null then
    select user_id into v_user_id from public.billing_customers where customer_id = p_customer_id;
    if v_user_id is not null then
      insert into public.user_plans (user_id, plan, subscription_status, updated_at)
        values (v_user_id,
                case when p_plan in ('pro','business') then p_plan else 'pro' end,
                v_status, now())
      on conflict (user_id) do update
        set plan = case when v_status in ('active','trialing')
                        then (case when p_plan in ('pro','business') then p_plan else user_plans.plan end)
                        else user_plans.plan end,
            subscription_status = v_status,
            updated_at = now();
    end if;
  end if;

  return 'applied';
end $$;

-- Repoint the entitlement lookup at the live table (was the orphan user_plan). A paid plan that
-- is NOT an active/trialed subscription does not entitle — mirroring the live getUserPlan gate.
create or replace function public.get_user_entitlement(p_user_id text)
returns table (entitled boolean, plan text, subscription_status text)
language sql stable security definer as $$
  select
    (s.status in ('active','trialing'))
      or (up.plan in ('pro','business') and up.subscription_status in ('active','trialing')) as entitled,
    coalesce(up.plan, 'free') as plan,
    coalesce(s.status, up.subscription_status) as subscription_status
  from (select 1) _
  left join public.billing_customers c on c.user_id = p_user_id
  left join public.billing_subscriptions s on s.customer_id = c.customer_id
  left join public.user_plans up on up.user_id = p_user_id;
$$;

comment on function public.apply_billing_event(text, text, timestamptz, text, text, jsonb, text) is 'Batch-05 inbox + Batch-04/Item-4 live user_plans projection (grants only via a known customer→user link)';

commit;
