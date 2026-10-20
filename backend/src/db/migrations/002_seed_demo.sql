-- Seed demo users (passwords are Supabase Auth hashes — create via supabase.auth.admin.createUser in practice; these are placeholders)
-- Roles per spec 3: customer, shop_owner, manager, admin
INSERT INTO users (id, name, email, role, status) VALUES
('00000000-0000-0000-0000-000000000001', 'Maria Santos', 'maria.santos@email.com', 'customer', 'active'),
('00000000-0000-0000-0000-000000000002', 'Golden Heritage Co.', 'contact@goldenheritage.ph', 'shop_owner', 'active'),
('00000000-0000-0000-0000-000000000003', 'Jill Martinez', 'jill.m@atany.ph', 'manager', 'active')
ON CONFLICT (email) DO NOTHING;

INSERT INTO shops (user_id, shop_name, payout_method) VALUES
('00000000-0000-0000-0000-000000000002', 'Golden Heritage Co.', 'BDO Business Account')
ON CONFLICT DO NOTHING;

-- Demo products (mirrors admin.html:1330 mock)
INSERT INTO products (shop_id, name, category, karat_weight, price, stock, status, description, image_url)
SELECT s.id, v.name, v.category, v.karat, v.price, v.stock, 'approved', v.name, v.img
FROM (SELECT id FROM shops LIMIT 1) s
CROSS JOIN (VALUES
  ('Solitaire Diamond Ring','Rings','18K · 3.1g',68000,4,'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=200&q=70'),
  ('Rose Gold Bangle','Bracelets','18K · 12g',54000,1,'https://images.unsplash.com/photo-1611591437281-460bfbe1220a?auto=format&fit=crop&w=200&q=70'),
  ('Byzantine Gold Chain','Necklaces','21K · 28g',132000,2,'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=200&q=70')
) AS v(name, category, karat, price, stock, img)
ON CONFLICT DO NOTHING;

-- Auctions: one live, one scheduled, one ended (covers all badge variants)
INSERT INTO auctions (product_id, start_price, current_bid, status, start_time, end_time)
SELECT id, price, price + 6500, 'live', NOW() - INTERVAL '2 hours', NOW() + INTERVAL '2 hours' FROM products WHERE name='Solitaire Diamond Ring' LIMIT 1;

INSERT INTO auctions (product_id, start_price, current_bid, status, start_time, end_time)
SELECT id, price, price, 'scheduled', NOW() + INTERVAL '1 day', NOW() + INTERVAL '2 days' FROM products WHERE name='Rose Gold Bangle' LIMIT 1;
