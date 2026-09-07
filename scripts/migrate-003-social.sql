-- Migration 003: social graph, moments, persistent check-ins, gift catalog,
-- spins, reports. Safe to re-run (IF NOT EXISTS / OR IGNORE throughout).
-- Apply: wrangler d1 execute best-audio-room --remote --file=./scripts/migrate-003-social.sql

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL,
  followee_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follower_id, followee_id),
  FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (followee_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows (followee_id);

CREATE TABLE IF NOT EXISTS moments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_moments_created ON moments (created_at DESC);

CREATE TABLE IF NOT EXISTS moment_likes (
  moment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (moment_id, user_id),
  FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS checkins (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, day),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gift_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  cost INTEGER NOT NULL CHECK (cost > 0),
  effect TEXT NOT NULL DEFAULT 'pop'
);

INSERT OR IGNORE INTO gift_catalog (id, name, emoji, cost, effect) VALUES
  ('rose', 'Rose', '🌹', 10, 'pop'),
  ('coffee', 'Coffee', '☕', 25, 'pop'),
  ('crown', 'Crown', '👑', 60, 'banner'),
  ('mic', 'Golden Mic', '🎙️', 100, 'banner'),
  ('car', 'Sports Car', '🏎️', 250, 'fullscreen'),
  ('rocket', 'Rocket', '🚀', 250, 'fullscreen'),
  ('castle', 'Castle', '🏰', 500, 'fullscreen'),
  ('dragon', 'Dragon', '🐉', 1000, 'fullscreen');

CREATE TABLE IF NOT EXISTS spin_plays (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  cost INTEGER NOT NULL,
  prize INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_spins_user ON spin_plays (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  room_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reports_target ON reports (target_id);
