-- Phase B: Property Data Model Refactor

-- 1. Create property_details table
CREATE TABLE IF NOT EXISTS property_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast property lookup
CREATE INDEX IF NOT EXISTS idx_property_details_property_id ON property_details(property_id);
-- GIN index for fast JSONB querying
CREATE INDEX IF NOT EXISTS idx_property_details_details ON property_details USING GIN (details);

-- 2. Add new columns to properties
ALTER TABLE properties
ADD COLUMN IF NOT EXISTS short_description VARCHAR(200),
ADD COLUMN IF NOT EXISTS full_description VARCHAR(5000),
ADD COLUMN IF NOT EXISTS occupancy_type VARCHAR(50) DEFAULT 'Any';

-- 3. Data Migration (Backfill)
DO $$
DECLARE
    r RECORD;
    v_details JSONB;
    v_short_desc VARCHAR(200);
BEGIN
    FOR r IN SELECT id, description, property_type, bedrooms, area_sqft FROM properties LOOP
        
        -- Safe substring for short description
        IF r.description IS NOT NULL THEN
            IF LENGTH(r.description) > 197 THEN
                v_short_desc := SUBSTRING(r.description, 1, 197) || '...';
            ELSE
                v_short_desc := r.description;
            END IF;
        ELSE
            v_short_desc := '';
        END IF;

        UPDATE properties
        SET 
            full_description = COALESCE(r.description, ''),
            short_description = v_short_desc
        WHERE id = r.id;
        
        -- Build JSONB details based on property type
        IF r.property_type IN ('Apartment', 'House', 'Villa') THEN
            v_details := jsonb_build_object(
                'bhk', COALESCE(r.bedrooms, 1),
                'built_up_area', COALESCE(r.area_sqft, 0)
            );
        ELSIF r.property_type = 'PG' THEN
            v_details := jsonb_build_object();
        ELSIF r.property_type = 'Commercial' THEN
            v_details := jsonb_build_object(
                'commercial_area', COALESCE(r.area_sqft, 0)
            );
        ELSE
            v_details := '{}'::jsonb;
        END IF;

        -- Insert if not exists (rerunnable)
        IF NOT EXISTS (SELECT 1 FROM property_details WHERE property_id = r.id) THEN
            INSERT INTO property_details (property_id, details)
            VALUES (r.id, v_details);
        END IF;
    END LOOP;
END $$;

-- 4. Drop deprecated columns
ALTER TABLE properties
DROP COLUMN IF EXISTS description,
DROP COLUMN IF EXISTS bedrooms,
DROP COLUMN IF EXISTS bathrooms,
DROP COLUMN IF EXISTS area_sqft,
DROP COLUMN IF EXISTS latitude,
DROP COLUMN IF EXISTS longitude,
DROP COLUMN IF EXISTS furnishing_status,
DROP COLUMN IF EXISTS property_condition;
