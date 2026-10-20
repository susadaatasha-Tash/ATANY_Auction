-- backend/src/db/schema.sql
-- Spec 2: Core tables. Role enum is single users table per spec 3.
-- RLS per spec 5.4: enable on user-specific tables.

CREATE TYPE user_role AS ENUM ('customer','shop_owner','admin');
CREATE TYPE user_status AS ENUM ('active','suspended');
CREATE TYPE branch_status AS ENUM ('Open','Temporarily Closed');
CREATE TYPE product_status AS ENUM ('pending','approved','rejected');
CREATE TYPE auction_status AS ENUM ('scheduled','live','paused','ended');
CREATE TYPE order_status AS ENUM ('pending','ready_pickup','completed');
CREATE TYPE alert_severity AS ENUM ('low','medium','high');
CREATE TYPE alert_status AS ENUM ('new','investigating','resolved','dismissed');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'customer',
  status user_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  shop_name TEXT NOT NULL,
  payout_method TEXT,
  home_branch_id UUID REFERENCES branches(id)
);

CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  hours TEXT,
  phone TEXT,
  status branch_status NOT NULL DEFAULT 'Open'
);

CREATE TABLE products (
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

CREATE TABLE auctions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  start_price INTEGER NOT NULL,
  current_bid INTEGER NOT NULL DEFAULT 0,
  minimum_bid_increment INTEGER NOT NULL DEFAULT 1000,
  status auction_status NOT NULL DEFAULT 'scheduled',
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  paused_at TIMESTAMPTZ
);

CREATE TABLE bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID REFERENCES auctions(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  flagged BOOLEAN DEFAULT false,
  flag_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID REFERENCES auctions(id),
  buyer_id UUID REFERENCES users(id),
  amount INTEGER NOT NULL,
  branch_id UUID REFERENCES branches(id),
  status order_status NOT NULL DEFAULT 'pending',
  payment_method TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE security_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  type TEXT NOT NULL,
  severity alert_severity NOT NULL,
  status alert_status NOT NULL DEFAULT 'new',
  detail TEXT,
  activity_trail JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  auction_id UUID REFERENCES auctions(id) ON DELETE SET NULL
);

-- RLS (spec 5.4) — customers see own rows, shop owners see own shop's rows, admin bypasses via service_role
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_alerts ENABLE ROW LEVEL SECURITY;

-- Helper: auth.uid() = current user id (Supabase Auth)
CREATE POLICY "users: self or admin can read" ON users FOR SELECT USING (auth.uid() = id OR public.is_admin());
-- Self UPDATE: ownership only. Privileged columns (role/status/password/2FA/email/id)
-- are blocked by public.users_guard_privileged_columns() — see migration 028.
CREATE POLICY "users: self can update own profile" ON users FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
-- No INSERT policy for authenticated clients — public signup cannot create privileged rows.

CREATE POLICY "shops: owner or admin" ON shops FOR ALL USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "products: shop owner can manage own, public can read approved" ON products
  FOR SELECT USING (status = 'approved' OR shop_id IN (SELECT id FROM shops WHERE user_id = auth.uid()) OR public.is_admin());
CREATE POLICY "products: shop owner insert pending" ON products FOR INSERT WITH CHECK (shop_id IN (SELECT id FROM shops WHERE user_id = auth.uid()));

CREATE POLICY "bids: owner can read own, admin can read all" ON bids FOR SELECT USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "bids: authenticated can insert own" ON bids FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "orders: buyer or admin" ON orders FOR SELECT USING (auth.uid() = buyer_id OR public.is_admin());
CREATE POLICY "notifications: owner" ON notifications FOR ALL USING (auth.uid() = user_id);

-- Branches are public read (spec 4.5: feeds GPS locator without auth), admin-only write enforced via backend requireRole, not RLS

