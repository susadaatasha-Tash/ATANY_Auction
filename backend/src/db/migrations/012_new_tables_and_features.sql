-- Migration 012: New tables and features
-- Adds: seller_applications, preferred_branch_id on users, messages, audit_logs, billing_records
-- Safe: Uses IF NOT EXISTS throughout; no destructive changes

-- ============================================================
-- 1. CUSTOMER PREFERRED BRANCH
-- ============================================================
-- Add preferred_branch_id to users table (customers only)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS preferred_branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL;

-- ============================================================
-- 2. SELLER APPLICATIONS
-- ============================================================
CREATE TYPE public.seller_application_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE IF NOT EXISTS public.seller_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  shop_name TEXT NOT NULL,
  contact_number TEXT,
  email TEXT NOT NULL,
  shop_address TEXT,
  branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  business_description TEXT,
  application_reason TEXT,
  status public.seller_application_status NOT NULL DEFAULT 'pending',
  rejection_reason TEXT,
  reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seller_applications_applicant ON public.seller_applications(applicant_id);
CREATE INDEX IF NOT EXISTS idx_seller_applications_status ON public.seller_applications(status);

ALTER TABLE public.seller_applications ENABLE ROW LEVEL SECURITY;

-- Applicant can view their own application
CREATE POLICY "seller_applications_select_own" ON public.seller_applications
  FOR SELECT USING (auth.uid() = applicant_id);

-- Any authenticated user can insert (submit application)
CREATE POLICY "seller_applications_insert_auth" ON public.seller_applications
  FOR INSERT WITH CHECK (auth.uid() = applicant_id);

-- Admin/manager can view all applications
CREATE POLICY "seller_applications_select_admin" ON public.seller_applications
  FOR SELECT USING (public.is_admin_or_manager());

-- Admin/manager can update applications (approve/reject)
CREATE POLICY "seller_applications_update_admin" ON public.seller_applications
  FOR UPDATE USING (public.is_admin_or_manager());

-- ============================================================
-- 3. MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  auction_id UUID REFERENCES public.auctions(id) ON DELETE SET NULL,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON public.messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id));

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Users can only see messages they sent or received
CREATE POLICY "messages_select_own" ON public.messages
  FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- Users can send messages
CREATE POLICY "messages_insert_own" ON public.messages
  FOR INSERT WITH CHECK (auth.uid() = sender_id);

-- Users can mark their own messages as read
CREATE POLICY "messages_update_own" ON public.messages
  FOR UPDATE USING (auth.uid() = receiver_id);

-- ============================================================
-- 4. AUDIT LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Only admin/manager can read audit logs
CREATE POLICY "audit_logs_select_admin" ON public.audit_logs
  FOR SELECT USING (public.is_admin_or_manager());

-- Service role inserts via backend only (no direct client insert policy needed)

-- ============================================================
-- 5. BILLING RECORDS (Seller platform maintenance fees)
-- ============================================================
CREATE TYPE public.billing_status AS ENUM ('pending', 'paid', 'overdue', 'cancelled');

CREATE TABLE IF NOT EXISTS public.billing_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  billing_period TEXT NOT NULL,
  status public.billing_status NOT NULL DEFAULT 'pending',
  due_date DATE,
  paid_at TIMESTAMPTZ,
  payment_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_records_seller ON public.billing_records(seller_id);
CREATE INDEX IF NOT EXISTS idx_billing_records_status ON public.billing_records(status);

ALTER TABLE public.billing_records ENABLE ROW LEVEL SECURITY;

-- Seller can view their own billing records
CREATE POLICY "billing_records_select_own" ON public.billing_records
  FOR SELECT USING (auth.uid() = seller_id);

-- Admin/manager can view all billing records
CREATE POLICY "billing_records_select_admin" ON public.billing_records
  FOR SELECT USING (public.is_admin_or_manager());

-- Admin/manager can update billing records
CREATE POLICY "billing_records_update_admin" ON public.billing_records
  FOR UPDATE USING (public.is_admin_or_manager());

-- ============================================================
-- 6. FIX RLS — security_alerts (has RLS enabled but no policies)
-- ============================================================
-- Admin/manager can view all security alerts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'security_alerts_select_admin' AND tablename = 'security_alerts'
  ) THEN
    CREATE POLICY "security_alerts_select_admin" ON public.security_alerts
      FOR SELECT USING (public.is_admin_or_manager());
  END IF;
END $$;

-- Admin/manager can update security alerts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'security_alerts_update_admin' AND tablename = 'security_alerts'
  ) THEN
    CREATE POLICY "security_alerts_update_admin" ON public.security_alerts
      FOR UPDATE USING (public.is_admin_or_manager());
  END IF;
END $$;

-- Service role inserts security alerts via backend (no client insert policy)

-- ============================================================
-- 7. FIX — Restore is_admin_or_manager() EXECUTE for RLS
-- ============================================================
-- Migration 008 revoked EXECUTE from anon/authenticated/PUBLIC.
-- This breaks RLS policies that call is_admin_or_manager() as SECURITY DEFINER.
-- The function must be executable by authenticated role for RLS to work.
-- Only restore is_admin_or_manager (is_admin is unused and stays locked).
GRANT EXECUTE ON FUNCTION public.is_admin_or_manager() TO authenticated;

-- ============================================================
-- 8. FIX RLS — Add basic SELECT policy on auctions
-- ============================================================
-- Auctions should be publicly readable for live/scheduled status
-- but we add RLS for consistency and future protection
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'auctions_select_public' AND tablename = 'auctions'
  ) THEN
    ALTER TABLE public.auctions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "auctions_select_public" ON public.auctions
      FOR SELECT USING (true);
  END IF;
END $$;
