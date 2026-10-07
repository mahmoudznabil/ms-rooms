# MS-ROOMS — Production Readiness Plan

**Companion to:** [CODE-REVIEW.md](./CODE-REVIEW.md) (full findings with line references)
**Launch target:** web only, Cloudflare Pages + D1 + R2
**Monetization:** deferred — see §2

---

## 1. The decision that shapes this plan

You chose **IAP for coin purchases** and **web-only launch**. Those cannot both be true at launch, so this plan resolves it deliberately:

- **Apple/Google IAP only exists inside native apps.** A Cloudflare Pages web app cannot call StoreKit or Play Billing. There is no web-only IAP.
- **Apple Guideline 3.1.1** requires digital currency consumed in an iOS app to be sold via IAP, and forbids pointing users at an external checkout for it.

**So: the web launch sells nothing.** Coins stay a purely earned currency, `/api/recharge/buy` is **deleted** (it is an unauthenticated 550,000-coin mint reachable from the wallet UI), and IAP becomes Phase 6, gated on shipping a native shell.

The one thing to get right *now* is the ledger: Phase 2 introduces `admin_credit`/`admin_debit` and the receipt-idempotency shape so Phase 6 is an add-on rather than a rewrite of the money tables. Migration 008 already widened the enum for this.

**Consequence for the product:** with no purchase path, coins are earned only (check-in, gifts, spin, rooms). That is a perfectly coherent v1 economy — and it means the +EV spin faucet and the double daily-claim are economy-breaking bugs rather than mere balance issues, so they stay in Phase 1.

---

## 2. Definition of "production-ready"

All eight must hold before the first real user arrives. This is the go/no-go bar, not a wish list.

| # | Criterion | Evidence required |
|---|---|---|
| 1 | No endpoint trusts client-supplied identity | Automated probe: every mutating route called unauthenticated returns 401/403; two-account isolation test passes |
| 2 | No account-takeover path | Username-only login deleted; email/phone linking requires a verified claim; attachment claim scoped to uploader |
| 3 | Money and XP cannot be forged | Server-side amounts; conditional debits; concurrent-spin/claim test shows no double-credit |
| 4 | Voice connects and recovers | 2-person and 5-person calls on 3 network profiles (LAN, home NAT, mobile hotspot), plus mid-call network drop and rejoin |
| 5 | No PII leak | `curl` on profile/transactions/xp/support as an anonymous caller returns no email/phone/firebase_uid |
| 6 | Recoverable | D1 Time Travel bookmark recorded; a tested restore; one-command rollback of the Pages deploy |
| 7 | Observable | Error tracking, D1 error/latency visibility, and an alert that fires when the API 5xx rate spikes |
| 8 | Legally shippable | Privacy policy live at a real URL, claims true, cookie consent actually gates analytics, self-service deletion works end to end |

---

## 3. Assumptions

- One to two engineers, part-time-to-full-time. Estimates are **focused engineer-days** and assume familiarity with the codebase.
- No native app work in scope until Phase 6.
- Production already exists (`ms-rooms.pages.dev`); there are no real users to migrate, so we can be aggressive.
- A staging environment will be created (Phase 0) — currently **previews share the production D1 and R2 bucket**, which must be fixed before any migration work.

---

## 4. The plan

### Phase 0 — Guardrails (3–5 days)

Nothing risky should happen until we can detect and reverse it. This phase exists because the codebase currently has **no CI, no tests, no migration runner, no backups, no error tracking, and previews that write to production data.**

