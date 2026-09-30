"use client";

/**
 * Cloudflare-native realtime voice layer.
 *
 * Entirely on the Cloudflare stack: the Worker backend (`workers/backend.ts`)
 * brokers Cloudflare Calls SFU sessions and short-lived TURN credentials.
 * The browser uses only Web-standard WebRTC (RTCPeerConnection + getUserMedia).
 * No external media servers or third-party SDKs.
 *
 * When Calls credentials are not configured on the Worker, `getTurnConfig()`
 * reports `configured: false` and the hook runs in local preview mode
 * (microphone level meter only, no remote streaming) instead of failing.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";

export type VoiceStatus = "preview" | "requesting" | "live" | "denied" | "error";

export interface TurnConfig {
  configured: boolean;
  urls: string[];
  username: string | null;
  credential: string | null;
  iceServers: RTCIceServer[] | null;
  setupHint: string | null;
}

export async function getTurnConfig(): Promise<TurnConfig> {
  const res = await fetch(`${API_BASE}/api/turn`, { cache: "no-store" });
  if (!res.ok) throw new Error(`turn request failed: ${res.status}`);
  const data = (await res.json()) as {
    ok: boolean;
    configured?: boolean;
    turn?: { urls: string[]; username: string; credential: string } | null;
    iceServers?: RTCIceServer[] | null;
    setup?: string;
  };
  if (!data.ok) throw new Error("Firebase JWK fetch failed");
  const iceServers = Array.isArray(data.iceServers) && data.iceServers.length > 0 ? data.iceServers : null;
  return {
    configured: data.configured === true && (iceServers != null || data.turn != null),
    urls: data.turn?.urls ?? [],
    username: data.turn?.username ?? null,
    credential: data.turn?.credential ?? null,
    iceServers,
    setupHint: data.setup ?? null,
  };
}

async function postCallsSession(offerSdp: string, room: string): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/calls/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sdp: offerSdp, room }),
  });
  if (res.status === 501) return null; // Calls not configured -> preview mode
  if (!res.ok) throw new Error(`calls session failed: ${res.status}`);
  const data = (await res.json()) as { ok: boolean; answer?: string };
  if (!data.ok || typeof data.answer !== "string") throw new Error("bad calls answer");
  return data.answer;
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

export function useCloudflareVoice(roomSlug: string) {
  const [status, setStatus] = useState<VoiceStatus>("preview");
  const [micOn, setMicOn] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const rafRef = useRef<number>(0);
  const audioRef = useRef<{ ctx: AudioContext; analyser: AnalyserNode; buf: Uint8Array<ArrayBuffer> } | null>(null);

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    audioRef.current?.ctx.close().catch(() => undefined);
    audioRef.current = null;
    setLevel(0);
  }, []);

  const stopAll = useCallback(() => {
    stopMeter();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    setMicOn(false);
    setStatus("preview");
  }, [stopMeter]);

  useEffect(() => stopAll, [stopAll]);

  const toggleMic = useCallback(async () => {
    if (micOn) {
      stopAll();
      return;
    }
    setError(null);
    setStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      // Local level meter (works with or without the SFU).
      const Ctx = window.AudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      audioRef.current = { ctx, analyser, buf };
      const tick = () => {
        const a = audioRef.current;
        if (a) setLevel(rmsLevel(a.analyser, a.buf));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      // Cloudflare path: TURN for NAT traversal + Calls SFU session.
      // Backend returns `iceServers` verbatim from
      // rtc.live.cloudflare.com/.../generate-ice-servers (STUN + TURN entries).
      // Pass them straight to RTCPeerConnection.
      let iceServers: RTCIceServer[] = [];
      try {
        const turn = await getTurnConfig();
        if (turn.configured && turn.iceServers && turn.iceServers.length > 0) {
          iceServers = turn.iceServers;
        } else if (turn.configured && turn.urls.length > 0) {
          iceServers = [
            {
              urls: turn.urls,
              username: turn.username ?? undefined,
              credential: turn.credential ?? undefined,
            },
          ];
        }
      } catch {
        iceServers = [];
      }

      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;
      stream.getAudioTracks().forEach((t) => pc.addTrack(t, stream));

      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      const answer = await postCallsSession(offer.sdp ?? "", roomSlug);
      if (answer) {
        await pc.setRemoteDescription({ type: "answer", sdp: answer });
        setStatus("live");
      } else {
        // Calls not configured: stay in preview mode with local mic pipeline.
        setStatus("preview");
      }
      setMicOn(true);
    } catch (e) {
      stopAll();
      if (e instanceof DOMException && e.name === "NotAllowedError") {
        setStatus("denied");
        setError("Microphone permission was denied.");
      } else {
        setStatus("error");
        setError(e instanceof Error ? e.message : "Could not start the microphone.");
      }
    }
  }, [micOn, roomSlug, stopAll]);

  return { status, micOn, level, error, toggleMic, leave: stopAll };
}

// ---------------------------------------------------------------------------
// 1:1 call media session (voice + video).
//
// Unlike the room hook above (mic preview + optional SFU), a call MUST render
// the remote party: we expose `remoteStream` (attach to <audio>/<video>) and
// `localStream` (self preview / PiP). Signalling reuses the same Worker
// broker (POST /api/calls/session) — the SDP simply carries video when the
// local stream has a camera track.
export type CallPhase = "idle" | "joining" | "live" | "ended" | "error";

export function useCallSession(roomSlug: string, withVideo: boolean) {
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(withVideo);
  const [videoMode, setVideoMode] = useState(withVideo);
  const [screenShareOn, setScreenShareOn] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connection, setConnection] = useState<string>("new");
  const [liveSince, setLiveSince] = useState<number | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const withVideoRef = useRef(withVideo);
  withVideoRef.current = withVideo;

  const teardown = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setLiveSince(null);
  }, []);

  useEffect(() => teardown, [teardown]);

  const join = useCallback(async (wantVideo: boolean) => {
    teardown();
    setError(null);
    setPhase("joining");
    setVideoMode(wantVideo);
    setCamOn(wantVideo);
    setMicOn(true);
    try {
      // Friendly pre-permission errors (standard rule: never fail silently).
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser can't access the microphone. Try Chrome, Edge, or Safari.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: wantVideo ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" } : false,
      });
      streamRef.current = stream;
      setLocalStream(stream);

      let iceServers: RTCIceServer[] = [];
      try {
        const turn = await getTurnConfig();
        if (turn.configured && turn.iceServers && turn.iceServers.length > 0) {
          iceServers = turn.iceServers;
        } else if (turn.configured && turn.urls.length > 0) {
          iceServers = [{ urls: turn.urls, username: turn.username ?? undefined, credential: turn.credential ?? undefined }];
        }
      } catch {
        iceServers = [];
      }

      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;
      const remote = new MediaStream();
      setRemoteStream(remote);
      pc.ontrack = (ev) => {
        ev.streams[0]?.getTracks().forEach((t) => remote.addTrack(t));
      };
      pc.onconnectionstatechange = () => setConnection(pc.connectionState);
      stream.getAudioTracks().forEach((t) => pc.addTrack(t, stream));
      stream.getVideoTracks().forEach((t) => pc.addTrack(t, stream));

      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: wantVideo });
      await pc.setLocalDescription(offer);
      const answer = await postCallsSession(offer.sdp ?? "", roomSlug);
      if (!answer) throw new Error("Voice service isn't configured yet. Try again later.");
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
      setPhase("live");
      setLiveSince(Date.now());
    } catch (e) {
      teardown();
      if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")) {
        setError(
          wantVideo
            ? "Camera/mic blocked. Tap the camera icon in the address bar, allow access, then rejoin."
            : "Microphone blocked. Tap the mic icon in the address bar, allow access, then rejoin."
        );
      } else if (e instanceof DOMException && e.name === "NotFoundError") {
        setError(wantVideo ? "No camera or microphone found on this device." : "No microphone found on this device.");
      } else {
        setError(e instanceof Error ? e.message : "Could not join the call.");
      }
      setPhase("error");
    }
  }, [roomSlug, teardown]);

  const toggleMic = useCallback(() => {
    const s = streamRef.current;
    if (!s) return;
    const next = !micOn;
    s.getAudioTracks().forEach((t) => {
      t.enabled = next;
    });
    setMicOn(next);
  }, [micOn]);

  const toggleCam = useCallback(() => {
    const s = streamRef.current;
    const videoTracks = s?.getVideoTracks() ?? [];
    // Voice call → turning the camera on rejoins with video (clean SDP).
    if (videoTracks.length === 0 && !videoMode) {
      void join(true);
      return;
    }
    const next = !camOn;
    videoTracks.forEach((t) => {
      t.enabled = next;
    });
    setCamOn(next);
  }, [camOn, videoMode, join]);

  const toggleScreenShare = useCallback(async () => {
    const s = streamRef.current;
    if (!s) return;
    const next = !screenShareOn;
    try {
      if (next) {
        // Start screen sharing
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true,
        });
        // Replace video track with screen share
        const videoTrack = screenStream.getVideoTracks()[0];
        const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === "video");
        if (sender && videoTrack) {
          await sender.replaceTrack(videoTrack);
        }
        // Handle screen share ended by user
        videoTrack.onended = async () => {
          setScreenShareOn(false);
          // Switch back to camera if it was on
          if (camOn) {
            const camStream = await navigator.mediaDevices.getUserMedia({
              video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
              audio: false,
            });
            const camTrack = camStream.getVideoTracks()[0];
            const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === "video");
            if (sender && camTrack) {
              await sender.replaceTrack(camTrack);
            }
          }
        };
        setScreenShareOn(true);
      } else {
        // Stop screen sharing, switch back to camera
        if (camOn) {
          const camStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
            audio: false,
          });
          const camTrack = camStream.getVideoTracks()[0];
          const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === "video");
          if (sender && camTrack) {
            await sender.replaceTrack(camTrack);
          }
        }
        setScreenShareOn(false);
      }
    } catch (e) {
      console.error("Screen share error:", e);
      setScreenShareOn(false);
    }
  }, [camOn]);

  const addPeople = useCallback(() => {
    // TODO: Implement add people to call (group calls)
    console.log("Add people to call - not yet implemented");
    // This would open a modal to select contacts to add to the call
  }, []);

  const openGames = useCallback(() => {
    // TODO: Implement in-call games
    console.log("Open games - not yet implemented");
    // This would open a games panel
  }, []);

  const openReactions = useCallback(() => {
    // TODO: Implement reactions/emoji picker
    console.log("Open reactions - not yet implemented");
    // This would open an emoji/reactions picker
  }, []);

  const openMore = useCallback(() => {
    // TODO: Implement more options menu
    console.log("Open more options - not yet implemented");
    // This would open a more options menu
  }, []);

  const leave = useCallback(() => {
    teardown();
    setPhase("ended");
  }, [teardown]);

  return { phase, error, micOn, camOn, videoMode, screenShareOn, localStream, remoteStream, connection, liveSince, join, toggleMic, toggleCam, toggleScreenShare, addPeople, openGames, openReactions, openMore, leave };
}