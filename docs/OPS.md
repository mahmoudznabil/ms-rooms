# Operations Runbook — MS-ROOMS

Companion to [PRODUCTION-PLAN.md](./PRODUCTION-PLAN.md) (the plan) and
[CODE-REVIEW.md](./CODE-REVIEW.md) (the findings). This is the reference for
backup, rollback, and observability, plus the manual Cloudflare/GCP steps that
cannot be done from the repository.

---

## 1. Deploy & rollback rehearsal

The app is a single Cloudflare Pages project (`ms-rooms`): the Next.js static
export (`./out`) plus the Pages Function (`functions/api/[[path]].ts` →
`workers/backend.ts`).

**Deploy**

```bash
npm run build                 # regenerates ./out (static export)
npx wrangler pages deploy out --project-name=ms-rooms
```

**Roll back (two mechanisms)**

1. **Code/asset rollback — instant.** In the Cloudflare dashboard,
   **Workers & Pages → ms-rooms → Deployments**, click the previous production
   deployment → **Rollback to this deployment**. Pages serves the old assets and
   old Pages Function immediately. No data changes.
2. **Data rollback — only via Time Travel.** D1 changes are not reverted by a
   Pages rollback. Use the bookmark recorded before the migration (§2).

**Rehearse once on staging before relying on either.** The rehearsal is the
Exit criterion for Phase 0: deploy a build, confirm it serves, roll it back, and
confirm the old build is live again.

Rehearsal evidence 2026-10-16: prior production deployments stay addressable
after newer deploys (e.g. `c34be5eb.ms-rooms.pages.dev/api/rooms` → 200 after
`735d8084` went live), so the dashboard Rollback target always exists. A full
dashboard-rollback drill remains a manual click away.

**Order-of-operations rule for schema + code changes:** apply the SQL migration
*first*, then deploy the code that depends on it. A code rollback (mechanism 1)
never rolls back the schema; if you must undo the schema, restore the bookmark.

---

## 2. Backups

### 2.1 Time Travel bookmarks (before any destructive migration)

```bash
# Record and SAVE the returned bookmark id outside this machine.
npx wrangler d1 time-travel info audioroom-db

# After a migration, compare; to restore:
npx wrangler d1 time-travel restore audioroom-db --bookmark <BOOKMARK_ID> --remote
```

Bookmarks are the *only* way to undo a destructive DDL change. Record one
immediately before running `migrations/0007_calls_tab.sql`,
`0009_transactions_call_charge.sql`, or `0010_attachments_nullable.sql`.

### 2.2 Nightly export

Scheduled in [`.github/workflows/backup.yml`](../.github/workflows/backup.yml)
(cron `15 3 * * *`, plus manual `workflow_dispatch`). It runs
`scripts/backup-d1.mjs`, which exports `audioroom-db --remote` to a timestamped
SQL file and uploads it to an R2 backup bucket.

**Required repository secrets** (GitHub → Settings → Secrets):

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API token with **D1 read** on `audioroom-db` and **R2 write** on the backup bucket |
| `CLOUDFLARE_ACCOUNT_ID` | the Cloudflare account id |
| `R2_BACKUP_BUCKET` | name of a dedicated backup bucket (create once: `npx wrangler r2 bucket create ms-rooms-backups`) |

The workflow also uploads a 14-day build artifact as a second copy.

### 2.3 Manual backup

```bash
npm run db:backup                       # uses R2_BACKUP_BUCKET if set
D1_DATABASE=audioroom-db node scripts/backup-d1.mjs
```

---

## 3. Observability

### 3.1 Browser errors (live)

`components/Telemetry.tsx` installs global `error` / `unhandledrejection`
capture from `lib/telemetry.ts` on every page. Batches POST to the
same-origin collector `POST /api/client-errors` by default — no configuration
needed (override with build-time `NEXT_PUBLIC_TELEMETRY_URL` to forward to
Sentry/a vendor instead).

Server side (`workers/backend.ts`): capped fields, 30/min rate limit,
best-effort session attribution, 30-day retention prune on every write.
Read them in the admin dashboard **Errors** tab (master only), which also shows
24h counts by kind.

Privacy: the beacon sends `{ kind, message, stack, url }` only — no form
contents, no cookies. Stacks may contain route URLs; retention is 30 days.

### 3.2 Pages Function errors (wired)

