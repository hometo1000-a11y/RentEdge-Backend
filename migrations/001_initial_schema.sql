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
