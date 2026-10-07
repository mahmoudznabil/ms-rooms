-- Migration 0005 — user moderation columns (banned / ban_reason).
--
-- These two columns are read by /api/auth/me (bannedOrUser) and the admin ban
-- route, but they were never created by ANY .sql file in the repo — the backend
-- created them lazily at request time via ensureUserIdentityColumns()
-- (workers/backend.ts `ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0`
-- and `ALTER TABLE users ADD COLUMN ban_reason TEXT`).
--
-- Runtime DDL on the request path is exactly what Phase 2 removes: a cold-start
-- request could run thousands of statements, and the flag guarding it does not
-- survive across isolates. This migration makes the columns first-class so the
-- runtime DDL can be deleted.
--
-- NOT re-runnable (SQLite has no ADD COLUMN IF NOT EXISTS). On a database that
-- already has these columns (because the backend created them at runtime), skip
-- this file — `wrangler d1 migrations` will not know it was already applied, so
-- backfill the d1_migrations table as described in migrations/README.md.

ALTER TABLE users ADD COLUMN banned INTEGER NOT NULL DEFAULT 0 CHECK (banned IN (0,1));
ALTER TABLE users ADD COLUMN ban_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_users_banned ON users (banned);

-- Verify:
--   SELECT name, sql FROM sqlite_master WHERE name = 'users';
--   SELECT COUNT(*) FROM users WHERE banned = 1;
