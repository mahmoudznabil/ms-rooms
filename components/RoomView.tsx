"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Coins,
  Crown,
  Gift,
  Mic,
  MicOff,
  Plus,
  Send,
  Users,
  Volume2,
} from "lucide-react";
import { GIFT_CATALOG, MOCK_ROOMS, formatCount } from "@/lib/rooms";
import { useCloudflareVoice } from "@/lib/realtime";
import { useWallet } from "@/stores/useWallet";
import { useRoomStore } from "@/stores/useRoomStore";

function RoomViewInner() {
  const searchParams = useSearchParams();
  const slug = searchParams.get("slug") ?? "late-check-in";
  const room = useMemo(
    () => MOCK_ROOMS.find((r) => r.slug === slug) ?? MOCK_ROOMS[0],
    [slug]
  );

  const seats = useRoomStore((s) => s.seats);
  const listeners = useRoomStore((s) => s.listeners);
  const messages = useRoomStore((s) => s.messages);
  const setActiveRoom = useRoomStore((s) => s.setActiveRoom);
  const takeSeat = useRoomStore((s) => s.takeSeat);
  const leaveSeat = useRoomStore((s) => s.leaveSeat);
  const toggleMute = useRoomStore((s) => s.toggleMute);
  const sendMessage = useRoomStore((s) => s.sendMessage);
  const pushGiftMessage = useRoomStore((s) => s.pushGiftMessage);

  // Cloudflare-native voice: Calls SFU + TURN via our Worker, WebRTC in-browser.
  const voice = useCloudflareVoice(slug);

  const coins = useWallet((s) => s.coins);
  const spendCoins = useWallet((s) => s.spendCoins);

  const [draft, setDraft] = useState("");
  const [giftOpen, setGiftOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setActiveRoom(room.slug);
  }, [room.slug, setActiveRoom]);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2200);
    return () => clearTimeout(t);
  }, [notice]);

  const handleSend = () => {
    const text = draft.trim();
    if (!text) return;
    sendMessage("You", text);
    setDraft("");
  };

  const handleGift = (giftId: string) => {
    const gift = GIFT_CATALOG.find((g) => g.id === giftId);
    if (!gift) return;
    if (!spendCoins(gift.cost)) {
      setNotice("Not enough coins — claim your daily reward.");
      return;
    }
    pushGiftMessage("You", `sent ${gift.emoji} ${gift.name} (${gift.cost} coins)`);
    setGiftOpen(false);
    setNotice(`${gift.emoji} ${gift.name} sent!`);
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-[#0d0d12] text-white">
      <header className="sticky top-0 z-10 border-b border-white/5 bg-[#0d0d12]/90 backdrop-blur">
        <div className="flex items-center gap-3 px-4 pb-3 pt-4">
          <Link
            href="/"
            aria-label="Back to lobby"
            className="rounded-full bg-white/5 p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft size={17} />
          </Link>
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl"
            style={{ backgroundColor: room.coverColor }}
          >
            <Volume2 size={20} className="text-white/90" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-extrabold">{room.title}</h1>
            <p className="truncate text-xs text-white/50">
              {room.hostName} · {formatCount(room.listenerCount)} listening
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-xs font-bold text-amber-200">
            <Coins size={13} />
            {coins.toLocaleString()}
          </div>
        </div>
        <div className="px-4 pb-3">
          <p
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              voice.status === "live"
                ? "bg-emerald-400/10 text-emerald-300"
                : voice.status === "denied" || voice.status === "error"
                  ? "bg-red-400/10 text-red-300"
                  : "bg-white/5 text-white/55"
            }`}
          >
            <span
              className={`live-dot h-1.5 w-1.5 rounded-full ${
                voice.status === "live"
                  ? "bg-emerald-400"
                  : voice.status === "denied" || voice.status === "error"
                    ? "bg-red-400"
                    : "bg-white/40"
              }`}
            />
            {voice.status === "live"
              ? "Cloudflare Realtime • live"
              : voice.status === "requesting"
                ? "Connecting mic…"
                : voice.status === "denied" || voice.status === "error"
                  ? (voice.error ?? "Mic unavailable")
                  : voice.micOn
                    ? "Preview mic • on (Calls not configured)"
                    : "Preview mic — configure Calls to go live"}
          </p>
          {voice.micOn && (
            <div
              className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10"
              aria-hidden
            >
              <div
                className="h-full rounded-full bg-emerald-400 transition-[width]"
                style={{ width: `${Math.round(voice.level * 100)}%` }}
              />
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 py-4">
        <section aria-label="Speaker seats">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-widest text-white/50">Speakers · 8 seats</h2>
            <span className="text-xs text-white/40">{seats.filter(Boolean).length}/8 filled</span>
          </div>
          <div className="grid grid-cols-4 gap-2.5">
            {seats.map((seat, i) => (
              <div
                key={i}
                className="flex flex-col items-center rounded-2xl border border-white/8 bg-[#15151d] p-2.5"
              >
                {seat ? (
                  <>
                    <div
                      className="relative flex h-12 w-12 items-center justify-center rounded-full text-sm font-extrabold text-black"
                      style={{ backgroundColor: seat.color }}
                    >
                      {seat.name.slice(0, 1).toUpperCase()}
                      {seat.role === "host" && (
                        <span className="absolute -right-1 -top-1 rounded-full bg-amber-400 p-0.5 text-black">
                          <Crown size={11} />
                        </span>
                      )}
                      <span
                        className={`absolute -bottom-1 -right-1 rounded-full p-1 ${
                          seat.muted ? "bg-red-500 text-white" : "bg-emerald-500 text-black"
                        }`}
                      >
                        {seat.muted ? <MicOff size={10} /> : <Mic size={10} />}
                      </span>
                    </div>
                    <p className="mt-1.5 w-full truncate text-center text-xs font-semibold">{seat.name}</p>
                    {seat.id === "user-you" ? (
                      <div className="mt-1.5 flex gap-1">
                        <button
                          onClick={() => toggleMute(i)}
                          className="rounded-lg bg-white/8 px-2 py-1 text-[11px] font-semibold text-white/70 hover:bg-white/15"
                        >
                          {seat.muted ? "Unmute" : "Mute"}
                        </button>
                        <button
                          onClick={() => leaveSeat(i)}
                          className="rounded-lg bg-white/8 px-2 py-1 text-[11px] font-semibold text-white/70 hover:bg-white/15"
                        >
                          Leave
                        </button>
                      </div>
                    ) : (
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-white/35">{seat.role}</p>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => takeSeat(i)}
                      aria-label={`Take seat ${i + 1}`}
                      className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-white/20 bg-white/5 text-white/50 transition hover:border-white/40 hover:text-white"
                    >
                      <Plus size={18} />
                    </button>
                    <p className="mt-1.5 text-xs text-white/35">Seat {i + 1}</p>
                    <p className="text-[10px] text-white/25">Tap to join</p>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>

        <section aria-label="Listeners">
          <div className="mb-2 flex items-center gap-1.5">
            <Users size={13} className="text-white/50" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-white/50">
              Listeners · {listeners.length}
            </h2>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {listeners.map((name) => (
              <span key={name} className="rounded-full bg-white/6 px-2.5 py-1 text-xs text-white/65">
                {name}
              </span>
            ))}
          </div>
        </section>

        <section aria-label="Live chat" className="overflow-hidden rounded-3xl border border-white/8 bg-[#121218]">
          <div className="border-b border-white/5 px-4 py-2.5 text-xs font-bold uppercase tracking-widest text-white/50">
            Live chat
          </div>
          <div ref={chatRef} className="chat-scroll h-56 space-y-2 overflow-y-auto px-3 py-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`chat-in rounded-2xl px-3 py-2 text-sm ${
                  m.kind === "system"
                    ? "bg-white/5 text-center text-xs text-white/45"
                    : m.kind === "gift"
                      ? "border border-amber-300/20 bg-amber-300/10 text-amber-100"
                      : "bg-white/6 text-white/85"
                }`}
              >
                {m.kind === "chat" || m.kind === "gift" ? (
                  <p>
                    <span className="mr-1.5 font-bold text-white">{m.user}</span>
                    <span>{m.text}</span>
                  </p>
                ) : (
                  <p>{m.text}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="sticky bottom-0 z-10 border-t border-white/5 bg-[#0d0d12]/95 px-3 pb-4 pt-2 backdrop-blur">
        {notice && (
          <p className="mx-1 mb-2 rounded-xl bg-white/8 px-3 py-2 text-center text-xs font-semibold text-amber-200">
            {notice}
          </p>
        )}
        {giftOpen && (
          <div className="mx-1 mb-2 grid grid-cols-4 gap-2 rounded-2xl border border-white/10 bg-[#17171f] p-2.5">
            {GIFT_CATALOG.map((g) => (
              <button
                key={g.id}
                onClick={() => handleGift(g.id)}
                className="flex flex-col items-center rounded-xl bg-white/5 px-1 py-2 transition hover:bg-white/10 active:scale-95"
              >
                <span className="text-xl">{g.emoji}</span>
                <span className="mt-0.5 text-[11px] font-semibold">{g.name}</span>
                <span className="flex items-center gap-0.5 text-[10px] text-amber-200">
                  <Coins size={10} />
                  {g.cost}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={() => void voice.toggleMic()}
            aria-label={voice.micOn ? "Mute microphone" : "Unmute microphone"}
            className={`rounded-2xl p-3 transition active:scale-95 ${
              voice.micOn ? "bg-emerald-400 text-black" : "bg-white/8 text-white/70 hover:bg-white/12"
            }`}
          >
            {voice.micOn ? <Mic size={17} /> : <MicOff size={17} />}
          </button>
          <button
            onClick={() => setGiftOpen((v) => !v)}
            aria-label="Send a gift"
            className={`rounded-2xl p-3 transition active:scale-95 ${
              giftOpen ? "bg-amber-400 text-black" : "bg-white/8 text-amber-200 hover:bg-white/12"
            }`}
          >
            <Gift size={17} />
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
            placeholder="Say something kind…"
            maxLength={240}
            className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-white/6 px-3.5 py-3 text-sm text-white placeholder:text-white/30 focus:border-white/25 focus:outline-none"
          />
          <button
            onClick={handleSend}
            aria-label="Send chat message"
            className="rounded-2xl bg-white p-3 text-black transition hover:bg-white/85 active:scale-95"
          >
            <Send size={17} />
          </button>
        </div>
      </footer>
    </div>
  );
}

export default function RoomView() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center bg-[#0d0d12] text-sm text-white/50">
          Loading room…
        </div>
      }
    >
      <RoomViewInner />
    </Suspense>
  );
}
