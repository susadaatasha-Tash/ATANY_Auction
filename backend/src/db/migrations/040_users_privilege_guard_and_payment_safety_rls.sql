-- 040_users_privilege_guard_and_payment_safety_rls
--
-- Forward-only security migration.
--
-- 1. Re-creates the users privilege guard (migration 028 was baseline-marked
--    but the trigger was never actually created in the target database).
-- 2. Revokes dangerous default privileges (including TRUNCATE) from anon and
--    authenticated on payment safety tables (migration 039 enabled RLS but
--    did not revoke inherited grants).
--
-- Idempotent: safe to re-run.

-- ============================================================
-- PART 1: Users privilege guard (forward-only replacement for missing migration 028)
-- ============================================================

-- Safe profile self-update: ownership only; column rules enforced by trigger.
DROP POLICY IF EXISTS "users: self can update own name" ON public.users;
DROP POLICY IF EXISTS "users: self can update own profile" ON public.users;

CREATE POLICY "users: self can update own profile" ON public.users
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Explicitly deny client INSERT into public.users.
DROP POLICY IF EXISTS "users: authenticated insert denied" ON public.users;
DROP POLICY IF EXISTS "users: no client insert" ON public.users;

-- Privileged-column guard function
CREATE OR REPLACE FUNCTION public.users_guard_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  jwt_role text := '';
  trusted boolean := false;
BEGIN
  BEGIN
    jwt_role := COALESCE(auth.role(), '');
  EXCEPTION WHEN OTHERS THEN
    jwt_role := '';
  END;

  trusted := jwt_role = 'service_role'
    OR current_user IN ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin');

  IF trusted THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'users.id cannot be changed by client update';
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'users.email cannot be changed by client update';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'users.role cannot be changed by client update';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'users.status cannot be changed by client update';
  END IF;
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    RAISE EXCEPTION 'users.password_hash cannot be changed by client update';
  END IF;
  IF NEW.totp_secret IS DISTINCT FROM OLD.totp_secret
     OR NEW.totp_enabled IS DISTINCT FROM OLD.totp_enabled THEN
    RAISE EXCEPTION 'users 2FA fields cannot be changed by client update';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_guard_privileged ON public.users;
CREATE TRIGGER trg_users_guard_privileged
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.users_guard_privileged_columns();

-- ============================================================
-- PART 2: Revoke dangerous default privileges on payment safety tables
-- ============================================================

-- Migration 039 enabled RLS but did not revoke inherited default grants.
-- Default privileges grant anon/authenticated arwdDxtm (including TRUNCATE)
-- which bypasses RLS for TRUNCATE operations.
-- Only apply if the tables exist (migration 039 may not have run yet).

DO $$ BEGIN
  IF to_regclass('public.payment_operations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON public.payment_operations FROM anon, authenticated';
    EXECUTE 'GRANT ALL ON public.payment_operations TO postgres';
  END IF;
  IF to_regclass('public.payment_webhook_events') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON public.payment_webhook_events FROM anon, authenticated';
    EXECUTE 'GRANT ALL ON public.payment_webhook_events TO postgres';
  END IF;
  IF to_regclass('public.provider_collections') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON public.provider_collections FROM anon, authenticated';
    EXECUTE 'GRANT ALL ON public.provider_collections TO postgres';
  END IF;
  IF to_regclass('public.payment_reconciliations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON public.payment_reconciliations FROM anon, authenticated';
    EXECUTE 'GRANT ALL ON public.payment_reconciliations TO postgres';
  END IF;
END $$;

-- ============================================================
-- PART 3: Column-level protection on users table
-- ============================================================

-- Revoke table-level UPDATE from authenticated/anon, then grant only
-- approved profile columns. This provides defense-in-depth alongside
-- the trigger (Part 1). The trigger blocks privileged column changes;
-- the column grants prevent even attempting them.
--
-- Only apply if the roles exist (local dev may not have Supabase roles).

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    -- Revoke table-level UPDATE (removes all column grants)
    EXECUTE 'REVOKE UPDATE ON public.users FROM authenticated';
    -- Grant only approved profile columns
    EXECUTE 'GRANT UPDATE (name, phone, preferred_branch_id) ON public.users TO authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE UPDATE ON public.users FROM anon';
  END IF;
END $$;
