-- 0012: browser error telemetry collector (Phase 0 observability).
-- The client beacon (lib/telemetry.ts) POSTs batches here; admins read them
-- in the dashboard Errors tab. Additive only — safe on fresh and live DBs.
-- Retention is enforced by the writer (rows older than 30 days are pruned on
-- each insert), so this table cannot grow without bound.

CREATE TABLE IF NOT EXISTS client_errors (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  route TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'error',
  message TEXT NOT NULL DEFAULT '',
  stack TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_client_errors_created ON client_errors (created_at DESC);
