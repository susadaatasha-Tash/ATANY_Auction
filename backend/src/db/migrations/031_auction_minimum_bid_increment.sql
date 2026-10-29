-- 031_auction_minimum_bid_increment.sql
-- Adds seller-defined minimum bid increment per auction lot.
-- WHY: each seller sets the minimum increase per bid (previously hardcoded ₱1,000).
-- Money convention: INTEGER pesos (same as start_price/current_bid/amount).
-- Idempotent: safe to re-run. Legacy rows backfill to 1000 (the historical platform rule).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'auctions' AND column_name = 'minimum_bid_increment'
  ) THEN
    ALTER TABLE auctions ADD COLUMN minimum_bid_increment INTEGER NOT NULL DEFAULT 1000;
  END IF;
END $$;

-- Backfill legacy rows (the DEFAULT covers new inserts; this covers pre-migration rows
-- on databases where the column was added without a default, plus NULL repair).
UPDATE auctions SET minimum_bid_increment = 1000 WHERE minimum_bid_increment IS NULL;

-- Guard: increment must stay a positive, DB-safe integer amount.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'auctions_min_increment_positive'
  ) THEN
    ALTER TABLE auctions ADD CONSTRAINT auctions_min_increment_positive CHECK (minimum_bid_increment > 0);
  END IF;
END $$;
