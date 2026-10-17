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

### 6.5 Coin packages & admin-managed recharge (Phase D/F, `coin_packages`)

| Endpoint | Effect |
|---|---|
| `GET /api/recharge/packages` | Returns the active `coin_packages` rows (migration 0016) ordered by `display_order`. Falls back to the hardcoded Phase D ladder when the table is empty. |
| `POST /api/recharge/request { package_id }` | User asks for a pack. Creates one `recharge_requests` row (one open request per user — a second returns 409). **On the user's first ever request the system assigns them to an admin** — the least-loaded one by (customers, open requests, id), via `pickAdminForAssignment` — and writes `admin_customers`. |
| `GET /api/recharge/mine` | The caller's own state: coins, assigned admin, recharge count, whether they are in grace, unpaid allowance, credit ledger and request history. Drives the wallet panel. |

**Pricing ladder** (0.8× competitor median ≈ $1.08/100 coins):
$0.99→92, $4.99→462, $9.99→925, $29.99→2,950+177 bonus, $99.99→10,400+1,248 bonus.

**The allowance rule** (pure + unit-tested in `workers/recharge-policy.ts`, 26 cases) —
two phases:

- **Phase 1, prepaid — first `RECHARGE_GRACE_RECHARGES = 30` successful recharges.**
  The user pays the admin *first*, then receives the credit. An admin may credit
  freely; the working assumption is that nothing is owed.
- **Phase 2, postpaid — from the 31st.** The user has a card on file and billing
  is active. They may carry up to `RECHARGE_OUTSTANDING_CAP_USD = 100` of
  **unpaid** credit, which the system withdraws (charges the saved card) once
  reached. A credit that stays unpaid past `RECHARGE_SETTLEMENT_DAYS = 7` is
  **overdue**: the allowance stops extending immediately (409
  `allowance_overdue`), *before* the cap does — otherwise bad debt would simply
  sit at exactly $100 forever.
- Marking a credit **paid** frees the allowance again; **void** removes it from
  both the cap and the recharge count.
- All three constants live only in `workers/recharge-policy.ts` — change the
  policy there, nowhere else.

Why 30 is the line: it is roughly where card networks and PSPs start treating
an account as established. Letting a user cross it on convenience and carry a
balance indefinitely is the shape of *friendly fraud* (a stolen card used to
build history, then maxed out and charged back). Phase 2 exists to bound that
exposure.

### 6.7 Why there is no self-hosted card gateway (decision record)

Recharges are deliberately admin-managed rather than self-hosted card
processing, and this is a compliance decision, not a technical shortcut.

**What was asked:** an Egypt/MENA debit/credit gateway built on Pages/Workers,
where we own the customer data and the system auto-withdraws the $100 balance.

**Why not:**

| Blocker | Detail |
|---|---|
| **Licensing** | Processing cards in Egypt requires Central Bank of Egypt authorisation. Each market has its own regulator (SAMA, CBUAE, Central Bank Jordan). A licence cannot be self-hosted into existence. |
| **Scheme membership** | Visa/Mastercard/Meeza require a signed direct agreement or integration through an authorised member. Meeza is Egypt's national scheme, CBE-run — same constraint. There is no "build your own" path. |
| **Card data location** | A PAN must never sit on Workers/Pages. PCI DSS Level 1 expects HSM-backed tokenisation and audited key custody; Cloudflare provides neither and its terms rule it out. |

**What *is* buildable — and achieves the underlying goal.** The real desire is
owning the customer, the data and the withdrawal. That is an **orchestration
layer**, not an acquirer, and it runs fine on Pages/Workers:

- **We own** — the customer record, the wallet ledger, the allowance rules, the
  recharge history, invoicing/receipts, and the drain schedule.
- **A licensed PSP owns** — only the authorisation step for the actual money
  movement.
- **Consequence:** full customer-data ownership and automated collection are both
  achievable, without ever touching a PAN.

Egypt-specific rails worth evaluating when automated collection is ready (all
integrate via a licensed aggregator, none require us to become one): **Paymob**
(cards + Meeza + mobile wallets), **Fawry** (very large Egyptian consumer reach),
**InstaPay** (CBE real-time bank-to-bank, the closest fit to instant collection),
and Network International / PayTabs for wider GCC coverage.

**Operational implication of phase 2:** once billing is live, the scheduled job
that withdraws at the cap becomes revenue-critical. Until a PSP is integrated,
phase 2 is settled manually via `POST /api/admin/recharge/mark-paid` — the
`overdue` flag is the manual-collection worklist.

**Admin desk** (`app/admin/RechargeTab.tsx`, tab "Recharge"):

