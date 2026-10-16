/* Notification fan-out verification against local pages dev (port 8797).
 * u_repro2 follows u_repro1; room creation + DM must fan out; the daily
 * checkin reminder must synthesize exactly once.
 * Usage: node scripts/verify-notifications.mjs
 */
const BASE = "http://localhost:8797";

async function api(session, method, path, body) {
  const headers = { Cookie: `session=${session}`, "Content-Type": "application/json" };
  if (method !== "GET") {
    const csrfRes = await fetch(`${BASE}/api/csrf`, { headers: { Cookie: `session=${session}` } });
    const data = await csrfRes.json().catch(() => ({}));
    const m = (csrfRes.headers.get("set-cookie") ?? "").match(/csrf_token=([^;]+)/);
    if (data.csrf_token) headers["X-CSRF-Token"] = data.csrf_token;
    if (m) headers.Cookie = `session=${session}; csrf_token=${m[1]}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

const results = [];
const check = (name, cond, extra = "") => results.push([(cond ? "PASS" : "FAIL"), name, extra]);

const S1 = "sess_repro1"; // host/sender
const S2 = "sess_repro2"; // follower/recipient

// Clean slate for deterministic counts.
await api(S2, "POST", "/api/notifications/read", { all: true });

// u_repro2 follows u_repro1.
const f = await api(S2, "POST", "/api/follow", { follower_id: "u_repro2", followee_id: "u_repro1" });
check("follow ok", f.status === 200, `status=${f.status} ${f.data?.error ?? ""}`);

// Host creates a room -> follower gets room_live.
const room = await api(S1, "POST", "/api/rooms", { title: "NotifTest", description: "fanout", category: "Chat" });
check("room created", room.status === 201, `status=${room.status}`);

// Sender DMs follower -> message notif (conv-verify1 already exists; reuse it
// only if present, else create a fresh direct conversation).
let cid = "conv-verify1";
const existing = await api(S1, "GET", `/api/conversations/${cid}`, null).catch(() => ({ status: 404 }));
if (existing.status !== 200) {
  const dc = await api(S1, "POST", "/api/conversations/direct", { other_user_id: "u_repro2" });
  cid = dc.data?.conversation?.id;
}
check("conversation ready", !!cid, `cid=${cid}`);
const msg = await api(S1, "POST", `/api/conversations/${cid}/messages`, { conversation_id: cid, content: "notif ping" });
check("DM sent", msg.status === 200 || msg.status === 201, `status=${msg.status}`);

// Recipient lists: checkin reminder + room_live + message = 3 unread.
const list = await api(S2, "GET", "/api/notifications?limit=20");
const types = (list.data?.notifications ?? []).map((n) => n.type).sort();
check("checkin reminder synthesized", types.includes("checkin"), `types=${types}`);
check("room_live fanned out", types.includes("room_live"), `types=${types}`);
check("message fanned out", types.includes("message"), `types=${types}`);
const unread1 = await api(S2, "GET", "/api/notifications/unread-count");
check("unread-count >= 3", (unread1.data?.unread ?? 0) >= 3, `unread=${unread1.data?.unread}`);

// Second DM while unread exists must NOT add another row.
await api(S1, "POST", `/api/conversations/${cid}/messages`, { conversation_id: cid, content: "notif ping 2" });
const unread2 = await api(S2, "GET", "/api/notifications/unread-count");
check("no duplicate message row", unread2.data?.unread === unread1.data?.unread, `before=${unread1.data?.unread} after=${unread2.data?.unread}`);

// Second list call must NOT duplicate the checkin reminder.
await api(S2, "GET", "/api/notifications?limit=20");
const list2 = await api(S2, "GET", "/api/notifications?limit=20");
const checkins = (list2.data?.notifications ?? []).filter((n) => n.type === "checkin" && !n.read_at);
check("single checkin reminder", checkins.length === 1, `count=${checkins.length}`);

// Mark-all-read drains the badge.
await api(S2, "POST", "/api/notifications/read", { all: true });
const unread3 = await api(S2, "GET", "/api/notifications/unread-count");
check("mark-all-read drains badge", unread3.data?.unread === 0, `unread=${unread3.data?.unread}`);

let failed = 0;
for (const [s, n, x] of results) {
  if (s === "FAIL") failed++;
  console.log(`${s} ${n} ${x}`);
}
process.exit(failed ? 1 : 0);
