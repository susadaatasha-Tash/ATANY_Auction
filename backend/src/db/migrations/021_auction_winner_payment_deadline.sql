-- 021_auction_winner_payment_deadline.sql
-- Problem 1: 7-day payment rule — winner eligibility, payment deadline, expiration, next-bidder
-- Adds winner tracking and payment deadline to orders, and 'expired' to order_status

-- Add 'expired' to order_status enum if not exists (for expired payment eligibility)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'expired' AND enumtypid = 'order_status'::regtype) THEN
    ALTER TYPE order_status ADD VALUE 'expired';
  END IF;
END $$;

-- Add winner tracking columns to orders (if not exists)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='winner_confirmed_at') THEN
    ALTER TABLE orders ADD COLUMN winner_confirmed_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='payment_deadline') THEN
    ALTER TABLE orders ADD COLUMN payment_deadline TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='winner_rank') THEN
    ALTER TABLE orders ADD COLUMN winner_rank INTEGER DEFAULT 1;
  END IF;
END $$;

-- Index for efficiently finding expired pending orders
CREATE INDEX IF NOT EXISTS idx_orders_payment_deadline_pending ON orders(payment_deadline) WHERE status = 'pending';

-- Optional: Add terms acceptance tracking to users if not exists (for Part A/B)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='terms_accepted_at') THEN
    ALTER TABLE users ADD COLUMN terms_accepted_at TIMESTAMPTZ;
  END IF;
END $$;

COMMENT ON COLUMN orders.winner_confirmed_at IS 'When the current eligible winner was confirmed (auction end or reassignment time)';
COMMENT ON COLUMN orders.payment_deadline IS 'winner_confirmed_at + 7 days — deadline for the current eligible winner to pay';
COMMENT ON COLUMN orders.winner_rank IS '1 for first-highest bidder, 2 for second, etc. — tracks reassignment chain';
COMMENT ON COLUMN users.terms_accepted_at IS 'When the user last accepted the Terms & Policy (for login agreement gate)';
