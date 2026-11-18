-- 037_order_cancellation — Shop Owner cancellation of unpaid orders
--
-- Adds cancellation tracking columns to the orders table.
-- The 'cancelled' enum value is added in 037_order_cancellation_enum.sql
-- (must be a separate file due to PostgreSQL transaction constraints).
--
-- Business rule: only unpaid orders belonging to the seller's shop may be
-- cancelled. Cancellation persists status, reason, timestamp and actor --
-- no refunds, no commission reversals, no winner reassignment.

-- 1. Cancellation fields on orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

-- Index for querying cancelled orders by cancelling shop owner
CREATE INDEX IF NOT EXISTS idx_orders_cancelled_by ON orders(cancelled_by) WHERE status = 'cancelled';
