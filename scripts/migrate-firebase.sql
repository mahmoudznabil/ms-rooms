-- Migration 003: Link D1 users to Firebase Auth for cross-device progress.
-- Run once per DB:
--   wrangler d1 execute best-audio-room --local --file=./scripts/migrate-firebase.sql
--   wrangler d1 execute best-audio-room --remote --file=./scripts/migrate-firebase.sql
-- Firebase project: bestaudioroom (628489866765)
-- Auth methods enabled: phone, email/password, email link, google

-- D1 has no ADD COLUMN IF NOT EXISTS; run only if the column is missing.
-- Check with: wrangler d1 execute best-audio-room --local --command="PRAGMA table_info(users);"
ALTER TABLE users ADD COLUMN firebase_uid TEXT;
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN provider TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid) WHERE firebase_uid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL;

-- Session now optionally tracks which Firebase identity issued it
-- (requires recreating sessions if the column already exists; this is idempotent via exception)
-- If this ALTER fails because the column exists, ignore the error and continue.
-- Workaround: attempt and ignore error in application code.

-- Optional: audit log for Firebase link events
CREATE TABLE IF NOT EXISTS auth_audit (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  firebase_uid TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
