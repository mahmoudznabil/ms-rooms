import type { LobbyRoom } from "@/lib/rooms";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") ||
  "https://bestaudiobackend.mahmoudnabil03.workers.dev";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let csrfToken: string | null = null;
async function getCsrfToken(): Promise<string | null> {
  if (csrfToken) return csrfToken;
  try {
    const r = await fetch(`${API_BASE}/api/csrf`, { credentials: "include" });
    const d = (await r.json()) as { csrf_token?: string };
    if (d?.csrf_token) csrfToken = d.csrf_token;
  } catch {}
  return csrfToken;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const needsCsrf = ["POST", "PATCH", "DELETE", "PUT"].includes(method);
  let csrfHeader: Record<string, string> = {};
  if (needsCsrf) {
    const t = await getCsrfToken();
    if (t) csrfHeader["X-CSRF-Token"] = t;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeader, ...(init?.headers ?? {}) },
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
  id_tag?: string;
  email?: string | null;
  phone?: string | null;
  provider?: string | null;
  firebase_uid?: string | null;
  banned?: number;
  ban_reason?: string | null;
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
  is_private?: number;
  call_participant_user_id?: string | null;
  call_price_per_minute?: number;
}

export interface ApiSeat {
  seat_index: number;
  user_id: string | null;
  role: string;
  is_muted: number;
  joined_at: string | null;
  display_name: string | null;
  username: string | null;
  avatar_url: string | undefined;
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

export async function login(username: string): Promise<{ user: ApiUser }> {
  return req(`/api/auth/login`, { method: "POST", body: JSON.stringify({ username }) });
}

export async function me(): Promise<{ user: ApiUser }> {
  return req(`/api/auth/me`, { cache: "no-store" });
}

export async function fetchUser(id: string): Promise<{ user: ApiUser }> {
  return req(`/api/users/${encodeURIComponent(id)}`, { cache: "no-store" });
}

export async function patchUser(
  id: string,
  patch: { display_name?: string; bio?: string; avatar_url?: string; username?: string }
): Promise<{ user: ApiUser }> {
  return req(`/api/users/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export async function checkUsername(username: string, exclude_id?: string): Promise<{ available: boolean; reason?: string }> {
  const q = `/api/users/check-username?username=${encodeURIComponent(username)}${exclude_id ? `&exclude_id=${encodeURIComponent(exclude_id)}` : ""}`;
  return req(q, { cache: "no-store" });
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
export async function adminMe(): Promise<{ admin: AdminUser }> {
  return req(`/api/admin/me`, { cache: "no-store" });
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
export async function adminBanUser(token: string, input: { user_id: string; banned: boolean; reason?: string }): Promise<{ user_id: string; banned: boolean }> {
  return req(`/api/admin/users/ban`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
}
export async function adminPromoteUser(token: string, input: { user_id: string; role: "support" | "finance"; password?: string }): Promise<{ admin_id: string; admin_username: string; role: string; firebase_login: boolean }> {
  return req(`/api/admin/users/promote`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
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

export async function adminFirebaseLogin(idToken: string): Promise<{ admin: AdminUser; token: string }> {
  return req(`/api/admin/firebase`, { method: "POST", headers: { Authorization: `Bearer ${idToken}` } });
}
export interface TeamAdmin { id: string; username: string; display_name: string; role: string; firebase_uid: string | null; created_at: string; last_login: string | null; }
export async function adminTeamList(token: string): Promise<{ team: TeamAdmin[] }> {
  return req(`/api/admin/team`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
}
export async function adminTeamCreate(token: string, input: { username: string; display_name: string; role: "finance" | "support"; password: string }): Promise<{ id: string }> {
  return req(`/api/admin/team`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
}
export async function adminTeamRemove(token: string, id: string): Promise<void> {
  await req(`/api/admin/team/${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
}
export interface SafetyReport { id: string; reporter_id: string; target_id: string; reason: string; room_id: string | null; status: string; handled_by: string | null; created_at: string; reporter_name: string | null; target_name: string | null; }
export async function listReports(token: string, status?: string): Promise<{ reports: SafetyReport[] }> {
  return req(`/api/reports${status ? `?status=${status}` : ""}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
}
export async function resolveReport(token: string, id: string, status: "reviewing" | "resolved" | "dismissed"): Promise<void> {
  await req(`/api/reports/${encodeURIComponent(id)}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ status }) });
}
export async function adminEndRoom(token: string, slug: string): Promise<void> {
  await req(`/api/admin/rooms/end`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ slug }) });
}
export async function updateTicketStatus(token: string, id: string, status: "open" | "pending" | "resolved" | "closed"): Promise<void> {
  await req(`/api/support/tickets/${encodeURIComponent(id)}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ status }) });
}
export async function ticketDetail(id: string): Promise<{ ticket: SupportTicket; replies: Array<{ id: string; message: string; author_admin_id: string | null; author_user_id: string | null; created_at: string }>; user: { id: string; username: string; coins: number; gems: number; xp: number } | null }> {
  return req(`/api/support/tickets/${encodeURIComponent(id)}`, { cache: "no-store" });
}
export async function replyTicket(id: string, input: { message: string; adminToken?: string; user_id?: string }): Promise<void> {
  const headers: Record<string, string> = {};
  if (input.adminToken) headers.Authorization = `Bearer ${input.adminToken}`;
  await req(`/api/support/tickets/${encodeURIComponent(id)}/reply`, { method: "POST", headers, body: JSON.stringify({ message: input.message, user_id: input.user_id }) });
}

// ---- Chat/Messaging ----
export interface Conversation {
  id: string;
  type: 'direct' | 'group' | 'room';
  room_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationParticipant {
  conversation_id: string;
  user_id: string;
  joined_at: string;
  last_read_at: string | null;
  muted: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  type: 'text' | 'image' | 'audio' | 'file' | 'system';
  reply_to_id: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sender?: { id: string; username: string; display_name: string; avatar_url: string | null };
}

export interface ConversationWithParticipants extends Conversation {
  participants: Array<{
    user_id: string;
    joined_at: string;
    last_read_at: string | null;
    muted: number;
    user: { id: string; username: string; display_name: string; avatar_url: string | null };
  }>;
  last_message: Message | null;
  unread_count: number;
}

export async function listConversations(): Promise<{ conversations: Array<ConversationWithParticipants> }> {
  return req(`/api/conversations`, { cache: "no-store" });
}

export async function getOrCreateDirectConversation(otherUserId: string): Promise<{ conversation: ConversationWithParticipants }> {
  return req(`/api/conversations/direct`, { method: "POST", body: JSON.stringify({ other_user_id: otherUserId }) });
}

export async function createConversation(input: { type: 'group' | 'room'; room_id?: string; participant_ids: string[]; title?: string }): Promise<{ conversation: Conversation }> {
  return req(`/api/conversations`, { method: "POST", body: JSON.stringify(input) });
}

export async function getConversation(conversationId: string): Promise<{ conversation: ConversationWithParticipants }> {
  return req(`/api/conversations/${encodeURIComponent(conversationId)}`, { cache: "no-store" });
}

export async function addParticipant(conversationId: string, userId: string): Promise<void> {
  await req(`/api/conversations/${encodeURIComponent(conversationId)}/participants`, { method: "POST", body: JSON.stringify({ user_id: userId }) });
}

export async function removeParticipant(conversationId: string, userId: string): Promise<void> {
  await req(`/api/conversations/${encodeURIComponent(conversationId)}/participants/${encodeURIComponent(userId)}`, { method: "DELETE" });
}

export async function listMessages(conversationId: string, limit = 50, before?: string): Promise<{ messages: Message[] }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set('before', before);
  return req(`/api/conversations/${encodeURIComponent(conversationId)}/messages?${params.toString()}`, { cache: "no-store" });
}

export async function sendMessage(input: { conversation_id: string; content: string; type?: 'text' | 'image' | 'audio' | 'file'; reply_to_id?: string }): Promise<{ message: Message }> {
  return req(`/api/conversations/${encodeURIComponent(input.conversation_id)}/messages`, { method: "POST", body: JSON.stringify(input) });
}

export async function updateMessage(messageId: string, content: string): Promise<void> {
  await req(`/api/messages/${encodeURIComponent(messageId)}`, { method: "PATCH", body: JSON.stringify({ content }) });
}

export async function deleteMessage(messageId: string): Promise<void> {
  await req(`/api/messages/${encodeURIComponent(messageId)}`, { method: "DELETE" });
}

export async function markConversationRead(conversationId: string): Promise<void> {
  await req(`/api/conversations/${encodeURIComponent(conversationId)}/read`, { method: "POST" });
}

export async function getUnreadCount(): Promise<{ unread_count: number }> {
  return req(`/api/conversations/unread-count`, { cache: "no-store" });
}

// ---- Voice/Video calls (Calls tab rules: recents, ringing, missed) ----
export type CallMedia = "audio" | "video";
export type CallStatus =
  | "initiated" | "ringing" | "connected" | "ended"
  | "failed" | "cancelled" | "rejected" | "missed";
export type CallDirection = "in" | "out";

export interface CallPeer {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export interface CallItem {
  id: string;
  room_id: string;
  room_slug: string;
  direction: CallDirection;
  status: CallStatus;
  media: CallMedia;
  price_per_minute: number;
  started_at: string | null;
  connected_at: string | null;
  ended_at: string | null;
  created_at: string;
  peer: CallPeer;
}

export interface IncomingCall {
  id: string;
  room_id: string;
  room_slug: string;
  media: CallMedia;
  created_at: string;
  caller: CallPeer;
}

export async function startCall(peerId: string, callerId: string, media: CallMedia = "audio"): Promise<{ room: ApiRoomRow; call_session_id: string; media: CallMedia }> {
  if (!callerId) throw new ApiError("Sign in to call.", 401);
  return req(`/api/rooms/private-call`, {
    method: "POST",
    body: JSON.stringify({ caller_user_id: callerId, callee_user_id: peerId, call_price_per_minute: 10, media }),
  });
}

export async function callRecents(limit = 30): Promise<{ calls: CallItem[] }> {
  return req(`/api/calls?limit=${limit}`, { cache: "no-store" });
}

export async function incomingCalls(): Promise<{ incoming: IncomingCall[] }> {
  return req(`/api/calls/incoming`, { cache: "no-store" });
}

export async function missedCallCount(): Promise<{ missed: number }> {
  return req(`/api/calls/missed-count`, { cache: "no-store" });
}

export async function markCallsSeen(): Promise<void> {
  await req(`/api/calls/seen`, { method: "POST" });
}

export async function acceptCallRoom(roomId: string): Promise<{ room_slug: string | null; media: CallMedia }> {
  return req(`/api/rooms/private-call/accept`, { method: "POST", body: JSON.stringify({ room_id: roomId }) });
}

export async function rejectCallRoom(roomId: string): Promise<void> {
  await req(`/api/rooms/private-call/reject`, { method: "POST", body: JSON.stringify({ room_id: roomId }) });
}

export async function endCallRoom(roomId: string): Promise<void> {
  await req(`/api/rooms/private-call/end`, { method: "POST", body: JSON.stringify({ room_id: roomId }) });
}

export async function cancelCallRoom(roomId: string): Promise<void> {
  await req(`/api/rooms/private-call/cancel`, { method: "POST", body: JSON.stringify({ room_id: roomId }) });
}

export async function markCallMissed(roomId: string): Promise<void> {
  await req(`/api/rooms/private-call/missed`, { method: "POST", body: JSON.stringify({ room_id: roomId }) });
}

export interface PrivateCallStatus {
  room: ApiRoomRow & { host_user_id?: string; call_participant_user_id?: string | null; status?: string };
  call_session: {
    id: string;
    status: CallStatus;
    media: CallMedia;
    caller_user_id: string;
    callee_user_id: string;
    connected_at?: string | null;
    ended_at?: string | null;
    created_at?: string;
  } | null;
  caller: { id: string; display_name: string; avatar_url: string | null } | null;
  callee: { id: string; display_name: string; avatar_url: string | null } | null;
}

export async function privateCallStatus(roomId: string): Promise<PrivateCallStatus> {
  return req(`/api/rooms/private-call/status?room_id=${encodeURIComponent(roomId)}`, { cache: "no-store" });
}
