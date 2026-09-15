-- 014_davao_branch_setup.sql
-- Set up 3 Davao City branches for multi-branch testing
-- All branches located in Davao City, Philippines

-- ================================================================
-- 1. CREATE/UPDATE BRANCHES (all Davao City)
-- ================================================================

-- Gmall Branch (replaces/updates existing Davao City — Victoria Plaza branch)
INSERT INTO branches (id, name, address, lat, lng, hours, phone, status) VALUES
('2af5d27d-13d6-4743-99dd-e4e675002c1b', 'Gmall Branch', 'Gmall Davao, J.P. Laurel Ave, Davao City', 7.0917, 125.6114, 'Mon–Sat · 9:00 AM – 6:00 PM', '(082) 224-6500', 'Open')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, address=EXCLUDED.address, lat=EXCLUDED.lat, lng=EXCLUDED.lng, hours=EXCLUDED.hours, phone=EXCLUDED.phone, status=EXCLUDED.status;

-- Abreeza Branch
INSERT INTO branches (id, name, address, lat, lng, hours, phone, status) VALUES
('d4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a', 'Abreeza Branch', 'Abreeza Mall, JP Laurel Ave, Davao City', 7.0833, 125.6042, 'Mon–Sun · 10:00 AM – 9:00 PM', '(082) 221-5200', 'Open')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, address=EXCLUDED.address, lat=EXCLUDED.lat, lng=EXCLUDED.lng, hours=EXCLUDED.hours, phone=EXCLUDED.phone, status=EXCLUDED.status;

-- SM Lanang Branch
INSERT INTO branches (id, name, address, lat, lng, hours, phone, status) VALUES
('e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b', 'SM Lanang Branch', 'SM City Lanang, JP Laurel Ave, Davao City', 7.0756, 125.5972, 'Mon–Sun · 10:00 AM – 9:00 PM', '(082) 285-1100', 'Open')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, address=EXCLUDED.address, lat=EXCLUDED.lat, lng=EXCLUDED.lng, hours=EXCLUDED.hours, phone=EXCLUDED.phone, status=EXCLUDED.status;

-- ================================================================
-- 2. UPDATE EXISTING GOLDEN HERITAGE SHOP → GMALL BRANCH
-- ================================================================

-- Update Golden Heritage Co. shop to link to Gmall Branch
UPDATE shops SET home_branch_id = '2af5d27d-13d6-4743-99dd-e4e675002c1b'
WHERE user_id = '00000000-0000-0000-0000-000000000002';

-- Update shop name to reflect Gmall Branch
UPDATE shops SET shop_name = 'Golden Heritage — Gmall'
WHERE user_id = '00000000-0000-0000-0000-000000000002';

-- Update user name
UPDATE users SET name = 'Golden Heritage — Gmall'
WHERE id = '00000000-0000-0000-0000-000000000002';

-- ================================================================
-- 3. CREATE ABREEZA SHOP OWNER
-- ================================================================

-- User account
INSERT INTO users (id, name, email, password_hash, role, status) VALUES
('00000000-0000-0000-0000-000000000005', 'Golden Heritage — Abreeza', 'abreeza@goldenheritage.ph', 'supabase_auth', 'shop_owner', 'active')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email, role=EXCLUDED.role, status=EXCLUDED.status;

