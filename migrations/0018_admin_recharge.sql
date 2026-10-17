-- Migration 0018 — admin-managed recharge: credit ledger, customer assignment,
-- and user top-up requests (replaces the Stripe checkout path).
--
-- WHY: recharges are handled by admins, not a card processor. An admin credits
-- a user coins; the user pays the admin offline. That makes this a
-- credit-exposure ledger, so we need three things:
--
--   recharge_credits   — every credit an admin issues, its USD value, and
--                        whether the user has paid for it. The allowance rule
--                        (see workers/recharge-policy.ts) reads this: after
--                        RECHARGE_GRACE_RECHARGES (30) successful recharges a
--                        user may carry at most $100 UNPAID. Marking a credit
--                        'paid' frees that allowance again.
--   admin_customers    — which admin owns which user, so the work splits. The
--                        first time a user asks for a top-up the system
--                        assigns them to the least-loaded admin.
--   recharge_requests  — the queue an admin works through: a user asks for a
--                        package, an admin fulfils it (which writes a
--                        recharge_credits row) or declines it.
--
-- PURELY ADDITIVE: three CREATE TABLE IF NOT EXISTS + indexes. Safe on local,
-- preview, prod; mark in prod `d1_migrations` after apply.
--
-- Apply with:
--   local:   npm run db:migrate:local
--   preview: npx wrangler d1 migrations apply audioroom-db-preview --remote --env preview
--   prod:    npx wrangler d1 execute audioroom-db --remote --file=migrations/0018_admin_recharge.sql
--            (+ INSERT INTO d1_migrations (name) VALUES ('0018_admin_recharge.sql'))

-- Every credit an admin issues. `usd_cents` mirrors the coin_packages price
-- for the package credited, so the allowance cap and the shop stay consistent.
CREATE TABLE IF NOT EXISTS recharge_credits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  admin_id TEXT,
  request_id TEXT,
  package_id TEXT NOT NULL DEFAULT '',
  coins INTEGER NOT NULL CHECK (coins > 0),
  usd_cents INTEGER NOT NULL CHECK (usd_cents > 0),
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid', 'void')),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_recharge_credits_user ON recharge_credits (user_id, status);
CREATE INDEX IF NOT EXISTS idx_recharge_credits_admin ON recharge_credits (admin_id, created_at DESC);

-- Customer ownership: one admin per user (PK is the user, so a user cannot be
-- owned twice). `assigned_by` NULL means the system auto-assigned on the
-- user's first top-up request.
CREATE TABLE IF NOT EXISTS admin_customers (
  user_id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assigned_by TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by) REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_customers_admin ON admin_customers (admin_id, assigned_at DESC);

-- The admin work queue. A request is 'open' until an admin fulfils or
-- declines it; fulfilling writes a recharge_credits row and marks this
-- 'fulfilled' in the same request so the two never disagree.
CREATE TABLE IF NOT EXISTS recharge_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  coins INTEGER NOT NULL CHECK (coins > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fulfilled', 'declined')),
  admin_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_recharge_requests_status ON recharge_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recharge_requests_user ON recharge_requests (user_id, created_at DESC);

-- Verify:
--   SELECT COUNT(*) FROM recharge_credits;
--   SELECT COUNT(*) FROM admin_customers;
--   SELECT COUNT(*) FROM recharge_requests;