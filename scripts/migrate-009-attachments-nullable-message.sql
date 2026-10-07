-- Migration 009 — make message_attachments.message_id nullable.
--
-- BUG: the column was declared `message_id TEXT NOT NULL`, but the upload handler
-- (/api/attachments/upload in workers/backend.ts) inserts a literal NULL and then the
-- send-message handler later claims the row with
--   UPDATE message_attachments SET message_id = ? WHERE id = ? AND message_id IS NULL
--
-- So the intended lifecycle is: upload creates an *unclaimed* attachment row, and
-- sending the message links it. The NOT NULL constraint made that impossible, which
-- meant:
--   1. every upload returned a 500 *after* the object had already been written to R2,
--      leaking a paid R2 object with no DB row able to reference or garbage-collect it;
--   2. `attachment_type` was hardcoded to 'file' and the computed value discarded;
--   3. the download route joins on attachment.message_id, so downloads could never work
--      either — chat attachments were 100% non-functional.
--
-- This is the schema half of the fix; the code half is in workers/backend.ts.
--
-- SQLite cannot drop a NOT NULL constraint, so the table must be rebuilt.
--
-- NOT RE-RUNNABLE: this drops and recreates `message_attachments`. Take a D1 Time
-- Travel bookmark first (see docs/PRODUCTION-PLAN.md, "Pre-migration checklist").
--
-- Apply with:
--   npx wrangler d1 execute audioroom-db --remote --file=./scripts/migrate-009-attachments-nullable-message.sql

PRAGMA defer_foreign_keys = on;

ALTER TABLE message_attachments RENAME TO message_attachments_old;

CREATE TABLE message_attachments (
  id TEXT PRIMARY KEY,
  -- NULL = uploaded but not yet attached to a message.
  message_id TEXT,
  attachment_type TEXT NOT NULL CHECK (attachment_type IN ('image', 'video', 'audio', 'file', 'contact')),
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  r2_key TEXT NOT NULL, -- R2 object key, namespaced attachments/<uploader_user_id>/...
  thumbnail_r2_key TEXT, -- For images/videos
  duration_seconds INTEGER, -- For audio/video
  contact_data TEXT, -- JSON for contact info
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

INSERT INTO message_attachments (id, message_id, attachment_type, file_name, file_size, mime_type, r2_key, thumbnail_r2_key, duration_seconds, contact_data, created_at)
  SELECT id, message_id, attachment_type, file_name, file_size, mime_type, r2_key, thumbnail_r2_key, duration_seconds, contact_data, created_at
  FROM message_attachments_old;

DROP TABLE message_attachments_old;

-- Recreated: the old index was dropped with the old table.
CREATE INDEX IF NOT EXISTS idx_message_attachments_message
  ON message_attachments (message_id);

-- Unclaimed orphans are what the upload path leaves behind when a user uploads and
-- never sends. This index lets an R2/row reconciliation job find them cheaply.
CREATE INDEX IF NOT EXISTS idx_message_attachments_unclaimed
  ON message_attachments (created_at)
  WHERE message_id IS NULL;

-- Verify: message_id must no longer be NOT NULL.
--   SELECT sql FROM sqlite_master WHERE name = 'message_attachments';
-- Verify: row count must match what it was before the rebuild.
--   SELECT COUNT(*) FROM message_attachments;
-- Audit the R2 objects leaked by the old bug (rows that can never be referenced):
--   SELECT COUNT(*) FROM message_attachments WHERE message_id IS NULL;
