-- 033_billing_payment_method_type.sql
-- Records the payment channel used for a billing checkout (e.g. 'gcash').
-- WHY: GCash is a one-time wallet authorization, NOT a reusable saved method.
-- The UI must be able to say "Paid using GCash" truthfully without inventing a
-- fake saved payment method row. Set server-side when a checkout session is
-- created restricted to a single method type; NULL = hosted picker (any method).
-- No PAN/CVC/provider secrets are ever stored here.
-- Idempotent: safe to re-run.
ALTER TABLE public.billing_records
  ADD COLUMN IF NOT EXISTS payment_method_type TEXT;

COMMENT ON COLUMN public.billing_records.payment_method_type IS
  'Payment channel the current/last checkout was created for (e.g. gcash). NULL = hosted method picker.';
