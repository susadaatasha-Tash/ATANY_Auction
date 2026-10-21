-- 032_user_status_invited_on_leave.sql
-- WHY (Admin → Users & Roles staff management): the approved Users & Roles
-- screen needs two account states that did not exist in the base schema.
--
--   invited  — the account was created through the real invitation flow
--              (Supabase Auth inviteUserByEmail) but has not accepted the
--              invitation / completed onboarding yet.
--   on_leave — the account is administratively parked (staff not working).
--
-- Both values are ADDITIVE: existing rows keep their status, no data is
-- rewritten, and the enum default stays 'active'.
--
-- NOTE: 'ADD VALUE IF NOT EXISTS' keeps this migration idempotent, so it is
-- safe to re-run against a database that already has the values.
ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'invited';
ALTER TYPE user_status ADD VALUE IF NOT EXISTS 'on_leave';
