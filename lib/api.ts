import type { LobbyRoom } from "@/lib/rooms";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") ??
  "https://bestaudiobackend.mahmoudnabil03.workers.dev";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
  if (!res.ok || !data || (data as { ok?: boolean }).ok === false) {
    throw new ApiError((data as { error?: string } | null)?.error ?? `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

export interface ApiUser {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  coins: number;
  gems: number;
  xp: number;
  level?: number;
  created_at: string;
  updated_at: string;
}

export interface ApiRoomRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  host_name: string;
  host_user_id?: string;
  category: string;
  listener_count: number;
  speaker_count: number;
  cover_color: string;
  status?: string;
}

export interface ApiSeat {
  seat_index: number;
  user_id: string | null;
  role: string;
  is_muted: number;
  joined_at: string | null;
  display_name: string | null;
  username: string | null;
}

export interface GiftCatalogItem {
  id: string;
  name: string;
  emoji: string;
  cost: number;
  effect: "pop" | "banner" | "fullscreen";
}

export interface MomentItem {
  id: string;
  text: string;
  created_at: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  likes: number;
  liked: number | boolean;
}

export interface Txn {
  id: string;
  user_id: string;
  room_id: string | null;
  type: string;
  amount: number;
  description: string;
  created_at: string;
}

function toLobbyRoom(row: ApiRoomRow): LobbyRoom {
  const category =
    row.category === "Chill" ||
    row.category === "Music" ||
    row.category === "Community" ||
    row.category === "Karaoke" ||
    row.category === "Games"
      ? row.category
      : "Chat";
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    hostName: row.host_name,
    category,
    listenerCount: row.listener_count,
    speakerCount: row.speaker_count,
    coverColor: row.cover_color,
  };
}

export async function fetchRooms(): Promise<LobbyRoom[]> {
  const data = await req<{ rooms?: ApiRoomRow[] }>(`/api/rooms`, { cache: "no-store" });
  if (!Array.isArray(data.rooms)) throw new ApiError("bad rooms payload", 500);
  return data.rooms.map(toLobbyRoom);
}

export async function createRoom(input: {
  host_user_id: string;
  title: string;
  description?: string;
  category?: string;
  cover_color?: string;
}): Promise<{ room: ApiRoomRow }> {
  return req(`/api/rooms`, { method: "POST", body: JSON.stringify(input) });
}

export async function fetchRoomDetail(slug: string): Promise<{ room: ApiRoomRow; seats: ApiSeat[] }> {
  return req(`/api/rooms/${encodeURIComponent(slug)}`, { cache: "no-store" });
}

export async function updateRoom(
  slug: string,
  host_user_id: string,
  patch: { title?: string; description?: string }
): Promise<{ room: ApiRoomRow }> {
  return req(`/api/rooms/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    body: JSON.stringify({ host_user_id, ...patch }),
  });
}

export async function awardXp(
  user_id: string,
  amount: number,
  reason?: string,
  room_id?: string
): Promise<{ xp: number }> {
  return req(`/api/xp/award`, { method: "POST", body: JSON.stringify({ user_id, amount, reason, room_id }) });
}

export async function endRoom(slug: string, host_user_id: string): Promise<void> {
  await req(`/api/rooms/${encodeURIComponent(slug)}?host_user_id=${encodeURIComponent(host_user_id)}`, {
    method: "DELETE",
  });
}

export async function fetchSeats(slug: string): Promise<{ room_id: string; seats: ApiSeat[] }> {
  return req(`/api/rooms/${encodeURIComponent(slug)}/seats`, { cache: "no-store" });
}

export async function takeSeat(slug: string, seat_index: number, user_id: string): Promise<void> {
  await req(`/api/rooms/${encodeURIComponent(slug)}/seats`, {
    method: "POST",
    body: JSON.stringify({ seat_index, user_id }),
  });
}

export async function leaveSeat(slug: string, index: number): Promise<void> {
  await req(`/api/rooms/${encodeURIComponent(slug)}/seats/${index}`, { method: "DELETE" });
}

export async function muteSeat(slug: string, index: number, is_muted: boolean): Promise<void> {
  await req(`/api/rooms/${encodeURIComponent(slug)}/seats/${index}`, {
    method: "PATCH",
    body: JSON.stringify({ is_muted }),
  });
}

