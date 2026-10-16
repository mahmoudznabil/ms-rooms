# MS-ROOMS — Full Build Plan for Mimi v2.6

**Owner of this doc:** principal (diagnosis + plan). **Builder:** agent Mimi v2.6.
**Rule zero:** red/green TDD. `npm run test:unit` (Vitest), `npm run test:e2e`
(Playwright), `npx tsc --noEmit`, `npx eslint` on touched files — all green
before every commit. Verify backend changes live with `wrangler pages dev`
+ `scripts/verify-*.mjs` before pushing.

**Deploy flow (do not use GitHub auto-builds):** the Pages GitHub builder fails
intermittently on this repo. Ship with:
`npm run build && npx wrangler pages deploy out --project-name ms-rooms --branch master`,
then confirm the new deployment is Production in
`npx wrangler pages deployment list --project-name ms-rooms --json`
and re-run `BASE=https://ms-rooms.pages.dev node scripts/probe-auth.mjs`
(zero FAIL expected). DB work: local via `npm run db:migrate:local`,
preview via `npx wrangler d1 migrations apply <db> --remote --env preview`,
prod via `npx wrangler d1 execute audioroom-db --remote --file=<migration>`
(single additive files only — never re-run 0008/0009 rebuilds), then mark the
name in prod `d1_migrations`. Preview D1 id `366b9b76-…`, R2 `ms-rooms-preview`.

**Current prod baseline (verified 2026-10-16):** auth fixed, Moments removed,
seat hardening live, error telemetry live, notifications live, compat/mobile
pass live, probe sweep green. What follows is all that remains + the new
economy/dating scope.

---

## Phase A — Game logic fixes (MiniGamePanel is local-only; make it correct first)

**A1. Ludo "dice shows 4, token doesn't move" (perceived breakage, actually three defects).**
File: `components/MiniGamePanel.tsx` (`roll` ~L110, `moveTokens` ~L132).
- D1a. A token in the yard (`-1`) needs an exact 6 to leave, but nothing tells
  the user — any other roll looks like a dead button. Fix: when the roll can't
  move, show why ("Need a 6 to leave the yard") instead of silence; highlight
  the active token when it CAN move.
- D1b. `setNextLudo()` is called **inside** the `setLudo` updater (side effect
  in an updater — double-fires under StrictMode, uses a stale `activeLudo`
  closure). Fix: compute the next player OUTSIDE the updater and set both
  states from the roll handler.
- D1c. One shared die for 4 "players" (3 are fake local bots) with no turn
  indicator and no capture rule. Fix: visible turn order (You → Blue → Green →
  Gold), bots auto-roll on a short timer, exact-roll-to-finish + capture-back-
  to-yard implemented and shown. Win banner + score.
- Acceptance: scripted rolls (seeded RNG in a unit test of the extracted pure
  move function — extract `ludoMove(state, player, value)` to
  `lib/games/ludo.ts` with Vitest cases: yard-exit-6, yard-stuck-4, capture,
  home-exact, overshoot-stays) + E2E: roll 20×, token position always matches
  rules, no stuck UI.

**A2. Trivia repetition.** The 16-question static pack (`TRIVIA_QUESTIONS`) is
the fallback only after Phase B lands. Until then, raise the local pool to 60
mixed-easy questions in `lib/games/trivia-pack.ts` (extracted from the
component), deck-shuffle preserved. Vitest: no repeats within a full deck,
answer index always valid.

**A3. Games cost coins (server-side, all games).** Client-deducted fees are
farmable — never trust the client with money.
- New `game_sessions` usage (table exists; widen its `game_type` CHECK to
  `('ludo','reaction','trivia','memory','rush','pk')` via migration 0014):
  `POST /api/games/start { game_type, room_id? }` debits the entry fee
  atomically (`UPDATE users … WHERE coins >= ?`, `meta.changes` check like
  gifts/send) and returns `session_id`; `POST /api/games/finish { session_id,
  score }` validates score bounds server-side and credits XP by fixed table
  (NOT proportional to client score — cap per game per day).
- Fees (proposed, tune in Phase D): Ludo round 5, Trivia sprint 5, Reaction 2,
  Memory 2, Rush entry 10, Spin unchanged (already server-side).
- Anti-farm: max 10 paid sessions/game/day; XP table fixed (e.g. win 10,
  play 2); `awardXp` stays reserved — games credit via the finish endpoint.
- Acceptance: 402/409 on insufficient funds; double-finish is idempotent;
  unfunded client cannot mint XP (attempt direct `xp/award` — still capped).

**A4. Talking in rooms costs coins.**
- Metering point: the existing 5s seat poll + `signalPeers` heartbeat already
  prove presence. Add `POST /api/rooms/:slug/voice-heartbeat` (called by
  `useRoomVoice` every 60s while `micOn`): debits `VOICE_PER_MIN = 1` coin,
  `xp +1`, capped at 60 coins/day per user; host is exempt in their own room;
  muted seats are not billed (check `is_muted`).
