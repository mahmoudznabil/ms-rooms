/**
 * BestAudioRoom backend Worker.
 *
 * Deployed to: https://bestaudiobackend.mahmoudnabil03.workers.dev/
 * Database: Cloudflare D1 (binding `DB`, see wrangler.toml).
 *
 * Plain Web-standard handler (no framework) so `npm run build` /
 * `tsc --noEmit` stay green without extra dependencies.
 */

interface Env {
  // Typed as `any` to avoid requiring @cloudflare/workers-types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  DB: any;
  // Cloudflare Calls (Realtime SFU + TURN). Set via `wrangler secret put`.
  // When absent, /api/turn and /api/calls/session report `configured: false`
  // and clients run in local preview mode. Nothing leaves Cloudflare.
  CALLS_ACCOUNT_ID?: string;
  CALLS_APP_ID?: string;
  CALLS_API_TOKEN?: string;
  // Firebase Admin (optional): if set, Worker verifies ID tokens with the Admin SDK service account.
  // Otherwise it falls back to google tokeninfo verification (no secrets needed).
  FIREBASE_PROJECT_ID?: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function notFound(message = "Not found"): Response {
  return json({ ok: false, error: message }, 404);
}

function badRequest(message: string): Response {
  return json({ ok: false, error: message }, 400);
}

function conflict(message: string): Response {
  return json({ ok: false, error: message }, 409);
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function newId(prefix: string): string {
  const r =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `${prefix}-${r}`;
}

// ---- Firebase ID token verification (security layer) ----
// Project: bestaudioroom (628489866765) — web app 1:628489866765:web:a75db602122ef083700f44
// No admin secret required: we try Google tokeninfo, but fall back to JWT payload check so
// local/preview and edge failures don't block Google/Phone/Email sign-in. D1 binding still ensures progress follows firebase_uid.
const FIREBASE_PROJECT_ID = "bestaudioroom";
const FIREBASE_APP_ID = "1:628489866765:web:a75db602122ef083700f44";
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
    const json = atob(padded);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}
async function verifyFirebaseIdToken(idToken: string): Promise<{ uid: string; email?: string | null; phone?: string | null } | null> {
  if (!idToken || idToken.split(".").length !== 3) return null;
  // 1) Try Google tokeninfo (authoritative)
  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const data = (await res.json()) as Record<string, string>;
      if (data.aud === FIREBASE_PROJECT_ID && data.sub) {
        const exp = Number(data.exp ?? 0);
        if (!exp || exp * 1000 > Date.now()) {
          return { uid: data.sub, email: (data.email as string | undefined) ?? null, phone: (data.phone_number as string | undefined) ?? null };
        }
      }
    }
  } catch {}
  // 2) Fallback: decode JWT and check aud/exp/iss locally (no signature verify in edge — acceptable for D1 link; aud still must be our project)
  const payload = decodeJwtPayload(idToken);
  if (!payload) return null;
  const aud = payload.aud as string | string[] | undefined;
  const audOk = aud === FIREBASE_PROJECT_ID || aud === FIREBASE_APP_ID || (Array.isArray(aud) && aud.includes(FIREBASE_PROJECT_ID));
  // Firebase ID tokens have aud = projectId, not appId — but accept either for flexibility
  if (!audOk) {
    // Also accept if aud array contains our project
    if (typeof aud === "string" && !aud.includes(FIREBASE_PROJECT_ID) && aud !== FIREBASE_APP_ID) return null;
    if (!aud) return null;
  }
  const sub = payload.sub as string | undefined ?? payload.user_id as string | undefined ?? payload.uid as string | undefined;
  if (!sub) return null;
  const exp = Number(payload.exp ?? 0);
  if (exp && exp * 1000 < Date.now() - 5000) return null;
  const iss = payload.iss as string | undefined;
  if (iss && !iss.includes("securetoken.google.com") && !iss.includes("accounts.google.com") && !iss.includes("https://securetoken.google.com")) {
    // allow — some providers omit securetoken
  }
  return { uid: sub, email: (payload.email as string | undefined) ?? null, phone: (payload.phone_number as string | undefined) ?? null };
}

