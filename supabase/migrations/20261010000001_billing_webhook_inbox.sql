-- Batch 05 — Paddle webhook durable inbox + subscription projection (forward, additive).
-- Deduplication lives in Postgres (event_id primary key), so it survives process restarts;
-- an in-memory set does NOT. Subscription state is projected transactionally from verified
-- events only. Service-role writes; anon/authenticated cannot write.
begin;

create table if not exists public.billing_events (
  event_id     text primary key,                 -- idempotency key that survives restart
  event_type   text not null,
  occurred_at  timestamptz not null default now(),
  subscription_id text,
  customer_id  text,
  payload      jsonb not null,
  received_at  timestamptz not null default now()
);

create table if not exists public.billing_subscriptions (
  subscription_id text primary key,
  customer_id     text,
  status          text not null default 'unknown',
  last_event_id   text,
  last_occurred_at timestamptz,
  updated_at      timestamptz not null default now()
);

-- Link a Paddle customer to the app user (set during checkout handoff or by admin).
create table if not exists public.billing_customers (
  customer_id text primary key,
  user_id     text not null
);

-- Persist the event and project subscription state in ONE call. Returns 'duplicate' when the
-- event_id already exists (a replay), so the caller never re-applies an old event.
create or replace function public.apply_billing_event(
  p_event_id text, p_event_type text, p_occurred_at timestamptz,
  p_subscription_id text, p_customer_id text, p_payload jsonb
) returns text
language plpgsql security definer as $$
declare prior_occurred timestamptz;
begin
  if exists (select 1 from public.billing_events where event_id = p_event_id) then
    return 'duplicate';
  end if;

  insert into public.billing_events (event_id, event_type, occurred_at, subscription_id, customer_id, payload)
    values (p_event_id, p_event_type, p_occurred_at, p_subscription_id, p_customer_id, p_payload);

  if p_subscription_id is not null then
    select last_occurred_at into prior_occurred
      from public.billing_subscriptions where subscription_id = p_subscription_id for update;
    -- out-of-order guard: an older event must not regress newer state
    if prior_occurred is not null and p_occurred_at < prior_occurred then
      return 'out_of_order';
    end if;

    insert into public.billing_subscriptions
      (subscription_id, customer_id, status, last_event_id, last_occurred_at, updated_at)
    values (p_subscription_id, p_customer_id,
      case
        when p_event_type = 'subscription.canceled' then 'canceled'
        when p_event_type = 'subscription.paused'   then 'paused'
        when p_event_type = 'subscription.payment_failed' then 'past_due'
        when p_event_type in ('subscription.activated','transaction.paid','subscription.renewed','subscription.resume') then 'active'
        else coalesce(p_payload #>> '{status}', 'unknown')
      end,
      p_event_id, p_occurred_at, now())
    on conflict (subscription_id) do update
      set status = excluded.status,
          last_event_id = excluded.last_event_id,
          last_occurred_at = excluded.last_occurred_at,
          updated_at = now();
  end if;

  return 'applied';
end $$;

-- Entitlement lookup: active/trialed subscription for the user, else their server plan.
create or replace function public.get_user_entitlement(p_user_id text)
returns table (entitled boolean, plan text, subscription_status text)
language sql stable security definer as $$
  select
    (s.status in ('active','trialing')) or (up.plan in ('pro','business')) as entitled,
    coalesce(up.plan, 'free') as plan,
    s.status as subscription_status
  from (select 1) _
  left join public.billing_customers c on c.user_id = p_user_id
  left join public.billing_subscriptions s on s.customer_id = c.customer_id
  left join public.user_plan up on up.user_id = p_user_id;
$$;

alter table public.billing_events       enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_customers    enable row level security;
-- No select/insert/update policies for anon/authenticated => service-role / definer only.

commit;