- Client: when balance hits 0 mid-talk, server returns `402` → auto-mute with
  notice "Out of coins — check in or top up to keep talking" (reuse the
  server-mute backstop added in `RoomView`).
- Acceptance: 60 heartbeats ⇒ −60 coins +60 XP capped; muted ⇒ 0; host ⇒ 0.

---

## Phase B — Server trivia + Cloudflare Workers AI (non-repetitive easy questions)

**B1. Binding (zero secrets, free quota).** Pages Functions ARE Workers — add:
```toml
[ai]
binding = "AI"
```
(one AI binding max per Pages project; or Dashboard → Pages → Settings →
Bindings → Workers AI). Extend `Env` in `workers/backend.ts` with
`AI?: unknown` (loose-typed like `DB` — do not import workers-types into the
bundle) and call through a tiny `runAi(model, messages)` helper with a
`(env.AI as { run(m: string, i: unknown): Promise<unknown> } | undefined)`
cast. Model: `@cf/meta/llama-3.2-1b-instruct` (≈12 Neurons per 5-question
pack; ~800 packs/day inside the 10,000/day free quota). Local dev:
`wrangler pages dev --ai AI …`. If the binding is ever absent, everything
below degrades to the static pack — no errors, ever.

**B2. Pack pool (migration 0015).**
```sql
CREATE TABLE IF NOT EXISTS trivia_packs (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL DEFAULT 'general',
  payload TEXT NOT NULL,            -- JSON: [{q, options[4], answer 0-3}]
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_trivia_packs_use ON trivia_packs (use_count, created_at);
```
`POST /api/admin/trivia/generate { topic?, n? }` (master only): prompts for N
easy questions, strict-JSON instruction, validates shape server-side (4
options, answer in range, dedupe vs last 200 stored questions by normalized
text), stores packs. `GET /api/trivia/pack?topic=` (session): pops the
least-used pack (`use_count+1`), falls back to `lib/games/trivia-pack.ts`
static pool when empty/unconfigured. Serving threshold: keep ≥20 unused packs;
admin generates weekly (≈240 Neurons — 2.4% of free quota).

**B3. Client.** Trivia tab fetches a server pack on mount (cache 1/round),
static deck as fallback. Difficulty fixed to easy; topics rotate
(general → room category). Acceptance: 10 consecutive rounds, zero repeated
questions (assert via pack ids), airplane-mode still plays (fallback).

---

## Phase C — Chats tab unification (chats + calls + inline history)

Mostly exists — wire it into one surface:
- C1. Messages tab lists DMs AND call recents as entries (reuse
  `GET /api/calls` rows + conversations list; entry shows last message OR last
  call with peer, timestamp, unread dot). Tapping opens the thread.
- C2. Inside a thread, call history with that peer renders inline (query
  existing call sessions by peer pair, newest 5, "Voice 3:12 · ended" rows).
  History already lives in-chat (`loadMore`) — keep, add the call rows.
- C3. Missed-call badge already on tabs; add per-thread unread via existing
  `unread-count`. Acceptance: place call → end → thread shows the call row;
  missed call → chats-tab dot + thread row.

---

## Phase D — Pricing: 20% under competitors + recharge path

**D1. Competitor baseline (researched 2026-10-16, USD in-app; mark uncertain
figures in UI as "from X").**
- Coin face value: Chamet ≈ $0.01/coin ($0.99/100); Tango ≈ $0.0083
  ($0.99/120); Bigo ≈ $0.016–0.02; UpLive ≈ $0.017. Median ≈ $1.35/100.
- Paid 1:1 video: Chamet ≈ 70 coins/min flat (host-set up to premium tiers);
  Yalla/Bigo/UpLive/Tango/Hago have no per-minute 1:1 — gifts only.
- Funnel: Chamet 90-sec free trial + welcome/daily coins + 10% rebate.
- Host share: Chamet ~60% of call spend; Bigo ~25%; Tango ~30–50%.

**D2. Our ladder (0.8× median ⇒ ~$1.08/100 coins; per-minute 0.8 × 70 = 56).**
| USD | Coins | $/100 |
|---|---|---|
| $0.99 | 92 | $1.08 |
| $4.99 | 462 | $1.08 |
| $9.99 | 925 | $1.08 |
| $29.99 | 2,950 (+6% vol. bonus) | $1.02 |
| $99.99 | 10,400 (+12% vol. bonus) | $0.96 |
Call tiers (coins/min): Budget 30 · Standard 56 · Premium (host-set max) 100.
Host keeps **70%** of call spend as Gems (beats Chamet's ~60%; matches our
existing gift split — one story everywhere).

