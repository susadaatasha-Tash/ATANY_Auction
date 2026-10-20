-- 009_fix_is_admin_advisory.sql
-- Advisory: public.is_admin() is SECURITY DEFINER and directly callable by anon via /rest/v1/rpc/is_admin
-- Investigation: is_admin() is SECURITY DEFINER, no params, RETURNS boolean, checks public.users where id=auth.uid() and role='admin'
-- Usage: NOT used in any RLS policy (5 policies use is_admin_or_manager, not is_admin) and NOT used in any JS (no supabase.rpc('is_admin'))
-- Therefore it is scaffolding/leftover and should not be directly callable.

-- Revoke direct RPC from anon/authenticated (and PUBLIC which includes anon)
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;

-- is_admin_or_manager IS used in 5 RLS policies (users, shops, products, bids, orders) and must remain executable
-- for RLS to work (SECURITY DEFINER functions called from RLS still need caller EXECUTE in Supabase).
-- Verified: revoking it breaks RLS (admin cannot read all users), so we keep it granted.
-- If a client needs to check admin status for UI, create a separate SECURITY INVOKER function instead:
-- CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$ SELECT EXISTS (SELECT 1 FROM public.users WHERE id=auth.uid() AND role='admin'); $$;

-- Optional: DROP if truly unused (uncomment to remove entirely)
-- DROP FUNCTION IF EXISTS public.is_admin();
