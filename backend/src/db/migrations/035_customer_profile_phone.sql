-- 035_customer_profile_phone.sql
--
-- ATANY Customer Profile — phone persistence.
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- `GET /customer/account` (controllers/customer/account.controller.js) has ALWAYS
-- returned `phone: u.phone || null` — the read side was written expecting a phone
-- column on `public.users`. An audit of the live schema found the column does not
-- exist, so the Profile page silently showed an empty phone that could never be
-- saved.
--
-- Verified schema before writing this file (public.users, 10 columns):
--   id, name, email, password_hash, role, status, created_at,
--   totp_secret, totp_enabled, preferred_branch_id
-- -> no phone / phone_number / mobile_number anywhere in public.users.
--
-- This adds EXACTLY ONE column. It is not a duplicate:
--   · public.users had no phone field at all
--   · auth.users.phone is Supabase's own mirror and is NOT read by ATANY app code
--     (every ATANY profile read goes through public.users)
--   · no second/mobile/alternate phone column is created
--
-- Type: text, nullable — a phone number is optional on the profile, so existing
-- rows stay valid and no backfill is required.
--
-- No password column is added anywhere: passwords remain exclusively inside
-- Supabase Auth and never touch the application database.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone text;

COMMENT ON COLUMN public.users.phone IS
  'Optional customer contact number. Customer-editable via PUT /customer/account. Never a password or credential.';
