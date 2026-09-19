-- Ensure one order per auction (idempotent order creation in auctionCloser)
CREATE UNIQUE INDEX IF NOT EXISTS orders_auction_id_unique ON orders (auction_id) WHERE auction_id IS NOT NULL;
