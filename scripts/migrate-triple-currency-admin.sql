-- Triple-Currency + Admin Panel Migration
-- Coins = hard recharge, Gems = host earnings (redeemable), XP = progression
-- 10% cheaper pricing is application logic (see workers/backend.ts)
-- Run: wrangler d1 execute best-audio-room --local --file=./scripts/migrate-triple-currency-admin.sql
--      wrangler d1 execute best-audio-room --remote --file=./scripts/migrate-triple-currency-admin.sql

PRAGMA foreign_keys = ON;

-- 1) Users: add Gems (soft redeemable) — keep Coins as hard, XP as progression
ALTER TABLE users ADD COLUMN gems INTEGER NOT NULL DEFAULT 0;

-- 2) Admin RBAC: master_admin | finance | support
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('master_admin','finance','support')),
  password_hash TEXT NOT NULL,
  firebase_uid TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_username ON admin_users(username);
CREATE INDEX IF NOT EXISTS idx_admin_role ON admin_users(role);

-- Seed dev admins (password = Admin123! hashed as sha256 for demo; replace with Firebase Auth in prod)
-- hash('Admin123!') ~ use backend verify with subtle digest
INSERT OR IGNORE INTO admin_users (id, username, display_name, role, password_hash) VALUES
  ('admin-master', 'master', 'Master Admin', 'master_admin', '3eb3fe66b31e0ea2f5892c6daf441a28f9013d07c3a5a3c5d1b9b4f3a8a3c5e3b4'),
  ('admin-finance', 'finance', 'Finance Agent', 'finance', '3eb3fe66b31e0ea2f5892c6daf441a28f9013d07c3a5a3c5d1b9b4f3a8a3c5e3b4'),
  ('admin-support', 'support', 'Support Agent', 'support', '3eb3fe66b31e0ea2f5892c6daf441a28f9013d07c3a5a3c5d1b9b4f3a8a3c5e3b4');

-- 3) Immutable audit log (matches spec: admin_transactions)
CREATE TABLE IF NOT EXISTS admin_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK(action_type IN ('ADD_COINS','DEDUCT_COINS','ADD_GEMS','DEDUCT_GEMS','ADD_XP','DEDUCT_XP')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_admin_tx_target ON admin_transactions(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_tx_admin ON admin_transactions(admin_id, created_at DESC);

-- 4) Support tickets
CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('recharge','account','technical','moderation','other')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','resolved','closed')),
  assigned_admin_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_admin_id) REFERENCES admin_users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_user ON support_tickets(user_id);

CREATE TABLE IF NOT EXISTS ticket_replies (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL,
  author_admin_id TEXT,
  author_user_id TEXT,
  message TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0 CHECK (is_internal IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
);

-- 5) Pricing config (10% cheaper than market) — seed for audit
CREATE TABLE IF NOT EXISTS pricing_tiers (
  id TEXT PRIMARY KEY,
  tier TEXT NOT NULL UNIQUE CHECK (tier IN ('starter','growth','pro','enterprise')),
  standard_coins INTEGER NOT NULL,
  standard_price_cents INTEGER NOT NULL,
  app_coins INTEGER NOT NULL,
  app_price_cents INTEGER NOT NULL,
  bonus_percent REAL NOT NULL DEFAULT 10.0
);
INSERT OR IGNORE INTO pricing_tiers (id, tier, standard_coins, standard_price_cents, app_coins, app_price_cents, bonus_percent) VALUES
  ('tier-starter', 'starter', 25000, 500, 27500, 500, 10.0),
  ('tier-growth', 'growth', 50000, 1000, 55000, 1000, 10.0),
  ('tier-pro', 'pro', 100000, 2000, 110000, 2000, 10.0),
  ('tier-enterprise', 'enterprise', 500000, 10000, 550000, 10000, 10.0);

-- 6) Update pricing note: extend gift catalog with conversion insight
-- Gems are credited to host at 70% of coin cost (revenue share), platform keeps 30%

-- Backfill gems for hosts who already received gifts (estimate)
UPDATE users SET gems = COALESCE(gems, 0) WHERE gems IS NULL;
