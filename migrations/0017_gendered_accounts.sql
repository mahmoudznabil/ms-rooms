-- Migration 0017 — gendered accounts + host call settings (Phase E1/E2).
--
-- WHY: Phase E introduces women-host paid video calls and a free 30-second
-- matchup funnel. Users need a gender field (for discovery filtering and
-- matchup matching) and hosts need call_enabled / call_rate / matchup_open
-- toggles.
--
-- PURELY ADDITIVE: ALTER TABLE ADD COLUMN + indexes. Safe to apply on
-- local, preview, prod. Mark in prod `d1_migrations` after apply.
--
-- Apply with:
--   local:   npm run db:migrate:local
--   preview: npx wrangler d1 migrations apply audioroom-db-preview --remote --env preview
--   prod:    npx wrangler d1 execute audioroom-db --remote --file=migrations/0017_gendered_accounts.sql
--            (+ INSERT INTO d1_migrations (name) VALUES ('0017_gendered_accounts.sql'))

-- Gender: 'unspecified' (default), 'woman', 'man'. Optional at signup;
-- editable once per 30 days to prevent gaming discovery.
ALTER TABLE users ADD COLUMN gender TEXT NOT NULL DEFAULT 'unspecified'
  CHECK (gender IN ('unspecified', 'woman', 'man'));

-- Host call settings (Phase E2): opt-in toggle + per-minute rate (30/56/100).
ALTER TABLE users ADD COLUMN call_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (call_enabled IN (0, 1));

ALTER TABLE users ADD COLUMN call_rate INTEGER NOT NULL DEFAULT 56
  CHECK (call_rate IN (30, 56, 100));

-- Matchup availability (Phase E3): women hosts can open/close the queue.
ALTER TABLE users ADD COLUMN matchup_open INTEGER NOT NULL DEFAULT 0
  CHECK (matchup_open IN (0, 1));

-- Indexes for discovery filtering and matchup matching.
CREATE INDEX IF NOT EXISTS idx_users_gender ON users (gender) WHERE gender = 'woman';
CREATE INDEX IF NOT EXISTS idx_users_call_enabled ON users (call_enabled) WHERE call_enabled = 1;
CREATE INDEX IF NOT EXISTS idx_users_matchup_open ON users (matchup_open) WHERE matchup_open = 1;

-- Verify:
--   SELECT COUNT(*) FROM users WHERE gender = 'unspecified';
--   SELECT COUNT(*) FROM users WHERE call_enabled = 1;
