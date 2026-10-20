-- 015_order_payment_flow — separates payment status from order fulfillment
-- Keep existing orders intact; extend order_status with preparing, create payments table

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('pending','processing','paid','failed','cancelled','expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Extend order_status: existing ('pending','ready_pickup','completed') + add 'preparing'
-- New flow: pending -> preparing -> ready_pickup -> completed
-- Payment paid does NOT auto-complete order; fulfillment progresses separately
DO $$ BEGIN
  ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'preparing';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Payments table — one row per PayMongo checkout attempt; idempotent on provider_reference
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'paymongo',
  provider_reference_id TEXT,
  checkout_session_id TEXT,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PHP',
  payment_method TEXT,
  status payment_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_ref ON payments(provider_reference_id) WHERE provider_reference_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_checkout ON payments(checkout_session_id) WHERE checkout_session_id IS NOT NULL;

-- Only one successful paid payment per order
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_paid_per_order ON payments(order_id) WHERE status = 'paid';

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "payments_select_own" ON payments; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "payments_select_admin" ON payments; EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE POLICY "payments_select_own" ON payments FOR SELECT USING (auth.uid() = customer_id OR public.is_admin());
CREATE POLICY "payments_select_admin" ON payments FOR ALL USING (public.is_admin());
