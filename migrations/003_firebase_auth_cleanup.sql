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
