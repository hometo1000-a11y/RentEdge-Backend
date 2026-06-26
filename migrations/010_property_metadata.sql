-- 010_property_metadata.sql

-- TABLE: property_amenities
CREATE TABLE IF NOT EXISTS property_amenities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  amenity_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- TABLE: property_highlights
CREATE TABLE IF NOT EXISTS property_highlights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  highlight_text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ALTER TABLE properties for location metadata
ALTER TABLE properties
ADD COLUMN IF NOT EXISTS locality VARCHAR(255),
ADD COLUMN IF NOT EXISTS landmark VARCHAR(255),
ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
ADD COLUMN IF NOT EXISTS furnishing_status VARCHAR(50),
ADD COLUMN IF NOT EXISTS property_condition VARCHAR(50);
