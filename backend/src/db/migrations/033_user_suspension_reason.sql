-- 033_user_suspension_reason.sql
-- WHY (Admin → Users & Roles + Admin → Security Alerts):
-- Every MANUAL account suspension now carries a real, user-facing reason.
-- The reason must be durable (it is shown to the suspended customer / shop
-- owner on /account-suspended), must survive refresh + re-login, and must be
-- part of the admin audit trail.
--
-- The suspension pipeline itself is NOT duplicated: public.users.status stays
-- the single source of truth for "is this account suspended". This migration
-- only adds the CURRENT reason for that state.
--
--   users.suspension_reason — the admin-provided reason for the CURRENT
--                             suspension (NULL while the account is active).
--                             Cleared on reactivation; the historical reason
--                             always remains in public.audit_logs.
--
-- No new table: there is deliberately no "suspensions" table for one field.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS suspension_reason TEXT NULL;

-- Guard rail: the reason is plain user-facing text (max 500 chars).
DO $$ BEGIN
  ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_suspension_reason_length;
  ALTER TABLE public.users ADD CONSTRAINT users_suspension_reason_length
    CHECK (suspension_reason IS NULL OR char_length(suspension_reason) <= 500);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The current reason travels with the account row (admin list + /auth/me).
COMMENT ON COLUMN public.users.suspension_reason IS
  'Admin-provided reason for the CURRENT suspension. Cleared on reactivation; the audit trail keeps the history.';
