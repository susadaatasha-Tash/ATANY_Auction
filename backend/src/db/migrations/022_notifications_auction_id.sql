-- 022_notifications_auction_id.sql
-- Add auction_id to notifications so Auction Started popup can reliably identify the exact auction
-- Fixes race where auction_reminders are deleted before frontend GET can determine recipient.
-- Existing notifications without auction_id remain valid (nullable).
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS auction_id UUID REFERENCES public.auctions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_auction ON public.notifications(auction_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_auction ON public.notifications(user_id, auction_id);
