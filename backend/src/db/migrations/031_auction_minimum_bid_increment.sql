-- 031_auction_minimum_bid_increment.sql
-- Adds per-auction seller-defined minimum bid increment.
-- WHY: Sellers can define the minimum bid increment for each auction lot.
-- Defaults to ₱1,000 for legacy/backward compatibility.

-- 1. Add minimum_bid_increment column (integer pesos, same convention as start_price/current_bid)
ALTER TABLE public.auctions
  ADD COLUMN IF NOT EXISTS minimum_bid_increment INTEGER NOT NULL DEFAULT 1000;

-- 2. Backfill existing rows to the default (idempotent — NOT NULL DEFAULT already handles new rows,
--    but existing rows need explicit backfill since ADD COLUMN with NOT NULL DEFAULT does backfill
--    on most Postgres versions; this is an explicit safety net)
UPDATE public.auctions
SET minimum_bid_increment = 1000
WHERE minimum_bid_increment IS NULL;

-- 3. Sanity check constraint: increment must be positive
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_auctions_min_bid_increment_positive'
  ) THEN
    ALTER TABLE public.auctions
      ADD CONSTRAINT chk_auctions_min_bid_increment_positive
      CHECK (minimum_bid_increment > 0);
  END IF;
END $$;

COMMENT ON COLUMN public.auctions.minimum_bid_increment IS
  'Seller-defined minimum bid increment in pesos. Backend enforces submitted_bid >= current_bid + minimum_bid_increment. Default 1000.';
