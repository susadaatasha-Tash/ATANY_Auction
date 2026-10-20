-- 011_auction_reminders.sql
-- "Notify Me" subscriptions for scheduled auctions (separate from watchlists).
-- Referenced by controllers/customer/reminder.controller.js and services/auctionStarter.js.
-- Was missing from the DB → "relation \"auction_reminders\" does not exist" on the
-- every-minute startScheduledAuctions cron and on GET/POST /customer/reminders.

CREATE TABLE IF NOT EXISTS auction_reminders (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  auction_id UUID REFERENCES auctions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, auction_id)  -- backs ON CONFLICT (user_id, auction_id)
);

ALTER TABLE auction_reminders ENABLE ROW LEVEL SECURITY;

-- Owner-scoped, mirrors the watchlists policy. Backend uses the service role (bypasses RLS),
-- so the auctionStarter cron can still read every user's reminders.
DROP POLICY IF EXISTS "auction_reminders: owner" ON auction_reminders;
CREATE POLICY "auction_reminders: owner" ON auction_reminders FOR ALL USING (auth.uid() = user_id);
