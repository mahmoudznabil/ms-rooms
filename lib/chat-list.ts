/**
 * Chats-tab unification kernel (Phase C) — pure functions, no React, no DOM.
 *
 * The Messages tab lists DMs AND call recents in one surface. The rules:
 * - One entry per peer: a direct conversation and the call recents with the
 *   same peer collapse into a single row whose subtitle is whichever is
 *   latest (last message OR last call). Group/room conversations have no
 *   single peer, so they always stand alone.
 * - A call with a peer the user never messaged still gets an entry (tapping
 *   it opens/creates the DM thread) — otherwise missed calls from strangers
 *   would be invisible here.
 * - Inside a thread, `callsWithPeer` feeds the inline call-history block
 *   (newest 5): "Voice · 3:12 · ended", "Missed video call", …
 *
 * Everything time-based keys off ISO strings the server already returns
 * (`Message.created_at`, `CallItem.created_at`), so no new endpoint and no
 * migration was needed for Phase C.
 */

import type { CallItem } from "./api";
import type { ConversationWithParticipants } from "./api";

export type ChatListEntry =
  | { kind: "dm"; key: string; peerName: string; peerInitial: string; sortTs: number; conversation: ConversationWithParticipants }
  | { kind: "call"; key: string; peerName: string; peerInitial: string; sortTs: number; call: CallItem };

/** Milliseconds since epoch for an ISO timestamp; unparseable → 0 (sorts last). */
export function tsOf(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function displayNameOf(peer: { display_name?: string; username?: string }): string {
  const name = (peer.display_name ?? "").trim() || (peer.username ?? "").trim();
  return name || "Chat";
}

/**
 * Merge direct conversations + call recents into one per-peer list, newest
 * activity first. Group/room conversations pass through untouched.
 */
export function mergeChatEntries(
  conversations: ConversationWithParticipants[],
  calls: CallItem[],
  myUserId: string
): ChatListEntry[] {
  const entries: ChatListEntry[] = [];
  const byPeer = new Map<string, ChatListEntry & { kind: "dm" }>();

  for (const c of conversations) {
    const others = (c.participants ?? []).filter((p) => p.user_id !== myUserId);
    const isDirect = c.type === "direct" && others.length === 1;
    if (!isDirect) {
      const title =
        others.map((p) => p.user.display_name).join(", ") ||
        (c.type === "room" ? "Room chat" : "Group chat");
      entries.push({
        kind: "dm",
        key: `dm:${c.id}`,
        peerName: title,
        peerInitial: title.slice(0, 1).toUpperCase(),
        sortTs: tsOf(c.last_message?.created_at),
        conversation: c,
      });
      continue;
    }
    const peer = others[0];
    const name = displayNameOf(peer.user);
    const entry: ChatListEntry & { kind: "dm" } = {
      kind: "dm",
      key: `peer:${peer.user_id}`,
      peerName: name,
      peerInitial: name.slice(0, 1).toUpperCase(),
      sortTs: tsOf(c.last_message?.created_at),
      conversation: c,
    };
    byPeer.set(peer.user_id, entry);
    entries.push(entry);
  }

  for (const call of calls) {
    const peerId = call.peer?.id;
    if (!peerId) continue;
    const callTs = tsOf(call.created_at);
    const existing = byPeer.get(peerId);
    if (existing) {
      // Same peer: the row shows whichever is latest. A newer call promotes
      // the row and becomes its subtitle; an older call leaves the DM row.
      if (callTs > existing.sortTs) {
        existing.sortTs = callTs;
        const idx = entries.indexOf(existing);
        if (idx >= 0) {
          entries[idx] = {
            kind: "call",
            key: `peer:${peerId}`,
            peerName: existing.peerName,
            peerInitial: existing.peerInitial,
            sortTs: callTs,
            call,
          };
        }
        byPeer.delete(peerId);
      }
      continue;
    }
    // No DM with this peer (or its DM row was already promoted by a newer
    // call): calls collapse among themselves, newest wins the row.
    const name = displayNameOf(call.peer);
    const row = entries.find((e) => e.key === `peer:${peerId}`);
    if (!row) {
      entries.push({
        kind: "call",
        key: `peer:${peerId}`,
        peerName: name,
        peerInitial: name.slice(0, 1).toUpperCase(),
        sortTs: callTs,
        call,
      });
    } else if (row.kind === "call" && callTs > row.sortTs) {
      const idx = entries.indexOf(row);
      entries[idx] = { ...row, sortTs: callTs, call };
    }
  }

  entries.sort((a, b) => b.sortTs - a.sortTs);
  return entries;
}

/** Call sessions with one peer, newest first, capped (thread history block). */
export function callsWithPeer(calls: CallItem[], peerId: string, limit = 5): CallItem[] {
  return calls
    .filter((c) => c.peer?.id === peerId)
    .sort((a, b) => tsOf(b.created_at) - tsOf(a.created_at))
    .slice(0, Math.max(0, limit));
}

/** m:ss for a millisecond span; null when no billable talk time exists. */
export function formatCallDuration(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return null;
  const totalSec = Math.floor(ms / 1000);
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, "0")}`;
}

/** Talk time for one session: connected→ended preferred, else started→ended. */
export function callDurationMs(call: CallItem): number | null {
  const end = tsOf(call.ended_at);
  if (!end) return null;
  const start = tsOf(call.connected_at) || tsOf(call.started_at) || tsOf(call.created_at);
  if (!start || end <= start) return null;
  return end - start;
}

export interface CallSubtitle {
  text: string;
  /** Missed incoming calls render red (persistent fact, like WhatsApp). */
  missed: boolean;
}

/** One-line "Voice · 3:12 · ended" / "Missed video call" description. */
export function formatCallSubtitle(call: CallItem): CallSubtitle {
  const voice = call.media === "video" ? "Video" : "Voice";
  const incoming = call.direction === "in";
  switch (call.status) {
    case "missed":
      return incoming
        ? { text: `Missed ${voice.toLowerCase()} call`, missed: true }
        : { text: `${voice} call · no answer`, missed: false };
    case "rejected":
      return { text: `${voice} call · declined`, missed: incoming };
    case "cancelled":
      return { text: `${voice} call · cancelled`, missed: false };
    case "failed":
      return { text: `${voice} call · failed`, missed: false };
    case "ended":
    case "connected": {
      const dur = formatCallDuration(callDurationMs(call));
      return {
        text: dur ? `${voice} · ${dur} · ended` : `${voice} call · ended`,
        missed: false,
      };
    }
    default:
      // initiated / ringing — visible only mid-ring; stale ones expire to
      // 'missed' server-side within ~75s.
      return { text: `${incoming ? "Incoming" : "Outgoing"} ${voice.toLowerCase()} call…`, missed: false };
  }
}
