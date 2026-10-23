-- ============================================================
-- JewelryHub (ATANY_Auction) — COMPLETE DATABASE SETUP
-- Run this ENTIRE script in Supabase SQL Editor (Dashboard → SQL)
-- It creates all tables, types, functions, RLS, and seed data.
-- ============================================================

-- 0. Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. ENUMS
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('customer','shop_owner','admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('active','suspended','invited','on_leave');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE branch_status AS ENUM ('Open','Temporarily Closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE product_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE auction_status AS ENUM ('scheduled','live','paused','ended');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Migration 030 parity: 'paused' enum value idempotent (fresh installs already
-- include it in CREATE TYPE above; existing DBs get it via 030 migration file).
DO $$ BEGIN
  ALTER TYPE auction_status ADD VALUE IF NOT EXISTS 'paused';
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;
-- NOTE: auctions.paused_at is added AFTER CREATE TABLE auctions below
-- (migration 030 equivalent) — it cannot run here because the table may not
-- exist yet on fresh installs.

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('pending','ready_pickup','completed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE alert_severity AS ENUM ('low','medium','high');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE alert_status AS ENUM ('new','investigating','resolved','dismissed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE seller_application_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE billing_status AS ENUM ('pending','paid','overdue','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. TABLES (dependency order)

-- branches first (shops refs branches)
CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  hours TEXT,
  phone TEXT,
  status branch_status NOT NULL DEFAULT 'Open'
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'customer',
  status user_status NOT NULL DEFAULT 'active',
  suspension_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  totp_secret TEXT,
  totp_enabled BOOLEAN DEFAULT false,
  phone TEXT,
  preferred_branch_id UUID REFERENCES branches(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  shop_name TEXT NOT NULL,
  payout_method TEXT,
  home_branch_id UUID REFERENCES branches(id)
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  karat_weight TEXT,
  price INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  status product_status NOT NULL DEFAULT 'pending',
  description TEXT,
  image_url TEXT,
  proposed_start_time TIMESTAMPTZ,
  proposed_end_time TIMESTAMPTZ,
  proposed_duration_days INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auctions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  start_price INTEGER NOT NULL,
  current_bid INTEGER NOT NULL DEFAULT 0,
  minimum_bid_increment INTEGER NOT NULL DEFAULT 1000,
  status auction_status NOT NULL DEFAULT 'scheduled',
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  auction_code TEXT
);
-- Migration 030 parity for fresh installs (see backend/src/db/migrations/030_auction_pause_support.sql)
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
-- Migration 031 parity for fresh installs (seller-defined minimum bid increment)
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS minimum_bid_increment INTEGER NOT NULL DEFAULT 1000;

CREATE TABLE IF NOT EXISTS bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID REFERENCES auctions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  flagged BOOLEAN DEFAULT false,
  flag_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID REFERENCES auctions(id),
  buyer_id UUID REFERENCES users(id),
  amount INTEGER NOT NULL,
  branch_id UUID REFERENCES branches(id),
  status order_status NOT NULL DEFAULT 'pending',
  payment_method TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  transaction_code TEXT
);

CREATE TABLE IF NOT EXISTS security_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  type TEXT NOT NULL,
  severity alert_severity NOT NULL,
  status alert_status NOT NULL DEFAULT 'new',
  detail TEXT,
  activity_trail JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS watchlists (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS product_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (product_id, user_id)
);

CREATE TABLE IF NOT EXISTS auction_reminders (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  auction_id UUID REFERENCES auctions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, auction_id)
);

CREATE TABLE IF NOT EXISTS seller_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  applicant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_name TEXT NOT NULL,
  contact_number TEXT,
  email TEXT NOT NULL,
  shop_address TEXT,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  business_description TEXT,
  application_reason TEXT,
  status seller_application_status NOT NULL DEFAULT 'pending',
  rejection_reason TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auction_id UUID REFERENCES auctions(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  details JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  billing_period TEXT NOT NULL,
  status billing_status NOT NULL DEFAULT 'pending',
  due_date DATE,
  paid_at TIMESTAMPTZ,
  payment_reference TEXT,
  plan_code TEXT,
  paymongo_checkout_session_id TEXT,
  current_period_start DATE,
  current_period_end DATE,
  billing_interval TEXT NOT NULL DEFAULT 'monthly',
  billing_type TEXT NOT NULL DEFAULT 'subscription',
  subscription_change_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Subscription plan-change domain (migration 026/027 parity)
DO $$ BEGIN
  CREATE TYPE public.subscription_change_type AS ENUM ('upgrade', 'downgrade', 'interval_change');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.subscription_change_status AS ENUM ('pending_payment', 'scheduled', 'applied', 'canceled', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.subscription_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  current_plan_code TEXT,
  target_plan_code TEXT NOT NULL,
  current_billing_interval TEXT,
  target_billing_interval TEXT NOT NULL,
  change_type public.subscription_change_type NOT NULL,
  status public.subscription_change_status NOT NULL,
  effective_at DATE,
  proration_amount INTEGER NOT NULL DEFAULT 0,
  paymongo_checkout_session_id TEXT,
  billing_record_id UUID REFERENCES public.billing_records(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_changes_one_pending
  ON public.subscription_changes(seller_id) WHERE status = 'pending_payment';
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_changes_one_scheduled
  ON public.subscription_changes(seller_id) WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS public.seller_payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'paymongo',
  provider_payment_method_id TEXT NOT NULL,
  type TEXT,
  brand TEXT,
  last4 TEXT,
  exp_month INTEGER,
  exp_year INTEGER,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_id, provider_payment_method_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_payment_methods_one_default
  ON public.seller_payment_methods(seller_id) WHERE is_default;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_billing_records_subscription_change'
  ) THEN
    ALTER TABLE public.billing_records
      ADD CONSTRAINT fk_billing_records_subscription_change
      FOREIGN KEY (subscription_change_id)
      REFERENCES public.subscription_changes(id)
      ON DELETE SET NULL;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_billing_records_interval'
  ) THEN
    ALTER TABLE public.billing_records
      ADD CONSTRAINT chk_billing_records_interval
      CHECK (billing_interval IN ('monthly', 'annual'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS support_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT 'General Inquiry',
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attachment_path TEXT,
  user_id UUID,
  requester_role TEXT,
  category TEXT DEFAULT 'General Inquiry',
  source TEXT
);

-- 3. SEQUENCES (for human-readable codes)
CREATE SEQUENCE IF NOT EXISTS transaction_code_seq START 9001;
CREATE SEQUENCE IF NOT EXISTS auction_code_seq START 701;

-- 4. SEED BRANCHES
INSERT INTO branches (name, address, lat, lng, hours, phone, status) VALUES
('Davao City Branch', 'Victoria Plaza Area, Davao City', 7.0736, 125.6128, 'Mon-Sat 9:00 AM - 6:00 PM', '(082) 123-4567', 'Open'),
('Cebu Branch', 'Ayala Center, Cebu City', 10.3181, 123.9051, 'Mon-Sat 10:00 AM - 7:00 PM', '(032) 234-5678', 'Open'),
('Manila Branch', 'Greenbelt 5, Makati City', 14.5518, 121.0201, 'Daily 10:00 AM - 8:00 PM', '(02) 8888-1234', 'Open'),
('Iloilo Branch', 'Festive Walk, Iloilo City', 10.7202, 122.5621, 'Mon-Sat 10:00 AM - 6:00 PM', '(033) 321-9988', 'Open'),
('Baguio Branch', 'Session Road, Baguio City', 16.4131, 120.5930, 'Wed-Mon 9:00 AM - 5:00 PM', '(074) 442-7711', 'Open')
ON CONFLICT DO NOTHING;

-- 5. FUNCTIONS

-- SECURITY DEFINER helper: checks public.users.role (trusted source, NOT auth.jwt())
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

-- Auto-assign transaction codes
CREATE OR REPLACE FUNCTION set_transaction_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.transaction_code IS NULL OR NEW.transaction_code = '' THEN
    NEW.transaction_code := 'TXN-' || nextval('transaction_code_seq');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

-- Auto-assign auction codes
CREATE OR REPLACE FUNCTION set_auction_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.auction_code IS NULL OR NEW.auction_code = '' THEN
    NEW.auction_code := 'A-' || nextval('auction_code_seq');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

-- 6. TRIGGERS
DROP TRIGGER IF EXISTS orders_transaction_code_trigger ON orders;
CREATE TRIGGER orders_transaction_code_trigger BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION set_transaction_code();

DROP TRIGGER IF EXISTS auctions_auction_code_trigger ON auctions;
CREATE TRIGGER auctions_auction_code_trigger BEFORE INSERT ON auctions FOR EACH ROW EXECUTE FUNCTION set_auction_code();

-- 7. INDEXES
CREATE INDEX IF NOT EXISTS idx_seller_applications_applicant ON seller_applications(applicant_id);
CREATE INDEX IF NOT EXISTS idx_seller_applications_status ON seller_applications(status);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id));
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_records_seller ON billing_records(seller_id);
CREATE INDEX IF NOT EXISTS idx_billing_records_status ON billing_records(status);
CREATE UNIQUE INDEX IF NOT EXISTS orders_transaction_code_unique ON orders (transaction_code) WHERE transaction_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS auctions_auction_code_unique ON auctions (auction_code) WHERE auction_code IS NOT NULL;

-- Set NOT NULL + DEFAULT for codes
ALTER TABLE orders ALTER COLUMN transaction_code SET DEFAULT ('TXN-' || nextval('transaction_code_seq'::regclass));
ALTER TABLE orders ALTER COLUMN transaction_code SET NOT NULL;
ALTER TABLE auctions ALTER COLUMN auction_code SET DEFAULT ('A-' || nextval('auction_code_seq'::regclass));
ALTER TABLE auctions ALTER COLUMN auction_code SET NOT NULL;

-- 8. ROW LEVEL SECURITY

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE seller_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE auctions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies (idempotent)
DO $$ BEGIN DROP POLICY IF EXISTS "users: self or admin can read" ON users; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "users: self can update own name" ON users; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "users: self can update own profile" ON users; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "shops: owner or admin" ON shops; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "products: shop owner can manage own, public can read approved" ON products; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "products: shop owner insert pending" ON products; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "bids: owner can read own, admin can read all" ON bids; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "bids: authenticated can insert own" ON bids; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "orders: buyer or admin" ON orders; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "notifications: owner" ON notifications; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "watchlists: owner" ON watchlists; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "reviews: public read" ON product_reviews; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "reviews: authenticated can insert own" ON product_reviews; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "auction_reminders: owner" ON auction_reminders; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "seller_applications_select_own" ON seller_applications; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "seller_applications_insert_auth" ON seller_applications; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "seller_applications_select_admin" ON seller_applications; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "seller_applications_update_admin" ON seller_applications; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "messages_select_own" ON messages; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "messages_insert_own" ON messages; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "messages_update_own" ON messages; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "audit_logs_select_admin" ON audit_logs; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "billing_records_select_own" ON billing_records; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "billing_records_select_admin" ON billing_records; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "billing_records_update_admin" ON billing_records; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "security_alerts_select_admin" ON security_alerts; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "security_alerts_update_admin" ON security_alerts; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "auctions_select_public" ON auctions; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Anyone can insert support_requests" ON support_requests; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "Admin can read support_requests" ON support_requests; EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- Create policies
CREATE POLICY "users: self or admin can read" ON users FOR SELECT USING (
  auth.uid() = id OR public.is_admin()
);
CREATE POLICY "users: self can update own profile" ON users FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Privileged-column guard (Priority 1 / C1): clients cannot self-escalate role/status/password/2FA.
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

CREATE POLICY "shops: owner or admin" ON shops FOR ALL USING (
  auth.uid() = user_id OR public.is_admin()
);

CREATE POLICY "products: shop owner can manage own, public can read approved" ON products FOR SELECT USING (
  status = 'approved'::product_status
  OR shop_id IN (SELECT id FROM shops WHERE user_id = auth.uid())
  OR public.is_admin()
);
CREATE POLICY "products: shop owner insert pending" ON products FOR INSERT WITH CHECK (
  shop_id IN (SELECT id FROM shops WHERE user_id = auth.uid())
);

CREATE POLICY "bids: owner can read own, admin can read all" ON bids FOR SELECT USING (
  auth.uid() = user_id OR public.is_admin()
);
CREATE POLICY "bids: authenticated can insert own" ON bids FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "orders: buyer or admin" ON orders FOR SELECT USING (
  auth.uid() = buyer_id OR public.is_admin()
);

CREATE POLICY "notifications: owner" ON notifications FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "watchlists: owner" ON watchlists FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "reviews: public read" ON product_reviews FOR SELECT USING (true);
CREATE POLICY "reviews: authenticated can insert own" ON product_reviews FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "auction_reminders: owner" ON auction_reminders FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "seller_applications_select_own" ON seller_applications FOR SELECT USING (auth.uid() = applicant_id);
CREATE POLICY "seller_applications_insert_auth" ON seller_applications FOR INSERT WITH CHECK (auth.uid() = applicant_id);
CREATE POLICY "seller_applications_select_admin" ON seller_applications FOR SELECT USING (public.is_admin());
CREATE POLICY "seller_applications_update_admin" ON seller_applications FOR UPDATE USING (public.is_admin());

CREATE POLICY "messages_select_own" ON messages FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);
CREATE POLICY "messages_insert_own" ON messages FOR INSERT WITH CHECK (auth.uid() = sender_id);
CREATE POLICY "messages_update_own" ON messages FOR UPDATE USING (auth.uid() = receiver_id);

