-- 034_subscription_payment_method.sql
-- Seller subscription payment-method preference.
--
-- The seller picks ONE preferred method for their subscription payment:
--   card | gcash | maya | qrph
--
-- The actual payment ALWAYS runs through PayMongo Hosted Checkout
-- (payment_method_types = [the selected provider method]); ATANY only stores
-- the safe preference value here. No PAN, CVC or other card data is stored.
--
-- The column already exists in the deployed database — this migration makes it
-- reproducible for fresh installs and is idempotent.

ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS payment_method_type TEXT;

-- Only the approved methods may be stored (NULL = not chosen yet).
ALTER TABLE public.billing_records
  DROP CONSTRAINT IF EXISTS billing_records_payment_method_type_check;
ALTER TABLE public.billing_records
  ADD CONSTRAINT billing_records_payment_method_type_check
  CHECK (payment_method_type IS NULL OR payment_method_type IN ('card', 'gcash', 'maya', 'qrph'));

-- The preference is read for the seller's current/next billing record.
CREATE INDEX IF NOT EXISTS idx_billing_records_seller_method
  ON public.billing_records (seller_id, payment_method_type);
