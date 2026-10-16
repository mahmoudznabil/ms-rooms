-- Migration 0015 — `trivia_packs` for Phase B server-side trivia.
--
-- WHY: the room trivia game used to deal only from a static client-side pool,
-- which players saw repeating within a single evening. Admins can now mint
-- fresh 5-question packs with Workers AI (`POST /api/admin/trivia/generate`);
-- `GET /api/trivia/pack` serves the newest pack and the client falls back to
-- its static 60-question pool when none exists (or the AI binding is absent).
--
-- PURELY ADDITIVE: CREATE TABLE IF NOT EXISTS + index. Safe to apply on
-- local, preview and prod; safe to mark in prod `d1_migrations`.
--
-- Row shape:
--   questions_json — JSON array of exactly 5 { q, options[4], correct } objects.
--   source         — 'ai' (generated) or 'static' (hand-seeded fallback packs).
--   model          — Workers AI model id used, '' when not AI-made.
--
-- Apply with:
--   local:   npm run db:migrate:local
--   preview: npx wrangler d1 migrations apply audioroom-db-preview --remote --env preview
--   prod:    npx wrangler d1 execute audioroom-db --remote --file=migrations/0015_trivia_packs.sql
--            (+ INSERT INTO d1_migrations (name) VALUES ('0015_trivia_packs.sql'))

CREATE TABLE IF NOT EXISTS trivia_packs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  questions_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'static' CHECK (source IN ('static', 'ai')),
  model TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_trivia_packs_created ON trivia_packs (created_at DESC);

-- Verify:
--   SELECT COUNT(*) FROM trivia_packs;