CREATE POLICY "audit_logs_select_admin" ON audit_logs FOR SELECT USING (public.is_admin());

CREATE POLICY "billing_records_select_own" ON billing_records FOR SELECT USING (auth.uid() = seller_id);
CREATE POLICY "billing_records_select_admin" ON billing_records FOR SELECT USING (public.is_admin());
CREATE POLICY "billing_records_update_admin" ON billing_records FOR UPDATE USING (public.is_admin());

CREATE POLICY "security_alerts_select_admin" ON security_alerts FOR SELECT USING (public.is_admin());
CREATE POLICY "security_alerts_update_admin" ON security_alerts FOR UPDATE USING (public.is_admin());

CREATE POLICY "auctions_select_public" ON auctions FOR SELECT USING (true);

CREATE POLICY "Anyone can insert support_requests" ON support_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin can read support_requests" ON support_requests FOR SELECT USING (public.is_admin());

-- 9. GRANT EXECUTE for RLS helper
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- 10. SEED DEMO USERS (public.users rows — Auth users created separately via seedDemoUsers.js)
INSERT INTO users (id, name, email, password_hash, role, status) VALUES
('00000000-0000-0000-0000-000000000001', 'Maria Santos', 'maria.santos@email.com', 'supabase_auth', 'customer', 'active'),
('00000000-0000-0000-0000-000000000002', 'Golden Heritage Co.', 'contact@goldenheritage.ph', 'supabase_auth', 'shop_owner', 'active'),
('00000000-0000-0000-0000-000000000004', 'Admin User', 'admin@atany.ph', 'supabase_auth', 'admin', 'active')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, status=EXCLUDED.status;

