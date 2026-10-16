/* Seat-guard verification against local pages dev (port 8789).
 * Seeds via local D1 CLI first, then exercises takeSeat guards over HTTP.
 * Usage: node scripts/verify-seats.mjs
 */
const BASE = "http://localhost:8789";

async function api(session, method, path, body) {
  const headers = { Cookie: `session=${session}`, "Content-Type": "application/json" };
  if (method !== "GET") {
    // Double-submit CSRF: the token must travel as both cookie and header.
    const csrfRes = await fetch(`${BASE}/api/csrf`, { headers: { Cookie: `session=${session}` } });
    const csrf = await csrfRes.json().catch(() => ({}));
    const setCookie = csrfRes.headers.get("set-cookie") ?? "";
    const m = setCookie.match(/csrf_token=([^;]+)/);
    if (csrf.csrf_token) headers["X-CSRF-Token"] = csrf.csrf_token;
    if (m) headers.Cookie = `session=${session}; csrf_token=${m[1]}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const results = [];
function check(name, cond, extra = "") {
  results.push([cond ? "PASS" : "FAIL", name, extra]);
}

const S1 = "sess_repro1"; // u_repro1, room host
const S2 = "sess_repro2"; // u_repro2, stranger

// Room fixture via API (host creates).
const created = await api(S1, "POST", "/api/rooms", {
  title: "SeatTest",
  description: "guard fixture",
  category: "Chat",
});
const slug = created.data?.room?.slug;
check("room created", (created.status === 200 || created.status === 201) && !!slug, `status=${created.status}`);

// Stranger takes seat 1.
const t1 = await api(S2, "POST", `/api/rooms/${slug}/seats`, { seat_index: 1, user_id: "u_repro2" });
check("stranger takes seat 1", t1.status === 200, `status=${t1.status} ${t1.data?.error ?? ""}`);

// Same user takes a second seat -> 409.
const t2 = await api(S2, "POST", `/api/rooms/${slug}/seats`, { seat_index: 2, user_id: "u_repro2" });
check("second seat rejected (409)", t2.status === 409, `status=${t2.status} ${t2.data?.error ?? ""}`);

// Stranger takes host seat 0 -> 403.
const t0 = await api(S2, "POST", `/api/rooms/${slug}/seats`, { seat_index: 0, user_id: "u_repro2" });
check("host seat blocked for stranger (403)", t0.status === 403, `status=${t0.status} ${t0.data?.error ?? ""}`);

// Host takes seat 0 -> 200.
const h0 = await api(S1, "POST", `/api/rooms/${slug}/seats`, { seat_index: 0, user_id: "u_repro1" });
check("host takes seat 0", h0.status === 200, `status=${h0.status} ${h0.data?.error ?? ""}`);

// Re-taking own seat is idempotent -> 200.
const re = await api(S2, "POST", `/api/rooms/${slug}/seats`, { seat_index: 1, user_id: "u_repro2" });
check("re-take own seat ok", re.status === 200, `status=${re.status} ${re.data?.error ?? ""}`);

let failed = 0;
for (const [s, n, x] of results) {
  if (s === "FAIL") failed++;
  console.log(`${s} ${n} ${x}`);
}
process.exit(failed ? 1 : 0);
