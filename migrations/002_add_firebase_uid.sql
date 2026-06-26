-- Migration 002: Add firebase_uid to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid TEXT;
