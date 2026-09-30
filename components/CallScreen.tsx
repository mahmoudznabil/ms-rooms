"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageCircle, Mic, MicOff, Phone, PhoneOff, RotateCcw, Video, VideoOff, Wifi, WifiOff, Maximize2, Minimize2, Users, Gamepad2, Share2, Smile, X, MoreHorizontal } from "lucide-react";
import {
  acceptCallRoom,
  cancelCallRoom,
  endCallRoom,
  fetchRoomDetail,
  markCallMissed,
  privateCallStatus,
  rejectCallRoom,
  type CallMedia,
  type CallStatus,
} from "@/lib/api";
import { placeCall } from "@/lib/calls";
import { useCallSession } from "@/lib/realtime";
import { useSession } from "@/stores/useSession";
import { Spinner, UserAvatar } from "@/components/bits";

type Screen =
  | { kind: "loading" }
  | { kind: "signin" }
  | { kind: "invalid" }
  | { kind: "forbidden" }
  | { kind: "outgoing"; peerName: string; peerAvatar: string | null; peerUsername: string; media: CallMedia }
  | { kind: "incoming"; peerName: string; peerAvatar: string | null; peerUsername: string; media: CallMedia }
  | { kind: "incall" }
  | { kind: "ended"; title: string; hint: string; peerId: string | null };

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function ConnectionQualityIcon({ quality }: { quality: string }) {
  if (quality === "failed") return <WifiOff size={16} className="text-red-400" />;
  if (quality === "new" || quality === "connecting") return <Wifi size={16} className="text-amber-400 animate-pulse" />;
  if (quality === "disconnected") return <WifiOff size={16} className="text-red-400" />;
  return <Wifi size={16} className="text-emerald-400" />;
}

/**
 * In-call games. Deliberately two-player and turn-based: a coin flip and a
 * best-of-three. Both sides can play without either of them owning game state,
 * so a dropped call never leaves a phantom score on someone's screen.
 */
type CallGame = "coin" | "rps";

