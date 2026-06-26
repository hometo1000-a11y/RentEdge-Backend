-- Migration 005: Remove legacy password storage
-- Firebase Auth is now the sole authority for authentication and password management.

ALTER TABLE users
DROP COLUMN IF EXISTS password_hash;
