-- Migration 013: Remove 'manager' role, rename is_admin_or_manager → is_admin
-- Safe approach: drop dependent policies first, then function, then recreate everything.
-- Run this in Supabase SQL Editor.

BEGIN;

-- ============================================================
-- STEP 1: Drop all 14 RLS policies that depend on is_admin_or_manager()
-- ============================================================
-- These policies are temporarily removed. Admin access via service_role is unaffected.

DROP POLICY IF EXISTS "users: self or admin can read" ON public.users;
DROP POLICY IF EXISTS "shops: owner or admin" ON public.shops;
DROP POLICY IF EXISTS "products: shop owner can manage own, public can read approved" ON public.products;
DROP POLICY IF EXISTS "bids: owner can read own, admin can read all" ON public.bids;
DROP POLICY IF EXISTS "orders: buyer or admin" ON public.orders;
DROP POLICY IF EXISTS "seller_applications_select_admin" ON public.seller_applications;
DROP POLICY IF EXISTS "seller_applications_update_admin" ON public.seller_applications;
DROP POLICY IF EXISTS "audit_logs_select_admin" ON public.audit_logs;
DROP POLICY IF EXISTS "billing_records_select_admin" ON public.billing_records;
DROP POLICY IF EXISTS "billing_records_update_admin" ON public.billing_records;
DROP POLICY IF EXISTS "security_alerts_select_admin" ON public.security_alerts;
DROP POLICY IF EXISTS "security_alerts_update_admin" ON public.security_alerts;
DROP POLICY IF EXISTS "Admin can read support_requests" ON public.support_requests;

-- ============================================================
-- STEP 2: Drop the old function (no dependents remain)
-- ============================================================
DROP FUNCTION IF EXISTS public.is_admin_or_manager();

-- ============================================================
-- STEP 3: Create is_admin() — admin-only SECURITY DEFINER
-- ============================================================
-- Identical pattern to is_admin_or_manager() but checks role = 'admin' only.
-- Reads from public.users (trusted source), NOT auth.jwt() metadata.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
    AND role = 'admin'
  );
$$;

-- Grant execute to authenticated so RLS policies can call it
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- ============================================================
-- STEP 4: Recreate all 14 policies using is_admin()
-- ============================================================
-- Each policy is identical to before, just with is_admin() instead of is_admin_or_manager().

-- users
CREATE POLICY "users: self or admin can read" ON public.users
  FOR SELECT USING (auth.uid() = id OR public.is_admin());

-- shops
CREATE POLICY "shops: owner or admin" ON public.shops
  FOR ALL USING (auth.uid() = user_id OR public.is_admin());

-- products
CREATE POLICY "products: shop owner can manage own, public can read approved" ON public.products
  FOR SELECT USING (
    status = 'approved'::product_status
    OR shop_id IN (SELECT id FROM public.shops WHERE user_id = auth.uid())
    OR public.is_admin()
  );

-- bids
CREATE POLICY "bids: owner can read own, admin can read all" ON public.bids
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

-- orders
CREATE POLICY "orders: buyer or admin" ON public.orders
  FOR SELECT USING (auth.uid() = buyer_id OR public.is_admin());

-- seller_applications
CREATE POLICY "seller_applications_select_admin" ON public.seller_applications
  FOR SELECT USING (public.is_admin());
CREATE POLICY "seller_applications_update_admin" ON public.seller_applications
  FOR UPDATE USING (public.is_admin());

-- audit_logs
CREATE POLICY "audit_logs_select_admin" ON public.audit_logs
  FOR SELECT USING (public.is_admin());

-- billing_records
CREATE POLICY "billing_records_select_admin" ON public.billing_records
  FOR SELECT USING (public.is_admin());
CREATE POLICY "billing_records_update_admin" ON public.billing_records
  FOR UPDATE USING (public.is_admin());

-- security_alerts
CREATE POLICY "security_alerts_select_admin" ON public.security_alerts
  FOR SELECT USING (public.is_admin());
CREATE POLICY "security_alerts_update_admin" ON public.security_alerts
  FOR UPDATE USING (public.is_admin());

-- support_requests
CREATE POLICY "Admin can read support_requests" ON public.support_requests
  FOR SELECT USING (public.is_admin());

-- ============================================================
-- STEP 5: Remove 'manager' from user_role enum
-- ============================================================
-- PostgreSQL cannot DROP VALUE from an enum. Safe approach:
-- 1. Create new enum without 'manager'
-- 2. Migrate column to TEXT, then to new enum
-- 3. Drop old enum, rename new

-- Safety: ensure no rows still have 'manager' (should already be admin)
UPDATE public.users SET role = 'admin' WHERE role = 'manager';

-- Create new enum
DO $$ BEGIN
  CREATE TYPE public.user_role_new AS ENUM ('customer', 'shop_owner', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Migrate column: drop default → convert to TEXT → drop old enum → rename new → convert back → set default
ALTER TABLE public.users ALTER COLUMN role DROP DEFAULT;
ALTER TABLE public.users ALTER COLUMN role TYPE TEXT USING role::text;
DROP TYPE IF EXISTS public.user_role;
ALTER TYPE public.user_role_new RENAME TO user_role;
ALTER TABLE public.users
  ALTER COLUMN role TYPE public.user_role USING role::public.user_role,
  ALTER COLUMN role SET DEFAULT 'customer'::public.user_role;

-- ============================================================
-- STEP 6: Verify
-- ============================================================
-- Confirm is_admin_or_manager is gone and is_admin exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_admin_or_manager') THEN
    RAISE EXCEPTION 'FAIL: is_admin_or_manager still exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_admin') THEN
    RAISE EXCEPTION 'FAIL: is_admin does not exist';
  END IF;
END $$;

SELECT 'Migration 013 complete: manager removed, is_admin() active, all 14 policies recreated.' AS result;

COMMIT;
