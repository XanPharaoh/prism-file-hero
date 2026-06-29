-- Enable UUID extension
create extension if not exists "pgcrypto";

-- User plan table (one row per user)
create table if not exists public.user_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro', 'business')),
  paddle_customer_id text,
  paddle_subscription_id text,
  subscription_status text default 'inactive',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Usage log (one row per month per user)
create table if not exists public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null,
  pages_used integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month)
);

-- Auto-create user_plans row on new signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.user_plans (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- RLS
alter table public.user_plans enable row level security;
alter table public.usage_logs enable row level security;

create policy "Users read own plan"
  on public.user_plans for select using (auth.uid() = user_id);

create policy "Users read own usage"
  on public.usage_logs for select using (auth.uid() = user_id);
