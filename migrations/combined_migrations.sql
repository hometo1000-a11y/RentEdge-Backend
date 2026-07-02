-- ============================================================================
-- Combined migration script
-- Source files are concatenated in numeric order from 001 through 022.
-- ============================================================================

-- ============================================================================
-- 001_initial_schema.sql
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid  TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT NOT NULL UNIQUE,
  is_tenant     BOOLEAN DEFAULT FALSE,
  is_owner      BOOLEAN DEFAULT FALSE,
  email_verified BOOLEAN DEFAULT FALSE,
  phone_verified BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS properties (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  address       TEXT,
  city          TEXT,
  state         TEXT,
  pincode       TEXT,
  property_type TEXT,
  beds          INT DEFAULT 1,
  baths         INT DEFAULT 1,
  area_sqft     INT,
  rent          NUMERIC(12,2),
  deposit       NUMERIC(12,2),
  images        JSONB DEFAULT '[]'::jsonb,
  amenities     JSONB DEFAULT '[]'::jsonb,
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
  property_id   UUID REFERENCES properties(id) ON DELETE SET NULL,
  lease_start   DATE,
  lease_end     DATE,
  monthly_rent  NUMERIC(12,2),
  status        TEXT DEFAULT 'active',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leases (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   UUID REFERENCES properties(id) ON DELETE CASCADE,
  tenant_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  owner_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  unit_index    INT DEFAULT 1,
  code          TEXT,
  status        TEXT DEFAULT 'pending',
  start_date    DATE,
  end_date      DATE,
  rent_amount   NUMERIC(12,2),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id      UUID REFERENCES leases(id) ON DELETE SET NULL,
  tenant_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  owner_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  amount        NUMERIC(12,2) NOT NULL,
  method        TEXT,
  status        TEXT DEFAULT 'pending',
  paid_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 002_add_firebase_uid.sql
-- ============================================================================
-- Migration 002: Add firebase_uid to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid TEXT;

-- ============================================================================
-- 003_firebase_auth_cleanup.sql
-- ============================================================================
-- Migration 003: Firebase Auth Cleanup
-- Remove legacy Supabase Auth column (auth_id)
-- Enforce firebase_uid as the primary identity key

-- 1. Drop the UNIQUE constraint on auth_id (if it exists)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_auth_id_key;

-- 2. Drop the auth_id column (if it exists)
ALTER TABLE users DROP COLUMN IF EXISTS auth_id;

-- 3. Make firebase_uid NOT NULL (set a default for any NULL rows first)
UPDATE users SET firebase_uid = 'MISSING_' || id::text WHERE firebase_uid IS NULL;
ALTER TABLE users ALTER COLUMN firebase_uid SET NOT NULL;

-- 4. Add UNIQUE constraint on firebase_uid (idempotent via IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_firebase_uid_key'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_firebase_uid_key UNIQUE (firebase_uid);
  END IF;
END $$;

-- ============================================================================
-- 004_owner_payment_info.sql
-- ============================================================================
CREATE TABLE IF NOT EXISTS owner_payment_info (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_holder_name TEXT,
    bank_account_number TEXT,
    ifsc_code TEXT,
    upi_id TEXT,
    bank_verified BOOLEAN DEFAULT FALSE,
    verification_status TEXT DEFAULT 'pending',
    penny_drop_reference TEXT,
    payment_provider TEXT,
    provider_account_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

-- ============================================================================
-- 005_remove_password_hash.sql
-- ============================================================================
-- Migration 005: Remove legacy password storage
-- Firebase Auth is now the sole authority for authentication and password management.

ALTER TABLE users
DROP COLUMN IF EXISTS password_hash;

-- ============================================================================
-- 006_property_management.sql
-- ============================================================================
-- 006_property_management.sql

-- TABLE: properties
CREATE TABLE IF NOT EXISTS properties (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_name VARCHAR(255) NOT NULL,
  property_type VARCHAR(50) NOT NULL,
  description TEXT,
  address TEXT NOT NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  pincode VARCHAR(20) NOT NULL,
  rent_amount DECIMAL(12, 2) NOT NULL,
  deposit_amount DECIMAL(12, 2) NOT NULL,
  maintenance_amount DECIMAL(12, 2) DEFAULT 0,
  area_sqft DECIMAL(10, 2),
  bedrooms INTEGER DEFAULT 1,
  bathrooms INTEGER DEFAULT 1,
  cover_image_url TEXT,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- TABLE: property_images
CREATE TABLE IF NOT EXISTS property_images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  imagekit_file_id VARCHAR(255) NOT NULL,
  image_url TEXT NOT NULL,
  thumbnail_url TEXT,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- TABLE: property_tags
CREATE TABLE IF NOT EXISTS property_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  tag_name VARCHAR(50) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- TABLE: property_contacts
CREATE TABLE IF NOT EXISTS property_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  phone VARCHAR(20),
  whatsapp VARCHAR(20),
  email VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 007_update_properties_schema.sql
-- ============================================================================
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

-- ============================================================================
-- 008_temp_uploads.sql
-- ============================================================================
-- 008_temp_uploads.sql

CREATE TABLE IF NOT EXISTS temp_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  imagekit_file_id TEXT NOT NULL,
  image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_temp_uploads_session_id ON temp_uploads(session_id);
CREATE INDEX IF NOT EXISTS idx_temp_uploads_owner_id ON temp_uploads(owner_id);
CREATE INDEX IF NOT EXISTS idx_temp_uploads_created_at ON temp_uploads(created_at);

-- ============================================================================
-- 009_property_cover_images.sql
-- ============================================================================
-- 009_property_cover_images.sql
-- Add is_cover column to property_images to manage cover images

ALTER TABLE property_images
ADD COLUMN IF NOT EXISTS is_cover BOOLEAN DEFAULT FALSE;

-- ============================================================================
-- 010_property_metadata.sql
-- ============================================================================
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

-- ============================================================================
-- 011_property_model_refactor.sql
-- ============================================================================
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

-- ============================================================================
-- 012_property_tags_indexes.sql
-- ============================================================================
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

-- ============================================================================
-- 013_property_code.sql
-- ============================================================================
-- ─────────────────────────────────────────────────────────────
-- Migration 013: Property Code System
-- Adds a unique, human-friendly property code (e.g. RE8F2KQ1)
-- ─────────────────────────────────────────────────────────────

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

-- ============================================================================
-- 014_property_join_requests.sql
-- ============================================================================
CREATE TABLE IF NOT EXISTS property_join_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES users(id) ON DELETE CASCADE,
    property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(tenant_id, property_id)
);

-- Enable RLS
ALTER TABLE property_join_requests ENABLE ROW LEVEL SECURITY;

-- Policies

-- Tenants can see their own requests
CREATE POLICY "Tenants can view their own join requests" ON property_join_requests
    FOR SELECT USING (auth.uid() = tenant_id);

-- Tenants can insert their own requests
CREATE POLICY "Tenants can create join requests" ON property_join_requests
    FOR INSERT WITH CHECK (auth.uid() = tenant_id);

-- Owners can view requests for their properties
CREATE POLICY "Owners can view join requests for their properties" ON property_join_requests
    FOR SELECT USING (auth.uid() = owner_id);

-- Owners can update the status of requests for their properties
CREATE POLICY "Owners can update join requests for their properties" ON property_join_requests
    FOR UPDATE USING (auth.uid() = owner_id);

-- ============================================================================
-- 015_property_tenants.sql
-- ============================================================================
CREATE TABLE IF NOT EXISTS property_tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_id UUID REFERENCES properties(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'past')),
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(property_id, tenant_id)
);

-- Enable RLS
ALTER TABLE property_tenants ENABLE ROW LEVEL SECURITY;

-- Policies
-- Tenants can view their own tenancies
CREATE POLICY "Tenants can view their own tenancies" ON property_tenants
    FOR SELECT USING (auth.uid() = tenant_id);

-- Owners can view tenancies for their properties
CREATE POLICY "Owners can view tenancies for their properties" ON property_tenants
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM properties
            WHERE properties.id = property_tenants.property_id
            AND properties.owner_id = auth.uid()
        )
    );

