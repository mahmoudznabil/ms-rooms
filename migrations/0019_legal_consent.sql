-- Legal consent: versioned acceptance of the Terms, Privacy Policy and
-- Community Guidelines, in English and Arabic.
--
-- WHY THIS IS APPENDED-ONLY AND VERSIONED
--
-- A consent record is only worth keeping if it can still be read back years
-- later and still mean the same thing. That requires three things, which is
-- what this table is shaped around:
--
--   * doc_key + doc_version pin WHICH text was accepted. "The terms" is not a
--     citation; "terms@2026-10-17" is.
--   * lang records which language the customer actually read. Both languages
--     are equally valid, and the record has to show which one they chose.
--   * Nothing here is updated or deleted on account deletion of the user row
--     below in a way that loses the fact. The consent outlives the account so
--     that "did this person agree, and to what" remains answerable.
--
-- The unique index makes acceptance idempotent: re-accepting the same version
-- is a no-op rather than a duplicate row, so a user who taps the box twice on
-- a flaky connection does not end up with two records implying two separate
-- agreements.
CREATE TABLE IF NOT EXISTS legal_consent (
  id TEXT PRIMARY KEY,
  -- Set while the acceptance is still pending: the customer has signed in with
  -- their identity provider but the app has not yet created their account row,
  -- so there is no user_id to attach to. Bound to the provider's user id.
  firebase_uid TEXT,
  -- Set once the account exists. Null while pending, never both.
  user_id TEXT,
  doc_key TEXT NOT NULL,
  doc_version TEXT NOT NULL,
  lang TEXT NOT NULL,
  accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Hashed, never the raw address: enough to answer "were these two
  -- acceptances from the same person", not enough to build a location profile.
  ip_hash TEXT,
  user_agent TEXT
);

-- One record per (user, document, version). Partial on user_id so the index
-- stays small while pending rows accumulate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_consent_user_doc
  ON legal_consent (user_id, doc_key, doc_version)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_consent_pending_doc
  ON legal_consent (firebase_uid, doc_key, doc_version)
  WHERE firebase_uid IS NOT NULL AND user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_legal_consent_user
  ON legal_consent (user_id, accepted_at DESC);

CREATE INDEX IF NOT EXISTS idx_legal_consent_pending
  ON legal_consent (firebase_uid);

-- The gate itself.
--
-- `users.legal_consent_version` records the version of the document set the
-- user is currently cleared for, and is NULL until they accept. Having a
-- single column means the hot-path check is one indexed read of the user row
-- they have already loaded, rather than a join against the consent table on
-- every authenticated request.
--
-- It is set to the current version only when ALL required documents have been
-- accepted at that version — never partially, so there is no state where a
-- user is cleared against terms they did not read.
ALTER TABLE users ADD COLUMN legal_consent_version TEXT;

-- Signed-in age attestation. Separate from the consent version on purpose: an
-- age declaration is a one-off promise, while the document version changes
-- whenever the text is revised, so they must be able to diverge.
ALTER TABLE users ADD COLUMN legal_accepted_at TEXT;