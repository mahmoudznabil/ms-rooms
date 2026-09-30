"use client";

/**
 * Cloudflare TURN realtime media layer.
 *
 * Everything runs on Cloudflare: the Worker brokers short-lived TURN
 * credentials (`GET /api/turn`) and relays WebRTC signaling through D1
 * (`/api/signal/*`). The browser uses plain WebRTC. No third-party media SDK.
 *
 * Why signaling at all? TURN solves NAT traversal and gives us a relay, but two
 * browsers still have to exchange SDP offers/answers and ICE candidates before
 * a single audio sample moves. That exchange is what `/api/signal` provides, and
 * it is what makes TURN the actual transport rather than a fallback.
 *
 * Topology:
 *   - 1:1 calls  → a single peer connection (caller always offers).
 *   - Room audio → full mesh across whoever is on a mic (capped, see MESH_CAP).
 *
 * Mesh is the right call at our seat count: every participant sends its own
 * audio N-1 times, so uplink grows with the room. Past MESH_CAP peers the
 * additional upstream cost hurts more than the added latency, so we stop
 * connecting and show the room as "full" instead of silently degrading audio.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE, pollSignals, publishSignal, signalPeers, type SignalKind } from "@/lib/api";

/** Beyond this many mesh peers we stop adding connections (see file header). */
export const MESH_CAP = 7;

const POLL_MS = 900;
const ICE_REPUBLISH_MS = 2500;
const PEER_REFRESH_MS = 6000;
const HANGUP_MS = 12_000;

// ---------------------------------------------------------------------------
// TURN credentials
// ---------------------------------------------------------------------------

export interface TurnStatus {
  configured: boolean;
  setupHint: string | null;
}

/**
 * Fetch fresh TURN credentials. Cloudflare mints short-lived username/credential
 * pairs, so this must run per session rather than being cached forever — a
 * relay that rejects stale auth silently degrades to direct-only connectivity
 * and then fails for anyone behind a symmetric NAT.
 */
async function fetchIceServers(): Promise<RTCIceServer[]> {
  const res = await fetch(`${API_BASE}/api/turn`, { cache: "no-store" });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    ok?: boolean;
    configured?: boolean;
    iceServers?: RTCIceServer[] | null;
    setup?: string;
  };
  if (!data.ok || data.configured !== true) return [];
  return Array.isArray(data.iceServers) ? data.iceServers : [];
}

export async function probeTurn(): Promise<TurnStatus> {
  try {
    const res = await fetch(`${API_BASE}/api/turn`, { cache: "no-store" });
    const data = (await res.json()) as { ok?: boolean; configured?: boolean; setup?: string };
    return { configured: data.ok === true && data.configured === true, setupHint: data.setup ?? null };
  } catch {
    return { configured: false, setupHint: null };
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && (err.name === "AbortError" || err.name === "TimeoutError");
}

function friendlyMediaError(err: unknown, wantVideo: boolean): string {
  const code = (err as { code?: string })?.code ?? "";
  const msg = err instanceof Error ? err.message : String(err);
  if (code === "NotAllowedError" || /permission|denied/i.test(msg)) {
    return wantVideo
      ? "Camera and mic are blocked. Allow access in your browser's address bar, then rejoin."
      : "Microphone is blocked. Allow access in your browser's address bar, then rejoin.";
  }
  if (code === "NotFoundError" || /not found/i.test(msg)) {
    return wantVideo ? "No camera or microphone found on this device." : "No microphone found on this device.";
  }
  if (code === "NotReadableError") {
    return "Your microphone is in use by another app. Close it and try again.";
  }
  return msg || "Could not start the microphone.";
}

function rmsLevel(analyser: AnalyserNode, buffer: Uint8Array<ArrayBuffer>): number {
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const v = (buffer[i] - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / buffer.length) * 2.5);
}

/**
 * One shared capture + meter for the whole session; many PCs read from it.
 *
 * `startMonitor` is what makes the user hear themselves. WebRTC never echoes
 * your own microphone back — the local track is only sent to peers — so without
 * an explicit local path to the speakers the room feels dead and people assume
 * they are muted. It runs through a GainNode so the level can be trimmed, and
 * it is deliberately off until asked for: on speakers this is a feedback loop.
 */