| Endpoint | Effect |
|---|---|
| `GET /api/admin/customers?scope=mine\|unassigned\|all` | Customer list with per-user recharge count, unpaid USD, open requests, grace flag. `scope=all` is master-only. |
| `POST /api/admin/customers/claim` | Take an unassigned user (adopts their open requests). 409 if another admin owns them. |
| `POST /api/admin/customers/release` | Hand a user back to the pool. |
| `POST /api/admin/customers/assign` | Master-only: move a user to a named admin. |
| `GET /api/admin/recharge/requests?status=` | The open queue for my customers (oldest first). |
| `POST /api/admin/recharge/fulfil` | **The only path that credits purchased coins.** Writes the `recharge_credits` row and the balance change together, then a `purchase` ledger row. Runs the allowance gate first (409 on refusal). Fulfils the linked request in the same call so the queue and the ledger can never disagree. |
| `GET /api/admin/recharge/ledger?user_id=` | That user's credits, for settling. |
| `POST /api/admin/recharge/mark-paid` | Settle (`paid`) or void a credit — this is what frees allowance. |

RBAC: `fulfil` / `mark-paid` require `finance` or `master_admin`; the rest of the
customer desk is open to any admin (support can grow and work their base).

**Secrets**: none. There is no payment provider, so no Stripe keys and no
webhook to configure. Delete `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` from
the Pages project if they were ever set — nothing reads them.

`migrations/0016_coin_packages.sql` and `migrations/0018_admin_recharge.sql` —
both purely additive. Apply local → preview → prod, then mark in prod
`d1_migrations`.

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

### 6.6 Women hosts, paid calls, free matchup (Phase E)

`migrations/0017_gendered_accounts.sql` — purely additive: `users.gender`
(`'unspecified'|'woman'|'man'`, default `unspecified`), `users.call_enabled`
(0/1), `users.call_rate` (30/56/100, default 56), `users.matchup_open` (0/1),
plus three partial indexes for discovery and matchup matching. Apply local →
preview → prod, then mark in prod `d1_migrations`.

| Endpoint | Effect |
|---|---|
| `PATCH /api/users/:id` | Accepts the four new fields (validated against their CHECK lists). Gender is opt-in; no existing feature is gender-gated. |
| `POST /api/rooms/private-call/heartbeat { room_id }` | E2 metering. The caller POSTs every 60s while `connected`: atomic debit at the **callee's** rate (`call_rate`, default 56), 70% credited to the callee as Gems, caller +2 XP. `gift_sent` + `gift_received` ("Call earn") rows land in the same ledger as gifts. Insufficient balance → **402 `out_of_coins`**, the session and room are ended server-side so the callee is never left in a dead call. Missed heartbeats expire the session (see the sweep below). |
| `POST /api/matchup/queue` | E3 funnel. Men only. One free matchup per man per day (429 on the second). Picks an available host (`gender='woman' AND call_enabled=1 AND matchup_open=1`), creates a private room + session at `price_per_minute=0` with 30 free seconds, +5 XP to the host. 503 `no_hosts` when the queue is empty. |
| `GET /api/matchup/status?room_id=` | Polled by both sides during the free window: `free_seconds_remaining`, `price_per_minute`, session/room status. At 25s the client shows "Continue for {rate}/min?"; continue switches the session to the paid rate, decline/timeout sends `bye`. |

**Economy**: hosts keep 70% of call minutes as Gems (same split as gifts — one
story everywhere). Cash-out is out of scope (Phase 6 monetization); the UI copy
says "Gems convert at cash-out".

**Operational notes**

- Free-riding protection: the stale-ringing sweep (existing cron) also expires
  matchup sessions whose heartbeats stopped; the room is ended, not left live.
- Safety: matchup rooms are `is_private=1` and reuse the existing report/block
  flow. Queue joins are rate-limited (10/hour) by the global limiter.
- Monitoring worth watching: `no_hosts` rate on `/api/matchup/queue` (means the
  host pool is empty) and 402s on the heartbeat (means callers are out of
  coins — a top-up-conversion signal, not an error).

### 6.8 Legal consent gate (Phase F3, `legal_consent`)

Bilingual — English and Arabic — Terms of Service, Privacy Policy and Community
Guidelines. Both languages are shipped in-bundle (`lib/legal-documents.ts`) and
versioned as `LEGAL_VERSION = 2026-10-17`. In-bundle on purpose: a consent
record citing a document version nobody can reproduce later is worthless as
evidence.

**The rule** (pure + unit-tested in `lib/legal-documents.ts`, 16 cases):

- A **new** account cannot be created unless every required document has been
  accepted **at the current version**. Missing consent returns **HTTP 428**
  (`legal_consent_required`) from `POST /api/auth/firebase`.
