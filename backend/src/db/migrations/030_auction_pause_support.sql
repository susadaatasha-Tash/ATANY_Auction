-- 030_auction_pause_support.sql
-- Adds seller pause/resume capability to auctions.
-- WHY: My Auctions premium requires live→paused→live without consuming bidding time.
-- Idempotent: safe to re-run.

-- 1. Add paused value to auction_status enum
DO $$
BEGIN
  -- Only add if not already present (pg 9.3+ supports IF NOT EXISTS on some versions;
  -- fallback to manual check for Supabase Postgres compatibility)
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'paused'
      AND enumtypid = 'auction_status'::regtype
  ) THEN
    ALTER TYPE auction_status ADD VALUE 'paused';
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL
  WHEN others THEN NULL
END $$;

-- 2. Add paused_at column to record freeze timestamp (null = not paused)
ALTER TABLE public.auctions
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;

-- 3. Helpful index for paused queries (only if many paused rows)
CREATE INDEX IF NOT EXISTS idx_auctions_paused_at
  ON public.auctions(paused_at)
  WHERE paused_at IS NOT NULL;

COMMENT ON COLUMN public.auctions.paused_at IS
  'Set when auction is paused; cleared on resume. end_time is shifted by NOW()-paused_at on resume.';

-- 4. Fresh DB parity already via schema.sql / setup_complete.sql
