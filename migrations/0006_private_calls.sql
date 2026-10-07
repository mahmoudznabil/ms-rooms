-- Migration: Private 1-on-1 Call Rooms with Internal Coin Payment
-- Run with: wrangler d1 execute best-audio-room --local --file=./scripts/migrate-private-calls.sql
-- Then run with --remote for production

-- 1. Add private call fields to rooms table
ALTER TABLE rooms ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0 CHECK (is_private IN (0,1));
ALTER TABLE rooms ADD COLUMN call_participant_user_id TEXT;
ALTER TABLE rooms ADD COLUMN call_price_per_minute INTEGER NOT NULL DEFAULT 10 CHECK (call_price_per_minute >= 0);
ALTER TABLE rooms ADD COLUMN call_started_at TEXT;
ALTER TABLE rooms ADD COLUMN call_ended_at TEXT;

-- Index for finding private calls
CREATE INDEX IF NOT EXISTS idx_rooms_private ON rooms (is_private, status);
CREATE INDEX IF NOT EXISTS idx_rooms_call_participant ON rooms (call_participant_user_id);

-- 2. Private call sessions table - tracks each call session with payment
CREATE TABLE IF NOT EXISTS private_call_sessions (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  caller_user_id TEXT NOT NULL,
  callee_user_id TEXT NOT NULL,
  price_per_minute INTEGER NOT NULL DEFAULT 10,
  total_charged INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'ringing', 'connected', 'ended', 'failed', 'cancelled')),
  started_at TEXT,
  connected_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (caller_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (callee_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_private_calls_room ON private_call_sessions (room_id);
CREATE INDEX IF NOT EXISTS idx_private_calls_caller ON private_call_sessions (caller_user_id);
CREATE INDEX IF NOT EXISTS idx_private_calls_callee ON private_call_sessions (callee_user_id);
CREATE INDEX IF NOT EXISTS idx_private_calls_status ON private_call_sessions (status);

-- 3. Call transaction log for billing transparency
CREATE TABLE IF NOT EXISTS call_transactions (
  id TEXT PRIMARY KEY,
  call_session_id TEXT NOT NULL,
  user_id TEXT NOT NULL, -- the caller who pays
  amount INTEGER NOT NULL, -- negative for charges, positive for refunds
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (call_session_id) REFERENCES private_call_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_call_transactions_session ON call_transactions (call_session_id);
CREATE INDEX IF NOT EXISTS idx_call_transactions_user ON call_transactions (user_id);