| Task | Detail |
|---|---|
| CI on every PR | `.github/workflows/ci.yml`: `tsc --noEmit` + `next build` **blocking**; `eslint` non-blocking at first (31 errors today — see Phase 4 for the burndown), flipping to blocking before launch |
| Staging environment | Add `[env.preview]` to `wrangler.toml` with a **separate** D1 database and R2 bucket. Today every preview binds production `82d9964f-…` and bucket `ms-rooms`. |
| Migration runner | Adopt `wrangler d1 migrations` with a `schema_migrations` table. Renumber the chain (two files are both labelled "003"), prefix with order (`0001_`…), and add `npm run db:migrate`. |
| Canonical schema | Regenerate one `scripts/schema.sql` from production (`SELECT sql FROM sqlite_master ORDER BY type, name`) so `init-db.sql` stops drifting, and make it the source of truth. |
| Backups | Document the D1 Time Travel bookmark workflow; **record a bookmark before every destructive migration**. Add a nightly `wrangler d1 export --remote` to R2. |
| Observability | Error tracking (Sentry or equivalent) for both the Pages Function and the browser; Cloudflare Workers analytics; an alert on API 5xx rate and on D1 error rate. |
| Rollback rehearsal | Deploy, then roll back, on staging. Know the exact commands before you need them. |

**Exit:** a PR cannot merge with a broken build; a preview deploy provably does not touch production data; a bookmark can be created and restored.

---

### Phase 1 — Security lockdown (10–15 days) — **the launch blocker**

This is one architectural change applied consistently, plus hardening. It is not compressible: every day it is open, any anonymous visitor can take over any account.

