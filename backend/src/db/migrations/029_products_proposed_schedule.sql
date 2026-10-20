-- 029_products_proposed_schedule.sql
-- WHY (Priority 1 / C5): shop-owner listing create/update and admin approval code
-- already write products.proposed_start_time / proposed_end_time / proposed_duration_days,
-- but no migration created those columns (42703 on fresh environments).
-- Types:
--  proposed_start_time / proposed_end_time  → TIMESTAMPTZ (seller-proposed auction window)
--  proposed_duration_days                   → INTEGER (optional derived duration)

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS proposed_start_time TIMESTAMPTZ;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS proposed_end_time TIMESTAMPTZ;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS proposed_duration_days INTEGER;

CREATE INDEX IF NOT EXISTS idx_products_proposed_start
  ON public.products(proposed_start_time)
  WHERE proposed_start_time IS NOT NULL;

COMMENT ON COLUMN public.products.proposed_start_time IS
  'Seller-proposed auction start (listing submission); admin confirms before auction creation';
COMMENT ON COLUMN public.products.proposed_end_time IS
  'Seller-proposed auction end (listing submission); admin confirms before auction creation';
COMMENT ON COLUMN public.products.proposed_duration_days IS
  'Optional seller-proposed duration in days (derived when start/end provided)';
