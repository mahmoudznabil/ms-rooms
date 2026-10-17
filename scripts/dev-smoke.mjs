import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * End-to-end smoke test against a local dev server, using a seeded account.
 *
 * WHY THIS EXISTS
 *
 * Identity runs through Firebase, so until `dev:seed` there was no way to
 * exercise anything behind authentication without a browser. Rooms, seats,
 * chat, wallet and the admin desk were all reachable only by hand.
 *
 * This drives the real HTTP surface the browser uses — same endpoints, same
 * CSRF double-submit, same cookies — so it catches the class of bug where the
 * unit tests pass and the route does not.
 *
 * WHAT IT CHECKS
 *
 * The seat assertions are the point of it. Seat endpoints previously hardcoded
 * `seatIndex > 7`, which silently made seats 8-11 unreachable on a capacity-12
 * room. That bug could not be caught by a test of a pure function alone,
 * because the bug lived in the request handler reading the wrong bound. This
 * goes through the handler.
 *
 * USAGE
 *
 *   npm run dev:seed                       # in one shell
 *   npm run dev:serve                      # in another
 *   npm run dev:smoke
 *
 * Env:
 *   BASE    default http://localhost:8788
 *   COOKIE  session=... from dev:seed. Omit to seed a throwaway account.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const wrangler = join(repoRoot, "node_modules", "wrangler", "bin", "wrangler.js");

const BASE = process.env.BASE ?? "http://localhost:8788";
const STAMP = Date.now().toString(36);

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function sql(statement) {
  return execFileSync(
    process.execPath,
    [wrangler, "d1", "execute", "audioroom-db", "--local", "--command", statement],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, cwd: repoRoot }
  );
}

/** Mint a session for a throwaway user, so the script is self-contained. */
function seedSession(userId) {
  const token = `sess_dev_${STAMP}`;
  // `id_tag` is UNIQUE, and the stem alone truncates to the same value on every
  // run — so the stamp goes in the suffix, mirroring the random 4 digits the
  // real signup path appends.
  const stem = userId.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "SMK";
  const idTag = `${stem}#${STAMP.slice(-4).toUpperCase()}`;
  sql(
    `INSERT INTO users (id, username, display_name, avatar_url, frame_style, id_tag, email, phone,
        firebase_uid, provider, bio, coins, xp, streak)
     VALUES ('${userId}', '${userId}', 'Smoke Test', NULL, 'default', '${idTag}',
       '${userId}@example.test', NULL, 'dev-${userId}', 'dev', '', 500, 0, 0)
     ON CONFLICT(id) DO UPDATE SET coins = excluded.coins`
  );
  sql(
    `INSERT OR REPLACE INTO sessions (id, user_id, expires_at)
     VALUES ('${token}', '${userId}', datetime('now', '+1 hour'))`
  );
  return token;
}

console.log(`smoke: ${BASE}\n`);

// ---------------------------------------------------------------- reachability
let reachable = true;
try {
  const r = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(10000) });
  check("server reachable", r.ok, `HTTP ${r.status}`);
} catch (e) {
  reachable = false;
  check("server reachable", false, e.message);
}
if (!reachable) {
  console.log("\nStart the server first: npm run dev:serve");
  process.exit(1);
}

// ------------------------------------------------------------------- identity
const userId = `smoke-${STAMP}`;
const sessionToken = process.env.COOKIE?.match(/session=([^;]+)/)?.[1] ?? seedSession(userId);
const SESSION_COOKIE = `session=${sessionToken}`;
console.log(`account: ${userId}\n`);