- The check runs **before** the `INSERT INTO users`, so a refused signup leaves
  no orphan user row behind.
- Acceptance is keyed on `firebase_uid` first, because at signup the browser
  holds only a Firebase token — there is no session and no `users` row yet. The
  record is attached to the account once it exists (`claimPendingConsent`).
- Age: `age_confirmed: true` is required and never inferred. Under-18 is refused
  outright (400 `age_confirmation_required`), not flagged for later review.
- **Bumping `LEGAL_VERSION` re-gates everyone automatically**, because clearance
  is always evaluated against the current version.

**Endpoints**

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/legal/documents?lang=en\|ar` | none | Full document bodies. Public on purpose — a consent prompt that hides the text is not consent. |
| `POST /api/legal/accept` | Firebase bearer **or** session | Records acceptance. Idempotent via unique `(user, doc, version)`. |
| `GET /api/legal/status` | session | Which documents are still outstanding for the signed-in user. |

CSRF: `/api/legal/accept` is exempt when it carries an `Authorization` header
(bearer is never ambient, so cross-site forgery does not apply). The session path
still goes through the double-submit check.

**Existing users are NOT blocked — and that is a decision, not an oversight.**
On first rollout every pre-existing account has `legal_consent_version = NULL`,
because nobody accepted text that did not exist when they signed up. Blocking
them would lock out customers who have paid and would assert a consent that never
happened. They get a persistent, dismissable prompt instead
(`LEGAL_ENFORCE_RETURNS = false`).

**To make a revision binding:** bump `LEGAL_VERSION` **and** set
`LEGAL_ENFORCE_RETURNS = true`. The version bump changes which documents count as
current; the flag decides whether the difference is enforced.

**Unfilled placeholders — REQUIRED before this reaches customers.** Six
`{{...}}` markers stand in for operator-specific facts:

| Placeholder | Meaning |
|---|---|
| `{{OPERATOR_LEGAL_NAME}}` | Registered legal entity |
| `{{REGISTERED_ADDRESS}}` | Registered address |
| `{{GOVERNING_LAW}}` | Governing law / jurisdiction |
| `{{LIABILITY_CAP}}` | Liability cap |
| `{{SUPPORT_EMAIL}}` | Support contact |

These are deliberately **not** filled with invented values — a plausible-looking
but false registered address is worse than an obvious gap, because it is harder
to notice and it is still a false statement to a customer.

```
npm run check:legal          # warns on unfilled placeholders, fails on corruption
npm run check:legal:strict   # fails on either — use as a release gate
```

`check-legal.mjs` also detects **mixed-script corruption** in the Arabic (stray
Latin or CJK fragments). The generated Arabic text had exactly that problem once
— it is invisible to tests, type checking and review-by-eye, and visibly broken
Arabic in a legal document undermines the credibility the text depends on.

These documents are a solid starting point matched to how the product works. They
have **not** been reviewed by a qualified lawyer in the operator's jurisdiction.

### 6.9 Room seat capacity (Phase F4, no migration)

**Room policy is the single source of truth for how many seats a room has.**
`workers/room-policy.ts`, shared by client and server, 13 cases.

Seat endpoints previously hardcoded `seatIndex > 7`. Two silent bugs followed:

- A room configured for **12** seats drew twelve tiles the server refused —
  the last four were permanently unreachable.
- A **private 1-on-1 paid call** (`capacity = 2`) would have accepted **eight**
  people into a session the host is being billed for.

Now:

- `roomSeatPolicy(room)` honours the stored capacity as written. It is
  deliberately **not** snapped to a set of "nice" sizes — a 3-seat panel is a
  real configuration and rounding it would admit someone the owner never
  offered a seat to.
- **Private calls are pinned to exactly two seats**, overriding the stored
  capacity. That is an invariant, not a preference: admitting a third person
  would put an unbilled stranger into a paid session.
- Out-of-range values clamp to `ROOM_CAPACITY_MAX = 12`, mirroring the `seats`
  table's own `CHECK (seat_index BETWEEN 0 AND 11)`.
- `RoomView` derives its grid from the same function, so the UI can neither offer
  a seat the API would refuse nor hide one it would accept.

Verify against a live database:

```
node scripts/verify-seat-capacity.mjs         # prod
D1_REMOTE=0 node scripts/verify-seat-capacity.mjs   # local
```

**Known schema drift:** prod's `seats` table has **no `CHECK` constraint** on
`seat_index`, unlike `migrations/0001_init.sql`. The code enforces the bound, so
this is defence-in-depth only. Not rebuilt in place — a SQLite table rebuild on
a live table with seat rows is not worth the risk for a constraint the
application already guarantees.
