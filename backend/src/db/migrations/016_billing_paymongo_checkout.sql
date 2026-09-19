-- 016_billing_paymongo_checkout — enable PayMongo checkout for maintenance bills
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS paymongo_checkout_session_id TEXT;
CREATE INDEX IF NOT EXISTS idx_billing_paymongo_checkout ON public.billing_records(paymongo_checkout_session_id) WHERE paymongo_checkout_session_id IS NOT NULL;
