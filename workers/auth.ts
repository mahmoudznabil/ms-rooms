/**
 * Shared authentication helpers for the MS-ROOMS API.
 *
 * This is the keystone of the Phase 1 security lockdown: previously the acting
 * user id was taken from the request body on ~50 endpoints, and the session was
 * resolved only in a handful of places (with two byte-identical copies of the
 * helper). Every authenticated route should resolve the actor with `requireUser`
 * here and never trust a client-supplied id.
 */

interface EnvWithDB {
  // Loosely typed to match backend.ts, which avoids pulling @cloudflare/workers-types
  // into the Next.js app bundle. The runtime supplies a real D1Database.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  DB: any;
}

/**
 * Resolve a session user from an explicit token value.
 *
 * backend.ts had two closures that re-implemented the cookie lookup and the
 * `SELECT user_id FROM sessions` query inline (`sessionUserId` and
 * `requireChatUser`), duplicating the expiry check as well. That is three
 * copies of one rule; a fix to the expiry condition would have had to land in
 * all three, and the 2026-10-18 sweep found the copies had already drifted in
 * shape even though they agreed in behaviour.
 *
 * They now delegate here, so the query exists once.
 */
export async function userIdFromSessionToken(
  token: string | null,
  env: EnvWithDB,
): Promise<string | null> {
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime('now')`
  ).bind(token).first();
  return (row as { user_id?: string } | null)?.user_id ?? null;
}

/**
 * Resolve an admin from an explicit token value.
 *
 * The counterpart of `userIdFromSessionToken`, and the reason all 27 admin
 * handlers go through backend.ts's `getAdminFromToken` rather than
 * `requireAdmin` directly: it takes a token, not a Request, so it can be called
 * from a place that already extracted one.
 */
export async function adminFromToken(
  token: string | null,
  env: EnvWithDB,
): Promise<{ id: string; username: string; role: string } | null> {
  if (!token || !token.startsWith("admin_")) return null;
  const row = await env.DB.prepare(
    `SELECT a.id, a.username, a.role FROM admin_sessions s
     JOIN admin_users a ON a.id = s.admin_id
     WHERE s.id = ? AND s.expires_at > datetime('now')`
  ).bind(token).first();
  const adm = row as { id?: string; username?: string; role?: string } | null;
  if (!adm?.id) return null;
  return { id: adm.id, username: adm.username ?? "", role: adm.role ?? "" };
}

export interface AuthContext {
  id: string;
  /** 1 when the account is banned, otherwise 0. */
  banned: 0 | 1;
}

/** RFC 6265-compliant-enough cookie lookup; returns null when absent. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Resolve the signed-in user id from the session cookie. Returns null when
 * unauthenticated or expired.
 */
export async function sessionUserId(request: Request, env: EnvWithDB): Promise<string | null> {
  const token = readCookie(request, "session");
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT user_id FROM sessions WHERE id = ? AND expires_at > datetime('now')`
  ).bind(token).first();
  return (row as { user_id?: string } | null)?.user_id ?? null;
}

/**
 * Load the authenticated user and their ban flag. Centralises the banned check
 * so every route rejects banned accounts (previously only /api/auth/me did).
 * Returns null when unauthenticated, the user is missing, or the session expired.
 */
export async function requireUser(request: Request, env: EnvWithDB): Promise<AuthContext | null> {
  const id = await sessionUserId(request, env);
  if (!id) return null;
  const row = await env.DB.prepare(`SELECT id, banned FROM users WHERE id = ?`).bind(id).first();
  const u = row as { id?: string; banned?: number } | null;
  if (!u?.id) return null;
  return { id: u.id, banned: Number(u.banned) === 1 ? 1 : 0 };
}

/**
 * Resolve an admin from an admin session token.
 * Returns null when unauthenticated or expired. Role checks stay at the call
 * site via the returned `role`.
 *
 * READ THIS BEFORE USING IT
 *
 * As of the 2026-10-18 authorization sweep, this function is NOT on the live
 * path. All 27 admin handlers in backend.ts resolve admins through a local
 * `getAdminFromToken(readAdminToken(request))` pair, because those also handle
 * the `admin_session` COOKIE. This function previously accepted only an
 * `Authorization: Bearer` header, so using it would have rejected exactly the
 * browser sessions the admin UI actually creates — a helper that looks correct
 * and silently breaks every admin page.
 *
 * It now accepts the cookie too, so it at least agrees with reality. Prefer the
 * local pair inside backend.ts, which also runs `ensureAdminTables()` first; if
 * you are wiring up a NEW surface outside backend.ts, use this one.
 */
export async function requireAdmin(
  request: Request,
  env: EnvWithDB,
): Promise<{ id: string; username: string; role: string } | null> {
  const token = readAdminSessionToken(request);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT a.id, a.username, a.role FROM admin_sessions s
     JOIN admin_users a ON a.id = s.admin_id
     WHERE s.id = ? AND s.expires_at > datetime('now')`
  ).bind(token).first();
  const adm = row as { id?: string; username?: string; role?: string } | null;
  if (!adm?.id) return null;
  return { id: adm.id, username: adm.username ?? "", role: adm.role ?? "" };
}

/**
 * Bearer header, falling back to the `admin_session` cookie.
 *
 * Mirrors backend.ts `readAdminToken` (L410). Kept here as well so this module
 * is self-contained for callers outside the worker; the prefix check matters —
 * admin session ids are `admin_`-prefixed and a user session cookie must not be
 * accepted as an admin session.
 */
export function readAdminSessionToken(request: Request): string {
  const header = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/, "");
  if (header) return header;
  const cookie = request.headers.get("Cookie") || "";
  return cookie.split("; ").find((c) => c.trim().startsWith("admin_session="))?.split("=")[1] ?? "";
}

/** Constant-time string comparison (CSRF tokens; password hashes after Phase 1.15). */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