-- ============================================================================
-- 016_property_tenants_rent_status.sql
-- ============================================================================
ALTER TABLE property_tenants ADD COLUMN IF NOT EXISTS rent_status VARCHAR(20) DEFAULT 'paid';

-- ============================================================================
-- 017_tenant_discovery.sql
-- ============================================================================
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

-- ============================================================================
-- 018_rent_due_automation.sql
-- ============================================================================
-- =====================================================
-- RentEdge — Rent Due Automation Migration
-- Run this in Supabase SQL Editor (one-time migration)
-- =====================================================

-- Step 1: Add new columns to property_tenants
ALTER TABLE property_tenants
  ADD COLUMN IF NOT EXISTS lease_start_date DATE,
  ADD COLUMN IF NOT EXISTS billing_day INTEGER,
  ADD COLUMN IF NOT EXISTS next_due_date DATE,
  ADD COLUMN IF NOT EXISTS last_paid_date DATE,
  ADD COLUMN IF NOT EXISTS agreed_rent_amount NUMERIC,
  ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;

-- Step 2: Add a partial index to optimize the hourly worker query
CREATE INDEX IF NOT EXISTS idx_pt_active_due
ON property_tenants (status, next_due_date)
WHERE status = 'active' AND left_at IS NULL;

-- Step 3: Verify the migration (should show 6 new columns)
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'property_tenants'
ORDER BY ordinal_position;