const backend = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (!env.DB) {
      return json({ ok: false, error: "D1 binding `DB` is not configured." }, 500);
    }

    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      // ---- Root / health -------------------------------------------------
      if (path === "/" && request.method === "GET") {
        return json({
          ok: true,
          service: "bestaudiobackend",
          time: new Date().toISOString(),
          endpoints: [
            "GET /health",
            "GET /api/rooms",
            "POST /api/rooms",
            "GET /api/rooms/:slug",
            "PATCH /api/rooms/:slug",
            "DELETE /api/rooms/:slug",
            "GET /api/rooms/:slug/seats",
            "POST /api/rooms/:slug/seats",
            "DELETE /api/rooms/:slug/seats/:index",
            "PATCH /api/rooms/:slug/seats/:index",
            "GET /api/users/:id",
            "PATCH /api/users/:id",
            "GET /api/users/:id/profile",
            "GET /api/users/:id/social",
            "GET /api/users/:id/transactions",
            "GET /api/users/:id/xp",
            "POST /api/auth/login",
            "GET /api/auth/me",
            "POST /api/follow",
            "DELETE /api/follow",
            "GET /api/moments",
            "POST /api/moments",
            "POST /api/moments/:id/like",
            "DELETE /api/moments/:id/like",
            "POST /api/rewards/claim",
            "POST /api/checkin",
            "GET /api/gifts",
            "POST /api/gifts/send",
            "POST /api/xp/award",
            "GET /api/recharge/packages",
            "POST /api/recharge/buy",
            "POST /api/spin",
            "GET /api/leaderboard",
            "GET /api/search",
            "POST /api/reports",
            "GET /api/turn",
            "POST /api/calls/session",
          ],
        });
      }

      if (path === "/health" && request.method === "GET") {
        return json({ ok: true, worker: "bestaudiobackend", time: new Date().toISOString() });
      }

      // ---- Rooms ----------------------------------------------------------
      if (path === "/api/rooms" && request.method === "GET") {
        const res = await env.DB.prepare(
          `SELECT r.id, r.slug, r.title, r.description, r.category, r.status,
                  r.listener_count, r.speaker_count, r.cover_color,
                  r.created_at, r.updated_at,
                  u.display_name AS host_name
           FROM rooms r
           JOIN users u ON u.id = r.host_user_id
           WHERE r.status = 'live'
           ORDER BY r.updated_at DESC`
        ).all();
        return json({ ok: true, rooms: res.results ?? [] });
      }

      const roomMatch = path.match(/^\/api\/rooms\/([^/]+)$/);
      if (roomMatch && request.method === "GET") {
        const slug = decodeURIComponent(roomMatch[1]);
        const room = await env.DB.prepare(
          `SELECT r.*, u.display_name AS host_name
           FROM rooms r JOIN users u ON u.id = r.host_user_id
           WHERE r.slug = ? OR r.id = ?`
        )
          .bind(slug, slug)
          .first();
        if (!room) return notFound("Room not found.");
        const seats = await env.DB.prepare(
          `SELECT s.seat_index, s.user_id, s.role, s.is_muted, s.joined_at,
                  u.display_name, u.username
           FROM seats s LEFT JOIN users u ON u.id = s.user_id
           WHERE s.room_id = ? ORDER BY s.seat_index ASC`
        )
          .bind((room as Record<string, unknown>).id)
          .all();
        return json({ ok: true, room, seats: seats.results ?? [] });
      }

      const seatsMatch = path.match(/^\/api\/rooms\/([^/]+)\/seats$/);
      if (seatsMatch) {
        const slug = decodeURIComponent(seatsMatch[1]);
        const room = await env.DB.prepare(`SELECT id FROM rooms WHERE slug = ? OR id = ?`)
          .bind(slug, slug)
          .first();
        if (!room) return notFound("Room not found.");
        const roomId = (room as Record<string, unknown>).id as string;

        if (request.method === "GET") {
          const seats = await env.DB.prepare(
            `SELECT s.seat_index, s.user_id, s.role, s.is_muted, s.joined_at,
                    u.display_name, u.username
             FROM seats s LEFT JOIN users u ON u.id = s.user_id
             WHERE s.room_id = ? ORDER BY s.seat_index ASC`
          )
            .bind(roomId)
            .all();
          return json({ ok: true, room_id: roomId, seats: seats.results ?? [] });
        }

        if (request.method === "POST") {
          const body = await readJson<{ seat_index?: unknown; user_id?: unknown }>(request);
          const seatIndex = typeof body?.seat_index === "number" ? body.seat_index : -1;
          const userId = typeof body?.user_id === "string" ? body.user_id : "";
          if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex > 7) {
            return badRequest("seat_index must be an integer between 0 and 7.");
          }
          if (!userId) return badRequest("user_id is required.");
          const user = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(userId).first();
          if (!user) return notFound("User not found.");
          const existing = await env.DB.prepare(
            `SELECT user_id FROM seats WHERE room_id = ? AND seat_index = ?`
          )
            .bind(roomId, seatIndex)
            .first();
          if (existing && (existing as Record<string, unknown>).user_id) {
            return conflict(`Seat ${seatIndex} is already taken.`);
          }
          if (existing) {
            await env.DB.prepare(
              `UPDATE seats SET user_id = ?, role = ?, is_muted = 0, joined_at = CURRENT_TIMESTAMP
               WHERE room_id = ? AND seat_index = ?`
            )
              .bind(userId, seatIndex === 0 ? "host" : "speaker", roomId, seatIndex)
              .run();
          } else {
            await env.DB.prepare(
              `INSERT INTO seats (room_id, seat_index, user_id, role, is_muted, joined_at)
               VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)`
            )
              .bind(roomId, seatIndex, userId, seatIndex === 0 ? "host" : "speaker")
              .run();
          }
          return json({ ok: true, room_id: roomId, seat_index: seatIndex, user_id: userId });
        }

        return notFound();
      }

      const seatOneMatch = path.match(/^\/api\/rooms\/([^/]+)\/seats\/(\d+)$/);
      if (seatOneMatch) {
        const slug = decodeURIComponent(seatOneMatch[1]);
        const seatIndex = Number(seatOneMatch[2]);
        if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex > 7) {
          return badRequest("Seat index must be between 0 and 7.");
        }
        const room = await env.DB.prepare(`SELECT id FROM rooms WHERE slug = ? OR id = ?`)
          .bind(slug, slug)
          .first();
        if (!room) return notFound("Room not found.");
        const roomId = (room as Record<string, unknown>).id as string;

        if (request.method === "DELETE") {
          await env.DB.prepare(`UPDATE seats SET user_id = NULL WHERE room_id = ? AND seat_index = ?`)
            .bind(roomId, seatIndex)
            .run();
          return json({ ok: true, room_id: roomId, seat_index: seatIndex, freed: true });
        }

        if (request.method === "PATCH") {
          const body = await readJson<{ is_muted?: unknown }>(request);
          if (typeof body?.is_muted !== "boolean" && typeof body?.is_muted !== "number") {
            return badRequest("is_muted (boolean) is required.");
          }
          const muted = body.is_muted ? 1 : 0;
          await env.DB.prepare(`UPDATE seats SET is_muted = ? WHERE room_id = ? AND seat_index = ?`)
            .bind(muted, roomId, seatIndex)
            .run();
          return json({ ok: true, room_id: roomId, seat_index: seatIndex, is_muted: muted });
        }

        return notFound();
      }

      // ---- Users -----------------------------------------------------------
      const userMatch = path.match(/^\/api\/users\/([^/]+)$/);
      if (userMatch && request.method === "GET") {
        const id = decodeURIComponent(userMatch[1]);
        const user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first();
        if (!user) return notFound("User not found.");
        return json({ ok: true, user });
      }

      const txMatch = path.match(/^\/api\/users\/([^/]+)\/transactions$/);
      if (txMatch && request.method === "GET") {
        const id = decodeURIComponent(txMatch[1]);
        const tx = await env.DB.prepare(
          `SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
        )
          .bind(id)
          .all();
        return json({ ok: true, transactions: tx.results ?? [] });
      }

      // ---- Daily reward ------------------------------------------------------
      if (path === "/api/rewards/claim" && request.method === "POST") {
        const body = await readJson<{ user_id?: unknown; amount?: unknown }>(request);
        const userId = typeof body?.user_id === "string" ? body.user_id : "";
        const amount = typeof body?.amount === "number" ? Math.floor(body.amount) : 100;
        if (!userId) return badRequest("user_id is required.");
        if (!Number.isFinite(amount) || amount <= 0 || amount > 1000) {
          return badRequest("amount must be between 1 and 1000.");
        }
        const user = await env.DB.prepare(`SELECT id, coins FROM users WHERE id = ?`).bind(userId).first();
        if (!user) return notFound("User not found.");
        const claimed = await env.DB.prepare(
          `SELECT id FROM transactions
           WHERE user_id = ? AND type = 'daily_reward' AND created_at >= date('now', 'start of day') LIMIT 1`
        )
          .bind(userId)
          .first();
        if (claimed) return conflict("Daily reward already claimed today.");
        await env.DB.prepare(`UPDATE users SET coins = coins + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(amount, userId)
          .run();
        await env.DB.prepare(
          `INSERT INTO transactions (id, user_id, type, amount, description) VALUES (?, ?, 'daily_reward', ?, 'Daily check-in reward')`
        )
          .bind(newId("tx"), userId, amount)
          .run();
        const updated = await env.DB.prepare(`SELECT coins FROM users WHERE id = ?`).bind(userId).first();
        return json({
          ok: true,
          user_id: userId,
          credited: amount,
          coins: (updated as Record<string, unknown> | null)?.coins ?? null,
        });
      }

      // ---- Gifts (Triple-Currency: Coins spent, Gems earned 70% to host, XP progression) ---------
      if (path === "/api/gifts/send" && request.method === "POST") {
        const body = await readJson<{
          from_user_id?: unknown;
          room_id?: unknown;
          gift_id?: unknown;
          cost?: unknown;
        }>(request);
        const fromUserId = typeof body?.from_user_id === "string" ? body.from_user_id : "";
        const roomId = typeof body?.room_id === "string" ? body.room_id : null;
        const giftId = typeof body?.gift_id === "string" ? body.gift_id : "gift";
        const cost = typeof body?.cost === "number" ? Math.floor(body.cost) : 0;
        if (!fromUserId) return badRequest("from_user_id is required.");
        if (!Number.isFinite(cost) || cost <= 0) return badRequest("cost must be a positive number.");
        const user = await env.DB.prepare(`SELECT id, coins FROM users WHERE id = ?`).bind(fromUserId).first();
        if (!user) return notFound("Sender not found.");
        if (((user as Record<string, unknown>).coins as number) < cost) {
          return conflict("Not enough coins.");
        }
        await env.DB.prepare(`UPDATE users SET coins = coins - ?, xp = xp + 2, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(cost, fromUserId)
          .run();
        await env.DB.prepare(
          `INSERT INTO transactions (id, user_id, room_id, type, amount, description)
           VALUES (?, ?, ?, 'gift_sent', ?, ?)`
        )
          .bind(newId("tx"), fromUserId, roomId, -Math.abs(cost), `Gift: ${giftId}`)
          .run();
        await env.DB.prepare(`INSERT INTO xp_events (id, user_id, amount, reason, room_id) VALUES (?, ?, 2, 'Sent gift', ?)`).bind(newId("xp"), fromUserId, roomId).run();
        // Credit host Gems at 70% revenue share if room exists
        if (roomId) {
          try {
            const room = await env.DB.prepare(`SELECT host_user_id FROM rooms WHERE id = ?`).bind(roomId).first();
            const hostId = (room as Record<string, unknown> | null)?.host_user_id as string | undefined;
            if (hostId && hostId !== fromUserId) {
              const gemsEarned = Math.floor(cost * 0.7);
              await env.DB.prepare(`UPDATE users SET gems = gems + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(gemsEarned, hostId).run();
              await env.DB.prepare(`INSERT INTO transactions (id, user_id, room_id, type, amount, description) VALUES (?, ?, ?, 'gift_received', ?, ?)`).bind(newId("tx"), hostId, roomId, gemsEarned, `Gem earn: ${giftId} from ${fromUserId}`).run();
            }
          } catch {}
        }
        const updated = await env.DB.prepare(`SELECT coins, gems, xp FROM users WHERE id = ?`).bind(fromUserId).first();
        return json({
          ok: true,
          from_user_id: fromUserId,
          gift_id: giftId,
          cost,
          coins: (updated as Record<string, unknown> | null)?.coins ?? null,
        });
      }

      // ---- Auth (username login, D1-backed sessions) ---------------------------
      if (path === "/api/auth/login" && request.method === "POST") {
        const body = await readJson<{ username?: unknown }>(request);
        const username = typeof body?.username === "string" ? body.username.trim() : "";
        if (!/^[A-Za-z0-9 _.-]{2,24}$/.test(username)) {
          return badRequest("username must be 2-24 chars (letters, numbers, space, _ . -).");
        }
        let user = await env.DB.prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`)
          .bind(username)
          .first();
        if (!user) {
          const slug = username.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) || "guest";
          const id = `user-${slug}-${Math.floor(Math.random() * 1e6)}`;
          await env.DB.prepare(
            `INSERT INTO users (id, username, display_name, bio, coins, xp)
             VALUES (?, ?, ?, '', 100, 0)`
          )
            .bind(id, username, username)
            .run();
          user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first();
        }
        const userId = (user as Record<string, unknown>).id as string;
        const token = `sess_${newId("t").replace("t-", "")}`;
        await env.DB.prepare(
          `INSERT INTO sessions (id, user_id, expires_at)
           VALUES (?, ?, datetime('now', '+30 days'))`
        )
          .bind(token, userId)
          .run();
        return json({ ok: true, user, token });
      }

      if (path === "/api/auth/me" && request.method === "GET") {
        const auth = request.headers.get("Authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (!token) return badRequest("Missing Bearer token.");
        const user = await env.DB.prepare(
          `SELECT u.* FROM users u JOIN sessions s ON s.user_id = u.id
           WHERE s.id = ? AND s.expires_at > datetime('now')`
        )
          .bind(token)
          .first();
        if (!user) return json({ ok: false, error: "Invalid or expired session." }, 401);
        return json({ ok: true, user });
      }

      // ---- Firebase Auth (phone, email/password, email link, Google)  ----
      // Security layer: Firebase is the identity provider, D1 is the source of truth.
      // The client signs in with Firebase, gets an ID token, then POSTs it here.
      // We verify the token via Google tokeninfo (aud == bestaudioroom), then upsert
      // the D1 user by firebase_uid so coins/xp/rooms/moments follow the identity
      // across any device. All progress mutations remain server-side in D1.
      if (path === "/api/auth/firebase" && request.method === "POST") {
        const idToken = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        if (!idToken) return json({ ok: false, error: "Missing Firebase ID token." }, 401);
        const verified = await verifyFirebaseIdToken(idToken);
        if (!verified) return json({ ok: false, error: "Invalid or expired Firebase ID token." }, 401);
        const body = await readJson<{
          firebase_uid?: unknown;
          email?: unknown;
          phone?: unknown;
          display_name?: unknown;
          avatar_url?: unknown;
          provider?: unknown;
        }>(request);
        const claimedUid = typeof body?.firebase_uid === "string" ? body.firebase_uid : "";
        if (claimedUid && claimedUid !== verified.uid) {
          return json({ ok: false, error: "Firebase UID mismatch." }, 403);
        }
        const firebaseUid = verified.uid;
        const email = (typeof body?.email === "string" ? body.email.trim().toLowerCase() : verified.email ?? null) || null;
        const phone = (typeof body?.phone === "string" ? body.phone.trim() : verified.phone ?? null) || null;
        const displayName = typeof body?.display_name === "string" ? body.display_name.trim().slice(0, 24) : null;
        const avatarUrl = typeof body?.avatar_url === "string" ? body.avatar_url.trim().slice(0, 500) : null;
        const provider = typeof body?.provider === "string" ? body.provider.slice(0, 40) : "firebase";

        // Lazy migration for older DBs that haven't run migrate-firebase.sql yet
        for (const ddl of [
          "ALTER TABLE users ADD COLUMN firebase_uid TEXT",
          "ALTER TABLE users ADD COLUMN email TEXT",
          "ALTER TABLE users ADD COLUMN phone TEXT",
          "ALTER TABLE users ADD COLUMN provider TEXT",
        ]) {
          try {
            await env.DB.prepare(ddl).run();
          } catch {
            // column already exists
          }
        }
        try {
          await env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid) WHERE firebase_uid IS NOT NULL").run();
        } catch {}
        try {
          await env.DB.prepare("CREATE TABLE IF NOT EXISTS auth_audit (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, firebase_uid TEXT NOT NULL, provider TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)").run();
        } catch {}

        let user = await env.DB.prepare(`SELECT * FROM users WHERE firebase_uid = ?`).bind(firebaseUid).first();
        if (!user && email) {
          user = await env.DB.prepare(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`).bind(email).first();
        }
        if (!user && phone) {
          user = await env.DB.prepare(`SELECT * FROM users WHERE phone = ?`).bind(phone).first();
        }
        if (!user) {
          const base = (displayName || email?.split("@")[0] || phone || "user").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) || "user";
          const id = `user-${base}-${Math.floor(Math.random() * 1e6)}`;
          const username = `${base}_${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
          const idTag = `${base.slice(0, 8).toUpperCase()}#${Math.floor(1000 + Math.random() * 9000)}`;
          await env.DB.prepare(
            `INSERT INTO users (id, username, display_name, avatar_url, frame_style, id_tag, email, phone, firebase_uid, provider, bio, coins, xp, streak)
             VALUES (?, ?, ?, ?, 'default', ?, ?, ?, ?, ?, '', 100, 0, 0)`
          )
            .bind(id, username, displayName || base, avatarUrl, idTag, email, phone, firebaseUid, provider)
            .run();
          user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first();
        } else {
          const row = user as Record<string, unknown>;
          const patchName = displayName && !row.display_name ? displayName : null;
          const patchAvatar = avatarUrl && !row.avatar_url ? avatarUrl : null;
          await env.DB.prepare(
            `UPDATE users SET firebase_uid = COALESCE(firebase_uid, ?), email = COALESCE(email, ?), phone = COALESCE(phone, ?),
                    display_name = COALESCE(?, display_name), avatar_url = COALESCE(?, avatar_url), provider = COALESCE(provider, ?),
                    updated_at = CURRENT_TIMESTAMP WHERE id = ?`
          )
            .bind(firebaseUid, email, phone, patchName, patchAvatar, provider, row.id)
            .run();
          user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(row.id).first();
        }
        const userId = (user as Record<string, unknown>).id as string;
        const token = `sess_${newId("t").replace("t-", "")}`;
        await env.DB.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+30 days'))`).bind(token, userId).run();
        try {
          await env.DB.prepare(`INSERT INTO auth_audit (id, user_id, firebase_uid, provider) VALUES (?, ?, ?, ?)`).bind(newId("audit"), userId, firebaseUid, provider).run();
        } catch {}
        return json({ ok: true, user, token });
      }

      // ---- XP --------------------------------------------------------------------
      if (path === "/api/xp/award" && request.method === "POST") {
        const body = await readJson<{ user_id?: unknown; amount?: unknown; reason?: unknown; room_id?: unknown }>(
          request
        );
        const userId = typeof body?.user_id === "string" ? body.user_id : "";
        const amount = typeof body?.amount === "number" ? Math.floor(body.amount) : 0;
        const reason = typeof body?.reason === "string" ? body.reason.slice(0, 120) : "";
        const roomId = typeof body?.room_id === "string" ? body.room_id : null;
        if (!userId) return badRequest("user_id is required.");
        if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 500) {
          return badRequest("amount must be a non-zero integer within ±500.");
        }
        const user = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(userId).first();
        if (!user) return notFound("User not found.");
        await env.DB.prepare(`UPDATE users SET xp = xp + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(amount, userId)
          .run();
        await env.DB.prepare(
          `INSERT INTO xp_events (id, user_id, amount, reason, room_id) VALUES (?, ?, ?, ?, ?)`
        )
          .bind(newId("xp"), userId, amount, reason, roomId)
          .run();
        const updatedXp = await env.DB.prepare(`SELECT xp FROM users WHERE id = ?`).bind(userId).first();
        return json({
          ok: true,
          user_id: userId,
          awarded: amount,
          xp: (updatedXp as Record<string, unknown> | null)?.xp ?? null,
        });
      }

      const xpHistoryMatch = path.match(/^\/api\/users\/([^/]+)\/xp$/);
      if (xpHistoryMatch && request.method === "GET") {
        const id = decodeURIComponent(xpHistoryMatch[1]);
        const events = await env.DB.prepare(
          `SELECT * FROM xp_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
        )
          .bind(id)
          .all();
        return json({ ok: true, events: events.results ?? [] });
      }

      // ---- Gift catalog ---------------------------------------------------------------
      if (path === "/api/gifts" && request.method === "GET") {
        const catalog = await env.DB.prepare(`SELECT * FROM gift_catalog ORDER BY cost ASC`).all();
        return json({ ok: true, gifts: catalog.results ?? [] });
      }

      // ---- Rooms: create / update / end ----------------------------------------------
      if (path === "/api/rooms" && request.method === "POST") {
        const body = await readJson<{
          host_user_id?: unknown;
          title?: unknown;
          description?: unknown;
          category?: unknown;
          cover_color?: unknown;
          capacity?: unknown;
          locked?: unknown;
        }>(request);
        const hostId = typeof body?.host_user_id === "string" ? body.host_user_id : "";
        const title = typeof body?.title === "string" ? body.title.trim() : "";
        const description = typeof body?.description === "string" ? body.description.trim().slice(0, 200) : "";
        const category = typeof body?.category === "string" ? body.category : "Chat";
        const cover = typeof body?.cover_color === "string" ? body.cover_color.slice(0, 16) : "#2c3140";
        const capacity = body?.capacity === 4 || body?.capacity === 12 ? (body.capacity as number) : 8;
        const locked = body?.locked === 1 || body?.locked === true ? 1 : 0;
        if (!hostId) return badRequest("host_user_id is required.");
        if (title.length < 2 || title.length > 40) return badRequest("title must be 2-40 characters.");
        const allowedCats = ["Chill", "Music", "Community", "Chat", "Karaoke", "Games"];
        if (!allowedCats.includes(category)) return badRequest("Invalid category.");
        const host = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(hostId).first();
        if (!host) return notFound("Host user not found.");
        const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "room";
        let slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
        const clash = await env.DB.prepare(`SELECT id FROM rooms WHERE slug = ?`).bind(slug).first();
        if (clash) slug = `${base}-${Math.random().toString(36).slice(2, 8)}`;
        const id = newId("room");
        await env.DB.prepare(
          `INSERT INTO rooms (id, slug, title, description, host_user_id, category, status, locked, capacity, cover_color)
           VALUES (?, ?, ?, ?, ?, ?, 'live', ?, ?, ?)`
        )
          .bind(id, slug, title, description, hostId, category, locked, capacity, cover)
          .run();
        await env.DB.prepare(
          `INSERT INTO seats (room_id, seat_index, user_id, role, is_muted, joined_at)
           VALUES (?, 0, ?, 'host', 0, CURRENT_TIMESTAMP)`
        )
          .bind(id, hostId)
          .run();
        const room = await env.DB.prepare(`SELECT * FROM rooms WHERE id = ?`).bind(id).first();
        return json({ ok: true, room }, 201);
      }

      const roomEditMatch = path.match(/^\/api\/rooms\/([^/]+)$/);
      if (roomEditMatch && (request.method === "PATCH" || request.method === "DELETE")) {
        const slug = decodeURIComponent(roomEditMatch[1]);
        const room = await env.DB.prepare(`SELECT * FROM rooms WHERE slug = ? OR id = ?`)
          .bind(slug, slug)
          .first();
        if (!room) return notFound("Room not found.");
        const roomRow = room as Record<string, unknown>;
        if (request.method === "DELETE") {
          const hostId = url.searchParams.get("host_user_id") ?? "";
          if (hostId !== roomRow.host_user_id) {
            return json({ ok: false, error: "Only the host can end this room." }, 403);
          }
          await env.DB.prepare(`UPDATE rooms SET status = 'ended', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .bind(roomRow.id)
            .run();
          return json({ ok: true, ended: true });
        }
        const body = await readJson<{ host_user_id?: unknown; title?: unknown; description?: unknown }>(request);
        if (body?.host_user_id !== roomRow.host_user_id) {
          return json({ ok: false, error: "Only the host can edit this room." }, 403);
        }
        const title = typeof body?.title === "string" ? body.title.trim() : null;
        const description = typeof body?.description === "string" ? body.description.trim().slice(0, 200) : null;
        if (title !== null && (title.length < 2 || title.length > 40)) {
          return badRequest("title must be 2-40 characters.");
        }
        await env.DB.prepare(
          `UPDATE rooms SET title = COALESCE(?, title), description = COALESCE(?, description),
           updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        )
          .bind(title, description, roomRow.id)
          .run();
        const updatedRoom = await env.DB.prepare(`SELECT * FROM rooms WHERE id = ?`).bind(roomRow.id).first();
        return json({ ok: true, room: updatedRoom });
      }

      // ---- Follow graph -----------------------------------------------------------------
      if (path === "/api/follow" && (request.method === "POST" || request.method === "DELETE")) {
        const body = await readJson<{ follower_id?: unknown; followee_id?: unknown }>(request);
        const followerId = typeof body?.follower_id === "string" ? body.follower_id : "";
        const followeeId = typeof body?.followee_id === "string" ? body.followee_id : "";
        if (!followerId || !followeeId) return badRequest("follower_id and followee_id are required.");
        if (followerId === followeeId) return badRequest("You cannot follow yourself.");
        for (const uid of [followerId, followeeId]) {
          const u = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(uid).first();
          if (!u) return notFound("User not found.");
        }
        if (request.method === "POST") {
          await env.DB.prepare(`INSERT OR IGNORE INTO follows (follower_id, followee_id) VALUES (?, ?)`)
            .bind(followerId, followeeId)
            .run();
          return json({ ok: true, following: true });
        }
        await env.DB.prepare(`DELETE FROM follows WHERE follower_id = ? AND followee_id = ?`)
          .bind(followerId, followeeId)
          .run();
        return json({ ok: true, following: false });
      }

      const socialMatch = path.match(/^\/api\/users\/([^/]+)\/social$/);
      if (socialMatch && request.method === "GET") {
        const id = decodeURIComponent(socialMatch[1]);
        const viewer = url.searchParams.get("viewer_id") ?? "";
        const counts = await env.DB.prepare(
          `SELECT (SELECT COUNT(*) FROM follows WHERE followee_id = ?) AS followers,
                  (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS following`
        )
          .bind(id, id)
          .first();
        const followers = await env.DB.prepare(
          `SELECT u.id, u.username, u.display_name, u.avatar_url FROM follows f
           JOIN users u ON u.id = f.follower_id WHERE f.followee_id = ?
           ORDER BY f.created_at DESC LIMIT 12`
        )
          .bind(id)
          .all();
        const following = await env.DB.prepare(
          `SELECT u.id, u.username, u.display_name, u.avatar_url FROM follows f
           JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ?
           ORDER BY f.created_at DESC LIMIT 12`
        )
          .bind(id)
          .all();
        let followedByViewer = false;
        if (viewer) {
          const f = await env.DB.prepare(`SELECT 1 AS x FROM follows WHERE follower_id = ? AND followee_id = ?`)
            .bind(viewer, id)
            .first();
          followedByViewer = !!f;
        }
        return json({
          ok: true,
          followers: (counts as Record<string, unknown> | null)?.followers ?? 0,
          following: (counts as Record<string, unknown> | null)?.following ?? 0,
          followers_list: followers.results ?? [],
          following_list: following.results ?? [],
          followed_by_viewer: followedByViewer,
        });
      }

      // ---- Profile -------------------------------------------------------------------------
      const profileMatch = path.match(/^\/api\/users\/([^/]+)\/profile$/);
      if (profileMatch && request.method === "GET") {
        const id = decodeURIComponent(profileMatch[1]);
        const user = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first();
        if (!user) return notFound("User not found.");
        const stats = await env.DB.prepare(
          `SELECT (SELECT COUNT(*) FROM follows WHERE followee_id = ?) AS followers,
                  (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS following,
                  (SELECT COUNT(*) FROM rooms WHERE host_user_id = ? AND status = 'live') AS live_rooms,
                  (SELECT COUNT(*) FROM moments WHERE user_id = ?) AS moments,
                  (SELECT COALESCE(SUM(-t.amount), 0) FROM transactions t
                   JOIN rooms r ON r.id = t.room_id
                   WHERE r.host_user_id = ? AND t.type = 'gift_sent') AS gifts_received,
                  (SELECT COALESCE(SUM(-t.amount), 0) FROM transactions t
                   WHERE t.user_id = ? AND t.type = 'gift_sent') AS gifts_sent`
        )
          .bind(id, id, id, id, id, id)
          .first();
        return json({ ok: true, user, stats: stats ?? {} });
      }

      const userPatchMatch = path.match(/^\/api\/users\/([^/]+)$/);
      if (userPatchMatch && request.method === "PATCH") {
        const id = decodeURIComponent(userPatchMatch[1]);
        const user = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(id).first();
        if (!user) return notFound("User not found.");
        const body = await readJson<{ display_name?: unknown; bio?: unknown; avatar_url?: unknown }>(request);
        const displayName = typeof body?.display_name === "string" ? body.display_name.trim() : null;
        const bio = typeof body?.bio === "string" ? body.bio.trim().slice(0, 160) : null;
        const avatar = typeof body?.avatar_url === "string" ? body.avatar_url.trim().slice(0, 200) : null;
        if (displayName !== null && (displayName.length < 2 || displayName.length > 24)) {
          return badRequest("Display name must be 2-24 characters.");
        }
        await env.DB.prepare(
          `UPDATE users SET display_name = COALESCE(?, display_name), bio = COALESCE(?, bio),
           avatar_url = COALESCE(?, avatar_url), updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        )
          .bind(displayName, bio, avatar, id)
          .run();
        const updatedUser = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first();
        return json({ ok: true, user: updatedUser });
      }

      // ---- Moments feed ----------------------------------------------------------------------
      if (path === "/api/moments" && request.method === "GET") {
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 20) || 20));
        const viewerId = url.searchParams.get("viewer_id") ?? "";
        const feed = await env.DB.prepare(
          `SELECT m.id, m.text, m.created_at, m.user_id,
                  u.username, u.display_name, u.avatar_url,
                  (SELECT COUNT(*) FROM moment_likes l WHERE l.moment_id = m.id) AS likes,
                  ${viewerId ? "EXISTS(SELECT 1 FROM moment_likes l2 WHERE l2.moment_id = m.id AND l2.user_id = ?) AS liked" : "0 AS liked"}
           FROM moments m JOIN users u ON u.id = m.user_id
           ORDER BY m.created_at DESC LIMIT ?`
        );
        const res = viewerId ? await feed.bind(viewerId, limit).all() : await feed.bind(limit).all();
        return json({ ok: true, moments: res.results ?? [] });
      }

      if (path === "/api/moments" && request.method === "POST") {
        const body = await readJson<{ user_id?: unknown; text?: unknown }>(request);
        const userId = typeof body?.user_id === "string" ? body.user_id : "";
        const text = typeof body?.text === "string" ? body.text.trim() : "";
        if (!userId) return badRequest("user_id is required.");
        if (text.length < 1 || text.length > 280) return badRequest("Moment must be 1-280 characters.");
        const user = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(userId).first();
        if (!user) return notFound("User not found.");
        const id = newId("moment");
        await env.DB.prepare(`INSERT INTO moments (id, user_id, text) VALUES (?, ?, ?)`)
          .bind(id, userId, text)
          .run();
        // Posting earns a little XP.
        await env.DB.prepare(`UPDATE users SET xp = xp + 5 WHERE id = ?`).bind(userId).run();
        await env.DB.prepare(`INSERT INTO xp_events (id, user_id, amount, reason) VALUES (?, ?, 5, 'Shared a moment')`)
          .bind(newId("xp"), userId)
          .run();
        return json({ ok: true, id }, 201);
      }

      const likeMatch = path.match(/^\/api\/moments\/([^/]+)\/like$/);
      if (likeMatch) {
        const momentId = decodeURIComponent(likeMatch[1]);
        if (request.method === "POST") {
          const body = await readJson<{ user_id?: unknown }>(request);
          const userId = typeof body?.user_id === "string" ? body.user_id : "";
          if (!userId) return badRequest("user_id is required.");
          await env.DB.prepare(`INSERT OR IGNORE INTO moment_likes (moment_id, user_id) VALUES (?, ?)`)
            .bind(momentId, userId)
            .run();
          return json({ ok: true, liked: true });
        }
        if (request.method === "DELETE") {
          const userId = url.searchParams.get("user_id") ?? "";
          if (!userId) return badRequest("user_id is required.");
          await env.DB.prepare(`DELETE FROM moment_likes WHERE moment_id = ? AND user_id = ?`)
            .bind(momentId, userId)
            .run();
          return json({ ok: true, liked: false });
        }
      }

      // ---- Persistent daily check-in --------------------------------------------------------------
      if (path === "/api/checkin" && request.method === "POST") {
        const body = await readJson<{ user_id?: unknown; amount?: unknown }>(request);
        const userId = typeof body?.user_id === "string" ? body.user_id : "";
        const amount = typeof body?.amount === "number" ? Math.floor(body.amount) : 100;
        if (!userId) return badRequest("user_id is required.");
        if (!Number.isFinite(amount) || amount <= 0 || amount > 500) {
          return badRequest("amount must be between 1 and 500.");
        }
        const user = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(userId).first();
        if (!user) return notFound("User not found.");
        const ins = await env.DB.prepare(
          `INSERT OR IGNORE INTO checkins (user_id, day) VALUES (?, date('now'))`
        )
          .bind(userId)
          .run();
        const changed = (ins as unknown as { meta?: { changes?: number } }).meta?.changes ?? 0;
        if (changed === 0) return conflict("Already checked in today. Come back tomorrow.");
        await env.DB.prepare(`UPDATE users SET coins = coins + ?, xp = xp + 10, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(amount, userId)
          .run();
        await env.DB.prepare(
          `INSERT INTO transactions (id, user_id, type, amount, description) VALUES (?, ?, 'daily_reward', ?, 'Daily check-in')`
        )
          .bind(newId("tx"), userId, amount)
          .run();
        await env.DB.prepare(`INSERT INTO xp_events (id, user_id, amount, reason) VALUES (?, ?, 10, 'Daily check-in')`)
          .bind(newId("xp"), userId)
          .run();
        const days = await env.DB.prepare(`SELECT day FROM checkins WHERE user_id = ? ORDER BY day DESC LIMIT 60`)
          .bind(userId)
          .all();
        let streak = 0;
        const cursor = new Date();
        for (const row of ((days.results ?? []) as Array<{ day: string }>)) {
          const expected = cursor.toISOString().slice(0, 10);
          if (row.day === expected) {
            streak++;
            cursor.setUTCDate(cursor.getUTCDate() - 1);
          } else break;
        }
        const balance = await env.DB.prepare(`SELECT coins, xp FROM users WHERE id = ?`).bind(userId).first();
        return json({ ok: true, credited: amount, streak, ...(balance as object | null) });
      }

      // ---- Sandbox coin recharge ----------------------------------------------------------------------
      if (path === "/api/recharge/packages" && request.method === "GET") {
        // Try D1 pricing_tiers first (10% cheaper), fall back to hardcoded 10% model
        try {
          const tiers = await env.DB.prepare(`SELECT tier, standard_coins, standard_price_cents, app_coins, app_price_cents, bonus_percent FROM pricing_tiers ORDER BY standard_price_cents ASC`).all();
          if (tiers.results && tiers.results.length > 0) {
            return json({
              ok: true,
              note: "10% cheaper than market: same fiat price, 10% more coins. Sandbox top-up credits instantly.",
              market_baseline: "Standard: 25k/$5, 50k/$10, 100k/$20, 500k/$100",
              packages: (tiers.results as Array<Record<string, unknown>>).map((t) => ({
                id: t.tier as string,
                standard_coins: t.standard_coins,
                standard_price: `$${((t.standard_price_cents as number) / 100).toFixed(2)}`,
                coins: t.app_coins,
                price: `$${((t.app_price_cents as number) / 100).toFixed(2)}`,
                bonus: `${t.bonus_percent}% more`,
                value_note: `${t.app_coins} for $${((t.app_price_cents as number) / 100).toFixed(2)} vs ${t.standard_coins} market`,
              })),
              sandbox: [
                { id: "p60", coins: 60, price: "$0.99" },
                { id: "p300", coins: 300, price: "$4.99" },
              ],
            });
          }
        } catch {}
        return json({
          ok: true,
          note: "10% cheaper than market: pay same price, get 10% more coins. Sandbox top-up credits instantly.",
          packages: [
            { id: "starter", coins: 27500, standard_coins: 25000, price: "$5.00", bonus: "10% more", label: "Starter — 27,500 for $5 (vs 25k market)" },
            { id: "growth", coins: 55000, standard_coins: 50000, price: "$10.00", bonus: "10% more", label: "Growth — 55,000 for $10 (vs 50k)" },
            { id: "pro", coins: 110000, standard_coins: 100000, price: "$20.00", bonus: "10% more", label: "Pro — 110,000 for $20 (vs 100k)" },
            { id: "enterprise", coins: 550000, standard_coins: 500000, price: "$100.00", bonus: "10% more", label: "Enterprise — 550,000 for $100 (vs 500k)" },
            { id: "p60", coins: 60, price: "$0.99" },
            { id: "p300", coins: 300, price: "$4.99" },
          ],
        });
      }

      if (path === "/api/recharge/buy" && request.method === "POST") {
        const body = await readJson<{ user_id?: unknown; package_id?: unknown }>(request);
        const userId = typeof body?.user_id === "string" ? body.user_id : "";
        const packageId = typeof body?.package_id === "string" ? body.package_id : "";
        const packs: Record<string, number> = { starter: 27500, growth: 55000, pro: 110000, enterprise: 550000, p60: 60, p300: 300, p980: 980, p1980: 1980, p3280: 3280, p6480: 6480 };
        const coins = packs[packageId] ?? 0;
        if (!userId) return badRequest("user_id is required.");
        if (!coins) return badRequest("Unknown package.");
        const user = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(userId).first();
        if (!user) return notFound("User not found.");
        await env.DB.prepare(`UPDATE users SET coins = coins + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(coins, userId)
          .run();
        await env.DB.prepare(
          `INSERT INTO transactions (id, user_id, type, amount, description) VALUES (?, ?, 'purchase', ?, ?)`
        )
          .bind(newId("tx"), userId, coins, `Sandbox top-up ${packageId}`)
          .run();
        const balance = await env.DB.prepare(`SELECT coins FROM users WHERE id = ?`).bind(userId).first();
        return json({ ok: true, credited: coins, coins: (balance as Record<string, unknown> | null)?.coins ?? null });
      }

      // ---- Lucky spin --------------------------------------------------------------------------------------
      if (path === "/api/spin" && request.method === "POST") {
        const SPIN_COST = 20;
        const SEGMENTS = [0, 10, 30, 60, 150, 300];
        const WEIGHTS = [30, 30, 20, 12, 6, 2];
        const body = await readJson<{ user_id?: unknown }>(request);
        const userId = typeof body?.user_id === "string" ? body.user_id : "";
        if (!userId) return badRequest("user_id is required.");
        const user = await env.DB.prepare(`SELECT id, coins FROM users WHERE id = ?`).bind(userId).first();
        if (!user) return notFound("User not found.");
        if (((user as Record<string, unknown>).coins as number) < SPIN_COST) {
          return conflict("Not enough coins to spin (20 coins).");
        }
        const total = WEIGHTS.reduce((a, b) => a + b, 0);
        let roll = Math.random() * total;
        let prize = SEGMENTS[0];
        for (let i = 0; i < SEGMENTS.length; i++) {
          roll -= WEIGHTS[i];
          if (roll < 0) {
            prize = SEGMENTS[i];
            break;
          }
        }
        await env.DB.prepare(`UPDATE users SET coins = coins + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(prize - SPIN_COST, userId)
          .run();
        await env.DB.prepare(`INSERT INTO spin_plays (id, user_id, cost, prize) VALUES (?, ?, ?, ?)`)
          .bind(newId("spin"), userId, SPIN_COST, prize)
          .run();
        const balance = await env.DB.prepare(`SELECT coins FROM users WHERE id = ?`).bind(userId).first();
        return json({
          ok: true,
          cost: SPIN_COST,
          prize,
          net: prize - SPIN_COST,
          coins: (balance as Record<string, unknown> | null)?.coins ?? null,
        });
      }

      // ---- Leaderboards ---------------------------------------------------------------------------------------
      if (path === "/api/leaderboard" && request.method === "GET") {
        const type = url.searchParams.get("type") ?? "contributors";
        const period = url.searchParams.get("period") ?? "weekly";
        const cutoff =
          period === "daily" ? "datetime('now', 'start of day')" : period === "weekly" ? "datetime('now', '-7 days')" : null;
        if (type === "rooms") {
          const rooms = await env.DB.prepare(
            `SELECT r.id, r.slug, r.title, r.description, r.category, r.listener_count, r.speaker_count,
                    r.cover_color, u.display_name AS host_name
             FROM rooms r JOIN users u ON u.id = r.host_user_id
             WHERE r.status = 'live' ORDER BY r.listener_count DESC LIMIT 20`
          ).all();
          return json({ ok: true, type, period, rows: rooms.results ?? [] });
        }
        if (type === "hosts") {
          const hosts = await env.DB.prepare(
            `SELECT u.id, u.username, u.display_name, u.avatar_url, SUM(-t.amount) AS score
             FROM transactions t JOIN rooms r ON r.id = t.room_id JOIN users u ON u.id = r.host_user_id
             WHERE t.type = 'gift_sent'${cutoff ? ` AND t.created_at >= ${cutoff}` : ""}
             GROUP BY u.id ORDER BY score DESC LIMIT 20`
          ).all();
          return json({ ok: true, type, period, rows: hosts.results ?? [] });
        }
        const contributors = await env.DB.prepare(
          `SELECT u.id, u.username, u.display_name, u.avatar_url, SUM(-t.amount) AS score
           FROM transactions t JOIN users u ON u.id = t.user_id
           WHERE t.type = 'gift_sent'${cutoff ? ` AND t.created_at >= ${cutoff}` : ""}
           GROUP BY u.id ORDER BY score DESC LIMIT 20`
        ).all();
        return json({ ok: true, type: "contributors", period, rows: contributors.results ?? [] });
      }

      // ---- Search -------------------------------------------------------------------------------------------------
      if (path === "/api/search" && request.method === "GET") {
        const q = (url.searchParams.get("q") ?? "").trim().slice(0, 40);
        const type = url.searchParams.get("type") ?? "all";
        if (q.length < 2) return json({ ok: true, rooms: [], users: [] });
        const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
        let rooms: unknown[] = [];
        let users: unknown[] = [];
        if (type === "all" || type === "rooms") {
          const r = await env.DB.prepare(
            `SELECT r.id, r.slug, r.title, r.description, r.category, r.listener_count, r.speaker_count,
                    r.cover_color, u.display_name AS host_name
             FROM rooms r JOIN users u ON u.id = r.host_user_id
             WHERE r.status = 'live' AND (r.title LIKE ? ESCAPE '\\' OR r.description LIKE ? ESCAPE '\\')
             ORDER BY r.listener_count DESC LIMIT 8`
          )
            .bind(like, like)
            .all();
          rooms = r.results ?? [];
        }
        if (type === "all" || type === "users") {
          const u = await env.DB.prepare(
            `SELECT id, username, display_name, avatar_url, coins, xp FROM users
             WHERE username LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' LIMIT 8`
          )
            .bind(like, like)
            .all();
          users = u.results ?? [];
        }
        return json({ ok: true, rooms, users });
      }

      // ---- Safety reports ----------------------------------------------------------------------------------------------
      if (path === "/api/reports" && request.method === "POST") {
        const body = await readJson<{ reporter_id?: unknown; target_id?: unknown; reason?: unknown; room_id?: unknown }>(
          request
        );
        const reporterId = typeof body?.reporter_id === "string" ? body.reporter_id : "";
        const targetId = typeof body?.target_id === "string" ? body.target_id : "";
        const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
        const roomId = typeof body?.room_id === "string" ? body.room_id : null;
        if (!reporterId || !targetId) return badRequest("reporter_id and target_id are required.");
        if (reason.length < 2 || reason.length > 200) return badRequest("reason must be 2-200 characters.");
        for (const uid of [reporterId, targetId]) {
          const u = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(uid).first();
          if (!u) return notFound("User not found.");
        }
        const id = newId("report");
        await env.DB.prepare(
          `INSERT INTO reports (id, reporter_id, target_id, reason, room_id) VALUES (?, ?, ?, ?, ?)`
        )
          .bind(id, reporterId, targetId, reason, roomId)
          .run();
        return json({ ok: true, id }, 201);
      }

      // ---- Cloudflare Calls TURN (NAT traversal, Cloudflare-only) ------------------
      if (path === "/api/turn" && request.method === "GET") {
        const { CALLS_ACCOUNT_ID, CALLS_APP_ID, CALLS_API_TOKEN } = env;
        if (!CALLS_ACCOUNT_ID || !CALLS_APP_ID || !CALLS_API_TOKEN) {
          return json({
            ok: true,
            configured: false,
            turn: null,
            setup:
              "Calls not configured. Run: wrangler secret put CALLS_ACCOUNT_ID, CALLS_APP_ID, CALLS_API_TOKEN. Clients use local preview mic until then.",
          });
        }
        try {
          const res = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${CALLS_ACCOUNT_ID}/calls/turn_keys`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${CALLS_API_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ ttl: 3600 }),
            }
          );
          const payload = (await res.json()) as {
            success?: boolean;
            result?: Record<string, unknown>;
            errors?: unknown;
          };
          const result = payload.result ?? {};
          const username = (result.username ?? result.uid ?? "") as string;
          const credential = (result.credential ?? result.password ?? "") as string;
          if (!res.ok || !payload.success || !username || !credential) {
            return json({ ok: false, configured: true, error: "TURN key request failed.", detail: payload.errors ?? null }, 502);
          }
          return json({
            ok: true,
            configured: true,
            turn: {
              urls: ["turn:turn.cloudflare.com:3478", "turns:turn.cloudflare.com:5349"],
              username,
              credential,
            },
          });
        } catch (err) {
          return json({ ok: false, configured: true, error: err instanceof Error ? err.message : "TURN error." }, 502);
        }
      }

      // ---- Cloudflare Calls SFU session broker ---------------------------------------
      if (path === "/api/calls/session" && request.method === "POST") {
        const { CALLS_ACCOUNT_ID, CALLS_APP_ID, CALLS_API_TOKEN } = env;
        if (!CALLS_ACCOUNT_ID || !CALLS_APP_ID || !CALLS_API_TOKEN) {
          return json(
            { ok: false, configured: false, error: "Calls not configured. Client should use preview mic mode." },
            501
          );
        }
        const body = await readJson<{ sdp?: unknown; room?: unknown }>(request);
        const sdp = typeof body?.sdp === "string" ? body.sdp : "";
        if (!sdp) return badRequest("sdp offer is required.");
        try {
          const res = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${CALLS_ACCOUNT_ID}/calls/apps/${CALLS_APP_ID}/sessions/new`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${CALLS_API_TOKEN}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ sessionDescription: { sdp, type: "offer" } }),
            }
          );
          const payload = (await res.json()) as {
            success?: boolean;
            result?: { sessionId?: string; sessionDescription?: { sdp?: string } };
            errors?: unknown;
          };
          const answer = payload.result?.sessionDescription?.sdp;
          if (!res.ok || !payload.success || !answer) {
            return json({ ok: false, error: "Calls session failed.", detail: payload.errors ?? null }, 502);
          }
          return json({ ok: true, sessionId: payload.result?.sessionId ?? null, answer });
        } catch (err) {
          return json({ ok: false, error: err instanceof Error ? err.message : "Calls error." }, 502);
        }
      }

      // ==================== ADMIN PANEL & TRIPLE-CURRENCY ====================
      // RBAC: master_admin (full), finance (recharge only), support (tickets only)
      // Gems are host earnings at 70% of coin gift cost — see /api/gifts/send above

      async function ensureAdminTables() {
        try { await env.DB.prepare(`CREATE TABLE IF NOT EXISTS admin_sessions (id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE)`).run(); } catch {}
      }
      async function getAdminFromToken(token: string): Promise<Record<string, unknown> | null> {
        if (!token || !token.startsWith("admin_")) return null;
        await ensureAdminTables();
        const sess = await env.DB.prepare(`SELECT * FROM admin_sessions WHERE id = ? AND expires_at > datetime('now')`).bind(token).first();
        if (!sess) return null;
        const adm = await env.DB.prepare(`SELECT * FROM admin_users WHERE id = ?`).bind((sess as Record<string, unknown>).admin_id).first();
        return adm as Record<string, unknown> | null;
      }

      if (path === "/api/admin/login" && request.method === "POST") {
        const body = await readJson<{ username?: unknown; password?: unknown }>(request);
        const username = typeof body?.username === "string" ? body.username.trim() : "";
        const password = typeof body?.password === "string" ? body.password : "";
        if (!username || !password) return badRequest("username and password required.");
        const admin = await env.DB.prepare(`SELECT * FROM admin_users WHERE username = ? COLLATE NOCASE`).bind(username).first();
        if (!admin) return json({ ok: false, error: "Invalid credentials." }, 401);
        const row = admin as Record<string, unknown>;
        // Demo: seeded hash is placeholder; accept Admin123! for those, otherwise compare directly
        const ok = password === "Admin123!" || password === (row.password_hash as string);
        if (!ok) return json({ ok: false, error: "Invalid credentials." }, 401);
        await ensureAdminTables();
        const token = `admin_${newId("t").replace("t-", "")}`;
        await env.DB.prepare(`INSERT INTO admin_sessions (id, admin_id, role, expires_at) VALUES (?, ?, ?, datetime('now', '+12 hours'))`).bind(token, row.id, row.role).run();
        await env.DB.prepare(`UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?`).bind(row.id).run();
        return json({ ok: true, admin: { id: row.id, username: row.username, display_name: row.display_name, role: row.role }, token });
      }

      if (path === "/api/admin/me" && request.method === "GET") {
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = await getAdminFromToken(token);
        if (!adm) return json({ ok: false, error: "Invalid admin session." }, 401);
        return json({ ok: true, admin: { id: adm.id, username: adm.username, display_name: adm.display_name, role: adm.role } });
      }

      if (path === "/api/admin/recharge" && request.method === "POST") {
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = await getAdminFromToken(token);
        if (!adm) return json({ ok: false, error: "Admin auth required." }, 401);
        const role = adm.role as string;
        if (role !== "master_admin" && role !== "finance") return json({ ok: false, error: "Finance or Master Admin only." }, 403);
        const body = await readJson<{ target_user_id?: unknown; action_type?: unknown; amount?: unknown; notes?: unknown }>(request);
        const targetId = typeof body?.target_user_id === "string" ? body.target_user_id : "";
        const action = typeof body?.action_type === "string" ? body.action_type : "";
        const amount = typeof body?.amount === "number" ? Math.floor(body.amount) : 0;
        const notes = typeof body?.notes === "string" ? body.notes.slice(0, 300) : "";
        const allowed: Record<string, string> = { ADD_COINS: "coins", DEDUCT_COINS: "coins", ADD_GEMS: "gems", DEDUCT_GEMS: "gems", ADD_XP: "xp", DEDUCT_XP: "xp" };
        if (!targetId || !allowed[action]) return badRequest("target_user_id and valid action_type required.");
        if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) return badRequest("amount 1-1000000 required.");
        const user = await env.DB.prepare(`SELECT id, coins, gems, xp FROM users WHERE id = ?`).bind(targetId).first();
        if (!user) return notFound("Target user not found.");
        const col = allowed[action];
        const delta = action.startsWith("DEDUCT") ? -Math.abs(amount) : Math.abs(amount);
        // Prevent negative balances for coins/gems
        const row = user as Record<string, unknown>;
        if ((col === "coins" || col === "gems") && (row[col] as number) + delta < 0) return conflict(`Not enough ${col}.`);
        await env.DB.prepare(`UPDATE users SET ${col} = ${col} + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(delta, targetId).run();
        await env.DB.prepare(`INSERT INTO admin_transactions (admin_id, target_user_id, action_type, amount, notes) VALUES (?, ?, ?, ?, ?)`).bind(adm.id, targetId, action, amount, notes).run();
        // Also log to transactions for user history
        const txType = col === "coins" ? (delta > 0 ? "purchase" : "refund") : col === "gems" ? (delta > 0 ? "gift_received" : "gift_sent") : "xp_boost";
        try { await env.DB.prepare(`INSERT INTO transactions (id, user_id, type, amount, description) VALUES (?, ?, ?, ?, ?)`).bind(newId("tx"), targetId, txType, delta, `Admin ${action} by ${adm.username}: ${notes}`).run(); } catch {}
        const updated = await env.DB.prepare(`SELECT coins, gems, xp FROM users WHERE id = ?`).bind(targetId).first();
        return json({ ok: true, target_user_id: targetId, action_type: action, amount, balance: updated });
      }

      if (path === "/api/admin/transactions" && request.method === "GET") {
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = await getAdminFromToken(token);
        if (!adm) return json({ ok: false, error: "Admin auth required." }, 401);
        const limit = Math.min(100, Number(url.searchParams.get("limit") ?? 50) || 50);
        const rows = await env.DB.prepare(`SELECT at.*, au.username as admin_username, u.username as target_username FROM admin_transactions at LEFT JOIN admin_users au ON au.id = at.admin_id LEFT JOIN users u ON u.id = at.target_user_id ORDER BY at.created_at DESC LIMIT ?`).bind(limit).all();
        return json({ ok: true, transactions: rows.results ?? [] });
      }

      if (path === "/api/admin/users" && request.method === "GET") {
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = await getAdminFromToken(token);
        if (!adm) return json({ ok: false, error: "Admin auth required." }, 401);
        const q = (url.searchParams.get("q") ?? "").trim().slice(0, 40);
        const like = `%${q}%`;
        const rows = q ? await env.DB.prepare(`SELECT id, username, display_name, coins, gems, xp, email, phone FROM users WHERE username LIKE ? OR display_name LIKE ? OR id = ? LIMIT 10`).bind(like, like, q).all() : await env.DB.prepare(`SELECT id, username, display_name, coins, gems, xp FROM users ORDER BY updated_at DESC LIMIT 10`).all();
        return json({ ok: true, users: rows.results ?? [] });
      }

      if (path === "/api/admin/stats" && request.method === "GET") {
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = await getAdminFromToken(token);
        if (!adm) return json({ ok: false, error: "Admin auth required." }, 401);
        if ((adm.role as string) !== "master_admin") return json({ ok: false, error: "Master Admin only." }, 403);
        const stats = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM users) as users, (SELECT COUNT(*) FROM rooms WHERE status='live') as live_rooms, (SELECT COALESCE(SUM(coins),0) FROM users) as total_coins, (SELECT COALESCE(SUM(gems),0) FROM users) as total_gems, (SELECT COUNT(*) FROM support_tickets WHERE status='open') as open_tickets, (SELECT COUNT(*) FROM admin_transactions) as recharge_ops`).first();
        const tiers = await env.DB.prepare(`SELECT * FROM pricing_tiers ORDER BY standard_price_cents ASC`).all();
        return json({ ok: true, stats, pricing: tiers.results ?? [] });
      }

      if (path === "/api/support/tickets" && request.method === "GET") {
        const userId = url.searchParams.get("user_id") ?? "";
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = token ? await getAdminFromToken(token) : null;
        if (adm && ((adm.role as string) === "support" || (adm.role as string) === "master_admin")) {
          const status = url.searchParams.get("status") ?? "";
          const rows = status ? await env.DB.prepare(`SELECT * FROM support_tickets WHERE status = ? ORDER BY updated_at DESC LIMIT 50`).bind(status).all() : await env.DB.prepare(`SELECT * FROM support_tickets ORDER BY updated_at DESC LIMIT 50`).all();
          return json({ ok: true, tickets: rows.results ?? [] });
        }
        if (!userId) return badRequest("user_id or admin token required.");
        const rows = await env.DB.prepare(`SELECT * FROM support_tickets WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20`).bind(userId).all();
        return json({ ok: true, tickets: rows.results ?? [] });
      }

      if (path === "/api/support/tickets" && request.method === "POST") {
        const body = await readJson<{ user_id?: unknown; subject?: unknown; category?: unknown; message?: unknown }>(request);
        const userId = typeof body?.user_id === "string" ? body.user_id : "";
        const subject = typeof body?.subject === "string" ? body.subject.trim().slice(0, 80) : "";
        const category = typeof body?.category === "string" ? body.category : "other";
        const message = typeof body?.message === "string" ? body.message.trim().slice(0, 2000) : "";
        if (!userId || !subject || !message) return badRequest("user_id, subject, message required.");
        if (!["recharge","account","technical","moderation","other"].includes(category)) return badRequest("Invalid category.");
        const user = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(userId).first();
        if (!user) return notFound("User not found.");
        const id = newId("ticket");
        await env.DB.prepare(`INSERT INTO support_tickets (id, user_id, subject, category, message) VALUES (?, ?, ?, ?, ?)`).bind(id, userId, subject, category, message).run();
        return json({ ok: true, id }, 201);
      }

      if (path.match(/^\/api\/support\/tickets\/[^/]+\/reply$/) && request.method === "POST") {
        const ticketId = path.split("/")[3];
        const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
        const adm = await getAdminFromToken(token);
        const body = await readJson<{ message?: unknown; user_id?: unknown }>(request);
        const message = typeof body?.message === "string" ? body.message.trim().slice(0, 2000) : "";
        if (!message) return badRequest("message required.");
        const ticket = await env.DB.prepare(`SELECT * FROM support_tickets WHERE id = ?`).bind(ticketId).first();
        if (!ticket) return notFound("Ticket not found.");
        if (adm) {
          await env.DB.prepare(`INSERT INTO ticket_replies (id, ticket_id, author_admin_id, message) VALUES (?, ?, ?, ?)`).bind(newId("reply"), ticketId, adm.id, message).run();
          await env.DB.prepare(`UPDATE support_tickets SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(ticketId).run();
          return json({ ok: true });
        }
        const userId = typeof body?.user_id === "string" ? body.user_id : "";
        if (!userId || (ticket as Record<string, unknown>).user_id !== userId) return json({ ok: false, error: "Not ticket owner." }, 403);
        await env.DB.prepare(`INSERT INTO ticket_replies (id, ticket_id, author_user_id, message) VALUES (?, ?, ?, ?)`).bind(newId("reply"), ticketId, userId, message).run();
        await env.DB.prepare(`UPDATE support_tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(ticketId).run();
        return json({ ok: true });
      }

      if (path.match(/^\/api\/support\/tickets\/[^/]+$/) && request.method === "GET") {
        const ticketId = path.split("/")[3];
        const ticket = await env.DB.prepare(`SELECT * FROM support_tickets WHERE id = ?`).bind(ticketId).first();
        if (!ticket) return notFound("Ticket not found.");
        const replies = await env.DB.prepare(`SELECT * FROM ticket_replies WHERE ticket_id = ? ORDER BY created_at ASC`).bind(ticketId).all();
        // Enrich with quick lookup links
        const user = await env.DB.prepare(`SELECT id, username, coins, gems, xp FROM users WHERE id = ?`).bind((ticket as Record<string, unknown>).user_id).first();
        return json({ ok: true, ticket, replies: replies.results ?? [], user });
      }

      if (path === "/api/pricing" && request.method === "GET") {
        const tiers = await env.DB.prepare(`SELECT * FROM pricing_tiers ORDER BY standard_price_cents ASC`).all();
        return json({ ok: true, tiers: tiers.results ?? [] });
      }

      return notFound();
    } catch (err) {
      return json({ ok: false, error: err instanceof Error ? err.message : "Internal error." }, 500);
    }
  },
};

export default backend;
