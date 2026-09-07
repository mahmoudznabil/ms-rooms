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
            "GET /api/rooms/:slug",
            "GET /api/rooms/:slug/seats",
            "POST /api/rooms/:slug/seats",
            "DELETE /api/rooms/:slug/seats/:index",
            "PATCH /api/rooms/:slug/seats/:index",
            "GET /api/users/:id",
            "GET /api/users/:id/transactions",
            "GET /api/users/:id/xp",
            "POST /api/auth/login",
            "GET /api/auth/me",
            "POST /api/rewards/claim",
            "POST /api/gifts/send",
            "POST /api/xp/award",
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

      // ---- Gifts ---------------------------------------------------------------
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
        await env.DB.prepare(`UPDATE users SET coins = coins - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(cost, fromUserId)
          .run();
        await env.DB.prepare(
          `INSERT INTO transactions (id, user_id, room_id, type, amount, description)
           VALUES (?, ?, ?, 'gift_sent', ?, ?)`
        )
          .bind(newId("tx"), fromUserId, roomId, -Math.abs(cost), `Gift: ${giftId}`)
          .run();
        const updated = await env.DB.prepare(`SELECT coins FROM users WHERE id = ?`).bind(fromUserId).first();
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

      return notFound();
    } catch (err) {
      return json({ ok: false, error: err instanceof Error ? err.message : "Internal error." }, 500);
    }
  },
};

export default backend;