The backend catch-all now logs a structured JSON line per error with a
`correlation_id` (returned to the client as `correlation_id` in the 500 body,
and no longer echoing the internal message):

```json
{"level":"error","correlation_id":"<id>","path":"/api/...","method":"POST","message":"...","stack":"..."}
```

These surface in **Cloudflare → Workers & Pages → ms-rooms → Logs**, and in
Workers Analytics / Logpush if enabled.

### 3.3 Alerts (manual — dashboard)

| Alert | Where | Condition |
|---|---|---|
| API 5xx rate | Cloudflare Analytics → Workers & Pages, or WAF/Logpush → your alerting | `5xx / total > 2%` for 5 min |
| D1 error rate | Logpush → D1 dataset, or the `overloaded`/error lines in Function logs | sustained D1 errors or `overloaded` responses |

At minimum, forward Workers Logs to Logpush (or your observability vendor) and
alert on the two conditions above. This is the Phase 0 "error tracking +
alerting" handoff.

### 3.4 Correlation in support

A user-facing error now returns `{ ok:false, error:"Internal error.",
correlation_id:"<id>" }`. Ask the user for the `correlation_id` (or read it from
your collector) and search the Function logs for it.

---

## 4. Manual handoffs (cannot be done from the repo)

These need a Cloudflare/GCP dashboard action or credentials I don't have. Each
is a prerequisite for the phase it belongs to.

| # | Action | Command / location | Phase | Status |
|---|---|---|---|---|
| 1 | Create the preview D1 database | `npx wrangler d1 create audioroom-db-preview` | 0 | ✅ done 2026-10-16 (`366b9b76-…`, migrated 0001–0012) |
| 2 | Create the preview R2 bucket | `npx wrangler r2 bucket create ms-rooms-preview` | 0 | ✅ done 2026-10-16 |
| 3 | Paste the preview ids into `wrangler.toml` | replace `REPLACE_WITH_PREVIEW_DATABASE_ID` | 0 | ✅ done — `[env.preview]` active |
| 4 | Create the backup R2 bucket | `npx wrangler r2 bucket create ms-rooms-backups` | 0 |
| 5 | Add GitHub secrets for backup | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `R2_BACKUP_BUCKET` | 0 |
| 6 | Set the telemetry sink | Pages build env `NEXT_PUBLIC_TELEMETRY_URL` | 0 |
| 7 | Set Pages secrets (idempotent) | `npx wrangler pages secret put TURN_KEY_ID --project-name=ms-rooms` (also `TURN_API_TOKEN`, `RECAPTCHA_SECRET_KEY`) | 0/1 |
| 8 | Confirm `RECAPTCHA_SECRET_KEY` is set (otherwise recaptcha fails open) | Pages project settings | 1 |
| 9 | Cloudflare Rate Limiting rules | Dashboard → Security → WAF → Rate limiting | 1 |
| 10 | Delete `infra/cloud-armor/` | `git rm -r infra/cloud-armor` (targets an unused GCP LB) | 1/5 |
| 11 | Configure D1 Time Travel retention | Dashboard → D1 → `audioroom-db` → Settings | 0 |

---

## 5. Secrets checklist (Pages project)

| Secret | Purpose | Set? |
|---|---|---|
| `TURN_KEY_ID` / `TURN_API_TOKEN` | mints TURN ICE credentials | manual |
| `RECAPTCHA_SECRET_KEY` | signup bot protection — **fail-closed is required** | manual |
| `FIREBASE_PROJECT_ID` | declared but currently ignored (hardcoded `ms-rooms-auth`) | Phase 1 |
| `CALLS_ACCOUNT_ID` / `CALLS_APP_ID` / `CALLS_API_TOKEN` | Cloudflare Calls SFU (optional) | manual |

Never put server secrets in `.env.production`; that file holds only browser-public
`NEXT_PUBLIC_*` values.

---

## 6. Paid games + voice metering (Phase A, live since `b44a70b`)

### 6.1 Endpoints (`workers/backend.ts`)

