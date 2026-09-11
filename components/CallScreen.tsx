"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageCircle, Mic, MicOff, Phone, PhoneOff, RotateCcw, Video, VideoOff } from "lucide-react";
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
  | { kind: "outgoing"; peerName: string; peerAvatar: string | null; peerUsername: string }
  | { kind: "incoming"; peerName: string; peerAvatar: string | null; peerUsername: string }
  | { kind: "incall" }
  | { kind: "ended"; title: string; hint: string; peerId: string | null };

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
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

  const mediaSession = useCallSession(slug, media === "video");
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
        routeStatus(st.call_session?.status ?? null, isCaller ? "caller" : "callee", (st.call_session?.connected_at as string | null) ?? null, peerInfo);
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
      p: { id: string; name: string; username: string; avatar: string | null } = peer
    ) => {
      if (status === "connected") {
        setConnectedAt(at);
        setScreen({ kind: "incall" });
      } else if (status === "ringing" || status === "initiated") {
        setScreen(who === "caller"
          ? { kind: "outgoing", peerName: p.name, peerAvatar: p.avatar, peerUsername: p.username }
          : { kind: "incoming", peerName: p.name, peerAvatar: p.avatar, peerUsername: p.username });
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
          routeStatus(status, role, (st.call_session?.connected_at as string | null) ?? null);
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
      <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center py-10 text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-white/45">Outgoing {media === "video" ? "video" : "voice"} call</p>
        <div className="mt-4"><UserAvatar name={screen.peerName} avatarUrl={screen.peerAvatar} size={96} /></div>
        <h1 className="mt-4 text-2xl font-black">{screen.peerName}</h1>
        <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-white/50">
          <span className="live-dot inline-block h-2 w-2 rounded-full bg-emerald-400" />
          Ringing… {fmtElapsed(ringSecs * 1000)}
        </p>
        {ringSecs >= 45 && <p className="mt-1 text-xs text-amber-200/80">Still ringing — they may be away.</p>}
        <button onClick={() => void doCancel()} disabled={busy} aria-label="Cancel call" className="mt-8 rounded-full bg-red-500 p-5 text-white shadow-lg shadow-red-500/30 transition hover:bg-red-400 active:scale-95 disabled:opacity-40">
          <Phone size={26} className="rotate-[135deg]" />
        </button>
        <p className="mt-2 text-xs font-semibold text-white/50">Cancel</p>
      </div>
    );
  }

  if (screen.kind === "incoming") {
    return (
      <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center py-10 text-center">
        <p className="text-xs font-bold uppercase tracking-widest text-white/45">Incoming {media === "video" ? "video" : "voice"} call</p>
        <div className="mt-4"><UserAvatar name={screen.peerName} avatarUrl={screen.peerAvatar} size={96} /></div>
        <h1 className="mt-4 text-2xl font-black">{screen.peerName}</h1>
        <p className="mt-1 text-sm text-white/50">wants to talk to you</p>
        <div className="mt-8 flex items-center gap-6">
          <span className="flex flex-col items-center gap-1.5">
            <button onClick={() => void doDecline()} disabled={busy} aria-label="Decline" className="rounded-full bg-red-500 p-5 text-white shadow-lg shadow-red-500/30 transition hover:bg-red-400 active:scale-95 disabled:opacity-40">
              <Phone size={26} className="rotate-[135deg]" />
            </button>
            <span className="text-xs font-semibold text-white/50">Decline</span>
          </span>
          <span className="flex flex-col items-center gap-1.5">
            <button onClick={() => void doAccept()} disabled={busy} aria-label="Accept" className="animate-pulse rounded-full bg-emerald-500 p-5 text-white shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400 active:scale-95 disabled:opacity-40">
              <Phone size={26} />
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

  if (session.phase === "error") {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-4xl">🎙️</p>
        <h1 className="mt-3 text-xl font-black">Couldn&apos;t start media</h1>
        <p className="mt-1 text-sm text-white/50">{session.error ?? "Check permissions and try again."}</p>
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={() => void session.join(media === "video")} className="flex items-center gap-1.5 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-white/85">
            <RotateCcw size={15} /> Rejoin
          </button>
          <button onClick={onEnd} className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-bold text-white hover:bg-white/15">End call</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      {/* Hidden remote audio — ALWAYS rendered so voice works even on video calls */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />
      {notice && <p className="mb-3 rounded-xl bg-white/10 px-3 py-2 text-center text-xs font-semibold text-amber-200">{notice}</p>}

      {session.videoMode ? (
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black" style={{ aspectRatio: "3/4" }}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={remoteVideoRef} autoPlay playsInline className="h-full w-full object-cover" />
          {!session.remoteStream && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#15151d]">
              <UserAvatar name={peer.name} avatarUrl={peer.avatar} size={72} />
              <p className="text-sm text-white/50">{session.phase === "joining" ? "Connecting camera…" : "Waiting for video…"}</p>
            </div>
          )}
          {/* Self PiP */}
          <div className="absolute bottom-3 right-3 h-28 w-20 overflow-hidden rounded-2xl border border-white/20 bg-black">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={localVideoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
          </div>
          <div className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-bold text-white">
            {peer.name} · {elapsed}
          </div>
          {session.connection === "failed" && (
            <div className="absolute bottom-3 left-3 rounded-full bg-red-500/80 px-3 py-1 text-xs font-bold text-white">
              Poor connection…
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center rounded-3xl border border-white/10 bg-[#15151d] px-6 py-10 text-center">
          <UserAvatar name={peer.name} avatarUrl={peer.avatar} size={96} />
          <h1 className="mt-4 text-2xl font-black">{peer.name}</h1>
          <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-white/50">
            <span className={`inline-block h-2 w-2 rounded-full ${session.phase === "live" ? "bg-emerald-400 live-dot" : "bg-amber-300"}`} />
            {session.phase === "joining" ? "Connecting…" : elapsed}
          </p>
          {session.connection === "failed" && <p className="mt-1 text-xs font-bold text-red-300">Poor connection…</p>}
        </div>
      )}

      {/* Controls: mute · camera · end (clarity under pressure) */}
      <div className="mt-4 flex items-center justify-center gap-4">
        <span className="flex flex-col items-center gap-1.5">
          <button
            onClick={session.toggleMic}
            aria-label={session.micOn ? "Mute microphone" : "Unmute microphone"}
            className={`rounded-full p-4 transition active:scale-95 ${session.micOn ? "bg-white/10 text-white hover:bg-white/15" : "bg-red-500 text-white hover:bg-red-400"}`}
          >
            {session.micOn ? <Mic size={22} /> : <MicOff size={22} />}
          </button>
          <span className="text-[11px] font-semibold text-white/50">{session.micOn ? "Mute" : "Unmuted"}</span>
        </span>
        <span className="flex flex-col items-center gap-1.5">
          <button
            onClick={() => void session.toggleCam()}
            aria-label={session.camOn ? "Turn camera off" : "Turn camera on"}
            title={session.videoMode ? "Camera on/off" : "Turn on camera (rejoins with video)"}
            className={`rounded-full p-4 transition active:scale-95 ${session.camOn ? "bg-white/10 text-white hover:bg-white/15" : "bg-white/10 text-white/50 hover:bg-white/15"}`}
          >
            {session.camOn ? <Video size={22} /> : <VideoOff size={22} />}
          </button>
          <span className="text-[11px] font-semibold text-white/50">Camera</span>
        </span>
        <span className="flex flex-col items-center gap-1.5">
          <button onClick={onEnd} aria-label="End call" className="rounded-full bg-red-500 p-4 text-white shadow-lg shadow-red-500/30 transition hover:bg-red-400 active:scale-95">
            <PhoneOff size={22} />
          </button>
          <span className="text-[11px] font-semibold text-white/50">End</span>
        </span>
      </div>

      <Link href={`/messages?userId=${encodeURIComponent(peer.id)}`} className="mx-auto mt-4 flex w-fit items-center gap-1.5 rounded-full bg-white/5 px-4 py-2 text-xs font-bold text-white/60 hover:bg-white/10 hover:text-white">
        <MessageCircle size={13} /> Message {peer.name} after
      </Link>
    </div>
  );
}
