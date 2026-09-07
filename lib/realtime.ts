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
  setupHint: string | null;
}

export async function getTurnConfig(): Promise<TurnConfig> {
  const res = await fetch(`${API_BASE}/api/turn`, { cache: "no-store" });
  if (!res.ok) throw new Error(`turn request failed: ${res.status}`);
  const data = (await res.json()) as {
    ok: boolean;
    configured?: boolean;
    turn?: { urls: string[]; username: string; credential: string } | null;
    setup?: string;
  };
  if (!data.ok) throw new Error("turn endpoint returned an error");
  return {
    configured: data.configured === true && data.turn != null,
    urls: data.turn?.urls ?? [],
    username: data.turn?.username ?? null,
    credential: data.turn?.credential ?? null,
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
      let iceServers: RTCIceServer[] = [];
      try {
        const turn = await getTurnConfig();
        if (turn.configured && turn.urls.length > 0) {
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
