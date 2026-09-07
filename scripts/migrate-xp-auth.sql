-- Migration 002: XP tracking + lightweight session tokens.
-- Run with: wrangler d1 execute best-audio-room --remote --file=./scripts/migrate-xp-auth.sql
-- NOTE: the ALTER TABLE below is NOT re-runnable (SQLite has no
-- ADD COLUMN IF NOT EXISTS). Check PRAGMA table_info(users) first; if the
-- `xp` column already exists, run only the CREATE TABLE / CREATE INDEX
-- statements.

ALTER TABLE users ADD COLUMN xp INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS xp_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount <> 0),
  reason TEXT NOT NULL DEFAULT '',
  room_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_xp_user_created
  ON xp_events (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user
  ON sessions (user_id);