-- ============================================================================
-- 019_data_integrity_engine.sql
-- ============================================================================
-- =====================================================
-- RentEdge — Process 5: Database Integrity Engine
-- =====================================================

-- Step 1: Prevent invalid rent cycle calculations
ALTER TABLE property_tenants
ADD CONSTRAINT chk_billing_day CHECK (billing_day BETWEEN 1 AND 31);

-- ============================================================================
-- 020_payment_reversal.sql
-- ============================================================================
-- Migration 020: Add columns for idempotent payment reversal

ALTER TABLE property_tenants
ADD COLUMN previous_last_paid_date DATE NULL,
ADD COLUMN previous_due_date DATE NULL;

-- Log the migration action
COMMENT ON COLUMN property_tenants.previous_last_paid_date IS 'Stores the last paid date prior to the most recent payment, for reversal.';
COMMENT ON COLUMN property_tenants.previous_due_date IS 'Stores the due date prior to the most recent payment, for reversal.';

-- ============================================================================
-- 021_rent_payment_proofs.sql
-- ============================================================================
-- Migration 021: Rent Payment Proofs

CREATE TABLE IF NOT EXISTS rent_payment_proofs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    property_tenant_id UUID NOT NULL REFERENCES property_tenants(id) ON DELETE CASCADE,
    property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    billing_period DATE NOT NULL,
    amount_due NUMERIC(12,2),
    amount_paid NUMERIC(12,2),
    payment_method TEXT NOT NULL,
    reference_number TEXT NOT NULL,
    screenshot_url TEXT NOT NULL,
    payment_date DATE NOT NULL,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    verification_status TEXT DEFAULT 'pending' CHECK (verification_status IN ('pending', 'approved')),
    verified_at TIMESTAMPTZ,
    verified_by UUID REFERENCES users(id) ON DELETE SET NULL,
    
    UNIQUE(property_tenant_id, billing_period)
);

-- Enable RLS
ALTER TABLE rent_payment_proofs ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Tenants can view their own payment proofs" ON rent_payment_proofs
    FOR SELECT USING (auth.uid() = tenant_id);

CREATE POLICY "Tenants can insert their own payment proofs" ON rent_payment_proofs
    FOR INSERT WITH CHECK (auth.uid() = tenant_id);

CREATE POLICY "Tenants can delete their pending proofs" ON rent_payment_proofs
    FOR DELETE USING (auth.uid() = tenant_id AND verification_status = 'pending');

CREATE POLICY "Owners can view payment proofs for their properties" ON rent_payment_proofs
    FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "Owners can update verification status" ON rent_payment_proofs
    FOR UPDATE USING (auth.uid() = owner_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_rent_payment_proofs_property_tenant_id ON rent_payment_proofs(property_tenant_id);
CREATE INDEX IF NOT EXISTS idx_rent_payment_proofs_tenant_id ON rent_payment_proofs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rent_payment_proofs_owner_id ON rent_payment_proofs(owner_id);
CREATE INDEX IF NOT EXISTS idx_rent_payment_proofs_billing_period ON rent_payment_proofs(billing_period);
CREATE INDEX IF NOT EXISTS idx_rent_payment_proofs_verification_status ON rent_payment_proofs(verification_status);

-- ============================================================================
-- 022_database_constraints_indexes.sql
-- ============================================================================
-- 022_database_constraints_indexes.sql

-- Make migration idempotent by dropping the constraint if it exists
ALTER TABLE property_tenants 
DROP CONSTRAINT IF EXISTS chk_rent_status;

-- Add CHECK constraint for rent_status
ALTER TABLE property_tenants
ADD CONSTRAINT chk_rent_status
CHECK (
  rent_status IN ('due', 'pending', 'paid', 'inactive')
);

-- Add composite index on rent_payment_proofs for performance optimizations
CREATE INDEX IF NOT EXISTS idx_rent_payment_proofs_history 
ON rent_payment_proofs (property_tenant_id, verification_status, payment_date DESC);
