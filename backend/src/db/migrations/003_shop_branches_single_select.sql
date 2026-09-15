-- 003_shop_branches_single_select.sql
-- Repeatable seed for branch assignments (spec: 5 Davao branches, one per shop, single-select via shops.home_branch_id)
-- 1. Ensure Victoria Plaza Branch exists with spec coords
INSERT INTO branches (id, name, address, lat, lng, status) VALUES
('2af5d27d-13d6-4743-99dd-e4e675002c1b', 'Davao City — Victoria Plaza', 'Victoria Plaza Area, J.P. Laurel Ave, Davao City', 7.0736, 125.6128, 'Open')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, address=EXCLUDED.address, lat=EXCLUDED.lat, lng=EXCLUDED.lng, status=EXCLUDED.status;

-- 2. Golden Heritage Co. → Victoria Plaza (single branch, remove others)
UPDATE shops SET home_branch_id = '2af5d27d-13d6-4743-99dd-e4e675002c1b'
WHERE shop_name = 'Golden Heritage Co.';

-- If shop_branches junction exists, ensure single row per shop (migrate from home_branch_id if needed)
-- CREATE TABLE IF NOT EXISTS shop_branches (shop_id UUID REFERENCES shops(id) ON DELETE CASCADE, branch_id UUID REFERENCES branches(id) ON DELETE CASCADE, PRIMARY KEY (shop_id, branch_id));
-- DELETE FROM shop_branches WHERE shop_id IN (SELECT id FROM shops WHERE shop_name='Golden Heritage Co.');
-- INSERT INTO shop_branches (shop_id, branch_id) SELECT id, home_branch_id FROM shops WHERE shop_name='Golden Heritage Co.' ON CONFLICT DO NOTHING;

-- 3. Second demo shop owner → Matina Branch (via auth + shops + products)
-- Auth user will be created via seedDemoUsers.js or Supabase Auth; this handles public.users + shops
INSERT INTO users (id, name, email, password_hash, role, status) VALUES
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Second Jewelers Co.', 'contact@secondjewelers.ph', 'hashed_dummy', 'shop_owner', 'active')
ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role;

INSERT INTO shops (id, user_id, shop_name, home_branch_id) VALUES
('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Second Jewelers Co.', '15b7f876-58e0-479d-b05e-02abddcf5d2b')
ON CONFLICT (id) DO UPDATE SET home_branch_id = EXCLUDED.home_branch_id;

-- Seed 2-3 approved products for Second Jewelers (branch_id via shop home_branch)
INSERT INTO products (id, shop_id, name, category, karat_weight, price, stock, status, description, image_url) VALUES
('b1111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'Matina Pearl Necklace', 'Necklaces', '18K · 12g', 75000, 3, 'approved', 'Freshwater pearls', 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=200&q=70'),
('b2222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', 'Matina Gold Hoops', 'Earrings', '14K · 4g', 32000, 5, 'approved', 'Classic hoops', 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=200&q=70')
ON CONFLICT (id) DO NOTHING;

-- At least one live auction for testing
INSERT INTO auctions (id, product_id, start_price, current_bid, status, start_time, end_time) VALUES
('c1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', 70000, 70000, 'live', NOW() - INTERVAL '1 hour', NOW() + INTERVAL '6 hours')
ON CONFLICT (id) DO UPDATE SET status='live', end_time=NOW() + INTERVAL '6 hours';

-- Verify
-- SELECT s.shop_name, b.name as branch FROM shops s JOIN branches b ON b.id=s.home_branch_id WHERE s.shop_name IN ('Golden Heritage Co.','Second Jewelers Co.');