**D3. Recharge path (decision required before build).** `/api/recharge/buy`
was deleted (Phase 1.5: unauthenticated mint). Options: (a) web checkout via
Stripe Payment Links + server webhook crediting (fast, web-only; App-Store
rule 3.1.1 only bites once a native app ships); (b) admin/manual top-up only
(status quo — no user-facing recharge). **Recommended: (a) now**, with
`purchases(provider, provider_transaction_id UNIQUE, …)` (table exists from
0011) + idempotent webhook. Until it lands, coin flows are earned-only and
all paid features must degrade gracefully (402 + top-up nudge, never crash).

---

## Phase E — Women hosts, paid video calls, free matchup (Chamet-style)

**E1. Gendered accounts (migration 0016).**
`ALTER TABLE users ADD COLUMN gender TEXT NOT NULL DEFAULT 'unspecified'
CHECK (gender IN ('unspecified','woman','man'))` (+ index). Signup/profile:
optional gender select (default unspecified; editable once per 30 days to
prevent gaming discovery). Discovery filter on search/lobby ("Women hosts").
No gender-gating of existing features — only new ones below.

**E2. Women host paid video calls.**
- Host opt-in toggle on profile ("Accept paid video calls") + rate choice
  (30/56/100 coins/min, default 56) → stored on users
  (`call_enabled INTEGER DEFAULT 0`, `call_rate INTEGER DEFAULT 56` —
  migration 0016).
- Flow reuses private-call sessions: `POST /api/rooms/private-call` gains
  `callee_rate` resolution (callee's set rate; falls back to 56), upfront
  1-minute debit stays; **metering**: caller client sends
  `POST /api/rooms/private-call/heartbeat {room_id}` every 60s while
  `connected` → atomic debit at callee's rate, 70% to callee as Gems
  (`gift_received`-style row, reason `Call earn`), XP +2/min caller.
  Missed heartbeat ×2 → session marked `ended` (protects against free riding).
- Insufficient balance mid-call → 402 → callee notified, call ends gracefully
  (reuse `bye` flow), no negative balances (conditional UPDATE everywhere).
- Women cash-out story: Gems already exist; cash-out itself is out of scope
  (Phase 6 monetization) — state this in UI copy ("Gems convert at cash-out").

**E3. Free 30-second matchup (the funnel).**
- `POST /api/matchup/queue { gender_preference? }`: men join a pool; matching
  pairs one man with one available woman host (`call_enabled=1`,
  `matchup_open=1` toggle). Creates a private room + session with
  `free_seconds = 30`, `price_per_minute = 0` until t+30s.
- At 25s both sides get "Continue for {rate}/min?" — man taps Continue →
  normal paid heartbeat starts (upfront 1-min debit); either side declining or
  timeout → `bye` + session `ended (matchup_expired)`. One free matchup per
  man per day (anti-farm; track in new `matchups` table or reuse checkins-day
  pattern). Women earn +5 XP per completed matchup + keep followers (follow
  nudge on end screen).
- Safety: matchup rooms are private; report/block buttons present (reuse
  existing report flow); rate-limit queue joins (10/hour); hosts can close
  the queue anytime.
- Acceptance: full funnel E2E on local stack — queue → match → 30s free →
  continue-paid debits at host rate with 70% Gem split → decline ends clean;
  second same-day matchup rejected.

**Needed-check (what we have vs need):** HAVE — private rooms, ringing/
connected sessions, upfront debit, 70% gift split, follows, DMs, notifications
infra (reuse for "she's online" nudges). NEED — E1/E2/E3 schema + endpoints +
metering + matchup queue + host UI + pricing UI + recharge (D3).

---

## Phase F — Production polish (final sweep)

- F1. PNG `apple-touch-icon` + 192/512 manifest icons (export from
  `public/ms-rooms-logo.svg`; iOS ignores SVG).
- F2. CSP in report-only mode first (`Content-Security-Policy-Report-Only`
  → `public/_headers`), tune against Firebase/reCAPTCHA, then enforce.
  Never break login for a header.
- F3. Age-gate + moderation-process copy (policy decision — draft text, owner
  approves): 18+ for paid calls/matchup, report→review SLA, block semantics.
- F4. Room capacity column actually enforced (UI is 8-fixed; takeSeat caps at
  8 — reconcile 4/8/12 with the seat grid or lock capacity to 8).
- F5. Delete `prompt.txt` from the repo root if still present (brief artifact,
  not app code).
- F6. Re-run FULL suite green + probe sweep + prod smoke (login → lobby →
  room seat → gift → call) before signing off.

## Build order

A (A1+A2 now; A3+A4 with D3) → B → C → D2/D3 → E1 → E2 → E3 → F.
Migrations: 0014 (game sessions widen), 0015 (trivia_packs), 0016
(gender + call_enabled/call_rate/matchup_open). All additive; single-file
`d1 execute` on prod + mark in `d1_migrations`, runner elsewhere.

**Definition of done:** every phase lists acceptance tests above; all run in
CI or `scripts/verify-*.mjs`; probe-auth zero FAIL on prod; no new lint
errors; docs/OPS.md updated for any new endpoint/table/cron.
