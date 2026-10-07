# BestAudioRoom / MS-ROOMS — Code Review & Recommendations

**Date:** review of `master` @ `43a5c89`
**Scope:** whole web app — Next.js 16 static export frontend, Cloudflare Pages Function API (`workers/backend.ts`), D1 schema/migrations, R2, realtime/WebRTC layer, infra, and build tooling.
**Method:** full read of `workers/backend.ts` (3,171 lines), `lib/realtime.ts`, all app routes and components, all `scripts/*.sql`, `wrangler.toml`, `infra/`; plus `tsc --noEmit`, `next build`, and `eslint` runs.

> Anything marked **[verify]** is a claim about the *live* D1 database or runtime behaviour that cannot be confirmed from the repository alone.

---

## 1. Verdict

The product surface is genuinely ambitious and much of the hard engineering is done: WebRTC with a TURN-backed relay, a real D1 schema with 20+ tables, Firebase Auth with correct RS256/JWKS verification, an offline-capable PWA, and a static export that builds cleanly. The code style is consistent and there is no SQL injection and no `any` in the application code.

**But the app is not safe to run publicly in its current state.** The single biggest problem is architectural: **the API does not authenticate the acting user on most endpoints.** Identity, prices, and reward amounts are taken from the request body. That turns a social audio app into one where any anonymous visitor can take over any account, mint unlimited currency, read other people's email/phone/DMs/support tickets, and drain arbitrary balances. This is not a scattering of small bugs — it is one missing concept (`requireUser()`) repeated across ~50 handlers.

Build health is also red: `npm run lint` exits 1 with 31 errors, and there are no tests, no CI, and no migration runner.

**Priority order I recommend:** fix the auth model (P0) → fix the two schema mismatches that silently break calls and attachments (P1) → fix ICE/renegotiation so voice actually works reliably (P2) → then architecture, performance, a11y, and SEO.

---

## 2. What works well (keep this)

| Area | Evidence |
|---|---|
| Firebase ID token verification | `workers/backend.ts:186-243` — RS256 pinned, Google JWKS with `kid` rotation + forced refresh, `aud`/`iss`/`exp`/`iat` checked, **fails closed** when JWKS is unreachable. This is the correct implementation. |
| Master-admin bootstrap | `backend.ts:1985-1990` requires `email_verified === true` **and** `provider === "google.com"` **and** a hardcoded email allowlist. |
| Admin RBAC (partially) | `stats`, `team`, `ban`, `promote` all enforce `master_admin`. |
| No SQL injection | All ~200 queries use bound parameters. The only 3 string interpolations in SQL are a closed ternary, an allowlist map, and generated `?` placeholders. |
| The historical admin backdoor is genuinely dead | The seeded hashes in `scripts/init-db.sql:194-197` are **not** `sha256("Admin123!")` (computed: `3eb3fe66b31e3b4d…` vs seeded `3eb3fe66b31e0ea2…`). |
| Session cookie flags | `HttpOnly; Secure; SameSite=Lax` (`backend.ts:937, 1091`). |
| Signaling relay design | Seat-membership check, `kind` allowlist, 60 KB payload cap, 60 s TTL sweep (`backend.ts:3074-3110`). |
| Newer features do auth correctly | `sessionUserId()` used by all private-call endpoints (`backend.ts:2455-2460`) and the signal relay. The newer code shows the team knows the right pattern. |
| CSS/typography approach | System font stack, documented weight collapse, `prefers-reduced-motion` handling; no `dangerouslySetInnerHTML` anywhere in the frontend. |
| Build | `tsc --noEmit` clean under `strict: true`; `next build` succeeds, 17 static routes, 2.0 MB output. |
| Cache policy nuance | `public/_headers` correctly forces HTML revalidation while allowing immutable caching of hashed chunks — a real bug class avoided. |

---

## 3. P0 — Security (fix before anything else)

### 3.1 The core flaw: identity is a request field, not the session

`workers/backend.ts` contains **8 session lookups** and **~50 reads of a user id from the request body/query**. The client dutifully sends it (`lib/api.ts:202,220,291,299,318,322,349,366,405,584`), so the server never has to ask who you are.

Directly exploitable, all unauthenticated, all `POST`:

| Endpoint | Line | What an anonymous attacker can do |
|---|---|---|
| `/api/recharge/buy` | `1642-1662` | Credits up to **550,000 coins** to any `user_id`, repeatably, with no payment. Body: `{"user_id":"…","package_id":"enterprise"}`. Still labelled "Sandbox top-up". **Reachable from the UI**: `app/wallet/page.tsx:74` calls it. |
| `/api/gifts/send` | `854-902` | `from_user_id` **and** `cost` are client-supplied → drain any user's coin balance and credit a colluding host 70%. |
| `/api/xp/award` | `1105-1134` | ±500 XP per call, unlimited, for any user → forge levels and leaderboard rank. |
| `/api/spin` | `1665-1701` | Weights give EV = `(0·30+10·30+30·20+60·12+150·6+300·2)/100` = **31.2 coins per 20-coin spin** → an infinite coin faucet even without the direct mint. |
| `/api/rewards/claim` | `819-851` | `amount` client-set up to 1000; dedupe is only via `transactions`. |
| `/api/checkin` | `1558-1600` | `amount` up to 500; dedupe is only via `checkins`. Different table from `rewards/claim` → **both** daily claims succeed (≤1500 coins/day). |
| `/api/rooms/private-call` | `1199-1279` | `caller_user_id` **and** `call_price_per_minute` from the body → ring any user and drain their coins. |
| `/api/users/:id` PATCH | `1411-1451` | Changes display name, bio, avatar **and username** of any user, with no session check at all. |

**Fix (one change, applied everywhere):**

```ts
// hoist to the top of fetch(), before any route branch
async function requireUser(): Promise<{ id: string; banned: number } | null> {
  const token = readCookie(request, "session");
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.banned FROM users u JOIN sessions s ON s.user_id = u.id
     WHERE s.id = ? AND s.expires_at > datetime('now')`
  ).bind(token).first();
  return row ?? null;
}