-- Shop linked to Abreeza Branch
INSERT INTO shops (id, user_id, shop_name, home_branch_id) VALUES
('55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000005', 'Golden Heritage — Abreeza', 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a')
ON CONFLICT (id) DO UPDATE SET shop_name=EXCLUDED.shop_name, home_branch_id=EXCLUDED.home_branch_id;

-- ================================================================
-- 4. CREATE SM LANANG SHOP OWNER
-- ================================================================

-- User account
INSERT INTO users (id, name, email, password_hash, role, status) VALUES
('00000000-0000-0000-0000-000000000006', 'Golden Heritage — SM Lanang', 'smlanang@goldenheritage.ph', 'supabase_auth', 'shop_owner', 'active')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, email=EXCLUDED.email, role=EXCLUDED.role, status=EXCLUDED.status;

-- Shop linked to SM Lanang Branch
INSERT INTO shops (id, user_id, shop_name, home_branch_id) VALUES
('66666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000006', 'Golden Heritage — SM Lanang', 'e5f6a7b8-c9d0-4e1f-2a3b-4c5d6e7f8a9b')
ON CONFLICT (id) DO UPDATE SET shop_name=EXCLUDED.shop_name, home_branch_id=EXCLUDED.home_branch_id;

-- ================================================================
-- 5. SET CUSTOMER PREFERRED BRANCH → GMALL (default for testing)
-- ================================================================

UPDATE users SET preferred_branch_id = '2af5d27d-13d6-4743-99dd-e4e675002c1b'
WHERE id = '00000000-0000-0000-0000-000000000001';

-- ================================================================
-- 6. CREATE TEST PRODUCTS FOR EACH BRANCH
-- ================================================================

-- Products for Gmall Branch (shop_id from Golden Heritage)
INSERT INTO products (id, shop_id, name, category, karat_weight, price, stock, status, description, image_url) VALUES
('a1000000-0000-0000-0000-000000000001', (SELECT id FROM shops WHERE user_id='00000000-0000-0000-0000-000000000002'), 'Gmall Diamond Solitaire', 'Rings', '18K · 3.1g', 68000, 4, 'approved', 'Classic solitaire diamond ring', 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=200&q=70'),
('a1000000-0000-0000-0000-000000000002', (SELECT id FROM shops WHERE user_id='00000000-0000-0000-0000-000000000002'), 'Gmall Rose Gold Bangle', 'Bracelets', '18K · 12g', 54000, 2, 'approved', 'Elegant rose gold bangle', 'https://images.unsplash.com/photo-1611591437281-460bfbe1220a?auto=format&fit=crop&w=200&q=70')
ON CONFLICT (id) DO NOTHING;

-- Products for Abreeza Branch
INSERT INTO products (id, shop_id, name, category, karat_weight, price, stock, status, description, image_url) VALUES
('a2000000-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'Abreeza Pearl Pendant', 'Necklaces', '14K · 8g', 42000, 3, 'approved', 'Freshwater pearl pendant', 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=200&q=70'),
('a2000000-0000-0000-0000-000000000002', '55555555-5555-5555-5555-555555555555', 'Abreeza Gold Hoops', 'Earrings', '14K · 4g', 32000, 5, 'approved', 'Classic gold hoop earrings', 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=200&q=70')
ON CONFLICT (id) DO NOTHING;

-- Products for SM Lanang Branch
INSERT INTO products (id, shop_id, name, category, karat_weight, price, stock, status, description, image_url) VALUES
('a3000000-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666', 'SM Lanang Tennis Bracelet', 'Bracelets', '18K · 15g', 78000, 2, 'approved', 'Diamond tennis bracelet', 'https://images.unsplash.com/photo-1611591437281-460bfbe1220a?auto=format&fit=crop&w=200&q=70'),
('a3000000-0000-0000-0000-000000000002', '66666666-6666-6666-6666-666666666666', 'SM Lanang Sapphire Ring', 'Rings', '21K · 5g', 95000, 1, 'approved', 'Blue sapphire gold ring', 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=200&q=70')
ON CONFLICT (id) DO NOTHING;

-- ================================================================
-- 7. CREATE TEST AUCTIONS FOR EACH BRANCH
-- ================================================================

-- Gmall Branch: LIVE auction
INSERT INTO auctions (id, product_id, start_price, current_bid, status, start_time, end_time) VALUES
('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 68000, 70000, 'live', NOW() - INTERVAL '2 hours', NOW() + INTERVAL '6 hours')
ON CONFLICT (id) DO UPDATE SET status='live', end_time=NOW() + INTERVAL '6 hours';

-- Gmall Branch: SCHEDULED auction
INSERT INTO auctions (id, product_id, start_price, current_bid, status, start_time, end_time) VALUES
('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', 54000, 54000, 'scheduled', NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days')
ON CONFLICT (id) DO UPDATE SET status='scheduled', start_time=NOW() + INTERVAL '1 day', end_time=NOW() + INTERVAL '2 days';

-- Abreeza Branch: LIVE auction
INSERT INTO auctions (id, product_id, start_price, current_bid, status, start_time, end_time) VALUES
('b2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 42000, 44000, 'live', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '5 hours')
ON CONFLICT (id) DO UPDATE SET status='live', end_time=NOW() + INTERVAL '5 hours';

-- Abreeza Branch: SCHEDULED auction
INSERT INTO auctions (id, product_id, start_price, current_bid, status, start_time, end_time) VALUES
('b2000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000002', 32000, 32000, 'scheduled', NOW() + INTERVAL '2 days', NOW() + INTERVAL '3 days')
ON CONFLICT (id) DO UPDATE SET status='scheduled', start_time=NOW() + INTERVAL '2 days', end_time=NOW() + INTERVAL '3 days';

-- SM Lanang Branch: LIVE auction
INSERT INTO auctions (id, product_id, start_price, current_bid, status, start_time, end_time) VALUES
('b3000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 78000, 80000, 'live', NOW() - INTERVAL '30 minutes', NOW() + INTERVAL '7 hours')
ON CONFLICT (id) DO UPDATE SET status='live', end_time=NOW() + INTERVAL '7 hours';

-- SM Lanang Branch: SCHEDULED auction
INSERT INTO auctions (id, product_id, start_price, current_bid, status, start_time, end_time) VALUES
('b3000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000002', 95000, 95000, 'scheduled', NOW() + INTERVAL '3 days', NOW() + INTERVAL '4 days')
ON CONFLICT (id) DO UPDATE SET status='scheduled', start_time=NOW() + INTERVAL '3 days', end_time=NOW() + INTERVAL '4 days';

-- ================================================================
-- 8. VERIFY
-- ================================================================
-- Run these to verify:
-- SELECT u.email, u.role, s.shop_name, b.name as branch FROM users u JOIN shops s ON s.user_id=u.id JOIN branches b ON b.id=s.home_branch_id WHERE u.role='shop_owner';
-- SELECT a.status, p.name, b.name as branch FROM auctions a JOIN products p ON p.id=a.product_id JOIN shops s ON s.id=p.shop_id JOIN branches b ON b.id=s.home_branch_id ORDER BY b.name, a.status;
