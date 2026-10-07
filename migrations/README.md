# Migrations

This directory is the **authoritative** D1 migration chain, consumed by
`wrangler d1 migrations apply`. Files must be numbered contiguously from `0001`
with the `NNNN_name.sql` pattern.

## The chain (fresh database, in order)

| File | Source | What it does |
|---|---|---|
| `0001_init.sql` | `scripts/init-db.sql` | Base schema + seed data |
| `0002_social.sql` | `scripts/migrate-003-social.sql` | follows, moments, moment_likes, checkins, gift_catalog, spin_plays, reports |
| `0003_reports_status.sql` | `scripts/migrate-007-reports-status.sql` | `reports.status` |
| `0004_firebase_identity.sql` | `scripts/migrate-firebase.sql` | `users.firebase_uid/email/phone/provider` + `auth_audit` |
| `0005_user_moderation.sql` | **new** | `users.banned` / `users.ban_reason` (were previously runtime DDL only) |
| `0006_private_calls.sql` | `scripts/migrate-private-calls.sql` | rooms private-call fields + `private_call_sessions` + `call_transactions` |
| `0007_calls_tab.sql` | `scripts/migrate-calls-tab.sql` | rebuild `private_call_sessions` (media/status set) + `users.last_calls_seen` |
| `0008_signal_relay.sql` | `scripts/signal-db.sql` | `rtc_signals` |
| `0009_transactions_call_charge.sql` | `scripts/migrate-008-transactions-call-charge.sql` | `call_charge` in the transactions CHECK |
| `0010_attachments_nullable.sql` | `scripts/migrate-009-attachments-nullable-message.sql` | `message_attachments.message_id` nullable |
| `0011_phase2_indexes.sql` | **new** | hot-path indexes + `users(lower(username))` unique + `purchases` ledger table |

## Superseded migrations (do NOT add to this chain)

These are historical migrations for databases that predated `init-db.sql`.
Their tables/columns are already folded into `0001_init.sql`:

- `scripts/migrate-xp-auth.sql` (Migration 002 — `xp`, `xp_events`, `sessions`)
- `scripts/migrate-004-pk-games.sql` (`pk_battles`, `game_sessions`)
- `scripts/migrate-005-rooms-locked-capacity.sql` (`rooms.locked`, `rooms.capacity`)
- `scripts/migrate-006-user-profile-columns.sql` (`frame_style`, `level`, `streak`, `last_checkin`, `id_tag`)
- `scripts/migrate-chat-ai.sql` (`conversations`, `messages`, `ai_usage_events`)
- `scripts/migrate-triple-currency-admin.sql` (`admin_*`, `support_tickets`, `ticket_replies`, `pricing_tiers`)

> Note: two of these are both labelled "Migration 003" (`migrate-003-social.sql` and
> `migrate-firebase.sql`); that is historical and this directory is the fix.

## Applying to a FRESH database

```bash
npm run db:migrate            # production
npm run db:migrate:local      # local Miniflare D1
```

## Applying to the EXISTING production database

**Do not run `db:migrate` blindly against production.** Production was migrated
by hand, so `wrangler d1 migrations` would find no `d1_migrations` table and
try to re-apply every file from `0001`, which fails on already-existing tables
and columns.

The only migrations that are *not yet* applied to production are the two newest
ones (the transaction-check rebuild and the nullable attachment column). Apply
them directly, exactly as the pre-migration checklist in
`docs/PRODUCTION-PLAN.md` describes:

```bash
npx wrangler d1 execute audioroom-db --remote --file=./migrations/0009_transactions_call_charge.sql
npx wrangler d1 execute audioroom-db --remote --file=./migrations/0010_attachments_nullable.sql
```

Then backfill `d1_migrations` so future `db:migrate` runs know where production is:

```sql
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Insert the migrations that are ALREADY live in production. Do this only after
-- confirming each one is actually applied (PRAGMA table_info / sqlite_master).
INSERT OR IGNORE INTO d1_migrations (name) VALUES
  ('0001_init.sql'), ('0002_social.sql'), ('0003_reports_status.sql'),
  ('0004_firebase_identity.sql'), ('0005_user_moderation.sql'),
  ('0006_private_calls.sql'), ('0007_calls_tab.sql'), ('0008_signal_relay.sql'),
  ('0009_transactions_call_charge.sql'), ('0010_attachments_nullable.sql');
```

**Before running that backfill**, reconcile it against the live schema — the
repository has drifted before (see `docs/CODE-REVIEW.md` §4.6), so confirm every
table/column each migration adds actually exists, and generate the canonical
schema first:

```bash
npm run db:export   # regenerates scripts/schema.sql from production
```

## Known issue carried into Phase 2

`0007_calls_tab.sql` (and `scripts/migrate-calls-tab.sql`) rebuilds
`private_call_sessions` with `RENAME TO …_old` + `DROP`. With SQLite's default
`legacy_alter_table = off`, the RENAME **rewrites the referring FK in
`call_transactions`** to point at the `_old` table, which is then dropped. Phase 2
fixes this by rebuilding `call_transactions` in the same migration. Do not run a
fresh `db:migrate` against a database you care about until that fix lands.
