-- 025_billing_plan_code.sql
-- WHY THIS MIGRATION IS REQUIRED
-- 1) Plan identity must not be permanently derived from payment amount.
--    Billing rows need an explicit plan_code (bronze | gold | platinum) so
--    seller and admin always agree on the same plan from the same record.
-- 2) PayMongo webhook/polling already write billing status 'failed' and
--    'expired', but the public.billing_status enum only allowed
--    pending | paid | overdue | cancelled. Without these enum values those
--    updates fail at the database layer.
--
-- billing_records remains the single subscription/billing entity.
-- No separate subscriptions table is introduced: the existing table already
-- models monthly cycles (current_period_start/end) and append-only history.

ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS plan_code TEXT;

CREATE INDEX IF NOT EXISTS idx_billing_records_plan_code
  ON public.billing_records(plan_code)
  WHERE plan_code IS NOT NULL;

-- Backfill legacy rows from known catalog prices (closest catalog monthly price).
UPDATE public.billing_records
SET plan_code = CASE
  WHEN amount >= 12000 THEN 'platinum'
  WHEN amount >= 1500 THEN 'gold'
  ELSE 'bronze'
END
WHERE plan_code IS NULL;

-- Allow PayMongo failure states used by webhook + polling sync.
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
ALTER TYPE public.billing_status ADD VALUE IF NOT EXISTS 'failed';
ALTER TYPE public.billing_status ADD VALUE IF NOT EXISTS 'expired';
