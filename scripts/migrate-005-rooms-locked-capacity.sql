-- Migration 005: columns required by POST /api/rooms (locked rooms, capacities).
-- Both columns have constant defaults, so this is safe on tables with rows.
-- NOT re-runnable (SQLite has no ADD COLUMN IF NOT EXISTS): check
-- PRAGMA table_info(rooms) first if unsure.
-- Apply: wrangler d1 execute best-audio-room --remote --file=./scripts/migrate-005-rooms-locked-capacity.sql

ALTER TABLE rooms ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN capacity INTEGER NOT NULL DEFAULT 8;
