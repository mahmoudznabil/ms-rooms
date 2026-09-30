"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Coins,
  Crown,
  Dices,
  Flag,
  Gift,
  Mic,
  MicOff,
  MessageCircle,
  Phone,
  Plus,
  Send,
  Settings2,
  Swords,
  UserPlus,
  UserCheck,
  Users,
  Volume2,
} from "lucide-react";
import { GIFT_CATALOG, formatCount } from "@/lib/rooms";
import {
  ApiError,
  endRoom,
  fetchRoomDetail,
  fetchSeats,
  follow,
  giftCatalog,
  leaveSeat,
  muteSeat,
  reportUser,
  sendGift,
  takeSeat,
  unfollow,
  fetchSocial,
  awardXp,
  type ApiRoomRow,
  type ApiSeat,
  type GiftCatalogItem,
} from "@/lib/api";
import { ENTRY_EFFECT_LEVEL, levelForXp } from "@/lib/levels";
import { useCloudflareVoice } from "@/lib/realtime";
import { useSession } from "@/stores/useSession";
import { Modal, Spinner, UserAvatar, LevelBadge, EmptyState, Field, inputCls, PrimaryButton } from "@/components/bits";
import SpinModal from "@/components/SpinModal";
import PKBattleBar from "@/components/PKBattleBar";
import MiniGamePanel from "@/components/MiniGamePanel";
import ChatPanel from "@/components/ChatPanel";

interface ChatMsg {
  id: string;
  userId?: string;
  user: string;
  text: string;
  kind: "chat" | "gift" | "system";
}

interface Fx {
  id: number;
  emoji: string;
  name: string;
  from: string;
  effect: string;
}

function seatAt(seats: ApiSeat[], index: number): ApiSeat | undefined {
  return seats.find((s) => s.seat_index === index && s.user_id);
}

function RoomViewInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const slug = searchParams.get("slug") ?? "";
  const user = useSession((s) => s.user);
  const refreshSession = useSession((s) => s.refresh);

  const [room, setRoom] = useState<ApiRoomRow | null>(null);
  const [seats, setSeats] = useState<ApiSeat[]>([]);
  const [missing, setMissing] = useState(false);
  const [loadingRoom, setLoadingRoom] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<GiftCatalogItem[]>([]);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [giftOpen, setGiftOpen] = useState(false);
  const [fx, setFx] = useState<Fx | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [spinOpen, setSpinOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string } | null>(null);
  const [followingHost, setFollowingHost] = useState(false);
  const [rush, setRush] = useState<{ endsAt: number; score: number } | null>(null);
  const [rushLeft, setRushLeft] = useState(0);
  const [pk, setPk] = useState<{ endsAt: number; scoreA: number; scoreB: number; opponent: string } | null>(null);
  const [pkWinner, setPkWinner] = useState<string | null>(null);
  const [incomingCall, setIncomingCall] = useState<{ roomId: string; callerName: string; callerAvatar?: string; pricePerMinute: number } | null>(null);
  const [callState, setCallState] = useState<"idle" | "ringing" | "connecting" | "connected" | "ended">("idle");
  const [showChat, setShowChat] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const fxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const voice = useCloudflareVoice(slug);
  const isHost = !!user && !!room && room.host_user_id === user.id;
  const mySeat = useMemo(
    () => (user ? seats.find((s) => s.user_id === user.id) : undefined),
    [seats, user]
  );

  const pushMsg = useCallback((m: Omit<ChatMsg, "id">) => {
    setMessages((prev) => [...prev.slice(-79), { ...m, id: `${Date.now()}-${Math.random().toString(36).slice(2)}` }]);
  }, []);

  const reloadSeats = useCallback(async () => {
    if (!slug) return;
    try {
      const r = await fetchSeats(slug);
      setSeats(r.seats);
    } catch {
      // Poll failures are silent; the last state stays on screen.
    }
  }, [slug]);

  // Initial load: room detail + gift catalog + follow state.
  useEffect(() => {
    if (!slug) {
      setLoadingRoom(false);
      return;
    }
    if (!user) {
      setLoadingRoom(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingRoom(true);
      setMissing(false);
      setLoadError(null);
      try {
        const detail = await fetchRoomDetail(slug);
        if (cancelled) return;
        setRoom(detail.room);
        setSeats(detail.seats);
        pushMsg({ user: "System", text: `Welcome to ${detail.room.title}. Be kind, mind mic etiquette.`, kind: "system" });
        
        // Check for incoming private call
        if (detail.room.is_private && detail.room.call_participant_user_id === user.id && detail.room.status === 'live') {
          const caller = detail.seats.find(s => s.seat_index === 0 && s.user_id);
          if (caller) {
            setIncomingCall({
              roomId: detail.room.id,
              callerName: caller.display_name ?? 'Unknown',
              callerAvatar: caller.avatar_url,
              pricePerMinute: detail.room.call_price_per_minute || 10,
            });
          }
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setMissing(true);
        } else if (e instanceof ApiError) {
          setLoadError(e.message);
          pushMsg({ user: "System", text: "Could not load this room. Check your connection.", kind: "system" });
        } else {
          setLoadError("Could not load this room. Check your connection.");
          pushMsg({ user: "System", text: "Could not load this room. Check your connection.", kind: "system" });
        }
      } finally {
        if (!cancelled) setLoadingRoom(false);
      }
      try {
        const cat = await giftCatalog();
        if (!cancelled && cat.gifts.length > 0) setCatalog(cat.gifts);
      } catch {
        if (!cancelled) {
          setCatalog(GIFT_CATALOG.map((g) => ({ ...g, effect: g.cost >= 250 ? "fullscreen" : g.cost >= 60 ? "banner" : "pop" } as GiftCatalogItem)));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, user, pushMsg]);

  // Follow state for the host.
  useEffect(() => {
    if (!room?.host_user_id || !user) return;
    fetchSocial(room.host_user_id, user.id)
      .then((s) => setFollowingHost(s.followed_by_viewer))
      .catch(() => undefined);
  }, [room?.host_user_id, user]);

  // Seat polling.
  useEffect(() => {
    if (!slug || !user) return;
    const t = setInterval(() => void reloadSeats(), 5000);
    return () => clearInterval(t);
  }, [slug, user, reloadSeats]);

  // Chat autoscroll + notice timeout + rush countdown.
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2400);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!rush) return;
    const t = setInterval(() => {
      const left = Math.max(0, Math.ceil((rush.endsAt - Date.now()) / 1000));
      setRushLeft(left);
      if (left <= 0) {
        clearInterval(t);
        const score = rush.score;
        setRush(null);
        const bonus = Math.min(50, Math.floor(score / 10));
        pushMsg({ user: "System", text: `Gift Rush over — you scored ${score}! ${bonus > 0 ? `+${bonus} XP earned.` : "Send gifts next time to earn XP."}`, kind: "system" });
        if (user && bonus > 0) {
          awardXp(user.id, bonus, "Gift Rush").then(() => void refreshSession()).catch(() => undefined);
        }
      }
    }, 500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rush !== null]);

  useEffect(() => {
    return () => {
      if (fxTimer.current) clearTimeout(fxTimer.current);
    };
  }, []);

  // Poll for incoming call status changes
  useEffect(() => {
    if (!slug || !user || !room) return;
    let cancelled = false;
    
    const pollCallStatus = () => {
      if (!room?.is_private) return;
      fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://bestaudiobackend.mahmoudnabil03.workers.dev"}/api/rooms/private-call/status?room_id=${room.id}`, {
        credentials: "include",
      })
        .then((res) => res.json())
        .then((data) => {
          if (cancelled) return;
          if (data.ok && data.call_session) {
            const callSession = data.call_session;
            if (callSession.status === 'ringing' && room.call_participant_user_id === user.id) {
              const caller = data.caller;
              if (caller && !incomingCall) {
                setIncomingCall({
                  roomId: room.id,
                  callerName: caller.display_name ?? 'Unknown',
                  callerAvatar: caller.avatar_url,
                  pricePerMinute: room.call_price_per_minute || 10,
                });
              }
            } else if (callSession.status === 'connected') {
              setCallState('connected');
              setIncomingCall(null);
            } else if (callSession.status === 'rejected' || callSession.status === 'ended') {
              setCallState('ended');
              setIncomingCall(null);
              setNotice(callSession.status === 'rejected' ? "Call was rejected" : "Call ended");
            }
          }
        })
        .catch(() => {
          // Silently ignore polling errors
        });
    };
    
    const interval = setInterval(pollCallStatus, 3000);
    pollCallStatus(); // Initial check
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [slug, room, user]);

  // Handle incoming call acceptance
  const acceptCall = async () => {
    if (!incomingCall || !room) return;
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://bestaudiobackend.mahmoudnabil03.workers.dev"}/api/rooms/private-call/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: incomingCall.roomId }),
        credentials: "include",
      });
      const data = await res.json();
      if (data.ok) {
        setIncomingCall(null);
        setCallState('connected');
        router.push(`/call?room=${room.slug}`);
      } else {
        alert(data.error || "Failed to accept call");
      }
    } catch (e) {
      alert("Failed to accept call");
    }
  };

  const rejectCall = async () => {
    if (!incomingCall) return;
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://bestaudiobackend.mahmoudnabil03.workers.dev"}/api/rooms/private-call/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: incomingCall.roomId }),
        credentials: "include",
      });
      const data = await res.json();
      if (data.ok) {
        setIncomingCall(null);
        setCallState('ended');
        setNotice("Call rejected");
      } else {
        alert(data.error || "Failed to reject call");
      }
    } catch (e) {
      alert("Failed to reject call");
    }
  };

  const endCall = async () => {
    if (!room) return;
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://bestaudiobackend.mahmoudnabil03.workers.dev"}/api/rooms/private-call/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: room.id }),
        credentials: "include",
      });
      const data = await res.json();
      if (data.ok) {
        setCallState('ended');
        router.push("/calls");
      } else {
        alert(data.error || "Failed to end call");
      }
    } catch (e) {
      alert("Failed to end call");
    }
  };

  if (!slug) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-4xl">🔗</p>
        <h1 className="mt-3 text-xl font-black">Invalid room link</h1>
        <p className="mt-1 text-sm text-white/50">This link is missing a room. Browse live rooms instead.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/lobby" className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-white/85">Back to lobby</Link>
          <Link href="/create" className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-bold text-white hover:bg-white/15">Create a room</Link>
        </div>
      </div>
    );
  }
  if (!user) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-4xl">🎙️</p>
        <h1 className="mt-3 text-xl font-black">Sign in to join the room</h1>
        <p className="mt-1 text-sm text-white/50">Voice rooms need an account so your coins, gifts and XP follow you.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/login" className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-white/85">Sign up / Log in</Link>
          <Link href="/lobby" className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-bold text-white hover:bg-white/15">Browse rooms</Link>
        </div>
      </div>
    );
  }
  if (loadingRoom) return <Spinner />;
  if (missing || loadError) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <p className="text-4xl">{missing ? "👻" : "📡"}</p>
        <h1 className="mt-3 text-xl font-black">{missing ? "Room not found" : "Couldn't load this room"}</h1>
        <p className="mt-1 text-sm text-white/50">
          {missing
            ? `No live room matches “${slug}”. It may have ended or the link is wrong.`
            : (loadError ?? "Check your connection and try again.")}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Link href="/lobby" className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black hover:bg-white/85">Back to lobby</Link>
          <button
            onClick={() => {
              setLoadingRoom(true);
              setMissing(false);
              setLoadError(null);
              fetchRoomDetail(slug)
                .then((detail) => {
                  setRoom(detail.room);
                  setSeats(detail.seats);
                  setLoadingRoom(false);
                })
                .catch((e) => {
                  if (e instanceof ApiError && e.status === 404) setMissing(true);
                  else setLoadError(e instanceof Error ? e.message : "Could not load this room.");
                  setLoadingRoom(false);
                });
            }}
            className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-bold text-white hover:bg-white/15"
          >
            Try again
          </button>
          <Link href="/create" className="rounded-full bg-white/10 px-5 py-2.5 text-sm font-bold text-white hover:bg-white/15">Create a room</Link>
        </div>
      </div>
    );
  }
  if (!room) return <Spinner />;

  const showFx = (emoji: string, name: string, from: string, effect: string) => {
    if (fxTimer.current) clearTimeout(fxTimer.current);
    const id = Date.now();
    if (effect === "pop") {
      pushMsg({ user: from, text: `sent ${emoji} ${name}`, kind: "gift" });
      return;
    }
    setFx({ id, emoji, name, from, effect });
    pushMsg({ user: from, text: `sent ${emoji} ${name}`, kind: "gift" });
    fxTimer.current = setTimeout(() => setFx(null), effect === "fullscreen" ? 2600 : 3200);
  };

  const handleSeat = async (index: number) => {
    try {
      await takeSeat(slug, index, user.id);
      await reloadSeats();
      pushMsg({ user: "System", text: `You took seat ${index + 1}. Say hi!`, kind: "system" });
      awardXp(user.id, 5, "Took the mic").then(() => void refreshSession()).catch(() => undefined);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not take that seat.");
    }
  };

  const handleLeave = async () => {
    if (!mySeat) return;
    try {
      await leaveSeat(slug, mySeat.seat_index);
      await reloadSeats();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not leave the seat.");
    }
  };

  const handleMuteToggle = async (index: number, currentlyMuted: boolean) => {
    try {
      await muteSeat(slug, index, !currentlyMuted);
      await reloadSeats();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not change mic state.");
    }
  };

  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;
    pushMsg({ userId: user.id, user: user.display_name, text, kind: "chat" });
    setDraft("");
  };

  const handleGift = async (giftId: string) => {
    const gift = catalog.find((g) => g.id === giftId);
    if (!gift || !room) return;
    if (user.coins < gift.cost) {
      setNotice("Not enough coins — top up in Wallet or spin for luck.");
      return;
    }
    try {
      const r = await sendGift({ from_user_id: user.id, room_id: room.id, gift_id: gift.id, cost: gift.cost });
      await refreshSession();
      if (rush) setRush({ ...rush, score: rush.score + gift.cost });
      if (pk) setPk({ ...pk, scoreA: pk.scoreA + gift.cost, scoreB: pk.scoreB + Math.floor(Math.random() * 20) });
      showFx(gift.emoji, gift.name, user.display_name, gift.effect);
      setGiftOpen(false);
      if (r.coins < 20) setNotice("Running low on coins — daily check-in refills you.");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Gift failed. Try again.");
    }
  };

  const toggleFollowHost = async () => {
    if (!room.host_user_id) return;
    try {
      if (followingHost) {
        await unfollow(user.id, room.host_user_id);
        setFollowingHost(false);
      } else {
        await follow(user.id, room.host_user_id);
        setFollowingHost(true);
        pushMsg({ user: "System", text: `You followed ${room.host_name}.`, kind: "system" });
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Follow failed. Try again.");
    }
  };

  const startRush = () => {
    if (rush) return;
    setRush({ endsAt: Date.now() + 60000, score: 0 });
    setRushLeft(60);
    pushMsg({ user: "System", text: "Gift Rush started! Every gift you send for 60s scores coins toward bonus XP.", kind: "system" });
  };

  const startPK = () => {
    if (pk) return;
    const opponents = ["Night Owl Radio", "Tiny Joys Club", "Behind the Beat"];
    const opp = opponents[Math.floor(Math.random() * opponents.length)];
    setPk({ endsAt: Date.now() + 120000, scoreA: 0, scoreB: 0, opponent: opp });
    setPkWinner(null);
    pushMsg({ user: "System", text: `⚔️ PK Battle started: ${room?.title ?? "Your room"} vs ${opp} — 2 minutes! Send gifts to win.`, kind: "system" });
  };

  const entryFx = levelForXp(user.xp) >= ENTRY_EFFECT_LEVEL;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/" aria-label="Back to lobby" className="rounded-full bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white">
          <ArrowLeft size={17} />
        </Link>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ backgroundColor: room.cover_color }}>
          <Volume2 size={20} className="text-white/90" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-extrabold">{room.title}</h1>
          <p className="truncate text-xs text-white/50">{room.host_name} · {formatCount(room.listener_count)} listening</p>
        </div>
        {isHost && (
          <button onClick={() => setManageOpen(true)} aria-label="Manage room" className="rounded-full bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white">
            <Settings2 size={16} />
          </button>
        )}
        <button onClick={() => setShowChat(true)} aria-label="Open messages" className="rounded-full bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white">
          <MessageCircle size={16} />
        </button>
        <Link href="/wallet" className="flex items-center gap-1 rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-xs font-bold text-amber-200">
          <Coins size={13} /> {user.coins.toLocaleString()}
        </Link>
      </div>

      <p className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
        voice.status === "live" ? "bg-emerald-400/10 text-emerald-300"
        : voice.status === "denied" || voice.status === "error" ? "bg-red-400/10 text-red-300"
        : "bg-white/5 text-white/55"}`}>
        <span className={`live-dot h-1.5 w-1.5 rounded-full ${voice.status === "live" ? "bg-emerald-400" : voice.status === "denied" || voice.status === "error" ? "bg-red-400" : "bg-white/40"}`} />
        {voice.status === "live" ? "Cloudflare Realtime • live"
          : voice.status === "requesting" ? "Connecting mic…"
          : voice.status === "denied" || voice.status === "error" ? (voice.error ?? "Mic unavailable")
          : voice.micOn ? "Preview mic • on" : "Tap the mic to talk"}
      </p>

      {entryFx && (
        <div className="entry-banner mt-2 rounded-2xl px-3 py-2 text-center text-sm font-extrabold">
          ✨ {user.display_name} <LevelBadge xp={user.xp} /> entered the room
        </div>
      )}

      {rush ? (
        <div className="mt-2 rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-2">
          <div className="flex items-center justify-between text-sm font-extrabold">
            <span className="flex items-center gap-1.5 text-fuchsia-200"><Swords size={15} /> Gift Rush</span>
            <span className="text-fuchsia-100">{rushLeft}s · {rush.score} pts</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="pk-bar h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-amber-400" style={{ width: `${(rushLeft / 60) * 100}%` }} />
          </div>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <button onClick={startRush} className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/10 py-2 text-xs font-bold text-fuchsia-200 transition hover:bg-fuchsia-500/20">
            <Swords size={14} /> Start 60s Gift Rush
          </button>
          <button onClick={() => setSpinOpen(true)} className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-amber-300/25 bg-amber-300/10 py-2 text-xs font-bold text-amber-200 transition hover:bg-amber-300/20">
            <Dices size={14} /> Lucky Spin
          </button>
        </div>
      )}

      {/* Feature 4.2: Room-to-Room PK Battle */}
      {pk ? (
        <div className="mt-2">
          <PKBattleBar
            roomA={{ name: room.title, score: pk.scoreA }}
            roomB={{ name: pk.opponent, score: pk.scoreB }}
            endsAt={pk.endsAt}
            onEnd={(winner) => {
              const msg = winner === "A" ? `🏆 ${room.title} won the PK! +50 XP` : winner === "B" ? `🏆 ${pk.opponent} won — good fight!` : "🤝 Draw! Both rooms fought well.";
              pushMsg({ user: "System", text: msg, kind: "system" });
              setPkWinner(winner);
              if (winner === "A") awardXp(user.id, 50, "PK Victory", room.id).then(() => void refreshSession()).catch(() => undefined);
              setTimeout(() => setPk(null), 8000);
            }}
          />
          {pkWinner && <p className="mt-1 text-center text-xs font-bold text-amber-200">Winner: {pkWinner === "A" ? room.title : pkWinner === "B" ? pk.opponent : "Draw"}</p>}
        </div>
      ) : (
        <button onClick={startPK} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-2xl border border-amber-300/20 bg-gradient-to-r from-violet-500/10 to-amber-500/10 py-2.5 text-xs font-bold text-amber-200 transition hover:opacity-90">
          <Swords size={14} /> Challenge PK Battle (2:00)
        </button>
      )}

      {/* Feature 4.1: Embedded HTML5 Casual Games */}
      <div className="mt-3">
        <MiniGamePanel roomId={room.id} />
      </div>

      {/* Seats */}
      <section aria-label="Speaker seats" className="mt-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-widest text-white/50">Speakers · 8 seats</h2>
          <span className="text-xs text-white/40">{seats.filter((s) => s.user_id).length}/8 on mic</span>
        </div>
        <div className="grid grid-cols-4 gap-2.5">
          {Array.from({ length: 8 }, (_, i) => {
            const seat = seatAt(seats, i);
            if (!seat) {
              return (
                <div key={i} className="flex flex-col items-center rounded-2xl border border-white/10 bg-[#15151d] p-2.5">
                  <button onClick={() => void handleSeat(i)} aria-label={`Take seat ${i + 1}`}
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-white/20 bg-white/5 text-white/50 transition hover:border-violet-400/60 hover:text-white">
                    <Plus size={18} />
                  </button>
                  <p className="mt-1.5 text-xs text-white/35">Seat {i + 1}</p>
                  <p className="text-[10px] text-white/25">Tap to join</p>
                </div>
              );
            }
            const mine = seat.user_id === user.id;
            const muted = seat.is_muted === 1;
            return (
              <div key={i} className="flex flex-col items-center rounded-2xl border border-white/10 bg-[#15151d] p-2.5">
                <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-sm font-extrabold">
                  {(seat.display_name ?? "?").slice(0, 1).toUpperCase()}
                  {seat.role === "host" && (
                    <span className="absolute -right-1 -top-1 rounded-full bg-amber-400 p-0.5 text-black"><Crown size={11} /></span>
                  )}
                  <span className={`absolute -bottom-1 -right-1 rounded-full p-1 ${muted ? "bg-red-500 text-white" : "bg-emerald-500 text-black"}`}>
                    {muted ? <MicOff size={10} /> : <Mic size={10} />}
                  </span>
                </div>
                <p className="mt-1.5 w-full truncate text-center text-xs font-semibold">{mine ? "You" : (seat.display_name ?? "Guest")}</p>
                {mine ? (
                  <div className="mt-1.5 flex gap-1">
                    <button onClick={() => void handleMuteToggle(i, muted)} className="rounded-lg bg-white/10 px-2 py-1 text-[11px] font-semibold text-white/70 hover:bg-white/15">
                      {muted ? "Unmute" : "Mute"}
                    </button>
                    <button onClick={() => void handleLeave()} className="rounded-lg bg-white/10 px-2 py-1 text-[11px] font-semibold text-white/70 hover:bg-white/15">
                      Leave
                    </button>
                  </div>
                ) : isHost ? (
                  <button onClick={() => void handleMuteToggle(i, muted)} className="mt-1.5 rounded-lg bg-white/10 px-2 py-1 text-[11px] font-semibold text-white/70 hover:bg-white/15">
                    {muted ? "Unmute" : "Mute"}
                  </button>
                ) : (
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-white/35">{seat.role}</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Host row */}
      <div className="mt-3 flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <UserAvatar name={room.host_name} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{room.host_name}</p>
          <p className="truncate text-xs text-white/45">{room.description || room.category}</p>
        </div>
        {!isHost && room.host_user_id && (
          <div className="flex items-center gap-2">
            <button onClick={() => void toggleFollowHost()}
              className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition ${followingHost ? "bg-white/10 text-white/70" : "bg-white text-black"}`}>
              {followingHost ? <UserCheck size={13} /> : <UserPlus size={13} />}
              {followingHost ? "Following" : "Follow"}
            </button>
            <button
              onClick={async () => {
                if (!user) return;
                try {
                  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://bestaudiobackend.mahmoudnabil03.workers.dev"}/api/rooms/private-call`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      caller_user_id: user.id,
                      callee_user_id: room.host_user_id,
                      call_price_per_minute: room.call_price_per_minute || 10,
                    }),
                    credentials: "include",
                  });
                  const data = await res.json();
                  if (data.ok && data.room) {
                    router.push(`/call?room=${data.room.slug}`);
                  } else {
                    alert(data.error || "Failed to start call");
                  }
                } catch (e) {
                  alert("Failed to start call");
                }
              }}
              disabled={!user}
              className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition ${user ? "bg-violet-500 text-black hover:opacity-90" : "bg-white/5 text-white/40 cursor-not-allowed"}`}
            >
              <Phone size={13} /> Call
            </button>
          </div>
        )}
      </div>

      {/* Chat */}
      <section aria-label="Live chat" className="mt-3 overflow-hidden rounded-3xl border border-white/10 bg-[#121218]">
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
          <span className="text-xs font-bold uppercase tracking-widest text-white/50">Live chat</span>
          <span className="flex items-center gap-1 text-xs text-white/40"><Users size={12} /> {formatCount(room.listener_count)}</span>
        </div>
        <div ref={chatRef} className="chat-scroll h-56 space-y-2 overflow-y-auto px-3 py-3">
          {messages.map((m) => (
            <div key={m.id} className={`chat-in rounded-2xl px-3 py-2 text-sm ${
              m.kind === "system" ? "bg-white/5 text-center text-xs text-white/45"
              : m.kind === "gift" ? "border border-amber-300/20 bg-amber-300/10 text-amber-100"
              : "bg-white/[0.06] text-white/85"}`}>
              {m.kind === "chat" ? (
                <p>
                  <span className="mr-1.5 font-bold text-white">{m.user}</span>
                  <span>{m.text}</span>
                  {m.userId && m.userId !== user.id && (
                    <button onClick={() => setReportTarget({ id: m.userId as string, name: m.user })}
                      aria-label={`Report ${m.user}`}
                      className="ml-2 align-middle text-white/25 transition hover:text-red-300">
                      <Flag size={11} />
                    </button>
                  )}
                </p>
              ) : (
                <p>{m.kind === "gift" ? <><span className="mr-1.5 font-bold text-white">{m.user}</span><span>{m.text}</span></> : m.text}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Controls */}
      <div className="sticky bottom-16 z-10 mt-3 rounded-3xl border border-white/10 bg-[#0d0d12]/95 p-2.5 backdrop-blur md:bottom-0">
        {notice && <p className="mx-1 mb-2 rounded-xl bg-white/10 px-3 py-2 text-center text-xs font-semibold text-amber-200">{notice}</p>}
        {giftOpen && (
          <div className="mx-1 mb-2 grid grid-cols-4 gap-2 rounded-2xl border border-white/10 bg-[#17171f] p-2.5">
            {catalog.map((g) => (
              <button key={g.id} onClick={() => void handleGift(g.id)}
                disabled={user.coins < g.cost}
                className="flex flex-col items-center rounded-xl bg-white/5 px-1 py-2 transition hover:bg-white/10 active:scale-95 disabled:opacity-35">
                <span className="text-xl">{g.emoji}</span>
                <span className="mt-0.5 text-[11px] font-semibold">{g.name}</span>
                <span className="flex items-center gap-0.5 text-[10px] text-amber-200"><Coins size={10} />{g.cost}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button onClick={() => void voice.toggleMic()} aria-label={voice.micOn ? "Mute microphone" : "Unmute microphone"}
            className={`rounded-2xl p-3 transition active:scale-95 ${voice.micOn ? "bg-emerald-400 text-black" : "bg-white/10 text-white/70 hover:bg-white/15"}`}>
            {voice.micOn ? <Mic size={17} /> : <MicOff size={17} />}
          </button>
          <button onClick={() => setGiftOpen((v) => !v)} aria-label="Send a gift"
            className={`rounded-2xl p-3 transition active:scale-95 ${giftOpen ? "bg-amber-400 text-black" : "bg-white/10 text-amber-200 hover:bg-white/15"}`}>
            <Gift size={17} />
          </button>
          <input value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
            placeholder="Say something kind…" maxLength={240}
            className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/[0.06] px-3.5 py-3 text-sm text-white placeholder:text-white/30 focus:border-white/25 focus:outline-none" />
          <button onClick={handleSend} aria-label="Send chat message" className="rounded-2xl bg-white p-3 text-black transition hover:bg-white/85 active:scale-95">
            <Send size={17} />
          </button>
        </div>
      </div>

      {/* Gift effect overlays */}
      {fx?.effect === "fullscreen" && (
        <div key={fx.id} className="gift-overlay">
          <div className="text-center">
            <div className="gift-overlay-emoji">{fx.emoji}</div>
            <p className="mt-2 text-lg font-black text-white">{fx.from} sent {fx.name}!</p>
          </div>
        </div>
      )}
      {fx?.effect === "banner" && (
        <div key={fx.id} className="gift-banner fixed left-1/2 top-20 z-50 -translate-x-1/2 rounded-2xl border border-amber-300/30 bg-[#17171f]/95 px-5 py-3 text-center shadow-2xl">
          <p className="text-2xl">{fx.emoji}</p>
          <p className="text-sm font-bold text-amber-200">{fx.from} sent {fx.name}</p>
        </div>
      )}

      {spinOpen && <SpinModal onClose={() => setSpinOpen(false)} />}
      {showChat && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setShowChat(false)}>
          <div className="h-[82dvh] w-full overflow-hidden rounded-t-3xl border border-white/10 bg-[#0d0d12] sm:h-[640px] sm:max-w-md sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
            <ChatPanel onClose={() => setShowChat(false)} />
          </div>
        </div>
      )}
      {manageOpen && isHost && (
        <ManageRoomModal slug={slug} title={room.title} description={room.description}
          onClose={() => setManageOpen(false)}
          onSaved={(t) => { setRoom({ ...room, title: t.title, description: t.description }); setManageOpen(false); }}
          onEnded={() => router.push("/")} />
      )}
      {reportTarget && (
        <ReportModal userId={reportTarget.id} name={reportTarget.name} roomId={room.id} onClose={() => setReportTarget(null)}
          onSent={() => { setReportTarget(null); setNotice("Thanks — our team will review this report."); }} />
      )}
      {/* Incoming Call Modal */}
      {incomingCall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="modal-pop w-full max-w-md rounded-3xl border border-white/10 bg-[#17171f] p-6 shadow-2xl">
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500">
                {incomingCall.callerAvatar ? (
                  <img src={incomingCall.callerAvatar} alt={incomingCall.callerName} className="h-full w-full rounded-full object-cover" />
                ) : (
                  <span className="text-3xl font-bold text-white">{incomingCall.callerName?.slice(0,1).toUpperCase()}</span>
                )}
              </div>
              <div className="text-center">
                <h3 className="text-lg font-bold text-white">Incoming Call</h3>
                <p className="text-white/70">{incomingCall.callerName} is calling you</p>
                <p className="text-sm text-white/50">{incomingCall.pricePerMinute} coins/min</p>
              </div>
              <div className="flex gap-3 w-full">
                <button
                  onClick={rejectCall}
                  className="flex-1 rounded-2xl border border-red-400/30 bg-red-500/10 py-3 text-sm font-bold text-red-300 transition hover:bg-red-500/20"
                >
                  Decline
                </button>
                <button
                  onClick={acceptCall}
                  className="flex-1 rounded-2xl bg-green-500 py-3 text-sm font-bold text-black transition hover:bg-green-400"
                >
                  Accept
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ManageRoomModal({ slug, title, description, onClose, onSaved, onEnded }: {
  slug: string; title: string; description: string; onClose: () => void;
  onSaved: (t: { title: string; description: string }) => void; onEnded: () => void;
}) {
  const user = useSession((s) => s.user);
  const [t, setT] = useState(title);
  const [d, setD] = useState(description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { updateRoom } = await import("@/lib/api");
      const r = await updateRoom(slug, user.id, { title: t.trim(), description: d.trim() });
      onSaved({ title: (r.room as ApiRoomRow).title, description: (r.room as ApiRoomRow).description });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    if (!user || busy) return;
    if (!window.confirm("End this room for everyone?")) return;
    setBusy(true);
    try {
      await endRoom(slug, user.id);
      onEnded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not end the room.");
      setBusy(false);
    }
  };

  return (
    <Modal title="Manage room" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Room title">
          <input value={t} onChange={(e) => setT(e.target.value)} maxLength={40} className={inputCls} />
        </Field>
        <Field label="Description">
          <input value={d} onChange={(e) => setD(e.target.value)} maxLength={200} className={inputCls} />
        </Field>
        {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">{error}</p>}
        <PrimaryButton onClick={() => void save()} disabled={busy || t.trim().length < 2}>
          {busy ? "Saving…" : "Save changes"}
        </PrimaryButton>
        <button onClick={() => void end()} disabled={busy}
          className="w-full rounded-2xl border border-red-400/30 bg-red-500/10 py-3 text-sm font-bold text-red-300 transition hover:bg-red-500/20 disabled:opacity-40">
          End room for everyone
        </button>
      </div>
    </Modal>
  );
}

function ReportModal({ userId, name, roomId, onClose, onSent }: {
  userId: string; name: string; roomId: string; onClose: () => void; onSent: () => void;
}) {
  const me = useSession((s) => s.user);
  const [reason, setReason] = useState("Harassment or bullying");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const REASONS = ["Harassment or bullying", "Spam or scams", "Inappropriate content", "Hate speech", "Other"];

  const send = async () => {
    if (!me || busy) return;
    setBusy(true);
    setError(null);
    try {
      await reportUser({ reporter_id: me.id, target_id: userId, reason, room_id: roomId });
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Report failed. Try again.");
      setBusy(false);
    }
  };

  return (
    <Modal title={`Report ${name}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="What's wrong?">
          <div className="space-y-1.5">
            {REASONS.map((r) => (
              <button key={r} onClick={() => setReason(r)}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm font-semibold transition ${reason === r ? "bg-white text-black" : "bg-white/5 text-white/70 hover:bg-white/10"}`}>
                {r}
              </button>
            ))}
          </div>
        </Field>
        {error && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">{error}</p>}
        <PrimaryButton onClick={() => void send()} disabled={busy}>{busy ? "Sending…" : "Submit report"}</PrimaryButton>
      </div>
    </Modal>
  );
}

export default function RoomView() {
  return (
    <Suspense fallback={<Spinner />}>
      <RoomViewInner />
    </Suspense>
  );
}
