-- 006_fix_rls_insecure_user_metadata.sql
-- Security advisory: RLS policies referenced auth.jwt() -> 'user_metadata' ->> 'role' which is client-editable
-- via supabase.auth.updateUser({ data: { role: 'admin' } }), allowing privilege escalation.
-- Fix: Use trusted public.users.role via SECURITY DEFINER helper, and sync missing public.users rows.

-- 1. Helper functions (SECURITY DEFINER to bypass RLS recursion on users)
CREATE OR REPLACE FUNCTION public.is_admin_or_manager()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
    AND role IN ('admin','manager')
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_admin_or_manager() TO authenticated, anon, public;

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
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon, public;

-- 2. Sync missing public.users rows from auth.users (e.g. jill.m@atany.ph was missing)
INSERT INTO public.users (id, name, email, password_hash, role, status)
SELECT id, COALESCE(raw_user_meta_data->>'name', email), email, 'supabase_auth',
       CASE WHEN raw_user_meta_data->>'role' IN ('admin','manager','shop_owner','customer') THEN (raw_user_meta_data->>'role')::user_role ELSE 'customer'::user_role END,
       'active'
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.users)
ON CONFLICT (id) DO NOTHING;

-- 3. Fix RLS policies to use trusted source
DROP POLICY IF EXISTS "users: self or admin can read" ON public.users;
CREATE POLICY "users: self or admin can read" ON public.users FOR SELECT USING (
  auth.uid() = id OR public.is_admin_or_manager()
);

DROP POLICY IF EXISTS "shops: owner or admin" ON public.shops;
CREATE POLICY "shops: owner or admin" ON public.shops FOR ALL USING (
  auth.uid() = user_id OR public.is_admin_or_manager()
);

DROP POLICY IF EXISTS "products: shop owner can manage own, public can read approved" ON public.products;
CREATE POLICY "products: shop owner can manage own, public can read approved" ON public.products FOR SELECT USING (
  status = 'approved'::product_status
  OR shop_id IN (SELECT id FROM public.shops WHERE user_id = auth.uid())
  OR public.is_admin_or_manager()
);

DROP POLICY IF EXISTS "bids: owner can read own, admin can read all" ON public.bids;
CREATE POLICY "bids: owner can read own, admin can read all" ON public.bids FOR SELECT USING (
  auth.uid() = user_id OR public.is_admin_or_manager()
);

DROP POLICY IF EXISTS "orders: buyer or admin" ON public.orders;
CREATE POLICY "orders: buyer or admin" ON public.orders FOR SELECT USING (
  auth.uid() = buyer_id OR public.is_admin_or_manager()
);
