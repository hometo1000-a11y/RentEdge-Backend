-- Phase 1: Property Discovery Indexes & Pioneer Gamification

-- Add Pioneer Gamification Flag
ALTER TABLE properties ADD COLUMN IF NOT EXISTS is_city_pioneer BOOLEAN DEFAULT FALSE;

-- Add TSVector column for full-text search (address, locality, city)
ALTER TABLE properties ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Create function to update search_vector automatically
CREATE OR REPLACE FUNCTION update_property_search_vector() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.property_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.city, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.locality, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.address, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.short_description, '')), 'D');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- Create trigger to keep search_vector updated
DROP TRIGGER IF EXISTS trg_update_search_vector ON properties;
CREATE TRIGGER trg_update_search_vector
BEFORE INSERT OR UPDATE ON properties
FOR EACH ROW EXECUTE FUNCTION update_property_search_vector();

-- Update existing rows to populate the vector
UPDATE properties SET search_vector = 
    setweight(to_tsvector('english', coalesce(property_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(city, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(locality, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(address, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(short_description, '')), 'D');

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_properties_search_vector ON properties USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_properties_city_status ON properties(city, status);
CREATE INDEX IF NOT EXISTS idx_properties_rent ON properties(rent_amount);
CREATE INDEX IF NOT EXISTS idx_properties_type ON properties(property_type);
CREATE INDEX IF NOT EXISTS idx_properties_occupancy ON properties(occupancy_type);
