import { describe, expect, it } from "vitest";
import {
  canAdoptAnswer,
  canAdmitPeer,
  enqueueBounded,
  ICE_QUEUE_LIMIT,
  ICE_RESTART_LIMIT,
  iceFailureAction,
  isOfferer,
  isSpeaking,
  nextPollDelay,
  resolveIceServers,
  SPEAKING_RMS_THRESHOLD,
  shouldQueueIce,
} from "@/lib/signaling/decisions";

/**
 * These pin the exact race-condition and state-synchronization guards that
 * currently live inline in `lib/realtime.ts`. They are the reason a mesh call
 * either converges or deadlocks, and they were previously untestable because
 * they were buried in a 1,000-line React hook.
 *
 * Each `describe` names the production hazard it protects against.
 */

describe("offerer election", () => {
  it("elects exactly one offerer for a pair, regardless of argument order", () => {
    // The whole point: two peers must never both offer, or two competing
    // offers collide and the SDP exchange deadlocks.
    expect(isOfferer("alice", "bob")).toBe(true);
    expect(isOfferer("bob", "alice")).toBe(false);
  });

  it("is antisymmetric for arbitrary ids", () => {
    const a = "user-007";
    const b = "user-042";
    expect(isOfferer(a, b)).not.toBe(isOfferer(b, a));
  });

  it("never elects a peer as its own offerer", () => {
    // A self-pair would mean a peer offering to itself; must be impossible.
    expect(isOfferer("same", "same")).toBe(false);
  });
});

describe("mesh admission (MESH_CAP enforcement)", () => {
  it("admits a brand-new peer while under the cap", () => {
    expect(canAdmitPeer({ hasPeer: false, peerCount: 2, cap: 7 })).toBe(true);
  });

  it("refuses a brand-new peer at the cap, on both the offerer and answerer path", () => {
    // Both paths call this: the offerer stops dialing out, the answerer stops
    // accepting unbounded inbound offers.
    expect(canAdmitPeer({ hasPeer: false, peerCount: 7, cap: 7 })).toBe(false);
    expect(canAdmitPeer({ hasPeer: false, peerCount: 8, cap: 7 })).toBe(false);
  });

  it("always readmits an already-connected peer, even past the cap", () => {
    // Renegotiation (unmute, addTrack) must not be blocked by the cap, or a
    // full room can never renegotiate an existing connection.
    expect(canAdmitPeer({ hasPeer: true, peerCount: 9, cap: 7 })).toBe(true);
  });
});

describe("answer adoption guard", () => {
  it("adopts an answer only when we are not already stable", () => {
    expect(canAdoptAnswer("have-local-offer")).toBe(true);
  });

  it("ignores a duplicate or stray answer once stable", () => {
    // A re-published offer can produce a second answer; applying it to a
    // stable connection throws in setRemoteDescription and poisons the session.
    expect(canAdoptAnswer("stable")).toBe(false);
  });

  it("rejects answers in states that cannot accept one", () => {
    expect(canAdoptAnswer("have-remote-offer")).toBe(false);
    expect(canAdoptAnswer("closed")).toBe(false);
  });
});

describe("ICE candidate queueing", () => {
  it("queues candidates that arrive before any remote description", () => {
    // Trickle ICE routinely delivers candidates before setRemoteDescription.
    // Dropping them strands the connection on host-only candidates.
    expect(shouldQueueIce(false)).toBe(true);
  });

  it("applies candidates directly once a remote description exists", () => {
    expect(shouldQueueIce(true)).toBe(false);
  });
});

describe("bounded ICE queue", () => {
  it("appends below the limit", () => {
    const q = enqueueBounded<number>([1, 2], 3, ICE_QUEUE_LIMIT);
    expect(q).toEqual([1, 2, 3]);
  });

  it("drops overflow rather than growing without bound", () => {
    // An unbounded queue on a flapping peer is a memory leak in the middle of a
    // live call.
    const full = Array.from({ length: ICE_QUEUE_LIMIT }, (_, i) => i);
    const q = enqueueBounded(full, 999, ICE_QUEUE_LIMIT);
    expect(q).toHaveLength(ICE_QUEUE_LIMIT);
    expect(q).not.toContain(999);
  });

  it("does not mutate the input queue", () => {
    const original: number[] = [1];
    const next = enqueueBounded(original, 2, ICE_QUEUE_LIMIT);
    expect(original).toEqual([1]);
    expect(next).toEqual([1, 2]);
  });
});

describe("ICE failure escalation", () => {
  it("attempts an ICE restart for the first few failures", () => {
    expect(iceFailureAction(1)).toBe("restart");
    expect(iceFailureAction(ICE_RESTART_LIMIT)).toBe("restart");
  });

  it("drops the peer only after the restart budget is exhausted", () => {
    // Without this bound a peer that can never connect thrashes restartIce
    // forever and the room never settles.
    expect(iceFailureAction(ICE_RESTART_LIMIT + 1)).toBe("drop");
  });
});

describe("speaking detection", () => {
  it("flags speech above the threshold", () => {
    expect(isSpeaking(SPEAKING_RMS_THRESHOLD + 0.01)).toBe(true);
  });

  it("does not flag silence or the threshold itself", () => {
    expect(isSpeaking(0)).toBe(false);
    expect(isSpeaking(SPEAKING_RMS_THRESHOLD)).toBe(false);
  });
});

describe("ICE server resolution", () => {
  it("prefers the minted TURN servers when configured", () => {
    const turn = [{ urls: "turn:example.com:3478" }];
    expect(resolveIceServers(turn)).toBe(turn);
  });

  it("falls back to public STUN when TURN is unconfigured", () => {
    // Without this, an empty iceServers list means host candidates only and
    // anyone behind a symmetric NAT can never connect.
    const resolved = resolveIceServers([]);
    expect(resolved.length).toBeGreaterThan(0);
    expect(JSON.stringify(resolved)).toContain("stun.l.google.com");
  });
});

describe("poll backoff", () => {
  it("uses the visible base plus jitter when the tab is focused", () => {
    expect(nextPollDelay(false, () => 0, 900, 300)).toBe(900);
    expect(nextPollDelay(false, () => 1, 900, 300)).toBe(1200);
  });

  it("backs off hard when the tab is hidden", () => {
    // Background tabs must not keep hammering the signaling endpoint; the
    // floor here is seconds, not milliseconds.
    expect(nextPollDelay(true, () => 0, 900, 300)).toBe(5000);
    expect(nextPollDelay(true, () => 1, 900, 300)).toBe(7000);
  });

  it("adds jitter so a room of peers does not poll in lockstep", () => {
    const a = nextPollDelay(false, () => 0.25, 900, 300);
    const b = nextPollDelay(false, () => 0.75, 900, 300);
    expect(a).not.toBe(b);
  });
});
