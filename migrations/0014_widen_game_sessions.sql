-- Migration 0014 — widen `game_sessions.game_type` for the paid-games rollout.
--
-- WHY: the table predates the game panel. Its CHECK only admits
--   ludo | reaction | none
-- but Phase A3 turns every mini-game into a server-metered, coin-charged
-- session (POST /api/games/start → /api/games/finish), and the panel ships
-- four games plus the two planned ones:
--   ludo | reaction | trivia | memory | rush | pk
--
-- The old list also carried 'none', which no longer describes anything we
-- write; the widened list drops it and admits the six real game types.
--
-- SQLite cannot ALTER a CHECK constraint, so the table is rebuilt. This is the
-- same shape as 0009 (transactions). Unlike 0009, `game_sessions` is written
-- only by the room realtime layer and historically holds few rows (games were
-- local-only until this migration), so the copy step is cheap.
--
-- NOT RE-RUNNABLE: this drops and recreates `game_sessions`. Take a D1 Time
-- Travel bookmark first. Additive after this point only.
--
-- Apply with:
--   npx wrangler d1 execute audioroom-db --remote --file=migrations/0014_widen_game_sessions.sql

PRAGMA defer_foreign_keys = on;

ALTER TABLE game_sessions RENAME TO game_sessions_old;

CREATE TABLE game_sessions (
  id TEXT PRIMARY KEY,
  -- Nullable: a paid session can be started from the panel without a room
  -- (lobby / PK matchmaking). Room-scoped games fill it; the FK still
  -- cascade-deletes when the room goes away.
  room_id TEXT,
  game_type TEXT NOT NULL CHECK (game_type IN (
    'ludo',
    'reaction',
    'trivia',
    'memory',
    'rush',
    'pk'
  )),
  state_json TEXT NOT NULL DEFAULT '{}',
  current_turn_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','active','finished')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (current_turn_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Copy across, mapping the retired 'none' onto 'reaction' so no row is lost
-- and no row violates the new CHECK. ('none' was a placeholder for "no game
-- running"; such a row is meaningless as a billable session and is now a
-- reaction session nobody was charged for.)
INSERT INTO game_sessions (id, room_id, game_type, state_json, current_turn_user_id, status, created_at, updated_at)
  SELECT
    id,
    room_id,
    CASE WHEN game_type = 'none' THEN 'reaction' ELSE game_type END,
    state_json,
    current_turn_user_id,
    status,
    created_at,
    updated_at
  FROM game_sessions_old;

DROP TABLE game_sessions_old;

-- Recreated with the old table's indexes (dropped along with it) plus the two
-- new indexes the metering endpoints need:
--   * finish dedupe + anti-farm daily cap scan by (user, game_type, day)
--   * room realtime lookup by room
CREATE INDEX IF NOT EXISTS idx_game_sessions_room ON game_sessions (room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_sessions_user_type ON game_sessions (current_turn_user_id, game_type, created_at DESC);

-- Verify: should show the widened CHECK list.
--   SELECT sql FROM sqlite_master WHERE name = 'game_sessions';
-- Verify: row count must match what it was before the rebuild.
--   SELECT COUNT(*) FROM game_sessions;