| Endpoint | Effect |
|---|---|
| `POST /api/games/start { game_type, room_id? }` | Atomic fee debit (`UPDATE … WHERE coins >= fee`), inserts a `game_sessions` row (`status='active'`), returns `session_id`. 409 when broke or at the 10/day/game cap. |
| `POST /api/games/finish { session_id, score }` | Clamps `score` to the per-game max, awards FIXED xp (win 10 / play 2 — never proportional to score). Idempotent: double-finish returns the cached `{ xp_awarded, win }`, never a second award. |
| `POST /api/rooms/:slug/voice-heartbeat` | 1 coin/min while the mic is on (+1 xp). Host exempt in own room; muted seats not billed; stops billing at 60 coins/day (caller keeps talking). 402 `out_of_coins` → client auto-mutes and shows a top-up nudge. |

Fee table (server-side `GAME_ECON`, mirrored in `MiniGamePanel` only for the notice copy):
ludo 5, trivia 5, reaction 2, memory 2, rush 10, pk 10.

`POST /api/xp/award` stays reserved (no UI calls it) — game XP comes only from
`/api/games/finish`, so an unfunded client cannot mint XP. Verified live by
unauthenticated 403s on all three routes above (same guard shape as the rest of
the API; see `scripts/probe-auth.mjs`).

### 6.2 Schema

`migrations/0014_widen_game_sessions.sql` — `game_type` CHECK widened from
`('ludo','reaction','none')` to `('ludo','reaction','trivia','memory','rush','pk')`,
`room_id` nullable (lobby/PK sessions), plus `idx_game_sessions_room` and
`idx_game_sessions_user_type` for the finish-dedupe / daily-cap scans.

**Prod discovery:** prod had 0001–0013 marked but NO `game_sessions` table
(0001's CREATE never ran there — the table came from `scripts/migrate-004-pk-games.sql`,
never a numbered migration). 0014 therefore starts with `CREATE TABLE IF NOT
EXISTS` (final schema) and then rebuilds unconditionally — a copy-back no-op on
empty/new-shape tables. Applied prod 2026-10-16, marked in `d1_migrations`.
Same order-of-operations as §1: migration first, code second.

### 6.3 Server trivia packs (Phase B, `trivia_packs`)
| Endpoint | Effect |
|---|---|
| `POST /api/admin/trivia/generate { topic?, title? }` | Admin-gated (`admin_session`). Prompts Workers AI (`@cf/meta/llama-3.2-1b-instruct` via `runAi`, `workers/backend.ts`); strictly validates the reply (exactly 5 × `{ q, options[4 unique], correct }`, shared validator `workers/trivia-validate.ts`) and stores it as `source='ai'`. 503 `ai_unavailable` when the `[ai]` binding is absent; 502 `ai_malformed` when the reply fails validation (stores nothing). Logs to `ai_usage_events`. |
| `GET /api/trivia/pack` | Returns the newest pack, else `{ pack: null, fallback: true }`. A stored row that fails validation reads as "no pack". No auth (questions are public); the panel (`loadTriviaDeck`, `components/MiniGamePanel.tsx`) asks the server first and falls back to its static 60-question pool. |

`migrations/0015_trivia_packs.sql` — purely additive (`CREATE TABLE IF NOT
EXISTS trivia_packs` + `idx_trivia_packs_created`). Apply local → preview →
prod, then mark in prod `d1_migrations`. The `[ai]` binding (`wrangler.toml`
`[ai]` + `[env.preview.ai]` — singleton tables, not `[[ai]]` arrays, which
wrangler rejects) flows through `functions/api/[[path]].ts`
(`PagesEnv.AI`) untouched — the shim passes `env` wholesale.

### 6.4 Unified chats tab (Phase C — client only, no migration)

The Messages tab (`components/ChatPanel.tsx`) merges DMs and call recents
into one per-peer list (pure kernel `lib/chat-list.ts`):
- C1: each row shows the latest activity (last message OR last call) with a
  timestamp; tapping a call row opens/creates the DM thread with that peer.
- C2: inside a thread, the newest 5 calls with that peer render inline
  ("Voice · 3:12 · ended", "Missed video call"). Recents refresh on open,
  on the 4s message poll, and on the direct-DM boot path, so an ended call
  appears without leaving the thread.
- C3: the Messages tab badge (`components/AppShell.tsx`) sums missed calls
  (`/api/calls/missed-count`) + unread DMs (`/api/conversations/unread-count`)
  on the sidebar and mobile topbar. Per-thread unread reuses the existing
  conversation `unread_count` badge; missed incoming calls show a persistent
  red dot (WhatsApp style — a fact, not a clearable state). The standalone
  Calls tab and its badge/clearing flow are unchanged.
