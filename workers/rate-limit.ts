/**
 * Rate limit policy — pure functions, no I/O.
 *
 * WHY THIS IS SEPARATE
 *
 * The limits lived as one `if/else` chain inside `isRateLimited`, with a single
 * catch-all of 100/min for every non-GET method. That default is fine for a
 * room heartbeat and useless for `POST /api/xp/award`, which credits XP and is
 * bounded by nothing else in the handler. One number for every write endpoint
 * means either the dangerous ones are too loose or the chatty ones get
 * throttled, and there was no way to state a per-endpoint intent.
 *
 * Extracting the table makes each limit a reviewable decision, and lets the
 * rules be unit tested — the same reasoning as admin-policy.
 *
 * WHAT THIS IS NOT
 *
 * The limiter is in-isolate and keyed by IP + path. That is genuinely
 * best-effort: a single visitor can be handled by different isolates, and a
 * caller with a rotating source address gets a fresh budget each time. It stops
 * casual hammering and runaway clients. It is NOT a durable control — the
 * Cloudflare WAF Rate Limiting rules in the dashboard are (see docs/OPS.md).
 * Do not read a passing limit here as abuse prevention.
 */

export type Method = string;

export const WINDOW_MS = 60_000;

/**
 * Per-path limits, applied in order. First match wins, so specific paths must
 * come before their prefixes.
 *
 * Numbers are "per minute per IP per path". They are set so that ordinary use
 * never trips them, including a retry after a dropped connection — a limit that
 * punishes a flaky mobile network is worse than a slightly loose one.
 */
const PATH_LIMITS: ReadonlyArray<{ prefix: string; limit: number; why: string }> = [
  // --- Unbounded-value endpoints. These are the reason this table exists. ---
  {
    prefix: "/api/xp/award",
    limit: 20,
    why: "credits XP per call and the handler caps only the AMOUNT (±500), not the count; a client loop would farm XP indefinitely",
  },
  {
    prefix: "/api/rewards/claim",
    limit: 12,
    why: "410 stub, but keep it bounded so it cannot be used as a traffic amplifier",
  },
  {
    prefix: "/api/legal/accept",
    limit: 12,
    why: "written once per account per document version; must not be bulk-filled from one address",
  },
  {
    prefix: "/api/spin",
    limit: 10,
    why: "pays out coins; the wheel is not meant to be spun continuously",
  },
  {
    prefix: "/api/recharge/request",
    limit: 10,
    why: "creates rows an admin has to work through by hand",
  },
  {
    prefix: "/api/checkin",
    limit: 10,
    why: "once per day per account; the only legitimate repeat is a retry after a dropped response",
  },
  {
    prefix: "/api/gifts/send",
    limit: 60,
    why: "spends coins and is genuinely bursty during a live gift rush, so it is looser than the other value endpoints",
  },
  {
    prefix: "/api/games/start",
    limit: 30,
    why: "debits the entry fee and mints a session",
  },
  {
    prefix: "/api/games/finish",
    limit: 30,
    why: "credits a fixed XP amount and is idempotent, but pairs with start",
  },
  {
    prefix: "/api/attachments/upload",
    limit: 20,
    why: "paid R2 storage; each accepted file is 50MB",
  },
  {
    prefix: "/api/reports",
    limit: 20,
    why: "creates moderation work",
  },
  {
    prefix: "/api/follow",
    limit: 60,
    why: "bursty while browsing, but trivial to loop",
  },

  // --- Session and admin surfaces ---
  { prefix: "/api/auth/", limit: 20, why: "credential exchange; brute-force surface" },
  { prefix: "/api/admin/", limit: 30, why: "privileged surface" },

  // --- Chatty reads ---
  { prefix: "/api/signal/", limit: 120, why: "WebRTC signalling polls continuously during a call" },

  // --- Diagnostics ---
  { prefix: "/api/client-errors", limit: 30, why: "browser-submitted; unbounded reporting is a cheap DoS" },
  { prefix: "/api/csp-report", limit: 60, why: "browser-submitted; same exposure as client-errors" },
];

/** Methods that are never throttled by this limiter. */
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/** Fallback for any state-changing request that matched nothing above. */
const DEFAULT_WRITE_LIMIT = 100;

/** The only safe method that is hot enough to be worth limiting at all. */
const POLLED_READ_PREFIX = "/api/signal/";

export interface RatePolicy {
  /** Requests allowed per window, or null when this request is not limited. */
  limit: number | null;
  why: string;
}

/**
 * Decide the limit for a request. Returns `limit: null` for unlimited traffic.
 *
 * Ordering matters: the table is scanned top to bottom and the first prefix
 * match wins, so a specific path placed after its own prefix would never fire.
 */
export function ratePolicyFor(path: string, method: Method): RatePolicy {
  const safe = SAFE_METHODS.has(method.toUpperCase());

  if (safe) {
    // Only polled reads are limited. Everything else is a page load or a fetch
    // the user is waiting on, and throttling it produces a broken UI rather
    // than a defence.
    if (!path.startsWith(POLLED_READ_PREFIX)) return { limit: null, why: "safe method, not polled" };
  }

  for (const entry of PATH_LIMITS) {
    if (path.startsWith(entry.prefix)) return { limit: entry.limit, why: entry.why };
  }

  if (safe) return { limit: null, why: "safe method" };
  return { limit: DEFAULT_WRITE_LIMIT, why: "default write limit" };
}

/**
 * Sliding-window check over a timestamp array.
 *
 * Takes and returns the pruned list so the caller can store it back without
 * growing the array without bound. Exported separately from the policy lookup
 * so the arithmetic can be tested against a frozen clock.
 */
export function isOverLimit(
  hits: readonly number[],
  now: number,
  limit: number,
  windowMs: number = WINDOW_MS,
): { limited: boolean; kept: number[] } {
  const kept = hits.filter((t) => now - t < windowMs);
  return { limited: kept.length + 1 > limit, kept };
}
