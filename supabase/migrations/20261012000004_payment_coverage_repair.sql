-- 20261012000004_payment_coverage_repair.sql
-- The real sandbox PAYMENT.SALE.COMPLETED (sale 3E514943GY2888425, captured USD 19.00) carries no
-- billing_period_start_date / billing_period_end_date. Whether renewals include them is not
-- established by any evidence here, so coverage must work for any payment missing them. Coverage
-- therefore had nothing to bound the paid-through date with, and the buyer stayed free despite a
-- verified, captured payment. The Worker now reads the paid-through date from PayPal's own
-- subscription object (billing_info.next_billing_time) and passes it through this function.
--
-- It is deliberately narrow: it can only set the time window on a payment that ALREADY exists, it
-- cannot create a payment, change its amount/currency/status, reassign its subscription or user, or
-- name a plan. Service-role only, like the rest of the billing writers.

begin;

create or replace function public.set_payment_coverage(
  p_payment_id text, p_period_start timestamptz, p_period_end timestamptz)
 returns text
 language plpgsql
 security definer
 set search_path = public
as $$
declare v_user text; v_found int;
begin
  if p_payment_id is null or p_period_end is null then return 'invalid'; end if;
  if p_period_end <= coalesce(p_period_start, now() - interval '1 day') then return 'invalid_period'; end if;

  update public.billing_payments
     set period_start = coalesce(p_period_start, period_start),
         period_end   = p_period_end,
         updated_at   = now()
   where payment_id = p_payment_id;
  get diagnostics v_found = row_count;
  if v_found = 0 then return 'unknown_payment'; end if;

  -- Ownership still comes from the persisted link, never from the caller.
  select s.user_id into v_user
    from public.billing_subscriptions s
    join public.billing_payments pp on pp.subscription_id = s.subscription_id
   where pp.payment_id = p_payment_id;
  if v_user is null then
    -- No linked owner: the window is recorded but nothing can be granted.
    return 'unlinked';
  end if;

  perform public.refresh_user_coverage(v_user);
  return 'applied';
end $$;

revoke execute on function public.set_payment_coverage(text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.set_payment_coverage(text, timestamptz, timestamptz) to service_role;

comment on function public.set_payment_coverage(text, timestamptz, timestamptz) is
  'R8: bound the paid-through window of an existing captured payment from PayPal-supplied dates; '
  'cannot create/reassign/retier a payment; service_role only.';

commit;
