import { describe, expect, it } from "vitest";
import {
  callsWithPeer,
  callDurationMs,
  formatCallDuration,
  formatCallSubtitle,
  mergeChatEntries,
  tsOf,
  type ChatListEntry,
} from "@/lib/chat-list";
import type { CallItem, ConversationWithParticipants } from "@/lib/api";

/**
 * Phase C: the chats-tab unification contract. DMs and call recents collapse
 * into one per-peer list; the row subtitle is whichever is latest (last
 * message OR last call). A call with a peer the user never messaged still
 * gets a row (tapping opens/creates the thread).
 */

function dm(
  id: string,
  peerId: string | null, // null → group conversation
  lastMessageAt: string | null,
  unread = 0
): ConversationWithParticipants {
  const participants =
    peerId === null
      ? [
          { user_id: "me", joined_at: "2026-01-01T00:00:00Z", last_read_at: null, muted: 0, user: { id: "me", username: "me", display_name: "Me", avatar_url: null } },
          { user_id: "u2", joined_at: "2026-01-01T00:00:00Z", last_read_at: null, muted: 0, user: { id: "u2", username: "bea", display_name: "Bea", avatar_url: null } },
          { user_id: "u3", joined_at: "2026-01-01T00:00:00Z", last_read_at: null, muted: 0, user: { id: "u3", username: "cyd", display_name: "Cyd", avatar_url: null } },
        ]
      : [
          { user_id: "me", joined_at: "2026-01-01T00:00:00Z", last_read_at: null, muted: 0, user: { id: "me", username: "me", display_name: "Me", avatar_url: null } },
          { user_id: peerId, joined_at: "2026-01-01T00:00:00Z", last_read_at: null, muted: 0, user: { id: peerId, username: peerId, display_name: `Peer ${peerId}`, avatar_url: null } },
        ];
  return {
    id,
    type: peerId === null ? "group" : "direct",
    room_id: null,
    created_by: "me",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    participants,
    last_message: lastMessageAt
      ? {
          id: `m-${id}`,
          conversation_id: id,
          sender_id: "me",
          content: `hello ${id}`,
          type: "text",
          reply_to_id: null,
          metadata: null,
          created_at: lastMessageAt,
          updated_at: lastMessageAt,
          deleted_at: null,
        }
      : null,
    unread_count: unread,
  };
}

let callSeq = 0;
function call(
  peerId: string,
  createdAt: string,
  overrides: Partial<CallItem> = {}
): CallItem {
  callSeq += 1;
  return {
    id: `call-${callSeq}`,
    room_id: `room-${callSeq}`,
    room_slug: `room-${callSeq}`,
    direction: "in",
    status: "ended",
    media: "audio",
    price_per_minute: 10,
    started_at: createdAt,
    connected_at: createdAt,
    ended_at: new Date(Date.parse(createdAt) + 192_000).toISOString(), // +3:12
    created_at: createdAt,
    peer: { id: peerId, username: peerId, display_name: `Peer ${peerId}`, avatar_url: null },
    ...overrides,
  };
}

describe("tsOf", () => {
  it("parses ISO timestamps and degrades garbage to 0", () => {
    expect(tsOf("2026-10-16T10:00:00Z")).toBeGreaterThan(0);
    expect(tsOf(null)).toBe(0);
    expect(tsOf(undefined)).toBe(0);
    expect(tsOf("not-a-date")).toBe(0);
  });
});

