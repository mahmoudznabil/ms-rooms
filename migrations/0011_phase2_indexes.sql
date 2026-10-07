-- Phase 2 indexes + ledger readiness (see docs/PRODUCTION-PLAN.md Phase 2).
-- Safe to apply to fresh and existing DBs (IF NOT EXISTS throughout).

CREATE INDEX IF NOT EXISTS idx_transactions_type_created ON transactions (type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rooms_host ON rooms (host_user_id);
CREATE INDEX IF NOT EXISTS idx_moments_user ON moments (user_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports (status);
CREATE INDEX IF NOT EXISTS idx_private_calls_callee_status_created
  ON private_call_sessions (callee_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_private_calls_status_created
  ON private_call_sessions (status, created_at);
CREATE INDEX IF NOT EXISTS idx_private_calls_caller_created
  ON private_call_sessions (caller_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conv_sender_created
  ON messages (conversation_id, sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_tx_created ON admin_transactions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_updated ON users (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_spins_user_created ON spin_plays (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkins_user_day ON checkins (user_id, day DESC);

-- Case-insensitive username uniqueness: 'Maya' and 'maya' must not coexist.
-- If production already has colliding rows this statement fails: resolve
-- duplicates first (keep earliest created_at), then re-run.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (lower(username));

DROP INDEX IF EXISTS idx_seats_room;

-- Phase 6 ledger readiness: idempotent purchases keyed by provider receipt.
-- Added now so Phase 6 is an add-on, not a money-table rewrite.
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_transaction_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','credited','refunded','failed')),
  raw_receipt_ref TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, provider_transaction_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
