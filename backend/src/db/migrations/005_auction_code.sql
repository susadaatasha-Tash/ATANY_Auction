-- 005_auction_code.sql
-- Human-readable auction ID for admin/staff reference (A-701, A-702, etc.)
-- Keeps UUID as primary key for FK integrity; auction_code is display-only UNIQUE.

CREATE SEQUENCE IF NOT EXISTS auction_code_seq START 701;

ALTER TABLE auctions ADD COLUMN IF NOT EXISTS auction_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS auctions_auction_code_unique ON auctions (auction_code) WHERE auction_code IS NOT NULL;

-- Backfill existing rows ordered by start_time (oldest first -> A-701)
DO $$
DECLARE
  r RECORD;
  code TEXT;
BEGIN
  FOR r IN SELECT id FROM auctions WHERE auction_code IS NULL ORDER BY start_time ASC, id ASC LOOP
    SELECT 'A-' || nextval('auction_code_seq') INTO code;
    UPDATE auctions SET auction_code = code WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE auctions ALTER COLUMN auction_code SET DEFAULT ('A-' || nextval('auction_code_seq'::regclass));

CREATE OR REPLACE FUNCTION set_auction_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.auction_code IS NULL OR NEW.auction_code = '' THEN
    NEW.auction_code := 'A-' || nextval('auction_code_seq');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auctions_auction_code_trigger ON auctions;
CREATE TRIGGER auctions_auction_code_trigger BEFORE INSERT ON auctions FOR EACH ROW EXECUTE FUNCTION set_auction_code();

ALTER TABLE auctions ALTER COLUMN auction_code SET NOT NULL;