function createLocalCapture(wantVideo: boolean) {
  let disposed = false;
  const streamPromise = navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: wantVideo
      ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }
      : false,
  });

  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let monitorGain: GainNode | null = null;
  let buf: Uint8Array<ArrayBuffer> | null = null;
  let raf = 0;

  const ensureCtx = async (stream: MediaStream): Promise<AudioContext> => {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    return ctx;
  };

  return {
    streamPromise,
    /** Route the local mic to the speakers. Returns false if the browser blocked it. */
    async startMonitor(): Promise<boolean> {
      try {
        const stream = await streamPromise;
        if (disposed) return false;
        const audio = await ensureCtx(stream);
        if (!monitorGain) {
          const src = audio.createMediaStreamSource(stream);
          monitorGain = audio.createGain();
          // Trimmed: the point is to confirm you are transmitting, not to
          // compete with the room for volume.
          monitorGain.gain.value = 0.35;
          src.connect(monitorGain);
          monitorGain.connect(audio.destination);
        }
        return true;
      } catch {
        return false;
      }
    },
    stopMonitor() {
      try {
        monitorGain?.disconnect();
      } catch {
        /* already gone */
      }
      monitorGain = null;
    },
    get monitoring() {
      return monitorGain !== null;
    },
    startMeter(onLevel: (v: number) => void) {
      void streamPromise.then(async (stream) => {
        if (disposed || ctx) return;
        try {
          const audio = await ensureCtx(stream);
          const src = audio.createMediaStreamSource(stream);
          analyser = audio.createAnalyser();
          analyser.fftSize = 512;
          src.connect(analyser);
          buf = new Uint8Array(analyser.fftSize);
          const tick = () => {
            if (!analyser || !buf) return;
            onLevel(rmsLevel(analyser, buf));
            raf = requestAnimationFrame(tick);
          };
          tick();
        } catch {
          /* meter is cosmetic — never block media on it */
        }
      });
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      void ctx?.close().catch(() => undefined);
      ctx = null;
    },
  };
}

// ---------------------------------------------------------------------------
// 1:1 calls
// ---------------------------------------------------------------------------

export type CallPhase = "idle" | "joining" | "live" | "ended" | "error";

export interface CallSession {
  phase: CallPhase;
  error: string | null;
  micOn: boolean;
  camOn: boolean;
  videoMode: boolean;
  screenShareOn: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  connection: RTCPeerConnectionState | "new";
  liveSince: number | null;
  usingRelay: boolean;
  join: (wantVideo: boolean) => Promise<void>;
  toggleMic: () => void;
  toggleCam: () => void;
  toggleScreenShare: () => Promise<void>;
  leave: () => void;
}

/**
 * One-to-one call. `roomId` is the private room id and `caller` decides who
 * offers, so the handshake is deterministic and needs no extra negotiation.
 */
