-- ═══════════════════════════════════════════════════════════════
-- Migration 013: Property Code System
-- Adds a unique, human-friendly property code (e.g. RE8F2KQ1)
-- ═══════════════════════════════════════════════════════════════

-- 1. Add the column
ALTER TABLE properties ADD COLUMN IF NOT EXISTS property_code TEXT UNIQUE;

-- 2. Create a function to generate unique codes
CREATE OR REPLACE FUNCTION generate_property_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result TEXT := 'RE';
  i INT;
  code_exists BOOLEAN;
BEGIN
  LOOP
    result := 'RE';
    FOR i IN 1..6 LOOP
      result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;

    SELECT EXISTS(SELECT 1 FROM properties WHERE property_code = result) INTO code_exists;
    IF NOT code_exists THEN
      RETURN result;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 3. Backfill existing properties that have no code
DO $$
DECLARE
  prop RECORD;
BEGIN
  FOR prop IN SELECT id FROM properties WHERE property_code IS NULL
  LOOP
    UPDATE properties SET property_code = generate_property_code() WHERE id = prop.id;
  END LOOP;
END $$;

-- 4. Make the column NOT NULL now that all rows are populated
ALTER TABLE properties ALTER COLUMN property_code SET NOT NULL;

-- 5. Add a default so new inserts auto-generate if not provided
ALTER TABLE properties ALTER COLUMN property_code SET DEFAULT generate_property_code();

-- 6. Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_properties_property_code ON properties (property_code);
