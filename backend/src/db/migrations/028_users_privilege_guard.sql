-- 028_users_privilege_guard.sql
-- WHY (Priority 1 / C1): authenticated users could UPDATE their own public.users
-- row without column restrictions, including role → privilege escalation.
-- Fix:
--  1) Keep self-update RLS for safe profile fields only (name, preferred_branch_id, terms).
--  2) BEFORE UPDATE trigger blocks privileged column changes (role, status, password_hash,
--     totp_secret, totp_enabled) unless the write is a trusted service path.
--  3) No INSERT policy for authenticated users — public signup cannot create privileged rows.

-- Safe profile self-update: ownership only; column rules enforced by trigger below.
DROP POLICY IF EXISTS "users: self can update own name" ON public.users;
DROP POLICY IF EXISTS "users: self can update own profile" ON public.users;

CREATE POLICY "users: self can update own profile" ON public.users
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Explicitly deny client INSERT into public.users (service/admin flows use backend pool).
DROP POLICY IF EXISTS "users: authenticated insert denied" ON public.users;
DROP POLICY IF EXISTS "users: no client insert" ON public.users;
-- No INSERT policy is created — default deny for authenticated/anon via RLS.

-- Privileged-column guard function
CREATE OR REPLACE FUNCTION public.users_guard_privileged_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  jwt_role text := '';
  trusted boolean := false;
BEGIN
  -- Supabase request context (null-safe outside PostgREST)
  BEGIN
    jwt_role := COALESCE(auth.role(), '');
  EXCEPTION WHEN OTHERS THEN
    jwt_role := '';
  END;

  -- Backend service / direct DB paths may manage roles and status (admin Users & Roles).
  trusted := jwt_role = 'service_role'
    OR current_user IN ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin');

  IF trusted THEN
    RETURN NEW;
  END IF;

  -- Client/authenticated (and any other untrusted context): block privilege changes.
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

COMMENT ON FUNCTION public.users_guard_privileged_columns() IS
  'Blocks self-escalation on public.users: client sessions cannot change role/status/password/2FA/email/id';
COMMENT ON POLICY "users: self can update own profile" ON public.users IS
  'Self UPDATE allowed for ownership; privileged columns blocked by trigger (service_role/postgres only)';
