CREATE TABLE IF NOT EXISTS favorites (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, product_id)
);
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS "favorites: owner" ON favorites; EXCEPTION WHEN undefined_object THEN NULL; END $$;
CREATE POLICY "favorites: owner" ON favorites FOR ALL USING (auth.uid() = user_id);
