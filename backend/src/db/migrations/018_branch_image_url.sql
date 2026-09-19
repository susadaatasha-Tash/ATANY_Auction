-- 018_branch_image_url.sql
-- Add branch image URL to branches (SAME record read by Customer branch cards via GET /branches).
-- Seller ownership is verified via shops.home_branch_id -> branches.id; no new table.
-- shops table inspected: no suitable image field exists (only shop_name, payout_method, home_branch_id).
ALTER TABLE branches ADD COLUMN IF NOT EXISTS branch_image_url TEXT;
