-- Migration: Calls tab — voice/video media, missed+rejected statuses, seen tracking
-- Run with: npx wrangler d1 execute best-audio-room --remote --file=./scripts/migrate-calls-tab.sql
--
-- Why a rebuild: SQLite cannot ALTER a CHECK constraint, and the old
-- private_call_sessions CHECK list omits 'rejected'/'missed' (rejecting a
-- call would violate it). Rebuild preserves all rows.

-- 1. Rebuild private_call_sessions with media + full status set.
ALTER TABLE private_call_sessions RENAME TO private_call_sessions_old;

CREATE TABLE private_call_sessions (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  caller_user_id TEXT NOT NULL,
  callee_user_id TEXT NOT NULL,
  price_per_minute INTEGER NOT NULL DEFAULT 10,
  total_charged INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN ('initiated', 'ringing', 'connected', 'ended', 'failed', 'cancelled', 'rejected', 'missed')),
  media TEXT NOT NULL DEFAULT 'audio' CHECK (media IN ('audio', 'video')),
  started_at TEXT,
  connected_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (caller_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (callee_user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO private_call_sessions
  (id, room_id, caller_user_id, callee_user_id, price_per_minute, total_charged,
   duration_seconds, status, media, started_at, connected_at, ended_at, created_at, updated_at)
SELECT
  id, room_id, caller_user_id, callee_user_id, price_per_minute, total_charged,
  duration_seconds, status, 'audio', started_at, connected_at, ended_at, created_at, updated_at
FROM private_call_sessions_old;

DROP TABLE private_call_sessions_old;

CREATE INDEX IF NOT EXISTS idx_private_calls_room ON private_call_sessions (room_id);
CREATE INDEX IF NOT EXISTS idx_private_calls_caller ON private_call_sessions (caller_user_id);
CREATE INDEX IF NOT EXISTS idx_private_calls_callee ON private_call_sessions (callee_user_id);
CREATE INDEX IF NOT EXISTS idx_private_calls_status ON private_call_sessions (status);

-- 2. Missed-call badge cursor per user.
ALTER TABLE users ADD COLUMN last_calls_seen TEXT;