export function useCallSession(roomId: string, caller: boolean, myUserId: string | null): CallSession {
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [videoMode, setVideoMode] = useState(false);
  const [screenShareOn, setScreenShareOn] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connection, setConnection] = useState<RTCPeerConnectionState | "new">("new");
  const [liveSince, setLiveSince] = useState<number | null>(null);
  const [usingRelay, setUsingRelay] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const captureRef = useRef<ReturnType<typeof createLocalCapture> | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const camTrackRef = useRef<MediaStreamTrack | null>(null);
  const levelCbRef = useRef<((v: number) => void) | null>(null);
  const closedRef = useRef(false);

  const teardown = useCallback(() => {
    captureRef.current?.dispose();
    captureRef.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    screenTrackRef.current = null;
    camTrackRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setLiveSince(null);
    setScreenShareOn(false);
    levelCbRef.current = null;
  }, []);

  const join = useCallback(
    async (wantVideo: boolean) => {
      teardown();
      closedRef.current = false;
      setError(null);
      setPhase("joining");
      setVideoMode(wantVideo);
      setCamOn(wantVideo);
      setMicOn(true);

      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setError("This browser can't access a microphone. Try Chrome, Edge or Safari.");
        setPhase("error");
        return;
      }

      const capture = createLocalCapture(wantVideo);
      captureRef.current = capture;
      levelCbRef.current = null;

      let stream: MediaStream;
      try {
        stream = await capture.streamPromise;
      } catch (e) {
        if (closedRef.current) return;
        capture.dispose();
        setError(friendlyMediaError(e, wantVideo));
        setPhase("error");
        return;
      }
      if (closedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      localRef.current = stream;
      setLocalStream(stream);
      camTrackRef.current = stream.getVideoTracks()[0] ?? null;

      let ice: RTCIceServer[] = [];
      try {
        ice = await fetchIceServers();
      } catch {
        ice = [];
      }
      if (closedRef.current) return;

      const pc = new RTCPeerConnection({ iceServers: ice, bundlePolicy: "max-bundle" });
      pcRef.current = pc;

      const remote = new MediaStream();
      setRemoteStream(remote);
      pc.ontrack = (ev) => {
        const s = ev.streams[0];
        if (s) {
          s.getTracks().forEach((t) => {
            if (!remote.getTracks().some((r) => r.id === t.id)) remote.addTrack(t);
          });
        } else {
          remote.addTrack(ev.track);
        }
      };
      pc.onconnectionstatechange = () => {
        setConnection(pc.connectionState);
        if (pc.connectionState === "connected") {
          setPhase("live");
          setLiveSince((t) => t ?? Date.now());
        }
        if (pc.connectionState === "failed") {
          setPhase("error");
          setError("The connection failed. Both sides may be behind a strict network.");
        }
      };
      // Relay is only chosen after all direct routes fail — this flag tells the
      // UI whether audio is riding Cloudflare or a direct peer-to-peer path.
      const signal = async (kind: SignalKind, payload: unknown) => {
        try {
          await publishSignal({
            room_id: roomId,
            to_user_id: "*",
            kind,
            payload: typeof payload === "string" ? payload : JSON.stringify(payload),
          });
        } catch {
          /* the poll loop retries via ICE re-publish */
        }
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate && ev.candidate.type === "relay") setUsingRelay(true);
        if (ev.candidate) void signal("ice", ev.candidate.toJSON());
      };

      // Answer-first for the callee: wait for the caller's offer.
      if (!caller) {
        const poll = async () => {
          if (closedRef.current || !pcRef.current) return;
          try {
            const signals = await pollSignals(roomId);
            for (const sig of signals) {
              // Both sides broadcast to '*', so drop anything we sent ourselves.
              if (myUserId && sig.from === myUserId) continue;
              if (sig.kind === "offer") {
                await pc.setRemoteDescription({ type: "offer", sdp: sig.payload });
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                await signal("answer", answer.sdp ?? "");
              } else if (sig.kind === "ice" && sig.payload) {
                try {
                  await pc.addIceCandidate(JSON.parse(sig.payload));
                } catch {
                  /* stale candidate */
                }
              } else if (sig.kind === "bye") {
                setPhase("ended");
                return;
              }
            }
          } catch {
            /* retry next tick */
          }
          if (!closedRef.current) setTimeout(poll, POLL_MS);
        };
        setTimeout(poll, POLL_MS);
        return;
      }

      // Caller drives the handshake.
      try {
        const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: wantVideo });
        await pc.setLocalDescription(offer);
        // Re-publish until an answer lands; poll CONSUMES, so a dropped offer
        // would otherwise hang the call forever.
        let answered = false;
        const announce = async () => {
          if (answered || closedRef.current) return;
          const cur = pcRef.current?.localDescription;
          if (cur?.sdp) await signal("offer", cur.sdp);
        };
        await announce();
        const repeat = setInterval(() => void announce(), ICE_REPUBLISH_MS);

        const poll = async () => {
          if (closedRef.current || !pcRef.current) {
            clearInterval(repeat);
            return;
          }
          try {
            const signals = await pollSignals(roomId);
            for (const sig of signals) {
              if (myUserId && sig.from === myUserId) continue;
              if (sig.kind === "answer" && sig.payload && pcRef.current?.signalingState !== "stable") {
                answered = true;
                clearInterval(repeat);
                await pc.setRemoteDescription({ type: "answer", sdp: sig.payload });
                setPhase("live");
                setLiveSince(Date.now());
              } else if (sig.kind === "ice" && sig.payload) {
                try {
                  await pcRef.current?.addIceCandidate(JSON.parse(sig.payload));
                } catch {
                  /* stale candidate */
                }
              } else if (sig.kind === "bye") {
                setPhase("ended");
                clearInterval(repeat);
                return;
              }
            }
          } catch {
            /* retry next tick */
          }
          if (!closedRef.current) setTimeout(poll, POLL_MS);
        };
        setTimeout(poll, POLL_MS);
      } catch (e) {
        if (closedRef.current) return;
        setError(e instanceof Error ? e.message : "Could not start the call.");
        setPhase("error");
      }
    },
    [roomId, caller, myUserId, teardown]
  );

  const toggleMic = useCallback(() => {
    const s = localRef.current;
    if (!s) return;
    const next = !micOn;
    s.getAudioTracks().forEach((t) => {
      t.enabled = next;
    });
    setMicOn(next);
  }, [micOn]);

  const toggleCam = useCallback(async () => {
    const s = localRef.current;
    if (!s) return;
    const tracks = s.getVideoTracks();
    // Audio-only call → turning the camera on needs a fresh offer with video.
    if (tracks.length === 0 || !videoMode) {
      await join(true);
      return;
    }
    const next = !camOn;
    tracks.forEach((t) => {
      t.enabled = next;
    });
    setCamOn(next);
  }, [camOn, videoMode, join]);

  const toggleScreenShare = useCallback(async () => {
    const pc = pcRef.current;
    const s = localRef.current;
    if (!pc || !s) return;
    const sender = pc.getSenders().find((x) => x.track?.kind === "video");
    if (!sender) {
      setError("Turn on your camera before sharing your screen.");
      return;
    }
    if (screenShareOn) {
      // Swap back to the camera (or drop video entirely if it is off).
      await sender.replaceTrack(camTrackRef.current);
      setScreenShareOn(false);
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: false,
      });
      const track = display.getVideoTracks()[0];
      if (!track) return;
      await sender.replaceTrack(track);
      screenTrackRef.current = track;
      setScreenShareOn(true);
      // The browser's own "Stop sharing" bar ends the track without our UI.
      track.onended = () => {
        setScreenShareOn(false);
        screenTrackRef.current = null;
        void sender.replaceTrack(camTrackRef.current);
      };
    } catch (e) {
      if (!isAbort(e)) setError("Screen share was blocked or unavailable.");
    }
  }, [screenShareOn]);

  const leave = useCallback(() => {
    closedRef.current = true;
    // Tell the other side so they don't sit in a dead call.
    void publishSignal({ room_id: roomId, to_user_id: "*", kind: "bye", payload: "" }).catch(() => undefined);
    teardown();
    setConnection("new");
    setPhase("ended");
  }, [roomId, teardown]);

  useEffect(() => () => teardown(), [teardown]);

  // Drop the call server-side if we vanish without pressing the button.
  useEffect(() => {
    if (!roomId) return;
    const onLeave = () => {
      void publishSignal({ room_id: roomId, to_user_id: "*", kind: "bye", payload: "" }).catch(() => undefined);
    };
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  }, [roomId]);

  return {
    phase,
    error,
    micOn,
    camOn,
    videoMode,
    screenShareOn,
    localStream,
    remoteStream,
    connection,
    liveSince,
    usingRelay,
    join,
    toggleMic,
    toggleCam,
    toggleScreenShare,
    leave,
  };
}