function InCallGames({ onClose }: { onClose: () => void }) {
  const [game, setGame] = useState<CallGame>("coin");
  const [flip, setFlip] = useState<string | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [rps, setRps] = useState<{ you: string; them: string; win: boolean | null } | null>(null);

  const BEATS: Record<string, string> = { rock: "scissors", scissors: "paper", paper: "rock" };
  const RPS = ["rock", "scissors", "paper"] as const;

  const reset = () => {
    setFlip(null);
    setChoice(null);
    setRps(null);
  };

  return (
    <div className="absolute inset-x-0 bottom-24 z-30 mx-auto w-[min(22rem,calc(100%-2rem))] rounded-3xl border border-white/10 bg-[#12121a]/95 p-4 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-bold">
          <Gamepad2 size={15} /> Games
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => { setGame("coin"); reset(); }}
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${game === "coin" ? "bg-white text-black" : "bg-white/10 text-white/70"}`}
          >
            Coin flip
          </button>
          <button
            onClick={() => { setGame("rps"); reset(); }}
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${game === "rps" ? "bg-white text-black" : "bg-white/10 text-white/70"}`}
          >
            RPS
          </button>
          <button onClick={onClose} aria-label="Close games" className="ml-1 rounded-full p-1 text-white/50 hover:bg-white/10 hover:text-white">
            <X size={15} />
          </button>
        </div>
      </div>

      {game === "coin" ? (
        <div className="mt-3 text-center">
          <button
            onClick={() => setFlip(flip ? null : Math.random() < 0.5 ? "Heads" : "Tails")}
            className="flex h-20 w-full items-center justify-center rounded-2xl bg-white/5 text-2xl font-black transition hover:bg-white/10 active:scale-[0.98]"
          >
            {flip ?? "Flip the coin"}
          </button>
          <p className="mt-2 text-[11px] text-white/45">Call it in chat, or flip again.</p>
        </div>
      ) : (
        <div className="mt-3 text-center">
          <div className="flex items-center justify-center gap-2">
            {RPS.map((r) => (
              <button
                key={r}
                onClick={() => {
                  const them = RPS[Math.floor(Math.random() * RPS.length)];
                  setChoice(r);
                  setRps({ you: r, them, win: BEATS[r] === them });
                }}
                className={`h-14 w-14 rounded-2xl text-xl font-black capitalize transition active:scale-95 ${
                  choice === r ? "bg-white text-black" : "bg-white/5 text-white/80 hover:bg-white/10"
                }`}
              >
                {r === "rock" ? "✊" : r === "paper" ? "✋" : "✌️"}
              </button>
            ))}
          </div>
          {rps && (
            <p className="mt-2 text-sm font-bold">
              You played {rps.you}, they played {rps.them} —{" "}
              <span className={rps.win ? "text-emerald-300" : "text-white/60"}>
                {rps.win ? "you win!" : "you lose"}
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const REACTIONS = ["😂", "😍", "🔥", "👏", "😭", "💀", "🎉", "🤯"];

function Reactions({ onPick }: { onPick: (r: string) => void }) {
  return (
    <div className="absolute inset-x-0 bottom-24 z-30 mx-auto flex w-fit max-w-[calc(100%-2rem)] flex-wrap justify-center gap-1.5 rounded-full border border-white/10 bg-[#12121a]/95 p-2 shadow-2xl backdrop-blur">
      {REACTIONS.map((r) => (
        <button
          key={r}
          onClick={() => onPick(r)}
          className="h-10 w-10 rounded-full text-xl transition hover:scale-125 hover:bg-white/10 active:scale-95"
        >
          {r}
        </button>
      ))}
    </div>
  );
}

function FloatingReaction({ emoji, id }: { emoji: string; id: number }) {
  return (
    <span
      key={id}
      className="pointer-events-none absolute bottom-32 left-1/2 -translate-x-1/2 text-4xl"
      style={{ animation: "float-react 2.4s ease-out forwards" }}
    >
      {emoji}
    </span>
  );
}

export default function CallScreen() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const slug = searchParams.get("room") ?? "";
  const user = useSession((s) => s.user);

  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [roomId, setRoomId] = useState<string | null>(null);
  const [peer, setPeer] = useState<{ id: string; name: string; username: string; avatar: string | null }>({ id: "", name: "", username: "", avatar: null });
  const [media, setMedia] = useState<CallMedia>("audio");
  const [role, setRole] = useState<"caller" | "callee" | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [ringSecs, setRingSecs] = useState(0);
  const [connectedAt, setConnectedAt] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const mediaSession = useCallSession(roomId ?? "", role === "caller", user?.id ?? null);
  const joinedRef = useRef(false);

  // ---- boot: resolve slug → room → role -------------------------------------
  useEffect(() => {
    if (!slug) {
      setScreen({ kind: "invalid" });
      return;
    }
    if (!user) {
      setScreen({ kind: "signin" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const detail = await fetchRoomDetail(slug);
        if (cancelled) return;
        const r = detail.room as unknown as Record<string, unknown>;
        if (!r.is_private) {
          setScreen({ kind: "invalid" });
          return;
        }
        const id = r.id as string;
        setRoomId(id);
        const amCaller = r.host_user_id === user.id;
        const amCallee = r.call_participant_user_id === user.id;
        if (!amCaller && !amCallee) {
          setScreen({ kind: "forbidden" });
          return;
        }
        setRole(amCaller ? "caller" : "callee");
        const st = await privateCallStatus(id);
        if (cancelled) return;
        const isCaller = amCaller;
        const other = isCaller ? st.callee : st.caller;
        const peerInfo = {
          id: (isCaller ? (r.call_participant_user_id as string) : (r.host_user_id as string)) ?? "",
          name: (other?.display_name as string) ?? "Unknown",
          username: "",
          avatar: (other?.avatar_url as string | null) ?? null,
        };
        setPeer(peerInfo);
        setMedia((st.call_session?.media as CallMedia) ?? "audio");
        routeStatus(st.call_session?.status ?? null, isCaller ? "caller" : "callee", (st.call_session?.connected_at as string | null) ?? null, peerInfo, (st.call_session?.media as CallMedia) ?? "audio");
      } catch {
        if (!cancelled) setScreen({ kind: "invalid" });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, user]);

  const routeStatus = useCallback(
    (
      status: CallStatus | null,
      who: "caller" | "callee",
      at: string | null,
      p: { id: string; name: string; username: string; avatar: string | null } = peer,
      mediaType?: CallMedia
    ) => {
      if (status === "connected") {
        setConnectedAt(at);
        setScreen({ kind: "incall" });
      } else if (status === "ringing" || status === "initiated") {
        setScreen(who === "caller"
          ? { kind: "outgoing", peerName: p.name, peerAvatar: p.avatar, peerUsername: p.username, media: mediaType ?? "audio" }
          : { kind: "incoming", peerName: p.name, peerAvatar: p.avatar, peerUsername: p.username, media: mediaType ?? "audio" });
      } else if (status === "rejected") {
        setScreen({ kind: "ended", title: who === "caller" ? "Declined" : "You declined the call", hint: who === "caller" ? `${p.name} declined your call.` : "The caller has been notified.", peerId: p.id || null });
      } else if (status === "cancelled") {
        setScreen({ kind: "ended", title: "Cancelled", hint: who === "caller" ? "You cancelled the call." : "The caller cancelled before you answered.", peerId: p.id || null });
      } else if (status === "missed") {
        setScreen({ kind: "ended", title: who === "caller" ? "No answer" : "Missed call", hint: who === "caller" ? `${p.name} didn't answer.` : `You missed a call from ${p.name}.`, peerId: p.id || null });
      } else {
        setScreen({ kind: "ended", title: "Call ended", hint: "This call is over.", peerId: p.id || null });
      }
    },
    [peer]
  );

  // ---- poll while ringing ----------------------------------------------------
  useEffect(() => {
    if (screen.kind !== "outgoing" && screen.kind !== "incoming") return;
    if (!roomId || !role) return;
    const t = setInterval(async () => {
      setRingSecs((s) => s + 3);
      try {
        const st = await privateCallStatus(roomId);
        const status = st.call_session?.status ?? null;
        if (status !== "ringing" && status !== "initiated") {
          routeStatus(status, role, (st.call_session?.connected_at as string | null) ?? null, peer, (st.call_session?.media as CallMedia) ?? "audio");
        }
      } catch {
        // Silent — next poll retries.
      }
    }, 3000);
    return () => clearInterval(t);
  }, [screen.kind, roomId, role, routeStatus]);

  // ---- ringing timeout (standard ~45s): log it missed -------------------------
  useEffect(() => {
    if (ringSecs < 48) return;
    if ((screen.kind !== "outgoing" && screen.kind !== "incoming") || !roomId) return;
    void markCallMissed(roomId).catch(() => undefined);
  }, [ringSecs, screen.kind, roomId]);

  // ---- join media once connected ------------------------------------------------
  useEffect(() => {
    if (screen.kind === "incall" && !joinedRef.current) {
      joinedRef.current = true;
      void mediaSession.join(media === "video");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen.kind]);

  // ---- clock for timers ----------------------------------------------------------
  useEffect(() => {
    if (screen.kind !== "incall" && screen.kind !== "outgoing") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [screen.kind]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(t);
  }, [notice]);

  // ---- actions ---------------------------------------------------------------------
  const doAccept = async () => {
    if (!roomId || busy) return;
    setBusy(true);
    try {
      await acceptCallRoom(roomId);
      setConnectedAt(new Date().toISOString());
      setScreen({ kind: "incall" });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Couldn't accept. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const doDecline = async () => {
    if (!roomId || busy) return;
    setBusy(true);
    try {
      await rejectCallRoom(roomId);
    } catch {
      // Best-effort.
    } finally {
      setBusy(false);
      setScreen({ kind: "ended", title: "You declined the call", hint: "The caller has been notified.", peerId: peer.id || null });
    }
  };

  const doCancel = async () => {
    if (!roomId || busy) return;
    setBusy(true);
    try {
      await cancelCallRoom(roomId);
    } catch {
      // Best-effort.
    } finally {
      setBusy(false);
      setScreen({ kind: "ended", title: "Cancelled", hint: "You cancelled the call.", peerId: peer.id || null });
    }
  };

  const doEnd = async () => {
    mediaSession.leave();
    if (roomId) {
      try {
        await endCallRoom(roomId);
      } catch {
        // Best-effort.
      }
    }
    setScreen({ kind: "ended", title: "Call ended", hint: "Thanks for calling.", peerId: peer.id || null });
  };

  const doCallback = async () => {
    if (!user || !peer.id) return;
    setBusy(true);
    const err = await placeCall(peer.id, user.id, media, router);
    setBusy(false);
    if (err) setNotice(err);
  };

  // ---- static screens ------------------------------------------------------------------
  if (screen.kind === "loading") return <Spinner />;
  if (screen.kind === "signin") {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-4xl">📞</p>
        <h1 className="mt-3 text-xl font-black">Sign in to join the call</h1>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/login" className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-white/85">Sign Up / Log In</Link>
          <Link href="/calls" className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-bold text-white hover:bg-white/15">Calls tab</Link>
        </div>
      </div>
    );
  }
  if (screen.kind === "invalid") {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-4xl">🔗</p>
        <h1 className="mt-3 text-xl font-black">Invalid call link</h1>
        <p className="mt-1 text-sm text-white/50">This link doesn&apos;t point at a call.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/calls" className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-white/85">Back to Calls</Link>
        </div>
      </div>
    );
  }
  if (screen.kind === "forbidden") {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-4xl">🔒</p>
        <h1 className="mt-3 text-xl font-black">Private call</h1>
        <p className="mt-1 text-sm text-white/50">Only the two people on this call can open it.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/calls" className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-white/85">Back to Calls</Link>
        </div>
      </div>
    );
  }
  if (screen.kind === "ended") {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-4xl">📞</p>
        <h1 className="mt-3 text-xl font-black">{screen.title}</h1>
        <p className="mt-1 text-sm text-white/50">{screen.hint}</p>
        {notice && <p className="mx-auto mt-3 max-w-xs rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-amber-200">{notice}</p>}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {screen.peerId && (
            <button onClick={() => void doCallback()} disabled={busy} className="flex items-center gap-1.5 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-white/85 disabled:opacity-40">
              <Phone size={15} /> {busy ? "Calling…" : "Call back"}
            </button>
          )}
          {screen.peerId && (
            <Link href={`/messages?userId=${encodeURIComponent(screen.peerId)}`} className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-bold text-white hover:bg-white/15">
              Message
            </Link>
          )}
          <Link href="/calls" className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-bold text-white hover:bg-white/15">
            Calls tab
          </Link>
        </div>
      </div>
    );
  }

  // ---- ringing screens --------------------------------------------------------------------
if (screen.kind === "outgoing") {
    return (
      <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center py-10 text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-white/45">Outgoing {screen.media === "video" ? "video" : "voice"} call</p>
        <div className="relative mt-6">
          <span className="ring-pulse absolute inset-0" aria-hidden />
          <div className="relative">
            <UserAvatar name={screen.peerName} avatarUrl={screen.peerAvatar} size={112} />
          </div>
        </div>
        <h1 className="mt-6 text-3xl font-black">{screen.peerName}</h1>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-white/50">
          <span className="live-dot inline-block h-2 w-2 rounded-full bg-emerald-400" />
          Ringing… {fmtElapsed(ringSecs * 1000)}
        </p>
        {ringSecs >= 45 && <p className="mt-1 text-xs text-amber-200/80">Still ringing — they may be away.</p>}
        <button onClick={() => void doCancel()} disabled={busy} aria-label="Cancel call" className="mt-8 rounded-full bg-red-500 p-5 text-white shadow-lg shadow-red-500/30 transition hover:bg-red-400 active:scale-95 disabled:opacity-40">
          <Phone size={28} className="rotate-[135deg]" />
        </button>
        <p className="mt-2 text-xs font-semibold text-white/50">Cancel</p>
      </div>
    );
  }

  if (screen.kind === "incoming") {
    return (
      <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center py-10 text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-white/45">Incoming {screen.media === "video" ? "video" : "voice"} call</p>
        <div className="relative mt-6">
          <span className="ring-pulse ring-pulse-accept absolute inset-0" aria-hidden />
          <div className="relative">
            <UserAvatar name={screen.peerName} avatarUrl={screen.peerAvatar} size={112} />
          </div>
        </div>
        <h1 className="mt-6 text-3xl font-black">{screen.peerName}</h1>
        <p className="mt-1 text-sm text-white/50">wants to talk to you</p>
        <div className="mt-10 flex items-center gap-8">
          <span className="flex flex-col items-center gap-1.5">
            <button onClick={() => void doDecline()} disabled={busy} aria-label="Decline" className="rounded-full bg-red-500 p-6 text-white shadow-lg shadow-red-500/30 transition hover:bg-red-400 active:scale-95 disabled:opacity-40">
              <Phone size={28} className="rotate-[135deg]" />
            </button>
            <span className="text-xs font-semibold text-white/50">Decline</span>
          </span>
          <span className="flex flex-col items-center gap-1.5">
            <button onClick={() => void doAccept()} disabled={busy} aria-label="Accept" className="animate-pulse rounded-full bg-emerald-500 p-6 text-white shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400 active:scale-95 disabled:opacity-40">
              <Phone size={28} />
            </button>
            <span className="text-xs font-semibold text-white/50">Accept</span>
          </span>
        </div>
      </div>
    );
  }

  // ---- in-call -------------------------------------------------------------------------------
  return (
    <InCallUI
      peer={peer}
      media={media}
      connectedAt={connectedAt}
      now={now}
      session={mediaSession}
      notice={notice}
      onEnd={() => void doEnd()}
    />
  );
}

function InCallUI({
  peer,
  media,
  connectedAt,
  now,
  session,
  notice,
  onEnd,
}: {
  peer: { id: string; name: string; username: string; avatar: string | null };
  media: CallMedia;
  connectedAt: string | null;
  now: number;
  session: ReturnType<typeof useCallSession>;
  notice: string | null;
  onEnd: () => void;
}) {
const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const [showGames, setShowGames] = useState(false);
  const [showReactions, setShowReactions] = useState(false);
  const [floats, setFloats] = useState<Array<{ id: number; emoji: string }>>([]);

  useEffect(() => {
    if (remoteAudioRef.current && session.remoteStream) remoteAudioRef.current.srcObject = session.remoteStream;
  }, [session.remoteStream]);
  useEffect(() => {
    if (remoteVideoRef.current && session.remoteStream) remoteVideoRef.current.srcObject = session.remoteStream;
  }, [session.remoteStream]);
  useEffect(() => {
    if (localVideoRef.current && session.localStream) localVideoRef.current.srcObject = session.localStream;
  }, [session.localStream]);

  const elapsed = connectedAt
    ? fmtElapsed(now - new Date(connectedAt).getTime())
    : session.liveSince
      ? fmtElapsed(now - session.liveSince)
      : "00:00";

  const getConnectionQuality = (state: string): "excellent" | "good" | "fair" | "poor" | "failed" => {
    if (session.phase === "error") return "failed";
    if (session.connection === "failed") return "failed";
    if (session.connection === "disconnected") return "poor";
    if (session.connection === "connecting") return "fair";
    if (session.connection === "new") return "fair";
    if (session.connection === "connected") return "excellent";
    return "fair";
  };

  const quality = getConnectionQuality(session.connection);

  if (session.phase === "error") {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-black/90 z-50">
        <div className="mx-auto max-w-md py-10 px-6 text-center bg-[#15151d] rounded-3xl border border-white/10 shadow-2xl">
          <p className="text-5xl">🎙️</p>
          <h1 className="mt-4 text-2xl font-black">Couldn&apos;t start media</h1>
          <p className="mt-2 text-sm text-white/50">{session.error ?? "Check permissions and try again."}</p>
          <div className="mt-6 flex justify-center gap-3">
            <button onClick={() => void session.join(media === "video")} className="flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-black hover:bg-white/85">
              <RotateCcw size={16} /> Rejoin
            </button>
            <button onClick={onEnd} className="rounded-full bg-white/10 px-6 py-3 text-sm font-bold text-white hover:bg-white/15">End call</button>
          </div>
        </div>
      </div>
    );
  }

  const qualityColors = {
    excellent: "bg-emerald-400",
    good: "bg-green-400",
    fair: "bg-amber-400",
    poor: "bg-orange-400",
    failed: "bg-red-400",
  };

  return (
    <div className={`fixed inset-0 z-50 ${fullScreen ? "" : "max-w-md mx-auto"}`}>
      {/* Hidden remote audio — ALWAYS rendered so voice works even on video calls */}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      {session.videoMode ? (
        // VIDEO MODE - Full screen like WhatsApp
        <div className={`fixed inset-0 bg-black ${fullScreen ? "z-50" : "relative h-full"}`}>
          {/* Remote video - full screen */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
          />
          {!session.remoteStream && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 z-10">
              <UserAvatar name={peer.name} avatarUrl={peer.avatar} size={88} />
              <p className="text-base text-white/70">{session.phase === "joining" ? "Connecting camera…" : "Waiting for video…"}</p>
            </div>
          )}

          {/* Connection quality indicator - top left */}
          <div className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 backdrop-blur">
            <span className="flex items-center gap-1">
              <ConnectionQualityIcon quality={quality} />
              <span className="text-xs font-medium text-white capitalize">{quality}</span>
            </span>
          </div>

          {/* Call info - top center */}
          <div className="absolute left-1/2 top-4 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full bg-black/60 px-4 py-1.5 backdrop-blur">
            <span className="text-sm font-semibold text-white">{peer.name}</span>
            <span className="text-xs text-white/50">·</span>
            <span className="text-xs font-mono text-white/70 tabular-nums" id="call-timer">
              {(() => {
                const start = connectedAt ? new Date(connectedAt).getTime() : (session.liveSince ?? Date.now());
                const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
                const m = Math.floor(elapsed / 60);
                const s = elapsed % 60;
                return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
              })()}
            </span>
          </div>

          {/* Self PiP - bottom right */}
          <div className="absolute bottom-5 right-5 z-20 h-32 w-24 overflow-hidden rounded-xl border-2 border-white/20 bg-black shadow-xl">
            <video ref={localVideoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
          </div>

          {/* Connection status indicator - bottom left */}
          {session.connection === "failed" && (
            <div className="absolute bottom-5 left-5 z-20 flex items-center gap-1.5 rounded-full bg-red-500/90 px-3 py-1.5 backdrop-blur">
              <WifiOff size={12} className="text-white" />
              <span className="text-xs font-semibold text-white">Poor connection</span>
            </div>
          )}

          {/* Controls - bottom center */}
          <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3">
            {/* Mute */}
            <button
              onClick={session.toggleMic}
              aria-label={session.micOn ? "Mute microphone" : "Unmute microphone"}
              className={`rounded-full p-4 transition-all duration-200 active:scale-95 shadow-xl ${
                session.micOn
                  ? "bg-white/10 text-white hover:bg-white/20 ring-2 ring-white/20"
                  : "bg-red-500/90 text-white ring-2 ring-red-500/50"
              }`}
            >
              {session.micOn ? <Mic size={26} /> : <MicOff size={26} />}
            </button>

            {/* Camera toggle - only show in video mode or allow turning on */}
            <button
              onClick={() => void session.toggleCam()}
              aria-label={session.camOn ? "Turn camera off" : "Turn camera on"}
              className={`rounded-full p-4 transition-all duration-200 active:scale-95 shadow-xl ${
                session.camOn
                  ? "bg-white/10 text-white hover:bg-white/20 ring-2 ring-white/20"
                  : "bg-white/10 text-white/50 hover:bg-white/20"
              }`}
            >
              {session.camOn ? <Video size={26} /> : <VideoOff size={26} />}
            </button>

            {/* Fullscreen toggle */}
            <button
              onClick={() => setFullScreen(!fullScreen)}
              aria-label={fullScreen ? "Exit fullscreen" : "Enter fullscreen"}
              className="rounded-full bg-white/10 p-4 transition-all duration-200 active:scale-95 hover:bg-white/20 text-white"
            >
              {fullScreen ? <Minimize2 size={26} /> : <Maximize2 size={26} />}
            </button>

            {/* Screen Share */}
            <button
              onClick={() => void session.toggleScreenShare?.()}
              aria-label={session.screenShareOn ? "Stop screen share" : "Share screen"}
              className={`rounded-full p-4 transition-all duration-200 active:scale-95 shadow-xl ${
                session.screenShareOn
                  ? "bg-white/10 text-white hover:bg-white/20 ring-2 ring-white/20"
                  : "bg-white/10 text-white/50 hover:bg-white/20"
              }`}
            >
              <Share2 size={26} />
            </button>
            <button
              onClick={() => setShowGames((v) => !v)}
              aria-label="Games"
              className={`rounded-full p-4 transition-all duration-200 active:scale-95 shadow-xl ${
                showGames ? "bg-white text-black" : "bg-white/10 text-white hover:bg-white/20"
              }`}
            >
              <Gamepad2 size={26} />
            </button>
            <button
              onClick={() => setShowReactions((v) => !v)}
              aria-label="Reactions"
              className={`rounded-full p-4 transition-all duration-200 active:scale-95 shadow-xl ${
                showReactions ? "bg-white text-black" : "bg-white/10 text-white hover:bg-white/20"
              }`}
            >
              <Smile size={26} />
            </button>

            {/* End call */}
            <button
              onClick={onEnd}
              aria-label="End call"
              className="rounded-full bg-red-500/90 p-4 transition-all duration-200 active:scale-95 shadow-xl hover:bg-red-600 ring-2 ring-red-500/50"
            >
              <PhoneOff size={26} />
            </button>
          </div>

        </div>
      ) : (
        // AUDIO MODE - Full screen with avatar
        <div className={`fixed inset-0 bg-black ${fullScreen ? "z-50" : "relative h-full flex flex-col items-center justify-center"}`}>
          <div className="flex-1 flex flex-col items-center justify-center px-6">
            <UserAvatar name={peer.name} avatarUrl={peer.avatar} size={144} />
            <h1 className="mt-6 text-3xl font-black text-center">{peer.name}</h1>
            <p className="mt-2 flex items-center justify-center gap-2 text-base text-white/60">
              <span className={`inline-flex items-center gap-1 h-2 w-2 rounded-full ${session.phase === "live" ? "bg-emerald-400" : "bg-amber-300"}`} />
              <span className="text-sm font-medium">
                {session.phase === "joining" ? "Connecting…" : elapsed}
              </span>
            </p>
            {session.connection === "failed" && (
              <p className="mt-2 text-sm font-semibold text-red-300 flex items-center gap-1.5">
                <WifiOff size={14} /> Poor connection — reconnecting…
              </p>
            )}
          </div>

          {/* Connection quality indicator */}
          <div className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 backdrop-blur">
            <span className="flex items-center gap-1">
              <ConnectionQualityIcon quality={quality} />
              <span className="text-xs font-medium text-white capitalize">{quality}</span>
            </span>
          </div>

          {/* Call timer - top center */}
          <div className="absolute left-1/2 top-4 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full bg-black/60 px-4 py-1.5 backdrop-blur">
            <span className="text-sm font-semibold text-white">{peer.name}</span>
            <span className="text-xs text-white/50">·</span>
            <span className="text-xs font-mono text-white/70 tabular-nums" id="call-timer-audio">
              {(() => {
                const start = connectedAt ? new Date(connectedAt).getTime() : (session.liveSince ?? Date.now());
                const elapsed = Math.max(0, Math.floor((Date.now() - start) / 1000));
                const m = Math.floor(elapsed / 60);
                const s = elapsed % 60;
                return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
              })()}
            </span>
          </div>

          {/* Controls - bottom center */}
          <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-4 ${fullScreen ? "" : "mb-8"}`}>
            <button
              onClick={session.toggleMic}
              aria-label={session.micOn ? "Mute microphone" : "Unmute microphone"}
              className={`rounded-full p-5 transition-all duration-200 active:scale-95 shadow-xl ${
                session.micOn
                  ? "bg-white/10 text-white hover:bg-white/20 ring-2 ring-white/20"
                  : "bg-red-500/90 text-white ring-2 ring-red-500/50"
              }`}
            >
              {session.micOn ? <Mic size={28} /> : <MicOff size={28} />}
            </button>

            <button
              onClick={() => void session.toggleCam()}
              aria-label={session.camOn ? "Turn camera off" : "Turn camera on"}
              title={session.videoMode ? "Camera on/off" : "Turn on camera (rejoins with video)"}
              className={`rounded-full p-5 transition-all duration-200 active:scale-95 shadow-xl ${
                session.camOn
                  ? "bg-white/10 text-white hover:bg-white/20 ring-2 ring-white/20"
                  : "bg-white/10 text-white/50 hover:bg-white/20"
              }`}
            >
              {session.camOn ? <Video size={28} /> : <VideoOff size={28} />}
            </button>

            <button
              onClick={() => setFullScreen(!fullScreen)}
              aria-label={fullScreen ? "Exit fullscreen" : "Enter fullscreen"}
              className="rounded-full bg-white/10 p-5 transition-all duration-200 active:scale-95 hover:bg-white/20 text-white"
            >
              {fullScreen ? <Minimize2 size={28} /> : <Maximize2 size={28} />}
            </button>

            <button onClick={onEnd} aria-label="End call" className="rounded-full bg-red-500/90 p-5 transition-all duration-200 active:scale-95 shadow-xl hover:bg-red-600 ring-2 ring-red-500/50">
              <PhoneOff size={28} />
            </button>

<button
              onClick={() => setShowGames((v) => !v)}
              aria-label="Games"
              className={`rounded-full p-5 transition-all duration-200 active:scale-95 shadow-xl ${
                showGames ? "bg-white text-black" : "bg-white/10 text-white hover:bg-white/20"
              }`}
            >
              <Gamepad2 size={28} />
            </button>

            <button
              onClick={() => setShowReactions((v) => !v)}
              aria-label="Reactions"
              className={`rounded-full p-5 transition-all duration-200 active:scale-95 shadow-xl ${
                showReactions ? "bg-white text-black" : "bg-white/10 text-white hover:bg-white/20"
              }`}
            >
              <Smile size={28} />
            </button>

            <Link
              href={`/messages?userId=${encodeURIComponent(peer.id)}`}
              aria-label="Message"
              className="rounded-full bg-white/10 p-5 transition-all duration-200 active:scale-95 shadow-xl text-white hover:bg-white/20"
            >
              <MessageCircle size={28} />
            </Link>
          </div>

          {showGames && <InCallGames onClose={() => setShowGames(false)} />}
          {showReactions && (
            <Reactions
              onPick={(e) => {
                setFloats((f) => [...f, { id: Date.now() + Math.random(), emoji: e }]);
                setShowReactions(false);
                setTimeout(() => setFloats((f) => f.slice(-4)), 2400);
              }}
            />
          )}
          {floats.map((f) => (
            <FloatingReaction key={f.id} id={f.id} emoji={f.emoji} />
          ))}
        </div>
      )}
    </div>
  );
}