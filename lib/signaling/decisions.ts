/**
 * Signaling decision kernels.
 *
 * Every function here is pure: no React, no DOM, no WebRTC, no timers. That is
 * deliberate. These are the guards that decide whether a mesh call converges or
 * deadlocks — offerer election, mesh admission, answer adoption, ICE queueing,
 * failure escalation, speaking thresholds, poll backoff — and they used to be
 * inline in a 1,000-line hook, where they could not be tested at all.
 *
 * Extracting them does two things:
 *   1. It makes each hazard unit-testable in isolation (see
 *      `tests/unit/signaling.test.ts`).
 *   2. It gives the upcoming signaling-transport migration a stable, typed seam
 *      to target, so moving off D1 polling does not mean rewriting the
 *      correctness rules along with the transport.
 *
 * `lib/realtime.ts` imports from here. If a rule changes, it changes in one
 * place and the tests move with it.
 */

/** Mirror of the spec's RTCPeerConnection.signalingState, minus prototype noise. */
export type SignalingState =
  | "stable"
  | "have-local-offer"
  | "have-remote-offer"
  | "have-local-pranswer"
  | "have-remote-pranswer"
  | "closed";

// --- Offerer election -------------------------------------------------------

/**
 * Deterministic offerer election for a peer pair.
 *
 * The lexicographically smaller user id always offers. This is the single reason
 * a mesh of N peers does not produce two competing offers per pair and deadlock:
 * exactly one side of every edge dials, and the other only answers.
 */
export function isOfferer(myUserId: string, peerId: string): boolean {
  return myUserId < peerId;
}

// --- Mesh admission ---------------------------------------------------------

export interface PeerAdmission {
  /** True when we already hold an RTCPeerConnection for this peer. */
  hasPeer: boolean;
  /** How many peer connections we currently hold. */
  peerCount: number;
  /** The hard mesh ceiling (see MESH_CAP). */
  cap: number;
}

/**
 * Should we admit (dial or answer) this peer?
 *
 * New peers are refused once the mesh is at capacity — on both the offerer path
 * (stop dialing out) and the answerer path (refuse unbounded inbound offers).
 * *Existing* peers are always admitted, because renegotiation (unmute, addTrack)
 * must still work in a full room; refusing it would freeze every live connection.
 */
export function canAdmitPeer({ hasPeer, peerCount, cap }: PeerAdmission): boolean {
  return hasPeer || peerCount < cap;
}

// --- Answer adoption --------------------------------------------------------

/**
 * May we apply an incoming answer right now?
 *
 * An answer is only ever valid immediately after we sent our own offer — that is
 * exactly the `have-local-offer` state. In any other state the answer is a
 * duplicate, a stray re-delivery, or arrives during glare; applying it makes
 * `setRemoteDescription` throw and poisons the session. We skip instead.
 */
export function canAdoptAnswer(state: SignalingState): boolean {
  return state === "have-local-offer";
}

// --- ICE candidate handling -------------------------------------------------

/**
 * Must this candidate be queued rather than applied?
 *
 * Trickle ICE routinely delivers candidates before `setRemoteDescription` has
 * run. `addIceCandidate` throws without a remote description, so those
 * candidates must be buffered until the description lands.
 */
export function shouldQueueIce(hasRemoteDescription: boolean): boolean {
  return !hasRemoteDescription;
}

/** Maximum buffered candidates per peer before we start dropping overflow. */
export const ICE_QUEUE_LIMIT = 50;

/**
 * Resolve the ICE servers for a new peer connection.
 *
 * Minted Cloudflare TURN credentials when the backend has them; otherwise a
 * public STUN fallback. An empty list would leave only host candidates, which
 * silently fails for anyone behind a symmetric NAT — the exact users TURN
 * exists for.
 */
export const FALLBACK_STUN_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export function resolveIceServers(minted: RTCIceServer[]): RTCIceServer[] {
  return minted.length > 0 ? minted : FALLBACK_STUN_SERVERS;
}

/**
 * Append to a bounded queue, dropping overflow.
 *
 * An unbounded queue against a flapping peer is a memory leak mid-call. Returns
 * the original array untouched when full (never mutates the input).
 */
export function enqueueBounded<T>(queue: readonly T[], item: T, limit: number): readonly T[] {
  if (queue.length >= limit) return queue;
  return [...queue, item];
}

// --- ICE failure escalation -------------------------------------------------

/** How many consecutive ICE restarts we attempt before giving up on a peer. */
export const ICE_RESTART_LIMIT = 3;

export type IceFailureAction = "restart" | "drop";

/**
 * What to do after `consecutiveFailures` failed connection attempts.
 *
 * Restart ICE a bounded number of times, then drop the peer. Without the bound,
 * a peer that can never connect thrashes `restartIce` forever and the room never
 * settles.
 */
export function iceFailureAction(consecutiveFailures: number): IceFailureAction {
  return consecutiveFailures <= ICE_RESTART_LIMIT ? "restart" : "drop";
}

// --- Speaking detection -----------------------------------------------------

/** RMS amplitude above which a peer is considered to be speaking. */
export const SPEAKING_RMS_THRESHOLD = 0.14;

/** Is this RMS level speech? Strictly greater-than, so the threshold is silent. */
export function isSpeaking(rms: number): boolean {
  return rms > SPEAKING_RMS_THRESHOLD;
}

// --- Poll backoff -----------------------------------------------------------

/** Base poll interval when the tab is hidden. */
export const HIDDEN_POLL_BASE_MS = 5000;
/** Jitter band added when the tab is hidden. */
export const HIDDEN_POLL_JITTER_MS = 2000;

/**
 * Next signaling-poll delay, in milliseconds.
 *
 * Visible tabs poll fast; hidden tabs back off to seconds so a room full of
 * backgrounded tabs does not hammer the signaling endpoint. `random()` is
 * injected so the jitter is deterministic under test — production passes
 * `Math.random`, which also de-synchronizes a room of peers polling at once.
 */
export function nextPollDelay(
  hidden: boolean,
  random: () => number,
  visibleBaseMs: number,
  visibleJitterMs: number
): number {
  const base = hidden ? HIDDEN_POLL_BASE_MS : visibleBaseMs;
  const jitter = hidden ? HIDDEN_POLL_JITTER_MS : visibleJitterMs;
  return base + random() * jitter;
}
