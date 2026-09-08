-- Migration 006: profile columns required by POST /api/auth/firebase signup.
-- All columns are nullable or have constant defaults, so this is safe on
-- tables that already have rows. NOT re-runnable (SQLite has no ADD COLUMN
-- IF NOT EXISTS): check PRAGMA table_info(users) first if unsure.
-- Apply:
--   wrangler d1 execute best-audio-room --local  --file=./scripts/migrate-006-user-profile-columns.sql
--   wrangler d1 execute best-audio-room --remote --file=./scripts/migrate-006-user-profile-columns.sql

ALTER TABLE users ADD COLUMN frame_style TEXT NOT NULL DEFAULT 'default';
ALTER TABLE users ADD COLUMN level INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_checkin TEXT;
ALTER TABLE users ADD COLUMN id_tag TEXT;

-- Backfill a unique id_tag for pre-existing rows, then enforce uniqueness
-- for all future non-null values.
UPDATE users SET id_tag = 'USER#' || rowid WHERE id_tag IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_id_tag ON users(id_tag) WHERE id_tag IS NOT NULL;