| # | Task | Notes |
|---|---|---|
| 1.1 | **`requireUser()` / `requireRole()`** in a shared module; call on every authenticated route | Replaces the byte-identical `sessionUserId()`/`requireChatUser()` duplicates. Centralises the `banned` check (today only 2 of ~50 handlers check it). |
| 1.2 | **Remove client-supplied identity from every payload** | `user_id`, `from_user_id`, `host_user_id`, `caller_user_id`, `callee_user_id`, `reporter_id`, `amount`, `cost`. Update `lib/api.ts` signatures and all call sites. |
| 1.3 | **Server-side prices and amounts** | Read gift cost from `gift_catalog`, spin cost/segments from config, call price from server config. |
| 1.4 | **Delete `POST /api/auth/login`, `useSession.login`, `lib/api.ts:220`, `components/AuthModal.tsx`** | Username-only login = full takeover. |
| 1.5 | **Delete `POST /api/recharge/buy`** | Free 550k coins, reachable from the wallet UI. Remove the wallet buy button. |
| 1.6 | **Fix account linking** | Use `verified.email`/`verified.phone` only; require `emailVerified`; never accept `email`/`phone`/`firebase_uid` from the body. |
| 1.7 | **Real CSRF or a documented replacement** | Current check accepts any 32-char string. Either store a per-session secret and compare in constant time, or drop the custom layer and rely on `SameSite=Lax` + a strict `Origin` allowlist — but decide explicitly and remove the dead code. |
| 1.8 | **Column allowlists on every public read** | `email`, `phone`, `firebase_uid`, `ban_reason`, `banned` must not leave the server on `/api/users/:id`, `/profile`, `/transactions`, `/xp`. |
| 1.9 | **Lock down support tickets** | Session required for the owner branch; admin token for staff; remove the body-supplied `user_id` ownership check. |
| 1.10 | **Fix authorization-by-public-value** | Rooms edit/end and seat claim/evict/mute must compare against the session, not a query-string or body id. |
| 1.11 | **Atomic, idempotent money moves** | `UPDATE users SET coins = coins - ? WHERE id = ? AND coins >= ?` + `meta.changes` check; `env.DB.batch()` for multi-statement flows. Also closes the double daily-claim and the +EV spin. |
| 1.12 | **Admin session → `HttpOnly` cookie**; clear on logout | Stops a 12-hour privileged bearer token sitting in `localStorage` for any XSS to take. |
| 1.13 | **Security headers** | CSP, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy: microphone=(self), camera=(self)` in `public/_headers`. The Permissions-Policy matters for a WebRTC app. |
| 1.14 | **Rate limiting** | Cloudflare Rate Limiting rules on `/api/auth/*`, `/api/admin/*`, `/api/signal/*`, `/api/spin`, `/api/attachments/upload`. Also fixes unlimited admin-password brute force. |
| 1.15 | **PBKDF2 for admin passwords** + delete the three seeded rows sharing one SHA-256 hash | Verify against production first. |
| 1.16 | **Gate TURN/SFU credentials** behind a session; shorten TTL from 86400 | Today anyone can burn your TURN quota. |
| 1.17 | **Generic 500s** | Log detail server-side; return a correlation id. Stops leaking SQLite constraint text and schema names. |
| 1.18 | **Attachments** | ✅ **Done in this session** — see §5. |
| 1.19 | **AI moderation fail-open** | `lib/ai.ts` returns `{ allowed: true }` on error, and the call happens client-side. Decide: server-side moderation or explicit fail-closed, and disclose Gemini processing in the privacy policy. |
| 1.20 | **Unattended probe suite** | An unauthenticated request sweep over every route asserting 401/403, plus a two-account isolation test. This is the evidence for criteria #1 and #2 and doubles as the integration test suite. |

**Exit:** probe suite green; no client-supplied identity remains (grep-clean); headers verified on the deployed URL; rate limits demonstrated; staging survives a red-team pass by a second person.

---

### Phase 2 — Data integrity & correctness (6–8 days)

| Task | Detail |
|---|---|
| Apply migrations 008 + 009 | Pre-migration checklist below. Verify row counts and the rebuilt DDL. |
| Reap R2 orphans | The attachment bug leaked an object per upload attempt. Audit unclaimed rows, reconcile against the bucket, delete true orphans, then add an R2 lifecycle rule. |
| Fix the signal-poll poison pill | `DELETE … WHERE id IN (?,…)` binds up to 200 params against D1's 100 limit. Chunk at ≤50. **This is a latent total voice outage at ≥99 queued signals.** |
| Move runtime DDL out of the request path | `ensureUserIdentityColumns` can issue ~5,000 statements in one cold-start request. Also the per-poll `ALTER TABLE users ADD COLUMN last_calls_seen`. |
| Fix account deletion | One atomic batch across every table + R2 objects + a tombstone. Today it is partial and omits ~13 tables. |
| Financial-record retention | Change `transactions.user_id` / `admin_transactions.target_user_id` from `ON DELETE CASCADE` to a retained audit shape so deletion doesn't destroy the ledger. |
| Admin ledger types | Move `/api/admin/recharge` off masquerading as `purchase`/`refund`/`gift_sent`/`gift_received` (it corrupts the hosts leaderboard) onto `admin_credit`/`admin_debit` — the enum is already widened. |
| Leaderboard correctness | Attribute host gift revenue to the host's own credit rows, not the sender's debit rows. |
| Missing indexes | The set in CODE-REVIEW §4.7. Biggest wins: `transactions(type, created_at)`, the private-call composites, and `messages(conversation_id, sender_id, created_at)`. |
| `scheduled` handler | Move `expireStaleRinging`, the signal sweep, and session pruning off the request path; add retention for `sessions`, `ai_usage_events`, `auth_audit`, `xp_events`. |
| N+1 fixes | `/api/conversations` issues ~250 queries per request and breaches the free-tier subrequest cap at ~10 conversations. Replace with grouped aggregates. |
| `users.username` case-sensitivity | Add `UNIQUE INDEX ON users(lower(username))`. Today `'Maya'` and `'maya'` can coexist and `resolveUser` returns a nondeterministic row. |
| Timestamp standardisation | One ISO-8601 UTC format. **Do this as its own migration, carefully** — existing comparisons are lexicographic and mixing formats silently breaks the daily window and leaderboards (migration 008 deliberately preserves `CURRENT_TIMESTAMP` for this reason). |
| Avatar storage | Move base64 avatars out of the hot `users` row into R2, or bound them with a CHECK. |

**Exit:** row counts reconcile; no request exceeds D1's subrequest or parameter limits under a load test; deletion leaves no orphans; a nightly export exists.

---

### Phase 3 — Voice reliability (5–8 days) — *the product*

Voice is the reason users are here, and today it fails in ways users cannot diagnose or recover from. All four Criticals from CODE-REVIEW §5.

| Task | Detail |
|---|---|
| ICE candidate queue | Buffer candidates until `remoteDescription` is set, then flush. Today they throw and vanish — on exactly the relay-only paths TURN exists for. |
| Per-peer `bye` | Stop broadcasting on a consume-once queue; the other side never learns the call ended. Add the hangup watchdog (`HANGUP_MS` is currently dead code). |
| Perfect negotiation | Replace the inert `renegotiate` signal. This is also what makes **unmuting after joining** transmit — currently one-way audio until both sides rejoin. |
| `MESH_CAP` on the answerer | Listeners currently answer unbounded offers. |
| Real reconnection | `restartIce()` on failure; today a failed peer is permanently stranded while the UI claims "reconnecting…". Fix the copy either way. |
| Meter throttle | 60 fps `setState` from up to 7 RAF loops re-renders a 992-line component. Throttle to ~10 Hz and bail out when unchanged — cheapest large win for audio quality on low-end phones. |
| Failures made diagnosable | Surface `turnReady`/`usingRelay`, handle `onicecandidateerror`, add a "tap to enable audio" recovery for rejected `play()`, distinguish permission-denied from TURN-unavailable. |
| Resource leaks | Stop the display-capture track on teardown; one `dropPeer()` helper for PCs, streams, analysers, audio elements and seat state. |
| Polling consolidation | One visibility-aware scheduler with jittered backoff, replacing 9 independent loops (the 900 ms signal poll continues in background tabs today). |

**Exit:** the device/network test matrix passes. This needs **real devices on real networks** — it cannot be unit tested. Budget a day for it.

---

### Phase 4 — Frontend architecture & correctness (8–12 days)

| Task | Detail |
|---|---|
| Data layer | `useAsync` with loading/error/empty/retry/`AbortController`, keyed on `user?.id`. Fixes: errors rendering as empty states in 6+ pages, search races, out-of-order responses. |
| Global 401 handling | An interceptor that clears the session and routes to login. Today an expired cookie leaves a signed-in shell whose actions fail silently. |
| Logout correctness | Clear `admin_token`, reset `useCalls`, `clearFirebaseSessionHint`, **await** sign-out. Today logout can silently fail and the next user on a shared device is still admin. |
| Make room chat real | `RoomView.handleSend` only mutates local state — participants cannot see each other's messages in a "live" app. |
| Server-authoritative rewards | Remove client-computed `awardXp`; stop presenting `Math.random()` as a real opponent in PK/RPS. |
| Optimistic rollback | Failed DMs must not stay on screen as delivered. |
| Timer/interval leaks | `MiniGamePanel`, `SpinModal`, `PKBattleBar`, `CallScreen`. |
| Component splits | `RoomView` (992), `realtime.ts` (970), `CallScreen` (852), `admin` (740), `profile` (666). Specific extraction lists in CODE-REVIEW §6.5. |
| Dead-code removal | `livekit-*` and `genkit` deps (never imported / cannot run under static export), `lib/genkit.ts`, `AuthModal`, `ProfileBadge`, `RightRail`, `MOCK_ROOMS`, `stores/useAuth.ts`, the two junk root files, the `best-audio-room/` scaffold. |
| Lint to green | 31 errors, mostly React 19 compiler rules. Fix properly — several (`set-state-in-effect`, `purity`) flag the real render-storm and impure-render bugs above. Then make lint blocking. |
| CSS fixes | `--duration-normal` (7 uses, undefined → transitions silently dead), `animate-slide-up` (undefined), global `will-change`/`transition: all` on every `a`/`button`. |

**Exit:** lint green and blocking; a page-level error shows a retry rather than an empty state; no unbounded intervals.

---

### Phase 5 — Launch hygiene: SEO, PWA, a11y, legal (5–8 days)

| Task | Detail |
|---|---|
| **Static landing page** | The exported `out/index.html` body is currently just `Loading…` — verified. Render marketing content unconditionally in a server component; isolate the redirect. |
| Real route shells | Every app route's exported HTML is the login form (verified: `out/lobby.html` contains "Email address"). |
| Error/404 pages | `error.tsx`, `not-found.tsx`, `global-error.tsx`, `loading.tsx` — none exist. |
| Metadata | Per-route metadata, `robots.ts`, `sitemap.ts`, `openGraph`/`twitter`, `metadataBase`. |
| Service worker | Reload on `controllerchange` (a new SW currently controls a page pointing at old chunk hashes — the exact failure `_headers` documents). Fix the offline fallback: it caches every page under `/index.html`, so an offline `/lobby` serves the `/wallet` document. |
| Manifest/icons | PNG `apple-touch-icon` (iOS needs PNG), correct `purpose`, `start_url` → `/lobby`. |
| Fix 17 dead sidebar links | The admin nav links to 10 routes that don't exist; non-admins see all of them. |
| Remove the client-side admin allowlist | Staff emails in a public bundle; gate on the server-verified role. |
| Accessibility pass | Labels on placeholder-only fields, one shared `<Dialog>` with focus trap + Escape, keyboard-accessible controls, `aria-pressed`/tab semantics, `role="status"` for loading. |
| **Privacy policy at a real URL** | It lives in `backend.ts:356-484` and never executes — `/privacy-policy` 404s because `_routes.json` only mounts `/api/*`. Move to a static page. |
| **Correct the false security claims** | The shipped policy claims Cloud Armor rate limiting, geo-blocking and WAF. There is no rate limiting, and `infra/cloud-armor/` targets a GCP load balancer this architecture doesn't use (its own `project_id` default is a reCAPTCHA key). Delete that directory and write claims that are true. |
| Cookie consent that works | Currently hides only on "granted" (so Decline can't dismiss), and Firebase Analytics starts with **no consent gate**. Wire consent to analytics; fix the probe, which checks a different Firebase project. |
| Self-service deletion | Must actually delete, and say what is retained. It is the counterpart to the policy. |
| Content-safety posture | Abuse reporting exists; add a documented moderation/response process, an age-gate appropriate to an audio social app, and the store-facing child-safety statements. |
| Voice test matrix documented | Network profiles, devices, browsers, and the known-unsupported list. |

**Exit:** crawlable landing page; policy live and accurate; consent gates analytics; deletion verified end to end.

---

### Phase 6 — Monetization (gated, after web launch)

**Do not start until a native shell exists.** Sequence:

1. **Ledger readiness (do in Phase 2):** `admin_credit`/`admin_debit` exist; add a `purchases` table keyed by `(provider, provider_transaction_id)` UNIQUE for idempotency, with `user_id`, `sku`, `amount`, `status`, `raw_receipt_ref`.
2. **Server-side receipt validation** — App Store Server API / Play Developer API. Never trust a client-claimed purchase.
3. **Idempotent crediting** — replaying a receipt must not double-credit.
4. **Store compliance** — 3.1.1 (IAP for digital currency), restore purchases, refund/chargeback handling, and a reconciliation job against the provider.
5. **Native shell** — push notifications, deep links, and the iOS audio-session work.
6. **Only then** re-introduce a purchase UI, gated to native clients. Do not add a web checkout for coins while an iOS app exists.

---

## 5. Already completed in this session

The two schema-mismatch fixes you approved — including the hardening they made necessary.

| Change | Files |
|---|---|
| Migration adding `call_charge` (+ `call_refund`, `admin_credit`, `admin_debit`) to `transactions.type`; rebuilds the table and adds `idx_transactions_type_created` | `scripts/migrate-008-transactions-call-charge.sql` |
| Migration making `message_attachments.message_id` nullable; rebuilds the table, adds an unclaimed-orphans index | `scripts/migrate-009-attachments-nullable-message.sql` |
| Same two definitions corrected in the fresh-DB script so it stops drifting | `scripts/init-db.sql` |
| Upload now binds the real `message_id` (nullable) and the computed `attachment_type`; **deletes the R2 object if the row write fails**, closing the paid-storage leak | `workers/backend.ts` |
| Attachment claim scoped to the uploader via `substr(r2_key, 1, ?)` — prevents claiming someone else's file | `workers/backend.ts` |
| Download route: MIME allowlist, `inline` only for inert media, `nosniff`, `private, no-store`, sanitized filename | `workers/backend.ts` |
| `text/*` no longer classified as `contact` (it let `text/html` masquerade as a contact card) | `workers/backend.ts` |
| Form-supplied `attachment_type` honoured within the DB allowlist (was read and discarded) | `workers/backend.ts` |

**Why the download hardening was non-negotiable here:** attachments never worked, so the stored-XSS in the serving path was unreachable. Fixing the schema without hardening the response would have *activated* it. Enabling a feature may not enable a vulnerability.

**Verified:** `npx tsc --noEmit` exits 0; `npx eslint workers/backend.ts` reports **0 errors** (11 pre-existing warnings, one fewer than before). Not yet verified: the migrations have not been applied to any database, and the end-to-end upload→send→download path has not been exercised.

---

## 6. Pre-migration checklist (for 008 and 009)

Both migrations **drop and recreate a table** and are not re-runnable.

```bash
# 0. Confirm the current schema BEFORE touching anything (also resolves the
#    [verify] items from the code review).
npx wrangler d1 execute audioroom-db --remote \
  --command="SELECT name, sql FROM sqlite_master WHERE name IN ('transactions','message_attachments')"

#    Confirm the bug is live: this should currently error with a CHECK constraint
#    failure, proving callers are being charged with no ledger row.
npx wrangler d1 execute audioroom-db --remote \
  --command="SELECT COUNT(*) AS call_charge_rows FROM transactions WHERE type='call_charge'"
npx wrangler d1 execute audioroom-db --remote \
  --command="SELECT COUNT(*) AS unclaimed FROM message_attachments WHERE message_id IS NULL"

# 1. Record a Time Travel bookmark and SAVE THE ID somewhere outside this machine.
npx wrangler d1 time-travel info audioroom-db

# 2. Record pre-migration row counts for reconciliation.
npx wrangler d1 execute audioroom-db --remote --command="SELECT COUNT(*) FROM transactions"
npx wrangler d1 execute audioroom-db --remote --command="SELECT COUNT(*) FROM message_attachments"

# 3. Apply to a STAGING database first. Never to production first.
npx wrangler d1 execute <staging-db> --remote --file=./scripts/migrate-008-transactions-call-charge.sql
npx wrangler d1 execute <staging-db> --remote --file=./scripts/migrate-009-attachments-nullable-message.sql

# 4. Verify: DDL shows the new CHECK / nullable column; counts match step 2;
#    a private call now succeeds and writes a call_charge row; an upload →
#    message → download round-trip works.

# 5. Then production, then deploy the code, then re-run the verification.
```

**Ordering matters:** the code change depends on the nullable column, so apply migration 009 **before** deploying the new `backend.ts`. Migration 008 is safe either way (widening a constraint cannot break existing inserts), but applying both first keeps the deploy atomic.

**Rollback:** code rolls back with a Pages redeploy of the previous build. Data rolls back only via the Time Travel bookmark — which is why step 1 is not optional. If the row counts disagree after applying, **stop and restore** rather than proceeding.

---

## 7. Sequencing and effort

| Phase | Effort | Blocking launch? |
|---|---|---|
| 0 — Guardrails | 3–5 days | Yes (enables everything else) |
| 1 — Security lockdown | 10–15 days | **Yes — hard blocker** |
| 2 — Data integrity | 6–8 days | Yes |
| 3 — Voice reliability | 5–8 days | Yes (it's the core product) |
| 4 — Frontend architecture | 8–12 days | Partly — correctness items yes, refactors no |
| 5 — Launch hygiene | 5–8 days | Legal/SEO items yes; a11y polish can follow |
| 6 — Monetization | Gated | No — post-launch, needs native shell |

**Two viable paths:**

- **Safe launch, full quality — ~7–10 weeks solo.** Everything above through Phase 5.
- **Fastest safe launch — ~4–5 weeks.** Phase 0 + Phase 1 + Phase 2 + the Critical/High half of Phase 3 + only the legal/SEO-critical parts of Phase 5 (static landing page, live policy, consent gating, deletion). Defer the Phase 4 refactors and a11y polish, but **keep Phase 4's correctness items** (real chat, 401 handling, logout cleanup) — shipping a "live chat" that doesn't chat is a credibility problem, not a polish issue.

**Phases 1 and 2 cannot be compressed.** Phase 1 is the difference between a product and an open account-takeover endpoint. Phase 2 is the difference between an economy and a faucet.

---

## 8. Launch runbook

**T-7 days**
- [ ] Every §2 criterion signed off with evidence, not assertion.
- [ ] Full voice matrix re-run on staging.
- [ ] Load test: 10 concurrent rooms; confirm no D1 overload, no subrequest-cap breach.
- [ ] Second-person red-team pass on the security probe suite.
- [ ] Restore rehearsal from a Time Travel bookmark.
- [ ] Rollback rehearsal on staging.

**T-1 day**
- [ ] Freeze schema changes. Record a final bookmark.
- [ ] Confirm secrets are set on the Pages project (`TURN_KEY_ID`, `TURN_API_TOKEN`, `RECAPTCHA_SECRET_KEY`) and that reCAPTCHA **fails closed**, not open, without them.
- [ ] Alerting verified by forcing a 5xx on staging.
- [ ] Support/reporting inbox monitored by a human.

**Launch**
- [ ] Deploy to Pages; verify the deployed URL (not localhost).
- [ ] Smoke: sign in, create a room, join with a second account, hear audio, send a chat message, upload and download an attachment, place a 1:1 call, place a second concurrent call as the same user.
- [ ] Watch the 5xx rate, D1 error rate, and error tracker for 60 minutes.

**Rollback triggers (any one):** 5xx rate >2% for 5 minutes; voice connection failure rate >20%; any report of cross-account data visibility; any unexplained currency inflation.

---

## 9. Deliberately deferred

Not because they don't matter, but to keep the critical path honest:

- Payments/IAP (Phase 6, needs a native shell).
- Native apps — the `android/` and `ios/` directories stay parked.
- LiveKit/SFU migration — the WebRTC mesh is fine at your current room sizes; revisit past ~10 speakers per room.
- Real-time transport upgrade (WebSocket/Durable Objects/SSE instead of D1 polling). Worth doing, but the polling consolidation in Phase 3 buys most of the benefit at a fraction of the risk.
- Multi-region, sharding, read replicas — no evidence of need yet.
- Analytics/product metrics — nice to have; error tracking is the must-have.

---

## 10. The three things that would change this plan

1. **Real users already exist.** Then Phase 1 becomes an incident response, not a project: fix §1.1–1.7 and 1.12 immediately, rotate every admin credential, audit `auth_audit` and `transactions` for abuse, and assume sessions and currency are already compromised.
2. **Real money is already flowing** through `/api/recharge/buy`. Then the coin economy is already unsound, and the ledger needs forensic reconstruction from `transactions`, `admin_transactions`, and `call_transactions` before any economy change ships.
3. **A native app is genuinely required for v1** (rather than web first). Then Phase 6 moves ahead of Phases 4–5, and the sequencing changes materially — tell me and I'll re-plan.
