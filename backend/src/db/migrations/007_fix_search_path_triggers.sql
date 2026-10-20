-- 007_fix_search_path_triggers.sql
-- Security advisory: Functions public.set_transaction_code and public.set_auction_code had mutable search_path
-- (no explicit search_path), allowing search_path hijacking. Fix via SET search_path = public, pg_temp.
-- Advisory notes SECURITY DEFINER functions are most critical, but SECURITY INVOKER triggers also need fixed search_path
-- for safe nextval() and table references.

-- Fix set_transaction_code (currently SECURITY INVOKER, no search_path)
ALTER FUNCTION public.set_transaction_code() SET search_path = public, pg_temp;

-- Fix set_auction_code (currently SECURITY INVOKER, no search_path)
ALTER FUNCTION public.set_auction_code() SET search_path = public, pg_temp;

-- Verify
-- SELECT proname, prosecdef, proconfig FROM pg_proc WHERE proname IN ('set_transaction_code','set_auction_code');
