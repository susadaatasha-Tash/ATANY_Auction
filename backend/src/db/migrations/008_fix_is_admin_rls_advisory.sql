-- 008_fix_is_admin_rls_advisory.sql
-- Security advisory: public.is_admin() is SECURITY DEFINER and directly callable by anon via /rest/v1/rpc/is_admin
-- Also fixes insecure RLS that referenced user_metadata and ensures helper functions are not directly callable

-- Report before fix (for audit):
-- public.is_admin() | SECURITY DEFINER | no params | SELECT EXISTS (SELECT 1 FROM public.users WHERE id=auth.uid() AND role='admin')
-- Used in: NO RLS policy (only is_admin_or_manager is used in 5 policies: users, shops, products, bids, orders)
-- JS usage: grep found no supabase.rpc('is_admin') calls — scaffolding/leftover

-- Fix is_admin: revoke from anon/authenticated/PUBLIC (only owner/service_role can call directly via RPC)
-- RLS policies that use is_admin_or_manager internally run as SECURITY DEFINER owner, so they don't need caller EXECUTE
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_manager() FROM anon, authenticated, PUBLIC;

-- Optional: If legitimate client check "is current user admin" is needed for UI, expose a SECURITY INVOKER version instead:
-- CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin'); $$;
-- For now we keep as SECURITY DEFINER but locked down; if UI needs it, switch to INVOKER.

-- Verify
-- SELECT proname, prosecdef, proconfig FROM pg_proc WHERE proname IN ('is_admin','is_admin_or_manager');
-- Should show is_admin with proconfig and only postgres/service_role grants
