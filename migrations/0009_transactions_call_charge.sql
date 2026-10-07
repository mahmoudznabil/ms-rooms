-- Migration 008 — add the missing `call_charge` transaction type.
--
-- BUG: `transactions.type` was CHECKed against
--   daily_reward | streak_bonus | purchase | gift_sent | gift_received | refund | xp_boost
-- but /api/rooms/private-call (workers/backend.ts) inserts 'call_charge'. That insert
-- was not wrapped in try/catch, so it threw AFTER the caller's coins had already been
-- debited (UPDATE users SET coins = coins - ?) and after the room, seats and
-- private_call_sessions rows had committed. Result: every private call charged the
-- caller and returned a 500, with no ledger row — while call_transactions *did* get a
-- row, so the two ledgers permanently disagreed.
--
-- Commit 10cbf78 ("fix video call transaction constraint") claimed to fix this but
-- touched only components/CallScreen.tsx; the schema was never changed.
--
-- SQLite cannot ALTER a CHECK constraint, so the table must be rebuilt.
--
-- Types included beyond call_charge are the ones we know are coming, so that the
-- follow-up code change (admin adjustments currently masquerade as purchase/refund/
-- gift_sent/gift_received, which corrupts the hosts leaderboard) needs no second
-- destructive rebuild.
--
-- NOT RE-RUNNABLE: this drops and recreates `transactions`. Take a D1 Time Travel
-- bookmark first (see docs/PRODUCTION-PLAN.md, "Pre-migration checklist").
--
-- Apply with:
--   npx wrangler d1 execute audioroom-db --remote --file=./scripts/migrate-008-transactions-call-charge.sql

PRAGMA defer_foreign_keys = on;

ALTER TABLE transactions RENAME TO transactions_old;

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  room_id TEXT,
  type TEXT NOT NULL CHECK (type IN (
    'daily_reward',
    'streak_bonus',
    'purchase',
    'gift_sent',
    'gift_received',
    'refund',
    'xp_boost',
    'call_charge',
    'call_refund',
    'admin_credit',
    'admin_debit'
  )),
  amount INTEGER NOT NULL CHECK (amount <> 0),
  description TEXT NOT NULL DEFAULT '',
  -- Deliberately still CURRENT_TIMESTAMP (space-separated, not ISO 'T'/'Z').
  -- Existing rows use this format, and both the daily-reward dedupe
  -- (created_at >= date('now','start of day')) and every leaderboard cutoff compare
  -- these values as strings. Switching format here would sort new rows after old ones
  -- and silently distort the daily window and the leaderboards. Timestamp
  -- standardisation is a separate, deliberate migration.
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
);

INSERT INTO transactions (id, user_id, room_id, type, amount, description, created_at)
  SELECT id, user_id, room_id, type, amount, description, created_at FROM transactions_old;

DROP TABLE transactions_old;

-- Recreated: the old index was dropped with the old table.
CREATE INDEX IF NOT EXISTS idx_transactions_user_created
  ON transactions (user_id, created_at DESC);

-- New: the hosts/contributors leaderboards filter on type and then sort; without this
-- every leaderboard load full-scans transactions and sorts in a temp B-tree.
CREATE INDEX IF NOT EXISTS idx_transactions_type_created
  ON transactions (type, created_at DESC);

-- Verify: should return the new DDL including 'call_charge'.
--   SELECT sql FROM sqlite_master WHERE name = 'transactions';
-- Verify: row count must match what it was before the rebuild.
--   SELECT COUNT(*) FROM transactions;
