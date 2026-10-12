-- 20261012000001_retire_paddle_event_writer.sql
-- PayPal is the billing provider; the Paddle-era inbox writer is retired.
--
-- Why: apply_billing_event was a SECOND path that could set the paid projection in user_plans
-- (plan/status) from a subscription-STATUS event alone, with no captured payment. Since
-- 20261010000007_paypal_payment_coverage.sql, get_user_entitlement answers "is this user paid?"
-- from billing_payments coverage only. Two paths disagreeing about paid status is a defect: the
-- user_plans projection feeds reserve_usage caps, so a status-only write would hand out pro metering
-- limits that the entitlement authority denies. No Worker route calls it (the PayPal webhook applies
-- through apply_paypal_event, which derives coverage via refresh_user_coverage), so removing it makes
-- refresh_user_coverage the only writer of the paid projection.

drop function if exists public.apply_billing_event(text, text, timestamptz, text, text, jsonb);