const get = async (p, cookie = SESSION_COOKIE) => {
  const r = await fetch(BASE + p, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(20000) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

// CSRF is a double-submit: /api/csrf mints the token AND sets the cookie.
const csrfRes = await fetch(`${BASE}/api/csrf`, { signal: AbortSignal.timeout(10000) });
const csrfToken = (await csrfRes.json()).csrf_token;
const csrfCookie = (csrfRes.headers.get("set-cookie") || "").match(/csrf_token=[^;]+/)?.[0] ?? "";
const post = async (p, body) => {
  const r = await fetch(BASE + p, {
    method: "POST",
    headers: {
      Cookie: `${SESSION_COOKIE}; ${csrfCookie}`,
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

console.log("auth");
const me = await get("/api/auth/me");
check("seeded session authenticates", me.status === 200 && !!me.body?.user, me.body?.user?.id ?? me.body?.error);
check("anonymous request is rejected", (await get("/api/auth/me", "")).status !== 200);

console.log("\nroom seats (Phase F4 regression)");
const created = await post("/api/rooms", {
  title: "Smoke Room",
  description: "seat capacity check",
  category: "Chat",
  capacity: 12,
});
check("capacity-12 room created", created.status === 201 || created.status === 200, created.body?.room?.slug ?? created.body?.error);
check("stored capacity is 12", Number(created.body?.room?.capacity) === 12, `got ${created.body?.room?.capacity}`);

// The server mints the slug; it does not accept one from the client. Using a
// locally-invented slug here is what made an earlier run report every seat as
// "Room not found" — which reads like a seat bug and is not one.
const slug = created.body?.room?.slug;
check("server returned a slug to use", !!slug, String(slug));

// One seat per user is enforced on purpose ("already on another seat"), so each
// seat is taken and then released rather than stacked. Without the release this
// reports every later seat as a failure and reads like a seat bug.
const take = async (i) => {
  const r = await post(`/api/rooms/${slug}/seats`, { seat_index: i });
  return { status: r.status, err: r.body?.error };
};
const leave = async (i) => {
  await fetch(`${BASE}/api/rooms/${slug}/seats/${i}`, {
    method: "DELETE",
    headers: {
      Cookie: `${SESSION_COOKIE}; ${csrfCookie}`,
      "X-CSRF-Token": csrfToken,
    },
    signal: AbortSignal.timeout(20000),
  });
};

const s0 = await take(0);
check("seat 0 (host seat) taken", s0.status === 200 || s0.status === 201, s0.err ?? "");
await leave(0);

const s7 = await take(7);
check("seat 7 taken", s7.status === 200 || s7.status === 201, s7.err ?? "");
await leave(7);

// THE REGRESSION: seat 11 on a 12-seat room. This was refused by the hardcoded
// `seatIndex > 7`, which made the last four seats of a 12-seat room
// permanently unreachable while the UI drew them.
const s11 = await take(11);
check("seat 11 taken on a 12-seat room", s11.status === 200 || s11.status === 201, s11.err ?? "");
await leave(11);

const s12 = await take(12);
check("seat 12 refused (one past capacity)", s12.status === 400, s12.err ?? "accepted?!");
const sNeg = await take(-1);
check("negative seat refused", sNeg.status === 400, sNeg.err ?? "accepted?!");
const sFrac = await take(3.5);
check("non-integer seat refused", sFrac.status === 400, sFrac.err ?? "accepted?!");

const seats = await get(`/api/rooms/${slug}`);
check(
  "room detail reports capacity the UI can draw",
  Number(seats.body?.room?.capacity) === 12,
  `capacity=${seats.body?.room?.capacity}`
);

console.log("\nlegal consent (Phase F3)");
const docsEn = await get("/api/legal/documents?lang=en");
check("documents readable unauthenticated", docsEn.status === 200 && docsEn.body.documents?.length === 3);
const docsAr = await get("/api/legal/documents?lang=ar");
check("arabic documents served RTL", docsAr.body?.documents?.[0]?.dir === "rtl");
check(
  "both languages have identical structure",
  JSON.stringify(docsEn.body.documents.map((d) => d.sections.length)) ===
    JSON.stringify(docsAr.body.documents.map((d) => d.sections.length))
);

const before = await get("/api/legal/status");
check("starts un-cleared", before.body?.cleared === false, `outstanding=${JSON.stringify(before.body?.outstanding)}`);

const partial = await post("/api/legal/accept", {
  lang: "en",
  age_confirmed: true,
  docs: [{ key: "terms", version: docsEn.body.version }],
});
check("partial acceptance does not clear", partial.body?.cleared === false, `outstanding=${JSON.stringify(partial.body?.outstanding)}`);

const noAge = await post("/api/legal/accept", {
  lang: "en",
  age_confirmed: false,
  docs: docsEn.body.documents.map((d) => ({ key: d.key, version: d.version })),
});
check("acceptance without age confirmation refused", noAge.status === 400, noAge.body?.code ?? "");

const full = await post("/api/legal/accept", {
  lang: "ar",
  age_confirmed: true,
  docs: docsEn.body.documents.map((d) => ({ key: d.key, version: d.version })),
});
check("full acceptance clears the gate", full.body?.cleared === true, JSON.stringify(full.body?.outstanding));
check("language read is recorded", full.body?.lang === "ar", full.body?.lang);

const after = await get("/api/legal/status");
check("status reports cleared after accepting", after.body?.cleared === true);
check("recorded acceptance is retrievable as evidence", (after.body?.accepted?.length ?? 0) >= 3, `${after.body?.accepted?.length} rows`);

console.log("\nwallet");
const wallet = await get("/api/recharge/mine");
check("wallet reachable", wallet.status === 200, wallet.body?.error ?? "");
check("wallet reports the $100 cap", Number(wallet.body?.allowance_cap_usd) === 100);
check("wallet reports the 7-day settlement window", Number(wallet.body?.settlement_days) === 7);
// The request needs a real package from the ladder — the endpoint rejects a
// missing package_id rather than defaulting, which is correct. The ladder falls
// back to a hardcoded set when `coin_packages` has no active rows, so this also
// proves that fallback path works.
const packs = await get("/api/recharge/packages");
const packId = packs.body?.packages?.[0]?.id;
check("coin package ladder readable", !!packId, `${packs.body?.packages?.length ?? 0} packs`);
if (packId) {
  const requested = await post("/api/recharge/request", { package_id: packId, note: "smoke" });
  check("recharge request accepted", requested.status === 200 || requested.status === 201, requested.body?.error ?? "");
}

console.log("\npublic surface");
const rooms = await get("/api/rooms");
check("room list reachable", rooms.status === 200 && Array.isArray(rooms.body?.rooms));
const csp = await fetch(`${BASE}/`, { method: "GET" });
check("CSP report-only header present", !!csp.headers.get("content-security-policy-report-only"));
const icon = await fetch(`${BASE}/icon-512.png`, { method: "HEAD" });
check("PNG app icon served", icon.status === 200 && (icon.headers.get("content-type") ?? "").includes("png"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log(`failed: ${failures.join(", ")}`);
  process.exit(1);
}