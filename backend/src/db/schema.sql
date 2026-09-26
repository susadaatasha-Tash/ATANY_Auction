-- backend/src/db/schema.sql
-- Spec 2: Core tables. Role enum is single users table per spec 3.
-- RLS per spec 5.4: enable on user-specific tables.

CREATE TYPE user_role AS ENUM ('customer','shop_owner','admin');
CREATE TYPE user_status AS ENUM ('active','suspended');
CREATE TYPE branch_status AS ENUM ('Open','Temporarily Closed');
CREATE TYPE product_status AS ENUM ('pending','approved','rejected');
CREATE TYPE auction_status AS ENUM ('scheduled','live','ended');
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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE auctions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  start_price INTEGER NOT NULL,
  current_bid INTEGER NOT NULL DEFAULT 0,
  status auction_status NOT NULL DEFAULT 'scheduled',
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL
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
CREATE POLICY "users: self can update own name" ON users FOR UPDATE USING (auth.uid() = id);

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
