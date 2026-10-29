-- 034_winner_fallback_hardening.sql
--
-- WHY THIS FORWARD MIGRATION EXISTS (do not merge into 021 — 021 may already have
-- run in another environment; this file only makes the state CONVERGE):
--
-- The 7-day winner fallback was fully implemented in services/winnerExpiration.js
-- but the deployed database was missing the schema it depends on:
--
--   * orders.payment_deadline / winner_confirmed_at / winner_rank  -> absent
--   * order_status.'expired'                                        -> absent
--
-- Consequence (the production bug): the rotation UPDATE raised 42703 (undefined
-- column), PostgreSQL ABORTED the transaction, the catch-based legacy retry ran
-- inside the aborted transaction and failed with 25P02, so NOTHING committed.
-- Winner #1 -> #2 reassignment never happened. The no-bidder branch failed the
-- same way because 'expired' was not a valid order_status value.
--
-- This migration is idempotent and safe to run on an environment where 021
-- already applied. It also backfills WITHOUT resetting existing deadlines, so
-- already-overdue orders stay overdue and the next cron tick processes them.

-- ── 1. order_status.'expired' (terminal: window ended, no eligible bidder left) ──
-- Run outside a transaction block so ALTER TYPE ... ADD VALUE is always legal.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'expired'
      AND enumtypid = 'public.order_status'::regtype
  ) THEN
    ALTER TYPE public.order_status ADD VALUE 'expired';
  END IF;
END
$$;

-- ── 2. Winner-tracking columns ──────────────────────────────────────────────────
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS winner_confirmed_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_deadline  TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS winner_rank      INTEGER DEFAULT 1;

-- ── 3. Backfill EXISTING orders (never restart an old deadline) ─────────────────
-- created_at is the original order/auction-close timestamp and is deliberately
-- preserved: reassignment uses winner_confirmed_at / payment_deadline, so a
-- fallback rotation can never move an old order into a new reporting month.
UPDATE public.orders
   SET winner_confirmed_at = COALESCE(winner_confirmed_at, created_at)
 WHERE winner_confirmed_at IS NULL
   AND created_at IS NOT NULL;

-- deadline = existing deadline, else (winner_confirmed_at + 7d), else (created_at + 7d)
-- An order created Oct 1 backfilled on Oct 15 keeps an Oct 8 deadline (OVERDUE),
-- it is NOT pushed out to Oct 22.
UPDATE public.orders
   SET payment_deadline = COALESCE(
         payment_deadline,
         winner_confirmed_at + INTERVAL '7 days',
         created_at + INTERVAL '7 days'
       )
 WHERE payment_deadline IS NULL
   AND (winner_confirmed_at IS NOT NULL OR created_at IS NOT NULL);

-- rank 1 = original winner; only fallbacks advance it (2, 3, 4, ...)
UPDATE public.orders
   SET winner_rank = 1
 WHERE winner_rank IS NULL;

ALTER TABLE public.orders ALTER COLUMN winner_rank SET DEFAULT 1;

-- ── 4. Expiration candidate index (replaces "scan every pending order") ────────
-- Supports the cron's candidate query: status='pending' AND payment_deadline <= NOW()
CREATE INDEX IF NOT EXISTS idx_orders_pending_deadline
  ON public.orders (payment_deadline)
  WHERE status = 'pending' AND payment_deadline IS NOT NULL;

COMMENT ON COLUMN public.orders.winner_confirmed_at IS
  'When the CURRENT eligible winner was confirmed (auction close or fallback reassignment). Never derived in the frontend.';
COMMENT ON COLUMN public.orders.payment_deadline IS
  'Canonical 7-day payment deadline for the current eligible winner = winner_confirmed_at + 7 days.';
COMMENT ON COLUMN public.orders.winner_rank IS
  '1 = original winner, 2 = first fallback, 3 = second fallback, ... Persisted so the reassignment chain is deterministic.';
COMMENT ON TYPE public.order_status IS
  'pending | preparing | ready_pickup | completed | expired (expired = payment window ended and no eligible bidder remained).';