export async function login(username: string): Promise<{ user: ApiUser; token: string }> {
  return req(`/api/auth/login`, { method: "POST", body: JSON.stringify({ username }) });
}

export async function me(token: string): Promise<{ user: ApiUser }> {
  return req(`/api/auth/me`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
}

export async function fetchUser(id: string): Promise<{ user: ApiUser }> {
  return req(`/api/users/${encodeURIComponent(id)}`, { cache: "no-store" });
}

export async function patchUser(
  id: string,
  patch: { display_name?: string; bio?: string; avatar_url?: string }
): Promise<{ user: ApiUser }> {
  return req(`/api/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export interface ProfileStats {
  followers: number;
  following: number;
  live_rooms: number;
  moments: number;
  gifts_received: number;
  gifts_sent: number;
}

export async function fetchProfile(id: string): Promise<{ user: ApiUser; stats: ProfileStats }> {
  return req(`/api/users/${encodeURIComponent(id)}/profile`, { cache: "no-store" });
}

export interface SocialInfo {
  followers: number;
  following: number;
  followers_list: Array<{ id: string; username: string; display_name: string; avatar_url: string | null }>;
  following_list: Array<{ id: string; username: string; display_name: string; avatar_url: string | null }>;
  followed_by_viewer: boolean;
}

export async function fetchSocial(id: string, viewer_id?: string): Promise<SocialInfo> {
  const q = viewer_id ? `?viewer_id=${encodeURIComponent(viewer_id)}` : "";
  const data = await req<Partial<SocialInfo>>(`/api/users/${encodeURIComponent(id)}/social${q}`, {
    cache: "no-store",
  });
  return {
    followers: data.followers ?? 0,
    following: data.following ?? 0,
    followers_list: data.followers_list ?? [],
    following_list: data.following_list ?? [],
    followed_by_viewer: data.followed_by_viewer ?? false,
  };
}

export async function follow(follower_id: string, followee_id: string): Promise<void> {
  await req(`/api/follow`, { method: "POST", body: JSON.stringify({ follower_id, followee_id }) });
}

export async function unfollow(follower_id: string, followee_id: string): Promise<void> {
  await req(`/api/follow`, { method: "DELETE", body: JSON.stringify({ follower_id, followee_id }) });
}

export async function fetchTransactions(user_id: string): Promise<{ transactions: Txn[] }> {
  return req(`/api/users/${encodeURIComponent(user_id)}/transactions`, { cache: "no-store" });
}

export async function checkin(user_id: string): Promise<{ credited: number; streak: number; coins: number; xp: number }> {
  return req(`/api/checkin`, { method: "POST", body: JSON.stringify({ user_id }) });
}

export async function giftCatalog(): Promise<{ gifts: GiftCatalogItem[] }> {
  return req(`/api/gifts`);
}

export async function sendGift(input: {
  from_user_id: string;
  room_id?: string | null;
  gift_id: string;
  cost: number;
}): Promise<{ coins: number }> {
  return req(`/api/gifts/send`, { method: "POST", body: JSON.stringify(input) });
}

export interface RechargePack {
  id: string;
  coins: number;
  price: string;
}

export async function rechargePackages(): Promise<{ packages: RechargePack[]; note: string }> {
  return req(`/api/recharge/packages`);
}

export async function rechargeBuy(user_id: string, package_id: string): Promise<{ credited: number; coins: number }> {
  return req(`/api/recharge/buy`, { method: "POST", body: JSON.stringify({ user_id, package_id }) });
}

export async function spin(user_id: string): Promise<{ cost: number; prize: number; net: number; coins: number }> {
  return req(`/api/spin`, { method: "POST", body: JSON.stringify({ user_id }) });
}

export type BoardType = "contributors" | "hosts" | "rooms";
export type BoardPeriod = "daily" | "weekly" | "all";

export async function leaderboard(
  type: BoardType,
  period: BoardPeriod
): Promise<{ rows: Array<Record<string, unknown>> }> {
  return req(`/api/leaderboard?type=${type}&period=${period}`, { cache: "no-store" });
}

export async function searchAll(q: string): Promise<{ rooms: ApiRoomRow[]; users: ApiUser[] }> {
  const data = await req<{ rooms?: ApiRoomRow[]; users?: ApiUser[] }>(
    `/api/search?q=${encodeURIComponent(q)}`,
    { cache: "no-store" }
  );
  return { rooms: data.rooms ?? [], users: data.users ?? [] };
}

export async function fetchMoments(viewer_id?: string, limit = 20): Promise<{ moments: MomentItem[] }> {
  const q = `?limit=${limit}${viewer_id ? `&viewer_id=${encodeURIComponent(viewer_id)}` : ""}`;
  return req(`/api/moments${q}`, { cache: "no-store" });
}

export async function postMoment(user_id: string, text: string): Promise<{ id: string }> {
  return req(`/api/moments`, { method: "POST", body: JSON.stringify({ user_id, text }) });
}

export async function likeMoment(id: string, user_id: string): Promise<void> {
  await req(`/api/moments/${encodeURIComponent(id)}/like`, {
    method: "POST",
    body: JSON.stringify({ user_id }),
  });
}

export async function unlikeMoment(id: string, user_id: string): Promise<void> {
  await req(`/api/moments/${encodeURIComponent(id)}/like?user_id=${encodeURIComponent(user_id)}`, {
    method: "DELETE",
  });
}

export async function reportUser(input: {
  reporter_id: string;
  target_id: string;
  reason: string;
  room_id?: string | null;
}): Promise<{ id: string }> {
  return req(`/api/reports`, { method: "POST", body: JSON.stringify(input) });
}

// ---- Triple-Currency / Admin / Support (spec) ----
export interface AdminUser { id: string; username: string; display_name: string; role: "master_admin" | "finance" | "support"; }
export async function adminLogin(username: string, password: string): Promise<{ admin: AdminUser; token: string }> {
  return req(`/api/admin/login`, { method: "POST", body: JSON.stringify({ username, password }) });
}
export async function adminMe(token: string): Promise<{ admin: AdminUser }> {
  return req(`/api/admin/me`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
}
export async function adminRecharge(token: string, input: { target_user_id: string; action_type: "ADD_COINS" | "DEDUCT_COINS" | "ADD_GEMS" | "DEDUCT_GEMS" | "ADD_XP" | "DEDUCT_XP"; amount: number; notes?: string }): Promise<{ balance: { coins: number; gems: number; xp: number } }> {
  return req(`/api/admin/recharge`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
}
export async function adminTransactions(token: string, limit = 50): Promise<{ transactions: Array<Record<string, unknown>> }> {
  return req(`/api/admin/transactions?limit=${limit}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
}
export async function adminLookupUsers(token: string, q: string): Promise<{ users: ApiUser[] }> {
  return req(`/api/admin/users?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
}
export async function adminStats(token: string): Promise<{ stats: Record<string, unknown>; pricing: Array<Record<string, unknown>> }> {
  return req(`/api/admin/stats`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
}
export async function fetchPricing(): Promise<{ tiers: Array<{ tier: string; standard_coins: number; standard_price_cents: number; app_coins: number; app_price_cents: number; bonus_percent: number }> }> {
  return req(`/api/pricing`, { cache: "no-store" });
}
export interface SupportTicket { id: string; user_id: string; subject: string; category: string; message: string; status: string; created_at: string; updated_at: string; }
export async function createTicket(input: { user_id: string; subject: string; category: "recharge" | "account" | "technical" | "moderation" | "other"; message: string }): Promise<{ id: string }> {
  return req(`/api/support/tickets`, { method: "POST", body: JSON.stringify(input) });
}
export async function listTickets(params: { user_id?: string; adminToken?: string; status?: string }): Promise<{ tickets: SupportTicket[] }> {
  const q = new URLSearchParams();
  if (params.user_id) q.set("user_id", params.user_id);
  if (params.status) q.set("status", params.status);
  const headers: Record<string, string> = {};
  if (params.adminToken) headers.Authorization = `Bearer ${params.adminToken}`;
  return req(`/api/support/tickets${q.toString() ? `?${q}` : ""}`, { headers, cache: "no-store" });
}