-- 11. SEED SHOPS
INSERT INTO shops (user_id, shop_name, payout_method) VALUES
('00000000-0000-0000-0000-000000000002', 'Golden Heritage Co.', 'BDO Business Account')
ON CONFLICT DO NOTHING;

-- 12. SEED PRODUCTS
INSERT INTO products (shop_id, name, category, karat_weight, price, stock, status, description, image_url)
SELECT s.id, v.name, v.category, v.karat, v.price, v.stock, 'approved', v.name, v.img
FROM (SELECT id FROM shops WHERE user_id = '00000000-0000-0000-0000-000000000002' LIMIT 1) s
CROSS JOIN (VALUES
  ('Solitaire Diamond Ring','Rings','18K 3.1g',68000,4,'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=200&q=70'),
  ('Rose Gold Bangle','Bracelets','18K 12g',54000,1,'https://images.unsplash.com/photo-1611591437281-460bfbe1220a?auto=format&fit=crop&w=200&q=70'),
  ('Byzantine Gold Chain','Necklaces','21K 28g',132000,2,'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=200&q=70')
) AS v(name, category, karat, price, stock, img)
ON CONFLICT DO NOTHING;

-- 13. SEED AUCTIONS
INSERT INTO auctions (product_id, start_price, current_bid, status, start_time, end_time)
SELECT id, price, price + 6500, 'live', NOW() - INTERVAL '2 hours', NOW() + INTERVAL '2 hours'
FROM products WHERE name='Solitaire Diamond Ring' LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO auctions (product_id, start_price, current_bid, status, start_time, end_time)
SELECT id, price, price, 'scheduled', NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days'
FROM products WHERE name='Rose Gold Bangle' LIMIT 1
ON CONFLICT DO NOTHING;

-- Done!
SELECT 'Setup complete! Tables, RLS, functions, and seed data created.' AS result;
