-- 004_transaction_code.sql
-- Human-readable transaction ID for admin/staff reference (TXN-9001, TXN-9002, etc.)
-- Keeps UUID as primary key for FK integrity; transaction_code is display-only UNIQUE.

CREATE SEQUENCE IF NOT EXISTS transaction_code_seq START 9001;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS transaction_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS orders_transaction_code_unique ON orders (transaction_code) WHERE transaction_code IS NOT NULL;

-- Backfill existing rows ordered by created_at (oldest first -> TXN-9001)
DO $$
DECLARE
  r RECORD;
  code TEXT;
BEGIN
  FOR r IN SELECT id FROM orders WHERE transaction_code IS NULL ORDER BY created_at ASC LOOP
    SELECT 'TXN-' || nextval('transaction_code_seq') INTO code;
    UPDATE orders SET transaction_code = code WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE orders ALTER COLUMN transaction_code SET DEFAULT ('TXN-' || nextval('transaction_code_seq'::regclass));

CREATE OR REPLACE FUNCTION set_transaction_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.transaction_code IS NULL OR NEW.transaction_code = '' THEN
    NEW.transaction_code := 'TXN-' || nextval('transaction_code_seq');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_transaction_code_trigger ON orders;
CREATE TRIGGER orders_transaction_code_trigger BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION set_transaction_code();

ALTER TABLE orders ALTER COLUMN transaction_code SET NOT NULL;
