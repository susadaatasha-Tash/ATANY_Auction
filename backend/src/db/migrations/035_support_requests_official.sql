-- 035_support_requests_official.sql
-- Official ATANY support destination (goldjewelryauction@gmail.com).
--
-- The support_requests table already exists (migration 010) and is REUSED —
-- no second support table is created. This migration only adds the columns
-- that the official support flows genuinely require and that the table did
-- not have yet:
--
--   user_id         the authenticated requester (NULL for public requests)
--   requester_role  customer | shop_owner | admin | public
--   category        the whitelisted support category
--   source          which surface the request came from
--   attachment_path storage PATH inside the PRIVATE atany-support bucket
--
-- `subject` already existed and, historically, stored the CATEGORY value.
-- Existing rows are backfilled so no information is lost: the historical
-- category value is copied into the new `category` column and `subject`
-- keeps its value as the human-readable subject.
--
-- The status convention is unchanged: 'new' | 'in_progress' | 'resolved'.

ALTER TABLE support_requests
  ADD COLUMN IF NOT EXISTS user_id UUID NULL,
  ADD COLUMN IF NOT EXISTS requester_role TEXT NULL,
  ADD COLUMN IF NOT EXISTS category TEXT NULL,
  ADD COLUMN IF NOT EXISTS source TEXT NULL,
  ADD COLUMN IF NOT EXISTS attachment_path TEXT NULL;

-- Backfill: legacy rows stored the category in `subject`.
UPDATE support_requests
   SET category = subject
 WHERE category IS NULL;

-- New requests always carry a category.
ALTER TABLE support_requests
  ALTER COLUMN category SET DEFAULT 'General Inquiry';

-- Reference lookups (admin support desk / per-requester history).
CREATE INDEX IF NOT EXISTS support_requests_user_id_idx  ON support_requests (user_id);
CREATE INDEX IF NOT EXISTS support_requests_created_at_idx ON support_requests (created_at DESC);
