-- 027_subscription_hardening.sql
-- WHY: harden migration 026 + guarantee one active plan-change state per seller.
-- 1) Constrain billing_interval to known values (never free-text drift).
-- 2) Enforce at most one pending_payment upgrade + one scheduled downgrade per seller
--    (application also reuses/rejects; DB is the last line of defense).
-- 3) FK billing_records.subscription_change_id → subscription_changes(id)
--    with ON DELETE SET NULL so history rows survive change cleanup.
-- 4) Backfill billing_interval for known annual catalog amounts
--    (legacy rows defaulted to monthly when amount matched annual prices).
-- 5) Normalize billing_type for known historical values.
--
-- Apply AFTER 025_billing_plan_code.sql + 026_subscription_plan_change.sql.
-- NOTE: CREATE TYPE / ALTER TYPE ADD VALUE must NOT run inside a transaction block
-- on PostgreSQL < 12; this file avoids new enum values (uses TEXT + CHECK).
-- Idempotent: CHECK/FK constraints are skipped when already present (re-runnable).

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_billing_records_interval'
  ) THEN
    ALTER TABLE public.billing_records
      ADD CONSTRAINT chk_billing_records_interval
      CHECK (billing_interval IN ('monthly', 'annual'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_billing_records_type'
  ) THEN
    ALTER TABLE public.billing_records
      ADD CONSTRAINT chk_billing_records_type
      CHECK (billing_type IN ('subscription', 'upgrade_proration', 'renewal', 'refund', 'maintenance'));
  END IF;
END $$;

-- One pending upgrade payment per seller
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_changes_one_pending
  ON public.subscription_changes(seller_id)
  WHERE status = 'pending_payment';

-- One scheduled downgrade / interval change per seller
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_changes_one_scheduled
  ON public.subscription_changes(seller_id)
  WHERE status = 'scheduled';

-- FK: keep billing history when a change row is removed (SET NULL, not CASCADE wipe)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_billing_records_subscription_change'
  ) THEN
    ALTER TABLE public.billing_records
      ADD CONSTRAINT fk_billing_records_subscription_change
      FOREIGN KEY (subscription_change_id)
      REFERENCES public.subscription_changes(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill interval for known annual prices (17% off monthly×12)
UPDATE public.billing_records
SET billing_interval = 'annual'
WHERE billing_interval = 'monthly'
  AND (
    amount = 9960
    OR amount = 14940
    OR amount = 119520
  )
  AND (plan_code IS NULL OR plan_code IN ('bronze', 'gold', 'platinum'));

-- Anything still monthly that matches exact monthly catalog prices stays monthly.
-- Rows that look like proration (upgrade_proration) keep current interval default.

UPDATE public.billing_records
SET billing_type = 'subscription'
WHERE billing_type IS NULL
   OR billing_type NOT IN ('subscription', 'upgrade_proration', 'renewal', 'refund', 'maintenance');

-- Helpful composite index for admin list + current-cycle queries
CREATE INDEX IF NOT EXISTS idx_billing_records_seller_status
  ON public.billing_records(seller_id, status, current_period_end);

DO $$ BEGIN
  COMMENT ON CONSTRAINT chk_billing_records_interval ON public.billing_records
    IS 'billing_interval must be monthly or annual (stored, never inferred from price)';
EXCEPTION WHEN undefined_object THEN NULL; END $$;
COMMENT ON INDEX idx_subscription_changes_one_pending
  IS 'At most one pending_payment subscription_change per seller (duplicate upgrade protection)';
COMMENT ON INDEX idx_subscription_changes_one_scheduled
  IS 'At most one scheduled subscription_change per seller';

