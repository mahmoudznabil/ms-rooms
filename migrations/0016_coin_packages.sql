-- Migration 0016 — coin_packages for Phase D recharge path.
--
-- WHY: Phase D defines a coin pricing ladder at ~$1.08/100 coins (20% under
-- the $1.35/100 median competitor baseline). These are the SKUs users actually
-- buy via Stripe Payment Links. The existing `pricing_tiers` table holds
-- subscription tiers (starter/growth/pro/enterprise) for a different product
-- line; `coin_packages` is the user-facing coin shop.
--
-- PURELY ADDITIVE. Safe to apply on local, preview, prod. Mark in prod
-- `d1_migrations` after apply.
--
-- Pricing (0.8× competitor median ≈ $1.08/100 coins):
--   $0.99  → 92 coins  ($1.08/100)
--   $4.99  → 462 coins ($1.08/100)
--   $9.99  → 925 coins ($1.08/100)
--   $29.99 → 2,950 coins + 6% volume bonus = 3,127 ($1.02/100)
--   $99.99 → 10,400 coins + 12% volume bonus = 11,648 ($0.96/100)
--
-- Apply with:
--   local:   npm run db:migrate:local
--   preview: npx wrangler d1 migrations apply audioroom-db-preview --remote --env preview
--   prod:    npx wrangler d1 execute audioroom-db --remote --file=migrations/0016_coin_packages.sql
--            (+ INSERT INTO d1_migrations (name) VALUES ('0016_coin_packages.sql'))

CREATE TABLE IF NOT EXISTS coin_packages (
  id TEXT PRIMARY KEY,                    -- e.g. 'p92', 'p462', 'p925', 'p2950', 'p10400'
  name TEXT NOT NULL,                     -- e.g. 'Starter Pack'
  coins INTEGER NOT NULL CHECK (coins > 0), -- base coins granted
  bonus_coins INTEGER NOT NULL DEFAULT 0,  -- volume bonus coins
  price_cents INTEGER NOT NULL CHECK (price_cents > 0), -- price in cents (Stripe amount)
  stripe_price_id TEXT,                   -- Stripe Price ID for Payment Links / Checkout
  display_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE INDEX IF NOT EXISTS idx_coin_packages_active_order ON coin_packages (active DESC, display_order ASC);

-- Seed the Phase D ladder. Prices in cents.
INSERT OR IGNORE INTO coin_packages (id, name, coins, bonus_coins, price_cents, display_order, active) VALUES
  ('p92',   'Starter Pack',   92,     0,   99,  1, 1),
  ('p462',  'Popular Pack',   462,    0,   499, 2, 1),
  ('p925',  'Value Pack',     925,    0,   999, 3, 1),
  ('p2950', 'Premium Pack',   2950,   177, 2999, 4, 1),  -- 6% bonus
  ('p10400','Ultimate Pack',  10400,  1248, 9999, 5, 1); -- 12% bonus

-- Verify:
--   SELECT id, name, coins, bonus_coins, price_cents, display_order, active FROM coin_packages WHERE active = 1 ORDER BY display_order;
--   SELECT COUNT(*) FROM coin_packages;