// ---------------------------------------------------------------------------
// Room voice (mesh)
// ---------------------------------------------------------------------------

export type RoomVoiceStatus = "off" | "connecting" | "live" | "denied" | "error";

export interface RoomPeerVoice {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  muted: boolean;
  speaking: boolean;
  relayed: boolean;
}

export interface RoomVoice {
  status: RoomVoiceStatus;
  micOn: boolean;
  level: number;
  error: string | null;
  peers: RoomPeerVoice[];
  turnReady: boolean;
  speakingUserIds: string[];
  monitoring: boolean;
  toggleMic: () => void;
  toggleMonitor: () => Promise<void>;
  leave: () => void;
}

export function useRoomVoice(roomId: string, myUserId: string | null): RoomVoice {
  const [status, setStatus] = useState<RoomVoiceStatus>("off");
  const [micOn, setMicOn] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [peers, setPeers] = useState<RoomPeerVoice[]>([]);
  const [turnReady, setTurnReady] = useState(false);
  const [speakingUserIds, setSpeakingUserIds] = useState<string[]>([]);
  const [monitoring, setMonitoring] = useState(false);

  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const streamsRef = useRef<Map<string, MediaStream>>(new Map());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const captureRef = useRef<ReturnType<typeof createLocalCapture> | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<SignalPeerish[]>([]);
  const activeRef = useRef(false);
  const speakingRef = useRef(new Set<string>());
  const analyserMapRef = useRef<Map<string, AnalyserNode>>(new Map());

  const stopAll = useCallback(() => {
    activeRef.current = false;
    captureRef.current?.dispose();
    captureRef.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    pcsRef.current.forEach((pc) => pc.close());
    pcsRef.current.clear();
    streamsRef.current.clear();
    analyserMapRef.current.clear();
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    speakingRef.current.clear();
    setPeers([]);
    setSpeakingUserIds([]);
    setLevel(0);
    setMicOn(false);
    setStatus("off");
  }, []);

  const ensurePeer = useCallback(
    (peerId: string, ice: RTCIceServer[]) => {
      let pc = pcsRef.current.get(peerId);
      if (pc) return pc;
      pc = new RTCPeerConnection({ iceServers: ice, bundlePolicy: "max-bundle" });
      pcsRef.current.set(peerId, pc);
      const remote = new MediaStream();
      streamsRef.current.set(peerId, remote);

      pc.ontrack = (ev) => {
        const s = ev.streams[0];
        const tracks = s ? s.getTracks() : [ev.track];
        let audioTrack: MediaStreamTrack | null = null;
        for (const tr of tracks) {
          if (!remote.getTracks().some((r) => r.id === tr.id)) remote.addTrack(tr);
          if (tr.kind === "audio" && !audioTrack) audioTrack = tr;
        }
        // Drive a per-peer speaking meter for the seat ring.
        if (audioTrack && !analyserMapRef.current.has(peerId)) {
          try {
            if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
            const ctx = audioCtxRef.current;
            const src = ctx.createMediaStreamSource(remote);
            const an = ctx.createAnalyser();
            an.fftSize = 256;
            src.connect(an);
            analyserMapRef.current.set(peerId, an);
            const buf = new Uint8Array(an.fftSize);
            const tick = () => {
              if (!activeRef.current) return;
              if (rmsLevel(an, buf) > 0.14) speakingRef.current.add(peerId);
              else speakingRef.current.delete(peerId);
              setSpeakingUserIds([...speakingRef.current]);
              requestAnimationFrame(tick);
            };
            tick();
          } catch {
            /* meter is cosmetic */
          }
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc?.connectionState === "failed") {
          pc.close();
          pcsRef.current.delete(peerId);
          analyserMapRef.current.delete(peerId);
          streamsRef.current.delete(peerId);
        }
      };

      localRef.current?.getTracks().forEach((t) => pc?.addTrack(t, localRef.current as MediaStream));
      return pc;
    },
    []
  );

  const toggleMic = useCallback(async () => {
    if (micOn) {
      localRef.current?.getAudioTracks().forEach((t) => {
        t.enabled = false;
      });
      setMicOn(false);
      return;
    }
    setError(null);

    if (!localRef.current) {
      const capture = createLocalCapture(false);
      captureRef.current = capture;
      capture.startMeter(setLevel);
      let stream: MediaStream;
      try {
        stream = await capture.streamPromise;
      } catch (e) {
        capture.dispose();
        setError(friendlyMediaError(e, false));
        setStatus("denied");
        return;
      }
      localRef.current = stream;
      // Existing PCs were created before we had a stream; backfill their tracks.
      pcsRef.current.forEach((pc) => {
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      });
      setMicOn(true);
      return;
    }

    localRef.current.getAudioTracks().forEach((t) => {
      t.enabled = true;
    });
    setMicOn(true);
  }, [micOn]);

  /**
   * Route the mic to the speakers so you can hear yourself.
   *
   * Off by default on purpose: on built-in speakers this feeds the mic straight
   * back into the room and howls. Turning the mic off also stops monitoring,
   * so the user is never hearing themselves after they have muted.
   */
  const toggleMonitor = useCallback(async () => {
    const capture = captureRef.current;
    if (!capture) return;
    if (capture.monitoring) {
      capture.stopMonitor();
      setMonitoring(false);
      return;
    }
    // Monitoring a muted mic would just play silence.
    const enabled = localRef.current?.getAudioTracks().some((t) => t.enabled) ?? false;
    if (!enabled) {
      setError("Turn your mic on first, then you can hear yourself.");
      return;
    }
    const ok = await capture.startMonitor();
    if (!ok) {
      setError("This browser blocked audio playback. Tap anywhere on the page, then try again.");
      return;
    }
    setMonitoring(true);
  }, []);

  // Full session: capture + TURN + peer discovery + signaling loop.
  useEffect(() => {
    if (!roomId || !myUserId) return;
    let disposed = false;

    (async () => {
      setStatus("connecting");
      let ice: RTCIceServer[] = [];
      try {
        ice = await fetchIceServers();
      } catch {
        ice = [];
      }
      if (disposed) return;
      setTurnReady(ice.length > 0);

      const capture = createLocalCapture(false);
      captureRef.current = capture;
      let stream: MediaStream;
      try {
        stream = await capture.streamPromise;
      } catch (e) {
        if (disposed) return;
        capture.dispose();
        setError(friendlyMediaError(e, false));
        setStatus("denied");
        return;
      }
      if (disposed) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      // Captured but muted until the user actually taps the mic.
      stream.getTracks().forEach((t) => {
        t.enabled = false;
      });
      localRef.current = stream;
      capture.startMeter(setLevel);
      activeRef.current = true;
      setMicOn(false);
      setStatus("live");

      const signal = async (to: string, kind: SignalKind, payload: unknown) => {
        try {
          await publishSignal({
            room_id: roomId,
            to_user_id: to,
            kind,
            payload: typeof payload === "string" ? payload : JSON.stringify(payload),
          });
        } catch {
          /* retried by the loop */
        }
      };

      // Deterministic pairing: the lexicographically smaller id always offers,
      // so a pair never creates two competing offers.
      const offerTo = async (peerId: string) => {
        if (disposed || pcsRef.current.size >= MESH_CAP) return;
        const pc = ensurePeer(peerId, ice);
        if (pc.signalingState !== "stable") return;
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
        await signal(peerId, "offer", offer.sdp ?? "");
      };

      const acceptOffer = async (peerId: string, sdp: string) => {
        if (disposed || pcsRef.current.size >= MESH_CAP) return;
        const pc = ensurePeer(peerId, ice);
        await pc.setRemoteDescription({ type: "offer", sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await signal(peerId, "answer", answer.sdp ?? "");
      };

      const refreshPeers = async () => {
        if (disposed) return;
        try {
          const list = await signalPeers(roomId);
          peersRef.current = list;
          const cap = Math.min(MESH_CAP, list.length);
          setPeers(
            list.slice(0, cap).map((p) => ({
              userId: p.user_id,
              displayName: p.display_name ?? "Guest",
              avatarUrl: p.avatar_url,
              muted: p.is_muted === 1,
              speaking: speakingRef.current.has(p.user_id),
              relayed: false,
            }))
          );
          // Connect to anyone we haven't, as the designated offerer.
          for (const p of list) {
            if (myUserId < p.user_id && !pcsRef.current.has(p.user_id)) {
              await offerTo(p.user_id);
            }
          }
          // Re-offer to peers that never answered (poll consumes signals).
          for (const pc of pcsRef.current.values()) {
            if (pc.signalingState === "have-local-offer") await signal("*", "renegotiate", "");
          }
        } catch {
          /* peer list is best-effort */
        }
      };

      await refreshPeers();
      const peerTimer = setInterval(() => void refreshPeers(), PEER_REFRESH_MS);

      const poll = async () => {
        if (disposed || !activeRef.current) return;
        try {
          const signals = await pollSignals(roomId);
          for (const sig of signals) {
            if (sig.from === myUserId) continue;
            const pc = pcsRef.current.get(sig.from);
            if (sig.kind === "offer" && sig.payload) {
              await acceptOffer(sig.from, sig.payload);
            } else if (sig.kind === "answer" && sig.payload && pc && pc.signalingState !== "stable") {
              await pc.setRemoteDescription({ type: "answer", sdp: sig.payload });
            } else if (sig.kind === "ice" && sig.payload && pc) {
              try {
                await pc.addIceCandidate(JSON.parse(sig.payload));
              } catch {
                /* stale */
              }
            } else if (sig.kind === "bye") {
              pc?.close();
              pcsRef.current.delete(sig.from);
              streamsRef.current.delete(sig.from);
              analyserMapRef.current.delete(sig.from);
            }
          }
        } catch {
          /* retry */
        }
        if (!disposed) setTimeout(poll, POLL_MS);
      };
      setTimeout(poll, POLL_MS);

      return () => {
        disposed = true;
        clearInterval(peerTimer);
      };
    })();

    return () => {
      disposed = true;
      void publishSignal({ room_id: roomId, to_user_id: "*", kind: "bye", payload: "" }).catch(() => undefined);
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, myUserId]);

  // Keep the seat-ring "speaking" flags fresh for peers we already track.
  useEffect(() => {
    if (!speakingUserIds.length) return;
    setPeers((prev) =>
      prev.map((p) => (p.speaking !== speakingUserIds.includes(p.userId)
        ? { ...p, speaking: speakingUserIds.includes(p.userId) }
        : p))
    );
  }, [speakingUserIds]);

  return { status, micOn, level, error, peers, turnReady, speakingUserIds, monitoring, toggleMic, toggleMonitor, leave: stopAll };
}

// Local mirror of the API peer row, kept here so the hook doesn't need the type
// import at module scope (avoids pulling the API module into the SSR bundle).
interface SignalPeerish {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  is_muted: number;
}