// usage
const me = await requireUser();
if (!me) return j({ ok: false, error: "Sign in required." }, 401);
if (me.banned) return j({ ok: false, error: "Account banned." }, 403);
// then use me.id — never body.user_id
```

Then delete `user_id` / `from_user_id` / `host_user_id` / `caller_user_id` / `amount` / `cost` from every client payload and read them from `gift_catalog` / server config instead. Make money moves atomic and idempotent:

```ts
const r = await env.DB.prepare(
  `UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?`
).bind(cost, me.id, cost).run();
if (r.meta.changes !== 1) return conflict("Not enough coins.");
```

Note `sessionUserId()` already exists at `backend.ts:2455-2460` and `requireChatUser()` at `2607-2612` — they are **byte-identical duplicates**. Consolidate into one `requireUser()` in a shared module.

### 3.2 Username-only login is a full account-takeover endpoint

`workers/backend.ts:905-942` — `POST /api/auth/login` takes **only a username**. No password, no OTP, no Firebase token. It looks the user up `COLLATE NOCASE`, **creates the account if it does not exist**, and returns a 30-day `HttpOnly` session cookie.

Usernames are public via `/api/search` (`1756-1763`), room seats, and `/api/users/:id`. So `curl -X POST …/api/auth/login -d '{"username":"victim"}'` is full takeover — coins, DMs, profile.

The endpoint is currently called only by `stores/useSession.ts:77-86` (the `AuthModal.tsx` UI is unimported), so there is no live button — but the endpoint is public and reachable, and the one-line client helper is still exported.

**Fix:** delete the route, `useSession.login`, and `lib/api.ts:220`. Identity must come from `verifyFirebaseIdToken()` (`backend.ts:186-243`) — the correct flow already exists at `/api/auth/firebase`.

### 3.3 Account linking trusts an unverified email claim

`backend.ts:1023-1055` — `const email = typeof body?.email === "string" ? body.email… : verified.email` — the **request body overrides the verified token email**. The code then does:

```ts
if (!user && email) user = await …`SELECT * FROM users WHERE email = ? COLLATE NOCASE`…;
```

and falls into the "existing user" branch that mints a session for `row.id` (`1071-1091`). So: sign in with *any* Firebase account, POST `{"email":"victim@example.com"}`, receive a session cookie for the victim. Same hole via `body.phone` (`1024`, `1054`).

**Fix:** never accept `email`/`phone`/`firebase_uid` from the body. Use `verified.email` / `verified.phone` only, and require `verified.emailVerified` before using email for linking.

### 3.4 CSRF protection is decorative

`backend.ts:280-303`. The token is **never compared to anything**:

```ts
if (origin && isOriginAllowed(origin)) return true;   // 295 — any allowlisted Origin
…
return csrfToken.length >= 32;                        // 302 — ANY 32-char string passes
```

Plus `/api/admin/*`, `/api/auth/*`, `/api/recaptcha/*`, `/api/calls/session`, `/api/turn` skip it entirely (284-289), and `http://localhost:3000|3001` are allowlisted origins (43-49). `/api/csrf` sets the CSRF cookie `HttpOnly`, which defeats the double-submit pattern it looks like it wants.

It only holds up in real browsers because the session cookie is `SameSite=Lax`. **Combined with §3.1 this makes the economy endpoints cross-site exploitable.**

**Fix:** store a per-session CSRF secret, compare in constant time, drop the Origin shortcut.

### 3.5 PII is publicly readable

`resolveUser()` (`727-733`) is `SELECT *`, and it feeds `/api/users/:id` (`799-805`), `/api/users/:id/profile` (`1388-1407`), `/transactions` (`807-816`), and `/xp` (`1136-1145`) — all unauthenticated. Anonymous callers get **email, phone, firebase_uid, banned/ban_reason, balances**, plus an avatar that may be a ~140 KB base64 data URL (`1421`).

Support tickets are worse: `GET /api/support/tickets/:id` (`2352-2360`) has **no auth** and returns the ticket, all replies, and balances; `?user_id=` lists any user's tickets (`2302-2314`); and the reply route (`2331-2350`) only compares a **body-supplied** `user_id` to the ticket owner — so anyone can read a ticket and then post replies as its owner.

**Fix:** explicit column allowlists per surface; keep `email`/`phone`/`firebase_uid`/`ban_reason` server-side; require a session for the owner branch and an admin token for the staff branch.

### 3.6 Authorization by public value (rooms, seats, bans)

- `DELETE /api/rooms/:id` reads `?host_user_id=` **from the query string** and compares it to the stored host (`1290-1299`); `PATCH` does the same with `body.host_user_id` (`1300-1303`). Host ids are public via `/api/rooms` → **anyone can edit or end any room**.
- Seat routes (`610-703`) let anyone seat **any** user, evict anyone (`683-687` sets `user_id = NULL` with no ownership check), or mute anyone. An attacker can evict the host from seat 0 and install themselves.
- `banned` is checked in only two places (`972-981`, `1086-1089`). `/api/auth/login` hands a fresh 30-day session to a **banned** user, and no other handler (chat, gifts, signals, moments) checks it — so bans are trivially bypassed.

### 3.7 Stored XSS via chat attachments

`backend.ts:2952` stores `file.type` verbatim; the download route (`3030-3036`) serves it back with `Content-Type: <that value>`, `Content-Disposition: inline`, **from the app's own origin**, and with no `X-Content-Type-Options: nosniff`. Upload `text/html` or `image/svg+xml` to a conversation the victim is in → the payload runs same-origin, where it can read the `admin_token` from `localStorage` (§3.8) and call every API with the victim's cookies.

The same response sets `Cache-Control: public, max-age=31536000` on a membership-gated private DM attachment (`3034`) — should be `private, no-store`.

Also note `fileName` is interpolated unescaped into the `Content-Disposition` header (`3033`).

**Fix:** server-side MIME allowlist (image/audio/video), force `Content-Disposition: attachment`, add `nosniff`, use `private, no-store`, serve attachments from a separate origin or signed URL.

### 3.8 Admin token in `localStorage`, no CSP, client-side admin flag

- `app/admin/page.tsx:19` writes `localStorage.setItem("admin_token", tok)`; `components/AppShell.tsx:130` reads it. Any XSS exfiltrates a 12-hour token that can grant currency and ban users. The user session moved to `HttpOnly` cookies — the admin session did not.
- `components/AppShell.tsx:124-129` grants admin **UI** purely client-side: `const ADMIN_ALLOW = ["mahmoudnabil03@gmail.com", "marc@ms-rooms.app", …]; if (email && ADMIN_ALLOW.includes(email.toLowerCase())) { setIsAdmin(true); return; }`. The privileged *actions* still need a server token, so this is not a server bypass — but it leaks staff emails into a public bundle and renders the admin panel without a server check.
- `public/_headers` sets **no** `Content-Security-Policy`, `X-Frame-Options`, `Referrer-Policy`, or `Permissions-Policy` (mic/camera!). For a WebRTC app, `Permissions-Policy` is not optional.
- `logout()` (`stores/useSession.ts:88-96`) never clears `admin_token`, never resets `useCalls`, and swallows a failed `signOut` (`.catch(() => undefined)`) without awaiting the server logout — so on a shared device the next user is still "admin", and logout can silently fail.

**Fix:** authenticate the admin session via `HttpOnly` cookie; clear all stores + `admin_token` on logout and await sign-out; add CSP and `Permissions-Policy: microphone=(self), camera=(self)`.

### 3.9 No rate limiting, weak password hashing

- There is **no rate limiting anywhere** — no KV/D1 counters, no Cloudflare rate-limit binding, no lockout. `/api/admin/login` (`1949-1967`) is unlimited-brute-forceable.
- Passwords use **unsalted, single-round SHA-256** (`sha256hex`, `136-139`; used at `1960`, `2060`, `2278`) with a non-constant-time comparison (`===`). Rainbow tables make this equivalent to plaintext.
- Three seeded admin accounts in `scripts/migrate-triple-currency-admin.sql:28-31` share one byte-identical hash. [verify] whether these rows still exist in production.

**Fix:** PBKDF2-SHA256 via WebCrypto (≥600k iterations) with a per-row random salt, or a Workers-compatible Argon2; constant-time compare; Cloudflare Rate Limiting rules on `/api/auth/*`, `/api/admin/*`, `/api/signal/*`, `/api/spin`.

### 3.10 Free TURN/SFU credentials, and an unauthenticated signaling read

- `GET /api/turn` (`1797-1891`) mints a TURN credential with **`ttl: 86400`** for anonymous callers, and CSRF is explicitly skipped for it (`289`). Anyone can burn your Cloudflare TURN quota. `POST /api/calls/session` is the same.
- `GET /api/signal/poll` (`3113-3147`) verifies a session but **does not verify the caller holds a seat in the room**. It returns `to_user_id = '*'` broadcasts to anyone polling, so a signed-in non-member can passively observe a room's signaling; `to_user_id` is never validated against the room on publish either, so a seated user can write signals addressed to any user id in the system.

**Fix:** require a session + seat for both; shorten the TURN TTL to the call/room session length; validate `to_user_id` is `'*'` or a seat holder of that room; pin the 1:1 counter-party id client-side.

---

## 4. P1 — Correctness & data integrity

### 4.1 Two schema mismatches that silently break shipped features

Both are **certain code/schema mismatches in the repo**; whether production D1 matches these scripts is **[verify]**.

**a) `transactions.type = 'call_charge'` violates the CHECK constraint.**
`scripts/init-db.sql:65` allows `daily_reward | streak_bonus | purchase | gift_sent | gift_received | refund | xp_boost`. `backend.ts:1268` inserts `'call_charge'`. The INSERT is not wrapped in try/catch and there is no `batch()` anywhere in the file, so the constraint failure aborts with a 500 **after `backend.ts:1266` has already committed the coin debit**. Net effect: every private call charges the caller and returns an error, with no ledger row — while `call_transactions` (`1273`) *does* get a row, so the two ledgers permanently disagree.

Note commit `10cbf78` is titled *"fix video call transaction constraint"* but `git show --stat` shows it touched only `components/CallScreen.tsx` — the SQL was never fixed.

```sql
-- SQLite cannot ALTER a CHECK; rebuild the table
PRAGMA defer_foreign_keys = on;
ALTER TABLE transactions RENAME TO transactions_old;
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  room_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('daily_reward','streak_bonus','purchase',
       'gift_sent','gift_received','refund','xp_boost','call_charge','call_refund',
       'admin_credit','admin_debit')),
  amount INTEGER NOT NULL CHECK (amount <> 0),
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL
);
INSERT INTO transactions SELECT * FROM transactions_old;
DROP TABLE transactions_old;
CREATE INDEX idx_transactions_type_created ON transactions (type, created_at DESC);
```

**b) `message_attachments.message_id` is `NOT NULL` but the upload inserts literal `NULL`.**
`scripts/init-db.sql:255` declares `message_id TEXT NOT NULL`; `backend.ts:2981` binds `NULL`. Two bugs in one statement: the insert always fails, **and** the carefully computed `attachmentType` (`2951-2957`) is discarded in favour of the hardcoded `"file"`. The download route joins on `attachment.message_id` (`3010-3016`), so downloads are doubly impossible.

Because R2 `put` succeeds *first* (`2971`), **every failed upload leaks a paid R2 object with no DB row to garbage-collect it.**

**Fix:** make `message_id` nullable (rebuild) or create the message first; pass `attachmentType`; add an R2 lifecycle rule to reap orphans.

### 4.2 No transactions anywhere

`grep '\.batch\('` → **zero matches**. Every multi-statement write can partially commit: gifts (`872-893`), recharge, checkin, spin, private call (`1239-1275`), conversation create, message+attachment+XP, account deletion (`1469-1482`), admin recharge. **Fix:** wrap each logical operation in `env.DB.batch([...])` (D1 executes a batch atomically in one round trip).

### 4.3 TOCTOU races

Read-check-then-write with no DB guard, on money paths: `/api/rewards/claim` (`829-843`) double-credits under concurrency; `/api/gifts/send` (`867-874`) can drive `coins` negative; `/api/spin` (`1672-1689`) same; seat claim (`641-663`) turns a UNIQUE violation into a 500 instead of a 409. **Fix:** `INSERT OR IGNORE` + `meta.changes`, conditional `UPDATE … WHERE coins >= ?`, retry loops.

### 4.4 Account deletion is incomplete, non-atomic, and contradicts the privacy policy

`backend.ts:1454-1497` issues ~10 sequential DELETEs. It omits `transactions`, `moments`, `moment_likes`, `follows`, `checkins`, `spin_plays`, `reports`, `private_call_sessions`, `call_transactions`, `auth_audit`, `support_tickets`, `ai_usage_events`, `admin_users`, conversations the user only participates in, and all R2 objects. `rooms.host_user_id` is `ON DELETE RESTRICT`, so a user who ever hosted a room blocks the whole sequence mid-way. The privacy policy promises deletion within 30 days (`451`).

Related: `admin_transactions.target_user_id` and `transactions.user_id` are both `ON DELETE CASCADE` (`init-db.sql:160, 69`) despite `admin_transactions` being described as an "Immutable audit log" — so the financial record is destroyed along with the user. **Fix:** one atomic batch, plus a retained audit table with PII nulled (`ON DELETE SET NULL`).

### 4.5 Cloudflare limits that will hard-fail in production

| Limit | Where | Consequence |
|---|---|---|
| **100 bound params/query** | `backend.ts:3134-3136` builds `DELETE … WHERE id IN (?,…)` from a `LIMIT 200` select | At ≥99 queued signals the delete throws → poll returns 500 → rows are never consumed → **every later poll fails forever** (poison pill) while the table grows. This is a latent total outage of voice signaling in a busy room. Fix: chunk at ≤50 and add the missing `ORDER BY created_at, id`. |
| **Subrequest cap (50 free / 1000 paid)** | `ensureUserIdentityColumns` (`740-776`) runs 3 `ALTER TABLE` + `CREATE UNIQUE INDEX` + a `SELECT … LIMIT 1000` with up to 5 UPDATEs per row → **up to ~5,000 D1 statements in one request**, once per cold isolate. Guarded by a module-scope flag (`121`) that does not survive isolates. | Unlucky cold-start requests blow the cap and CPU budget. |
| **Subrequest cap** | `/api/conversations` (`2716-2728`) loops `hydrateConversation` (3-5 queries each) | ~250 queries per request; breaks at ~10 conversations on the free tier. |
| **CPU / 128 MB memory** | `/api/attachments/upload` buffers 50 MB twice (`request.formData()` at `2936` then `file.arrayBuffer()` at `2970`) | Concurrent uploads can OOM the isolate. Stream into `R2.put` instead. |
| **D1 rows-written/day** | `expireStaleRinging()` (`2500-2511`) runs on 3 polled endpoints; a global `DELETE FROM rtc_signals WHERE created_at < ?` runs on **every** publish and poll (`3106, 3120`); `ALTER TABLE users ADD COLUMN last_calls_seen` is re-attempted on **every** `/api/calls/missed-count` and `/api/calls/seen` (`2582, 2597`) | D1 is single-threaded per database; a 12-seat room generates ~26 writes/sec of pure sweep overhead, and voice latency is gated on it. Fix: a Cron Trigger (`scheduled` handler — none is exported today) and time-gate the sweeps. |

### 4.6 Migrations have no runner, no version table, and are not re-runnable

Eight of nine `scripts/migrate-*.sql` files use `ALTER TABLE … ADD COLUMN`, which SQLite has no `IF NOT EXISTS` for; each file's own header says in prose "NOT re-runnable, check `PRAGMA table_info` first". There is **no `schema_migrations` table, no runner, no npm script, no CI step** — nothing in the repo applies a migration. Two files are both labelled "Migration 003".

Worse, `init-db.sql` has **drifted** from the migration chain: a fresh DB built from `init-db.sql` alone lacks `users.firebase_uid/email/phone/provider/banned/ban_reason/last_calls_seen`, `rooms.is_private/call_*`, and many tables. Index names even differ for the same columns (`idx_pk_status` vs `idx_pk_battles_status`), so fresh and migrated databases get **different query plans**.

`migrate-calls-tab.sql:9,39` has a live FK bug: `ALTER TABLE private_call_sessions RENAME TO …_old` **rewrites** the referring FK in `call_transactions` (modern SQLite behaviour), which is then dropped with the old table. [verify] with `PRAGMA foreign_key_list(call_transactions)`.

`cleanup-test-users.sql:19` is a naked `DELETE FROM rtc_signals;` with no `WHERE` — running it destroys every in-flight signal for every live room. It also matches users with `username IN ('qa','testfix')` case-sensitively, while `users.username UNIQUE` is case-sensitive but all app lookups are `COLLATE NOCASE` — so a real user registered as `QA` **would** be deleted but would never be flagged as a duplicate by the app.

**Fix:** adopt `wrangler d1 migrations` with a `schema_migrations` table; regenerate one canonical `schema.sql` from production (`SELECT sql FROM sqlite_master ORDER BY type, name`); add `npm run db:migrate`.

### 4.7 Missing indexes on hot, user-facing queries

`/api/leaderboard?type=hosts` (`1720-1731`) filters `transactions.type` and joins `rooms.host_user_id` with **no index on either** → full scan + temp B-tree sort on every leaderboard load. `/api/calls` (`2519-2531`) uses `WHERE caller = ? OR callee = ?` with `ORDER BY created_at` — the `OR` defeats both indexes and neither includes `created_at`. `/api/calls/incoming` and `missed-count` poll without a composite on `(callee_user_id, status, created_at)`.

```sql
CREATE INDEX idx_transactions_type_created ON transactions (type, created_at DESC);
CREATE INDEX idx_rooms_host ON rooms (host_user_id);
CREATE INDEX idx_moments_user ON moments (user_id);
CREATE INDEX idx_reports_status ON reports (status);
CREATE INDEX idx_private_calls_callee_status_created
  ON private_call_sessions (callee_user_id, status, created_at DESC);
CREATE INDEX idx_private_calls_status_created
  ON private_call_sessions (status, created_at);
CREATE INDEX idx_private_calls_caller_created
  ON private_call_sessions (caller_user_id, created_at DESC);
CREATE INDEX idx_messages_conv_sender_created
  ON messages (conversation_id, sender_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_admin_tx_created ON admin_transactions (created_at DESC);
CREATE INDEX idx_users_updated ON users (updated_at DESC);
-- and drop the redundant idx_seats_room (UNIQUE(room_id,seat_index) already indexes it)
```

### 4.8 Smaller correctness issues

- `GET /api/rooms` (`574-586`) filters only `status = 'live'`, so **private 1-on-1 call rooms appear in the public lobby**; `GET /api/rooms/private-call/status` (`2439-2451`) then has no auth and returns both parties' names/avatars. Same leak in the room leaderboard and search.
- `total_charged` on `private_call_sessions` is never read or written and there is no `scheduled` handler → **a private call costs exactly one minute, ever.**
- `?limit=-1` on `/api/admin/transactions` (`2206`) survives clamping (`Math.min(100, -1) = -1`) and SQLite treats `LIMIT -1` as unlimited.
- `banned = body?.banned === true` (`2233`) — a client sending `1` or `"true"` silently fails to ban, with a 200 response.
- Seat index capped at 7 in code (`635, 674`) while the schema allows 0-11 and `rooms.capacity` allows 12 → seats 8-11 are unreachable and 12-capacity rooms cannot be filled.
- `/api/auth/me` returns **400** for a missing token (`952`) instead of 401. Known paths with a wrong method return **404** instead of 405 (`667, 702, 1555, 2857, 2922, 3164`).
- Timestamps mix `'2026-09-07 12:00:00'` (`CURRENT_TIMESTAMP`) with `'2026-09-07T12:00:00.000Z'` (`toISOString`, `2982`) in the same column family, and `rtc_signals.created_at` is epoch-ms INTEGER. Lexicographic comparison across formats is silently wrong (`'T' > ' '`).
- `users.username UNIQUE` is BINARY-collated while every lookup is `COLLATE NOCASE` → `'Maya'` and `'maya'` can coexist, and `resolveUser` then returns a **non-deterministic** row.
- The catch-all returns raw `err.message` (`3165-3167`) — leaking SQLite constraint text, table and column names.
- reCAPTCHA **fails open** when `RECAPTCHA_SECRET_KEY` is unset (`331-336`), and the verification result is never consumed by any signup/login path.
- `catch {}` on money paths: host gem credit (`884-893`), ban session wipe, XP on message send.

---

## 5. P2 — Realtime / voice (the core product)

The architecture (WebRTC mesh + Cloudflare TURN + D1 signaling relay) is sound. The implementation has four bugs that will make calls fail or hang in ways users cannot diagnose.

**[Critical] Trickled ICE candidates are silently dropped** — `lib/realtime.ts:377, 427, 908`. Every `addIceCandidate` is wrapped in `try { … } catch { /* stale */ }`. Candidates arriving before the remote description (the normal trickle order) throw `InvalidStateError` and vanish — no queue, no log. This breaks connectivity precisely on the relay-only/symmetric-NAT paths TURN exists for, and the user sees only *"Both sides may be behind a strict network."*
**Fix:** keep a `pendingCandidates: RTCIceCandidateInit[]` per PC, push when `pc.remoteDescription === null`, flush after every successful `setRemoteDescription`.

**[Critical] `bye` is a room-wide broadcast on a consume-on-poll queue** — `realtime.ts:517, 529, 944` vs `backend.ts:3124-3147`. `to_user_id = '*'` rows are deleted by the **first** poller, so in a 3+ person room (and often in 1:1) the other side never learns the call ended and sits "live" until WebRTC times out. The `HANGUP_MS` constant (`realtime.ts:34`) that was presumably meant to cap this is **dead code**.
**Fix:** address `bye` to each specific peer; add the watchdog.

**[Critical] `renegotiate` is published but read by nobody** — `realtime.ts:884-886`. No poll branch handles `kind === "renegotiate"`, so the mesh retry loop is inert; the stuck PC is protected from retry by the `has(peerId)` guard (`879`) while `offerTo` bails on `signalingState !== "stable"` (`846`). **Fix:** implement perfect negotiation (`negotiationneeded` + `makingOffer`/`ignoreOffer` + `rollback` on collision).

**[Critical] `MESH_CAP` is enforced only on the offerer** — `realtime.ts:843-859` vs `866`. `acceptOffer` checks the cap, but the poll loop calls it for *any* inbound offer, and every room visitor captures a mic (muted) on entry (`802-826`). **Fix:** gate `acceptOffer` on the cap and on actually holding a mic seat.

**[High] Nothing reconnects after `failed`, but the UI says it does** — `realtime.ts:704-711` deletes the PC and the `has()` guard prevents re-adding it; `restartIce()` appears **nowhere in the repo**. Meanwhile `CallScreen.tsx:737-741` renders *"Poor connection — reconnecting…"*. **Fix:** `restartIce()` / `createOffer({iceRestart:true})`, re-add the peer, and only error after N attempts — or change the copy.

**[High] Unmuting never renegotiates → one-way audio** — `realtime.ts:713, 744-746` calls `addTrack` on existing PCs with **no `onnegotiationneeded` handler**, so joining muted and then tapping the mic produces no new offer. Same root cause as the dead `renegotiate`.

**[High] A 60 Hz `setState` loop re-renders the 992-line room** — `realtime.ts:664-672` allocates a new array and calls `setSpeakingUserIds` **every animation frame per peer** (≤7 concurrent RAF loops), defeating memoization; `startMeter(setLevel)` adds another per-frame `setState`. This is the most likely cause of audio glitching on low-end phones, and the cheapest large win available. **Fix:** throttle to ~10 Hz and bail out when the value is unchanged.

**[High] Signaling is 900 ms polling with no backoff and no visibility pause** — `realtime.ts:31, 389, 440, 932`; plus seats 5 s, call status 3 s, incoming 4 s, and `document.hidden` is consulted in exactly one place (`IncomingCallGate.tsx:43`). **Fix:** `visibilitychange` pause, jittered backoff, and consider SSE/WebSocket or a Durable Object per room.

**[Medium] Resource leaks** — the display-capture track is never `stop()`ed in `teardown()` (`252-266`), so the screen-share indicator persists after the call ends; failed peers leave ghost seat entries and stale `<audio>` elements (`704-711`, `912-927`) because `setPeers` is never refreshed; a rejected `el.play()` is swallowed with no retry and no "tap to enable audio" banner (`688-702`).

**[Medium] `getUserMedia` is called outside any `try`** in `createLocalCapture` (`118-125`) while `reactStrictMode: true` — on an insecure origin the effect rejects unhandled and the room is stuck on "connecting" with no error UI.

**[Medium] `joinedRef` is a one-way latch** (`CallScreen.tsx:185`), making the error-screen **"Rejoin" button dead**: `join()` is never re-run because the effect depends only on `[screen.kind]`.

**[Medium] Self-mute is invisible to peers** — `is_muted` comes from the seats row, which the in-room mic button (`voice.toggleMic`) never writes, so a muted speaker still shows a green mic to everyone.

**[Medium] Eight `alert()` calls** in the call flows (`RoomView.tsx:309, 312, 331, 334, 352, 355, 717, 720`) block the event loop — freezing the WebRTC and RAF loops for as long as the dialog is open.

**Good news:** no `any` in the audited realtime files, and the signaling relay server-side checks (seat membership, `kind` allowlist, 60 KB cap) are reasonable.

---

## 6. P3 — Frontend architecture & performance

### 6.1 Static export ships no content (SEO + LCP)

Verified against the committed build output:

- `out/index.html` (7.6 KB) has a body containing **only** a "Loading…" spinner — because `app/page.tsx:74-81` returns early on `!ready` (`ready: false` initially). The entire 413-line marketing page is invisible to crawlers and paints only after JS + a failing `apiMe()` round trip.
- `out/lobby.html` contains the string `Email address`; `out/support.html` does **not** contain `Support Desk`. Every app route's exported HTML is the login form, because `AppShell.tsx:184-189` gates on `!user`.

**Fix:** render the static marketing sections unconditionally in a server component and isolate the redirect in a tiny client child; render real per-route shells instead of the `AppShell` login gate. Add `app/error.tsx`, `not-found.tsx`, `loading.tsx` (none exist), plus `robots.ts`/`sitemap.ts` and `openGraph`/`twitter` metadata.

### 6.2 Broken links and dead UI

- `AppShell.tsx:73-99` defines **17 sidebar links that do not exist** (`/admin/users`, `/admin/rooms`, `/my-rooms`, `/analytics`, `/settings/*`, …). The app has 15 routes. The admin panel's own navigation 404s.
- `AppShell.tsx:199` filters only `n.href !== "/admin"`, while `getSidebarConfig` returns the admin list for **any** `/admin/*` path — so non-admins see all 10 admin links.
- **Room "Live chat" does not work**: `RoomView.tsx:468-473` only calls local `pushMsg` — nothing is POSTed and no room-message polling exists, so participants cannot see each other's messages in a "live voice room" app.
- `RoomView.tsx:486` (`scoreB: ... + Math.floor(Math.random() * 20)`), `:518-525` (hardcoded opponent list) and `CallScreen.tsx:111` (RPS opponent) present `Math.random()` as a real peer in "PK battle" and "multiplayer" games. Combined with client-computed `awardXp` calls (`:231, 443, 605`), rewards are self-awarded.

### 6.3 State & data-fetching

- **No data layer at all**: no cache, dedupe, abort, retry, or unified error/loading/empty contract. Each of ~10 pages repeats `load()` + `useEffect` + `loading` + `error` + `.catch {}`.
- **Errors render as empty states**: `rankings/page.tsx:35-36` → "No ranks yet / Send a gift in any live room to claim the crown" on a network error; same in wallet, calls, lobby, moments, admin. `support/page.tsx:16-21` has **no** catch → unhandled rejection.
- **`user` object identity drives refetch storms**: `useSession.refresh()` replaces the whole object (`stores/useSession.ts:98-107`), and effects depend on `[user]`, so `wallet/page.tsx:74-77` triggers a 3× duplicated fetch, and `RoomView.tsx:190` re-pushes the "Welcome to …" system message on every refresh. **Fix:** depend on `user?.id` and memoize loaders.
- **Nine independent polling loops** (`AppShell` 30 s, `calls` 8 s, `IncomingCallGate` 4 s, `RoomView` 5 s + 3 s, `ChatPanel` 4 s, `LobbyView` 15 s, `moments` 20 s, `realtime` 900 ms), almost none visibility-aware. Consolidate into one scheduler.
- **No 401 handling**: `lib/api.ts:31-49` throws `ApiError` and each caller decides. When the 30-day cookie expires mid-session the app keeps rendering a signed-in shell whose actions fail silently. Add an interceptor that clears the session and routes to `/login`.
- **CSRF token cached forever** with no in-flight dedupe (`lib/api.ts:20-29`) — harmless only because §3.4 currently accepts anything; it becomes a bug the moment CSRF is fixed properly.
- **Optimistic DM never rolled back** (`ChatPanel.tsx:172-181`) — a failed send stays on screen as delivered.
- **Search race**: `app/search/page.tsx:25-44` clears only the debounce timer, so in-flight responses still call `setState` out of order; `.catch(() => undefined)` leaves `searched` false so a failed search renders nothing.
- **Dead store**: `stores/useAuth.ts` persists `token` + full user to `localStorage("viberoom-auth")` — nothing imports it; delete it. (It would also hydration-mismatch under `output: "export"`.)

### 6.4 Performance

- 60 Hz meter re-renders (see §5) is the worst offender; then `app/globals.css:216-231`, which applies `transition: all` + `will-change: transform` to **every** `a`/`button` plus a global `:hover { transform: scale(1.02) }` — compositor layers for every control on the page and a global override of intentional transforms.
- **Dead heavy dependencies ship**: `livekit-client` + `@livekit/components-react` are never imported (the app uses raw `RTCPeerConnection`); `lib/genkit.ts` (154 lines) duplicates `lib/ai.ts` and can never run under `output: "export"`, yet `genkit` + `@genkit-ai/googleai` are runtime deps. Dead components: `AuthModal.tsx`, `ProfileBadge.tsx`, `RightRail.tsx` (imported but never rendered), `MOCK_ROOMS`/`MOCK_LISTENERS` in `lib/rooms.ts:30-79`.
- CSS bugs with real effects: `--duration-normal` is referenced 7× but the token is `--dur-base`/`--dur-fast`/`--dur-slow` (`globals.css:218, 236-238, 252-254, 293`) → those transitions and `.stagger-item`'s animation **never apply**; `animate-slide-up` (`CookieConsentBanner.tsx:76`) is not defined anywhere.
- `prefetch={false}` on essentially every internal `Link` in a static export where chunks are immutable.
- One unlabeled remote `<img>` with no dimensions (`CallScreen.tsx:852`); `images: { unoptimized: true }` and raw `<img>` throughout.

### 6.5 Component size & duplication

| File | Lines | What to extract |
|---|---|---|
| `components/RoomView.tsx` | **992** | `useRoomBootstrap`, `useSeats`, `<SeatGrid>` (memoized so meter churn stops re-rendering chat), `<RoomHeader>`, `<GiftRushBar>`, `<IncomingCallModal>` on a shared `useIncomingCall` store |
| `lib/realtime.ts` | 970 | `usePeerConnections`, `useLocalCapture`, `useAudioMeter`, `useRoomSignaling` |
| `components/CallScreen.tsx` | 852 | `useCallBootstrap`, `useRingingPoll`, `useCallActions`, one `InCallToolbar` for the two ~180-line near-duplicate control clusters (`646-722` / `767-833`) |
| `app/admin/page.tsx` | 740 | 7 inline tab components → `components/admin/*` |
| `app/profile/page.tsx` | 666 | `OwnProfile` (`205-454`) and `FriendProfile` (`556-647`) duplicate the same `cards` array and shell → `<ProfileHeader/>`, `<ProfileStats/>` |
| `components/MiniGamePanel.tsx` | 447 | 4 games; `roomId` prop is dead (`:46,49`) |
| `components/ChatPanel.tsx` | 425 | `useConversations` + `useThread` |

Also duplicated: `sessionUserId` / `requireChatUser` are byte-identical in the backend; cookie parsing is hand-rolled 6× (`298-299, 946-947, 985-986, 1456-1457, 2456, 2608`); `RoomView` reimplements `lib/api.ts` helpers with raw `fetch` (`252, 297, 319, 341, 703`); coin packages exist in three places (`pricing_tiers`, a hardcoded map at `1646`, and a fallback list at `1631-1639`).

### 6.6 Build health

```
npx tsc --noEmit   → exit 0 (clean under strict)
npx next build      → exit 0 (17 static routes, 2.0 MB)
npx eslint .        → exit 1 — 31 errors, 54 warnings
```

Errors are React 19 Compiler rules: `react-hooks/set-state-in-effect` (17), `react-hooks/purity` (7, e.g. `Date.now()`/`Math.random()` during render), `react-hooks/immutability` (3), plus `prefer-const`, `@typescript-eslint/no-explicit-any`, `react-hooks/refs`. Concentrated in `CallScreen.tsx` (8), `RoomView.tsx` (3), `app/profile/page.tsx` (3), `IncomingCallGate.tsx`, `CookieConsentBanner.tsx`, `AppShell.tsx`, `app/calls/page.tsx` (2 each).

**There are zero tests** (0 `*.test.*` / `*.spec.*` files) and **no CI** (`.github/` is empty). Also two junk zero-byte files sit in the repo root (`console.error(chunk.toString()))` and `{`), and a gitignored `best-audio-room/` scaffold directory duplicates a `create-next-app` project.

---

## 7. P4 — Accessibility

- **Placeholder-only fields** with no accessible name on most pages: `support/page.tsx:43-51`, `admin/page.tsx:109-126, 319, 369-385`, `search/page.tsx:78-85`, `LobbyView.tsx:76-82`, `RoomView.tsx:801-804`, `ChatPanel.tsx:401-413`, `AuthModal.tsx:44-51`. The codebase already does this right in `FirebaseAuthPanel.tsx:277-281` (`<label htmlFor>`) — apply that everywhere.
- **Modals lack Escape and focus management.** `ServerCheckinModal.tsx:91-93` puts `onKeyDown` on a `<div>` with no `tabIndex`, so it never fires — the comment claims otherwise. `bits.tsx:82-119` has `role="dialog" aria-modal="true"` but no Escape, no focus trap, no initial focus, no focus restore, no scroll lock. Build one shared `<Dialog>`.
- **Clickable divs / mouse-only**: `MiniGamePanel.tsx:378-383` (reaction pad, unreachable by keyboard); `ChatPanel.tsx:340-343` loads history on `onWheel` only, so touch and keyboard users can never load older messages.
- **Missing selection semantics**: no `aria-pressed` on toggles (`create/page.tsx:69-97`, `rankings/page.tsx:55-63`), radio groups built from buttons (`RoomView.tsx:971-977`), `role="tab"` with no `tabpanel` (`calls/page.tsx:132-145`, `LobbyView.tsx:85-98`).
- **Unannounced async state**: `Spinner` sets `aria-label` on a `<div>` with no role (`bits.tsx:171-176`) — use `role="status"`/`aria-live`; message lists have no `role="log"`.
- **Contrast** was addressed as a fragile class-name hack: `globals.css:193-209` remaps only `text-white/10..45`, so other low-alpha text escapes it (e.g. `text-amber-200/70`, `text-rose-300` on `bg-rose-500/20`).

---

## 8. Operations & compliance

- **No secrets are committed** — `.env` and `.env.production` are gitignored and `.env.production` holds only browser-public `NEXT_PUBLIC_*` values. `android/google-services.json` and the iOS plists are tracked but contain no service-account private keys. Good.
- `.gitignore:10` is `.env*`, which also ignores `.env.example` — so a fresh clone gets **no template**. Add `!.env.example`.
- **The privacy policy shipped in the API is stale and contains false security claims.** `backend.ts:442` advertises "Cloud Armor rate limiting / geo-blocking / WAF (SQLi/XSS v33)" and CSRF protection. There is no rate limiting (§3.9), CSRF is decorative (§3.4), and `infra/cloud-armor/` protects a **GCP external HTTP(S) load balancer** that this Cloudflare Pages architecture does not use — its rules never see a byte of traffic. The policy also names Firebase project `ms-room-audio` while the code verifies `ms-rooms-auth`.
- **`/privacy-policy` 404s.** The 130-line policy lives in `backend.ts:356-484`, but `out/_routes.json` is `{"include": ["/api/*"]}` and the only Pages Function is `functions/api/[[path]].ts`, so it never executes. There is no `app/privacy*/page.tsx`, no `public/privacy*`, no `_redirects`. For a store submission this is a blocker.
- **`infra/cloud-armor` also has concrete defects** if ever used: `main.tf:22` defaults `project_id` to the reCAPTCHA site key (an invalid GCP id, acknowledged in its own comment); `trusted_cidrs` defaults to RFC 5737 documentation ranges in an `allow` rule at priority 900; the rate-limit path matcher references `/api/sensitive/.*` and `/login`, which do not exist (real paths are `/api/auth/login`, `/api/admin/*`).
- **No preview environment**: `wrangler.toml` has no `[env.preview]`, so every preview deploy binds to the **production** D1 (`82d9964f-…`) and the production R2 bucket. Any exploratory `wrangler d1 execute` hits live data.
- **No backup/restore procedure** is documented anywhere, while two migrations do destructive work. D1 Time Travel bookmarks are available but unused.
- **No retention/GC**: `sessions` gains a row per login forever (`/api/auth/firebase` mints a new one on **every** sign-in without revoking old ones); `ai_usage_events` is written on every AI call and has **no read path at all** in the backend; `auth_audit`, `xp_events` (written on every chat message), and `rtc_signals` all grow unbounded. Nothing is pruned — there is no `scheduled` export.
- Config drift to reconcile: `backend.ts:128` hardcodes `"ms-rooms-auth"` while `Env.FIREBASE_PROJECT_ID` (`33`) is declared and documented as an override but **never read**; the served backend domain (`bestaudiobackend.mahmoudnabil03…`) differs by one character (`x`) from the CORS allowlist entry (`mahmoudxnabil`) and points at a Worker this repo no longer deploys; every migration header says `wrangler d1 execute best-audio-room` while `wrangler.toml:21` names the DB `audioroom-db`.

---

## 9. Recommended roadmap

### Week 1 — stop the bleeding (P0)

1. Add `requireUser()` + `requireRole()` in a shared module; call it on every authenticated route; delete client-supplied identity from all payloads (§3.1). Verify with an unauthenticated `curl` sweep of every endpoint.
2. Delete `POST /api/auth/login`, `useSession.login`, `lib/api.ts:220`, and `components/AuthModal.tsx` (§3.2).
3. Use `verified.email`/`verified.phone` only in `/api/auth/firebase`; require `emailVerified` for linking (§3.3).
4. Replace CSRF with a server-validated, constant-time token (§3.4).
5. Column allowlists everywhere; lock down support tickets and the room/seat/ban authorization (§3.5, §3.6).
6. Attachment MIME allowlist + `Content-Disposition: attachment` + `nosniff` + `private, no-store` (§3.7).
7. Admin session → `HttpOnly` cookie; clear all stores + `admin_token` on logout; add CSP and `Permissions-Policy` to `public/_headers` (§3.8).
8. Remove the client-side `ADMIN_ALLOW` admin grant (§3.8).
9. Cloudflare Rate Limiting on `/api/auth/*`, `/api/admin/*`, `/api/signal/*`, `/api/spin`; PBKDF2 for admin passwords (§3.9).

### Week 2 — correctness & voice (P1, P2)

10. Rebuild `transactions` with `call_charge`; wrap money flows in `env.DB.batch()`; make balance checks conditional in SQL (§4.1, §4.2, §4.3).
11. Fix attachment upload (`message_id` nullable, pass `attachmentType`) and add an R2 lifecycle rule (§4.1).
12. Chunk the `IN (…)` delete at `backend.ts:3135` at ≤50 — this is a latent total voice outage (§4.5).
13. Move all runtime DDL/backfill into migrations; add a `schema_migrations` runner; regenerate canonical `schema.sql`; fix `migrate-calls-tab.sql` and `cleanup-test-users.sql` (§4.6).
14. Add the missing indexes (§4.7).
15. ICE candidate queue; per-peer `bye`; perfect negotiation; enforce `MESH_CAP` on the answerer; throttle the meter to 10 Hz (§5).

### Weeks 3–6 — product quality

16. Consolidate polling (one visibility-aware scheduler, or SSE/WebSocket); fix reconnect with `restartIce()` and correct the "reconnecting…" copy; surface `turnReady`, handle `onicecandidateerror`, add a "tap to enable audio" recovery.
17. Make room chat real; roll back failed optimistic DMs; make rewards and PK/game results server-authoritative.
18. Introduce the data layer (`useAsync` with loading/error/empty/retry/abort), key on `user?.id`, add global 401 handling.
19. Split `RoomView`, `CallScreen`, `realtime.ts`, `admin/page.tsx`, `profile/page.tsx`.
20. Static marketing content in the exported HTML; real route shells; per-route metadata + `robots.ts`/`sitemap.ts`; `error.tsx`/`not-found.tsx`.
21. Fix the 17 dead sidebar links; gate the admin nav on the server-verified role.
22. Service worker: prompt + reload on `controllerchange`; cache under `req` not a fixed `/index.html` key (currently an offline visit to `/lobby` can serve the `/wallet` document).
23. Accessibility pass: labels, one shared `<Dialog>`, keyboard support, `aria-pressed`/tab semantics, `role="status"`.
24. Add CI: `typecheck` + `lint` + `build` on every PR; make `npm run lint` green (31 errors today). Add Vitest with unit tests for `levels`, `firebase-hint`, and route handlers; add a smoke test that `curl`s every endpoint unauthenticated and asserts 401/403.
25. Delete dead weight: `livekit-*`, `genkit`, `lib/genkit.ts`, `AuthModal`, `ProfileBadge`, `RightRail`, `MOCK_ROOMS`, `stores/useAuth.ts`, the two junk root files, the `best-audio-room/` scaffold. Fix `--duration-normal` → `--dur-base` and define/remove `animate-slide-up`.
26. Correct or remove the false security claims in the privacy policy; serve a real `/privacy-policy` page from the static export.
27. Add `[env.preview]` with separate D1 + R2 so previews stop touching production; document D1 Time Travel bookmarks and a nightly export.

---

## 10. How to verify the open questions

```bash
# Confirm the deployed D1 schema (resolves the [verify] items in §4.1)
npx wrangler d1 execute audioroom-db --remote \
  --command="SELECT sql FROM sqlite_master WHERE name IN ('transactions','message_attachments')"

# Confirm whether private call rooms leak into the public lobby
curl -s https://<host>/api/rooms | jq '.rooms[] | select(.is_private==1)'

# Confirm the unauthenticated economy hole end-to-end (safe: use a throwaway account)
curl -s -X POST https://<host>/api/xp/award \
  -H 'Content-Type: application/json' -H "X-CSRF-Token: $(printf 'a%.0s' {1..32})" \
  -d '{"user_id":"<victim-id>","amount":500,"reason":"test"}' | jq

# Confirm the schema-migration drift
npx wrangler d1 execute audioroom-db --remote --command="PRAGMA foreign_key_list(call_transactions)"
npx wrangler d1 execute audioroom-db --remote --command="PRAGMA table_info(users)"
```

---

## 11. Top 12 by severity

1. **Identity is client-supplied on ~50 endpoints** → mint currency, drain balances, forge XP, change anyone's username (`backend.ts:854, 819, 1105, 1558, 1665, 1411, 1199`).
2. **`POST /api/recharge/buy` grants 550,000 coins free** and is reachable from the wallet UI (`1642-1662`; `app/wallet/page.tsx:74`).
3. **Username-only login = account takeover** (`905-942`).
4. **Account linking trusts an unverified `body.email`** → takeover via any Firebase account (`1023-1055`).
5. **CSRF accepts any 32-char string and skips admin/auth routes** (`280-303`).
6. **Public PII dump + support tickets readable/writable anonymously** (`727-733, 2302-2360`).
7. **Every private call charges coins and then 500s** — `call_charge` not in the CHECK (`1268` vs `init-db.sql:65`).
8. **Attachments are 100% broken and leak paid R2 storage** — `message_id NULL` (`2981` vs `init-db.sql:255`).
9. **Poison-pill signaling delete** (up to 200 bound params vs D1's 100) → voice outage at ≥99 queued signals (`3134-3136`).
10. **Stored XSS via attachment MIME + `inline` from the app origin**, with `admin_token` in `localStorage` and no CSP (`2952, 3030-3036`).
11. **ICE candidates dropped / `bye` broadcast / `renegotiate` inert / no `restartIce`** → reliable-connection failures users can't diagnose (`realtime.ts:377, 517, 884, 704`).
12. **Bans bypassable, rooms/seat hijackable, no rate limiting, unsalted SHA-256 admin passwords** (`905-942, 610-703, 1290-1303, 1960`).
