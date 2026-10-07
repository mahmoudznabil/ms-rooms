-- Migration 007: moderation workflow state on safety reports.
-- Safe on tables with rows (constant default). NOT re-runnable (SQLite has
-- no ADD COLUMN IF NOT EXISTS): check PRAGMA table_info(reports) first.
-- Apply:
--   wrangler d1 execute best-audio-room --local  --file=./scripts/migrate-007-reports-status.sql
--   wrangler d1 execute best-audio-room --remote --file=./scripts/migrate-007-reports-status.sql

ALTER TABLE reports ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE reports ADD COLUMN handled_by TEXT;