describe("mergeChatEntries", () => {
  it("merges a DM and a newer call with the same peer into one call row", () => {
    const entries = mergeChatEntries(
      [dm("c1", "u1", "2026-10-16T10:00:00Z")],
      [call("u1", "2026-10-16T11:00:00Z")],
      "me"
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("call");
    expect(entries[0].key).toBe("peer:u1");
  });

  it("keeps the DM row when the last message is newer than the last call", () => {
    const entries = mergeChatEntries(
      [dm("c1", "u1", "2026-10-16T12:00:00Z")],
      [call("u1", "2026-10-16T11:00:00Z")],
      "me"
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("dm");
  });

  it("creates a call row for a peer with no DM (missed calls stay visible)", () => {
    const entries = mergeChatEntries(
      [],
      [call("u9", "2026-10-16T11:00:00Z", { status: "missed" })],
      "me"
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("call");
    expect(entries[0].peerName).toBe("Peer u9");
  });

  it("collapses several calls with the same peer, newest wins", () => {
    const entries = mergeChatEntries(
      [],
      [
        call("u1", "2026-10-16T09:00:00Z"),
        call("u1", "2026-10-16T11:00:00Z", { status: "missed" }),
        call("u1", "2026-10-16T10:00:00Z"),
      ],
      "me"
    );
    expect(entries).toHaveLength(1);
    const row = entries[0];
    expect(row.kind).toBe("call");
    if (row.kind === "call") expect(row.call.status).toBe("missed");
  });

  it("sorts newest activity first across peers", () => {
    const entries = mergeChatEntries(
      [dm("c1", "u1", "2026-10-16T10:00:00Z")],
      [call("u2", "2026-10-16T12:00:00Z"), call("u3", "2026-10-16T09:00:00Z")],
      "me"
    );
    expect(entries.map((e) => e.key)).toEqual(["peer:u2", "peer:u1", "peer:u3"]);
  });

  it("passes group conversations through untouched", () => {
    const entries = mergeChatEntries([dm("g1", null, "2026-10-16T10:00:00Z")], [], "me");
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("dm");
    expect(entries[0].key).toBe("dm:g1");
  });

  it("skips calls with no peer id", () => {
    const bad = call("u1", "2026-10-16T11:00:00Z");
    (bad as { peer: unknown }).peer = null;
    expect(mergeChatEntries([], [bad], "me")).toHaveLength(0);
  });
});

describe("callsWithPeer", () => {
  it("returns newest-first, capped at 5, peer-filtered", () => {
    const calls = [
      call("u1", "2026-10-16T08:00:00Z"),
      call("u2", "2026-10-16T09:00:00Z"),
      call("u1", "2026-10-16T10:00:00Z"),
      call("u1", "2026-10-16T11:00:00Z"),
      call("u1", "2026-10-16T12:00:00Z"),
      call("u1", "2026-10-16T13:00:00Z"),
      call("u1", "2026-10-16T14:00:00Z"),
    ];
    const mine = callsWithPeer(calls, "u1");
    expect(mine).toHaveLength(5);
    expect(mine.every((c) => c.peer.id === "u1")).toBe(true);
    expect(mine[0].created_at).toBe("2026-10-16T14:00:00Z");
    expect(mine[4].created_at).toBe("2026-10-16T10:00:00Z");
  });
});

describe("formatCallDuration", () => {
  it("formats m:ss and degrades nullish input to null", () => {
    expect(formatCallDuration(192_000)).toBe("3:12");
    expect(formatCallDuration(45_000)).toBe("0:45");
    expect(formatCallDuration(null)).toBe(null);
    expect(formatCallDuration(0)).toBe(null);
    expect(formatCallDuration(-5)).toBe(null);
  });
});

describe("callDurationMs", () => {
  it("prefers connected→ended and returns null without an end", () => {
    const c = call("u1", "2026-10-16T10:00:00Z");
    expect(callDurationMs(c)).toBe(192_000);
    expect(callDurationMs({ ...c, ended_at: null })).toBe(null);
  });
});

describe("formatCallSubtitle", () => {
  const base = "2026-10-16T10:00:00Z";
  it.each([
    ["missed incoming voice", { direction: "in", status: "missed", media: "audio" }, "Missed voice call", true],
    ["missed incoming video", { direction: "in", status: "missed", media: "video" }, "Missed video call", true],
    ["missed outgoing", { direction: "out", status: "missed", media: "audio" }, "no answer", false],
    ["ended with duration", { direction: "out", status: "ended", media: "audio" }, "Voice · 3:12 · ended", false],
    ["ended video", { direction: "in", status: "ended", media: "video" }, "Video · 3:12 · ended", false],
    ["rejected incoming", { direction: "in", status: "rejected", media: "audio" }, "declined", true],
    ["cancelled", { direction: "out", status: "cancelled", media: "audio" }, "cancelled", false],
    ["failed", { direction: "out", status: "failed", media: "audio" }, "failed", false],
    ["ringing incoming", { direction: "in", status: "ringing", media: "audio" }, "Incoming voice call", false],
  ] as Array<[string, Partial<CallItem>, string, boolean]>)("%s → %s", (_label, over, text, missed) => {
    const sub = formatCallSubtitle(call("u1", base, over as Partial<CallItem>));
    expect(sub.text).toContain(text);
    expect(sub.missed).toBe(missed);
  });

  it("omits the duration when no talk time exists", () => {
    const sub = formatCallSubtitle(call("u1", base, { status: "ended", ended_at: null }));
    expect(sub.text).toBe("Voice call · ended");
  });
});

// Type-level: entries carry their payload for the panel to render.
describe("ChatListEntry payloads", () => {
  it("dm rows keep the conversation (unread badge), call rows keep the call", () => {
    const conv = dm("c1", "u1", "2026-10-16T12:00:00Z", 3);
    const entries: ChatListEntry[] = mergeChatEntries(
      [conv],
      [call("u2", "2026-10-16T13:00:00Z", { status: "missed" })],
      "me"
    );
    const [first, second] = entries;
    expect(first.kind).toBe("call");
    expect(second.kind).toBe("dm");
    if (second.kind === "dm") expect(second.conversation.unread_count).toBe(3);
  });
});
