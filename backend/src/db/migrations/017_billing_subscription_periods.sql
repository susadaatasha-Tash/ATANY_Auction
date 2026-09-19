-- 017_billing_subscription_periods — make subscription period explicit for renewals
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS current_period_start DATE;
ALTER TABLE public.billing_records ADD COLUMN IF NOT EXISTS current_period_end DATE;

-- Backfill existing records where period fields are null
UPDATE public.billing_records
SET current_period_start = COALESCE(current_period_start, created_at::date),
    current_period_end = COALESCE(current_period_end, due_date)
WHERE current_period_start IS NULL OR current_period_end IS NULL;

-- Index for period queries
CREATE INDEX IF NOT EXISTS idx_billing_period_end ON public.billing_records(current_period_end);
