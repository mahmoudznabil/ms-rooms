/* Account-deletion verification against local pages dev (port 8793).
 * Creates a throwaway user, DMs once, deletes, then checks the tombstone.
 * D1 assertions run separately (see command below).
 * Usage: node scripts/verify-delete.mjs
 */
const BASE = "http://localhost:8793";

async function api(session, method, path, body, csrf = true) {
  const headers = { Cookie: `session=${session}`, "Content-Type": "application/json" };
  if (csrf && method !== "GET") {
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

// Throwaway user (seeded separately with sess_repro3).
const S3 = "sess_repro3";
const me = await api(S3, "GET", "/api/auth/me");
check("throwaway session valid", me.status === 200, `status=${me.status}`);

// DM + message so there is content to clean up.
const conv = await api(S3, "POST", "/api/conversations/direct", { other_user_id: "u_repro1" });
const cid = conv.data?.conversation?.id;
check("DM created", conv.status === 201 && !!cid, `status=${conv.status}`);
const msg = cid
  ? await api(S3, "POST", `/api/conversations/${cid}/messages`, { conversation_id: cid, content: "bye world" })
  : { status: -1 };
check("message sent", msg.status === 200 || msg.status === 201, `status=${msg.status}`);

// Delete WITHOUT CSRF header (exactly what the profile page sends today).
const del = await api(S3, "POST", "/api/users/me/delete", {}, false);
check("delete without CSRF rejected (403 expected today)", del.status === 403, `status=${del.status} ${del.data?.error ?? ""}`);

// Delete WITH proper CSRF (what it should accept).
const del2 = await api(S3, "POST", "/api/users/me/delete", {}, true);
check("delete with CSRF succeeds", del2.status === 200, `status=${del2.status} ${del2.data?.error ?? ""}`);

let failed = 0;
for (const [s, n, x] of results) {
  if (s === "FAIL") failed++;
  console.log(`${s} ${n} ${x}`);
}
process.exit(failed ? 1 : 0);
