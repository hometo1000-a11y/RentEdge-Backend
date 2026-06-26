-- 007_update_properties_schema.sql
-- Update properties schema to match backend expectations (merging 001 and 006 intentions)

ALTER TABLE properties
  DROP COLUMN IF EXISTS images,
  DROP COLUMN IF EXISTS amenities,
  DROP COLUMN IF EXISTS is_active;

ALTER TABLE properties RENAME COLUMN title TO property_name;
ALTER TABLE properties RENAME COLUMN rent TO rent_amount;
ALTER TABLE properties RENAME COLUMN deposit TO deposit_amount;
ALTER TABLE properties RENAME COLUMN beds TO bedrooms;
ALTER TABLE properties RENAME COLUMN baths TO bathrooms;

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS maintenance_amount DECIMAL(12, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';

ALTER TABLE properties
  ALTER COLUMN area_sqft TYPE DECIMAL(10, 2);
