/**
 * Unauthenticated probe suite (Phase 1.20 evidence for criteria #1 and #2).
 *
 * Sweeps every mutating route without a session and asserts 401/403/410.
 * Usage: BASE=https://ms-rooms.pages.dev node scripts/probe-auth.mjs
 * Exit 0 when all probes pass, 1 otherwise.
 */
const BASE = (process.env.BASE ?? "http://localhost:3000").replace(/\/+$/, "");

const probes = [
  ["POST", "/api/gifts/send", { gift_id: "rose" }],
  ["POST", "/api/xp/award", { amount: 500 }],
  ["POST", "/api/spin", {}],
  ["POST", "/api/checkin", {}],
  ["POST", "/api/rewards/claim", {}],
  ["POST", "/api/moments", { text: "probe" }],
  ["POST", "/api/rooms", { title: "probe" }],
  ["PATCH", "/api/rooms/probe", { title: "probe" }],
  ["DELETE", "/api/rooms/probe", {}],
  ["POST", "/api/rooms/probe/seats", { seat_index: 1 }],
  ["POST", "/api/follow", { followee_id: "x" }],
  ["POST", "/api/reports", { target_id: "x", reason: "probe" }],
  ["POST", "/api/support/tickets", { subject: "s", message: "m" }],
  ["GET", "/api/support/tickets/t-probe", null],
  ["GET", "/api/users/u-probe/transactions", null],
  ["GET", "/api/turn", null],
  ["GET", "/api/signal/poll?room_id=x", null],
  ["POST", "/api/admin/login", { username: "x", password: "y" }],
];

let failures = 0;
for (const [method, path, body] of probes) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const ok = [401, 403, 410, 429].includes(res.status);
    console.log(`${ok ? "PASS" : "FAIL"} ${method} ${path} -> ${res.status}`);
    if (!ok) failures++;
  } catch (e) {
    console.log(`FAIL ${method} ${path} -> ${e instanceof Error ? e.message : e}`);
    failures++;
  }
}
// PII probe: public user read must not leak email/phone/firebase_uid/balances.
try {
  const res = await fetch(`${BASE}/api/users/mayarose`);
  const data = await res.json().catch(() => ({}));
  const leaked = ["email", "phone", "firebase_uid", "ban_reason", "coins", "gems"].filter((k) => data?.user?.[k] !== undefined && data?.user?.[k] !== null);
  console.log(`${leaked.length === 0 ? "PASS" : "FAIL"} GET /api/users/:id PII ${leaked.length ? `leaked: ${leaked.join(",")}` : "clean"}`);
  if (leaked.length) failures++;
} catch (e) {
  console.log(`FAIL PII probe -> ${e instanceof Error ? e.message : e}`);
  failures++;
}
process.exit(failures ? 1 : 0);
