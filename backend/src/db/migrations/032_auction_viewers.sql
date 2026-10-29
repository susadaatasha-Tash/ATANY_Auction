-- 032_auction_viewers.sql
-- Persistent unique viewers per auction (TOTAL VIEWERS) to complement the
-- in-memory live presence (WATCHERS) in services/auctionPresence.js.
-- WHY: active presence resets on restart/disconnect by design; historical
-- unique viewers must survive restarts, disconnects, and auction end.
-- One row per (auction, user): first_viewed_at never changes, last_viewed_at
-- refreshes on later opens. Same user, N tabs/reopens → exactly one row.
-- Idempotent: safe to re-run.
CREATE TABLE IF NOT EXISTS public.auction_viewers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES public.auctions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  first_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Critical: one total-viewer row per auction/user (race-safe dedup at the DB).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_auction_viewers_auction_user'
  ) THEN
    ALTER TABLE public.auction_viewers
      ADD CONSTRAINT uq_auction_viewers_auction_user UNIQUE (auction_id, user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_auction_viewers_auction
  ON public.auction_viewers(auction_id);
CREATE INDEX IF NOT EXISTS idx_auction_viewers_user
  ON public.auction_viewers(user_id);
