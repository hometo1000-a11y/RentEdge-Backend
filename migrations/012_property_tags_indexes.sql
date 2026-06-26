-- 012_property_tags_indexes.sql

-- Add UNIQUE constraint to prevent duplicate tags for a single property
ALTER TABLE property_tags
DROP CONSTRAINT IF EXISTS unique_property_tag;

ALTER TABLE property_tags
ADD CONSTRAINT unique_property_tag UNIQUE (property_id, tag_name);

-- Add index on tag_name for future filtering
CREATE INDEX IF NOT EXISTS idx_property_tags_tag_name ON property_tags(tag_name);

-- Index on property_id should also be added if not already created automatically
CREATE INDEX IF NOT EXISTS idx_property_tags_property_id ON property_tags(property_id);
