-- 026_subscription_plan_change.sql
-- WHY: plan-change + annual billing + scheduled downgrades + safe payment-method metadata.
-- 1) billing_interval / billing_type / subscription_change_id on billing_records so
--    interval is stored explicitly (never inferred from price) and plan-change
--    payments appear in billing history without overwriting rows.
-- 2) subscription_changes table keeps pending upgrade payments + scheduled downgrades
--    out of billing_records (history stays append-only and unambiguous).
-- 3) seller_payment_methods stores ONLY PayMongo provider ids + display metadata
--    (no PAN, no CVC). Full card vaulting requires PayMongo Elements + publishable key.

ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS billing_interval TEXT NOT NULL DEFAULT 'monthly';

ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS billing_type TEXT NOT NULL DEFAULT 'subscription';

ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS subscription_change_id UUID;

CREATE INDEX IF NOT EXISTS idx_billing_records_interval
  ON public.billing_records(billing_interval);

CREATE INDEX IF NOT EXISTS idx_billing_records_subscription_change
  ON public.billing_records(subscription_change_id)
  WHERE subscription_change_id IS NOT NULL;

DO $$ BEGIN
  CREATE TYPE public.subscription_change_type AS ENUM ('upgrade', 'downgrade', 'interval_change');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.subscription_change_status AS ENUM ('pending_payment', 'scheduled', 'applied', 'canceled', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.subscription_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  current_plan_code TEXT,
  target_plan_code TEXT NOT NULL,
  current_billing_interval TEXT,
  target_billing_interval TEXT NOT NULL,
  change_type public.subscription_change_type NOT NULL,
  status public.subscription_change_status NOT NULL,
  effective_at DATE,
  proration_amount INTEGER NOT NULL DEFAULT 0,
  paymongo_checkout_session_id TEXT,
  billing_record_id UUID REFERENCES public.billing_records(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_subscription_changes_seller
  ON public.subscription_changes(seller_id);
CREATE INDEX IF NOT EXISTS idx_subscription_changes_status
  ON public.subscription_changes(status);
CREATE INDEX IF NOT EXISTS idx_subscription_changes_scheduled
  ON public.subscription_changes(effective_at)
  WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS public.seller_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'paymongo',
  provider_payment_method_id TEXT NOT NULL,
  type TEXT,
  brand TEXT,
  last4 TEXT,
  exp_month INTEGER,
  exp_year INTEGER,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_id, provider_payment_method_id)
);

CREATE INDEX IF NOT EXISTS idx_seller_payment_methods_seller
  ON public.seller_payment_methods(seller_id);

-- At most one default method per seller
CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_payment_methods_one_default
  ON public.seller_payment_methods(seller_id)
  WHERE is_default;

-- RLS: seller owns methods; admins can read (not required for service-role backend)
ALTER TABLE public.subscription_changes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY subscription_changes_select_own ON public.subscription_changes
    FOR SELECT USING (auth.uid() = seller_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY subscription_changes_select_admin ON public.subscription_changes
    FOR SELECT USING (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.seller_payment_methods ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY seller_payment_methods_select_own ON public.seller_payment_methods
    FOR SELECT USING (auth.uid() = seller_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY seller_payment_methods_select_admin ON public.seller_payment_methods
    FOR SELECT USING (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
