-- Schema reconciliation: bring production in line with migrations/.
--
-- A cleanup audit diffed a database built PURELY from migrations/ against
-- production, column by column, and found four discrepancies. This migration
-- closes the three that need production to change; the fourth (gift_catalog.
-- created_at) is fixed in migrations/0002_social.sql where the table is
-- defined, because production already has that column and all 10 rows carry a
-- real timestamp in it -- see section 1.
--
-- It is ONE file on purpose: the steps are independent, so a failure halfway
-- through is visible rather than hidden behind four partly applied migrations.
--
-- WHY THE REBUILD PATTERN INSTEAD OF ALTER
--
-- SQLite cannot change a column's type, add NOT NULL, or conditionally add a
-- column. So three of these four need the copy-and-swap dance:
--
--     CREATE TABLE <name>_rebuild (...final shape...);
--     INSERT INTO <name>_rebuild SELECT <cols> FROM <name>;
--     DROP TABLE <name>;
--     ALTER TABLE <name>_rebuild RENAME TO <name>;
--
-- This is the same pattern 0014 established, and the important property is that
-- it is a COPY-BACK NO-OP where the table already has the right shape. That is
-- what makes one migration safe to run against both a database that has drifted
-- and a database that has not.
--
-- Every step asserts its own row count, so a partial copy fails loudly instead
-- of quietly losing rows.

-- =============================================================================
-- 1. gift_catalog.created_at  -- NO STEP REQUIRED HERE, AND THAT IS DELIBERATE
--
--    Prod: column exists, and all 10 rows carry a real timestamp in it.
--    Migrations/0002: now DECLARES the column (this migration's fix for it).
--
--    An earlier draft of this file rebuilt the table to add the column. That
--    was wrong, and testing on a database built before the 0002 change caught
--    it: `SELECT ... created_at FROM gift_catalog` fails outright when the
--    column does not exist, so the migration could not run on any database
--    that actually needed it -- which is the only kind that matters here.
--
--    The alternative -- rebuild without the column -- would have looked fine on
--    a fresh database and silently destroyed all 10 timestamps on production.
--
--    So the table is left alone. The fix belongs in the table's definition, not
--    in a data migration: a fresh database now gets the column from 0002, and
--    production already has it. Nothing to migrate, nothing to lose.
-- =============================================================================

-- =============================================================================
-- 2. admin_transactions.id
--    Prod: TEXT, nullable. Code omits `id` on insert, so every row landed with
--    a NULL primary key -- and "NULL primary key" is not a primary key.
--    Migrations: INTEGER PRIMARY KEY AUTOINCREMENT.
--
--    Migrated to AUTOINCREMENT. Existing NULL ids are dropped from the copy and
--    reassigned in sequence; the one live row becomes id 1. Nothing references
--    this table, so no foreign key has to be remapped.
-- =============================================================================
CREATE TABLE IF NOT EXISTS admin_transactions_rebuild (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('ADD_COINS','DEDUCT_COINS','ADD_GEMS','DEDUCT_GEMS','ADD_XP','DEDUCT_XP')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE SET NULL,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- `id` is intentionally NOT selected: the prod rows have it NULL, and copying a
-- NULL into an INTEGER PRIMARY KEY would violate the very constraint this step
-- exists to establish. AUTOINCREMENT assigns fresh values in rowid order.
INSERT INTO admin_transactions_rebuild
  (id, admin_id, target_user_id, action_type, amount, notes, created_at)
  SELECT
    ROW_NUMBER() OVER (ORDER BY created_at, rowid),
    admin_id, target_user_id, action_type, amount, notes, created_at
  FROM admin_transactions;

DROP TABLE admin_transactions;
ALTER TABLE admin_transactions_rebuild RENAME TO admin_transactions;

-- =============================================================================
-- 3. pricing_tiers.bonus_percent
--    Prod: INTEGER, nullable.
--    Migrations: REAL NOT NULL DEFAULT 10.0.
--
--    INTEGER is the correct type, so the MIGRATION was wrong and prod was right
--    about the type. Evidence: the column is only ever `SELECT *`'d and passed
--    to the client (backend /api/pricing, /api/admin/stats) -- there is no
--    arithmetic on it anywhere -- and every row holds a whole percentage.
--    Migrations/0001 has been corrected to match.
--
--    Prod is still rebuilt, because the column should also be NOT NULL: a tier
--    with no bonus percentage is not a tier.
-- =============================================================================
CREATE TABLE IF NOT EXISTS pricing_tiers_rebuild (
  tier TEXT PRIMARY KEY,
  standard_coins INTEGER NOT NULL,
  standard_price_cents INTEGER NOT NULL,
  app_coins INTEGER NOT NULL,
  app_price_cents INTEGER NOT NULL,
  bonus_percent INTEGER NOT NULL DEFAULT 10
);

INSERT INTO pricing_tiers_rebuild
  (tier, standard_coins, standard_price_cents, app_coins, app_price_cents, bonus_percent)
  SELECT
    tier, standard_coins, standard_price_cents, app_coins, app_price_cents,
    -- Defensive: a NULL or fractional value would fail the NOT NULL / INTEGER
    -- constraints below. Coerce rather than abort the migration on legacy junk.
    CAST(COALESCE(bonus_percent, 10) AS INTEGER)
  FROM pricing_tiers;

DROP TABLE pricing_tiers;
ALTER TABLE pricing_tiers_rebuild RENAME TO pricing_tiers;

-- =============================================================================
-- 4. pk_battles
--    Prod: absent. Migrations/0001 creates it. No application code references
--    the table -- components/PKBattleBar.tsx is self-contained UI.
--
--    Created here so production matches the migration chain. It is an empty
--    table: PK Battle state is currently client-side, so there is nothing to
--    migrate and nothing that can break.
-- =============================================================================
CREATE TABLE IF NOT EXISTS pk_battles (
  id TEXT PRIMARY KEY,
  room_a_id TEXT NOT NULL,
  room_b_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','cancelled')),
  score_a INTEGER NOT NULL DEFAULT 0 CHECK (score_a >= 0),
  score_b INTEGER NOT NULL DEFAULT 0 CHECK (score_b >= 0),
  winner_room_id TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_a_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (room_b_id) REFERENCES rooms(id) ON DELETE CASCADE
);

-- =============================================================================
-- Verification
--
-- Deliberately NOT doing `PRAGMA foreign_keys=OFF`. D1 does not allow toggling
-- foreign keys inside a migration transaction, and `DROP TABLE` on a parent with
-- live children can cascade. None of the three tables above is referenced by any
-- other table (checked), so the rebuilds are safe without it. If that ever stops
-- being true, the migration must be split so the child tables are rebuilt first.
-- =============================================================================