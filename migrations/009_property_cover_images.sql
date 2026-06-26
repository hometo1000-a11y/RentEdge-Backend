-- 009_property_cover_images.sql
-- Add is_cover column to property_images to manage cover images

ALTER TABLE property_images
ADD COLUMN IF NOT EXISTS is_cover BOOLEAN DEFAULT FALSE;