-- === Extensions (beyond spec) for d) ===
CREATE TABLE watchlists (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE favorites (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE product_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (product_id, user_id)
);

-- "Notify Me" subscriptions for scheduled auctions (separate from watchlists).
-- Used by reminder.controller.js and auctionStarter.js.
CREATE TABLE auction_reminders (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  auction_id UUID REFERENCES auctions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, auction_id)
);

-- Optional 2FA (TOTP) — per user, opt-in. Secret stored encrypted server-side (spec 5.6).
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN DEFAULT false;

-- Watchlists + reviews RLS
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "watchlists: owner" ON watchlists FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "favorites: owner" ON favorites FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "reviews: public read" ON product_reviews FOR SELECT USING (true);
CREATE POLICY "reviews: authenticated can insert own" ON product_reviews FOR INSERT WITH CHECK (auth.uid() = user_id);

ALTER TABLE auction_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auction_reminders: owner" ON auction_reminders FOR ALL USING (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════
-- Production readiness parity (migrations 015–029) — fresh installs
-- ═══════════════════════════════════════════════════════════════

-- C1 privilege guard (migration 028) — trigger blocks role/status/password/2FA self-escalation
CREATE OR REPLACE FUNCTION public.users_guard_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
  IF trusted THEN RETURN NEW; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'users.id cannot be changed by client update'; END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN RAISE EXCEPTION 'users.email cannot be changed by client update'; END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN RAISE EXCEPTION 'users.role cannot be changed by client update'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'users.status cannot be changed by client update'; END IF;
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN RAISE EXCEPTION 'users.password_hash cannot be changed by client update'; END IF;
  IF NEW.totp_secret IS DISTINCT FROM OLD.totp_secret OR NEW.totp_enabled IS DISTINCT FROM OLD.totp_enabled THEN
    RAISE EXCEPTION 'users 2FA fields cannot be changed by client update';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_users_guard_privileged ON public.users;
CREATE TRIGGER trg_users_guard_privileged
  BEFORE UPDATE ON public.users FOR EACH ROW
  EXECUTE FUNCTION public.users_guard_privileged_columns();

-- Orders winner tracking (migration 021)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS winner_confirmed_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_deadline TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS winner_rank INTEGER DEFAULT 1;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS transaction_code TEXT;
ALTER TABLE auctions ADD COLUMN IF NOT EXISTS auction_code TEXT;

-- Payments (migration 015) — payment status separated from order fulfillment
DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('pending','processing','paid','failed','cancelled','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'paymongo',
  provider_reference_id TEXT,
  checkout_session_id TEXT,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PHP',
  payment_method TEXT,
  status payment_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  metadata JSONB
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_paid_per_order ON payments(order_id) WHERE status = 'paid';

-- Billing records — plan/interval columns (migrations 012,016,017,025,026)
CREATE TABLE IF NOT EXISTS billing_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  billing_period TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
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
CREATE INDEX IF NOT EXISTS idx_billing_records_seller ON billing_records(seller_id);
CREATE INDEX IF NOT EXISTS idx_billing_records_plan_code ON billing_records(plan_code) WHERE plan_code IS NOT NULL;
ALTER TABLE billing_records ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "billing_records_select_own" ON billing_records; EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN DROP POLICY IF EXISTS "billing_records_select_admin" ON billing_records; EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE POLICY "billing_records_select_own" ON billing_records FOR SELECT USING (auth.uid() = seller_id);
CREATE POLICY "billing_records_select_admin" ON billing_records FOR SELECT USING (public.is_admin());

-- Subscription changes (migration 026)
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
ALTER TABLE public.subscription_changes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS subscription_changes_select_own ON public.subscription_changes; EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE POLICY subscription_changes_select_own ON public.subscription_changes
  FOR SELECT USING (auth.uid() = seller_id);

-- Seller payment methods (migration 026) — provider ids only, no PAN
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
ALTER TABLE public.seller_payment_methods ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS seller_payment_methods_select_own ON public.seller_payment_methods; EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE POLICY seller_payment_methods_select_own ON public.seller_payment_methods
  FOR SELECT USING (auth.uid() = seller_id);

-- Billing FK hardening (migration 027)
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

