"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Coins, Users, Mic, Compass, Home, Search } from "lucide-react";
import { MOCK_ROOMS, formatCount, type LobbyRoom } from "@/lib/rooms";
import { fetchRooms } from "@/lib/api";
import { useWallet } from "@/stores/useWallet";
import { useRoomStore } from "@/stores/useRoomStore";
import DailyRewardModal from "@/components/DailyRewardModal";

const TABS = [
  { id: "home", label: "Home", icon: Home },
  { id: "discover", label: "Discover", icon: Compass },
  { id: "search", label: "Search", icon: Search },
] as const;

export default function LobbyView() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("home");
  const [liveRooms, setLiveRooms] = useState<LobbyRoom[] | null>(null);
  const coins = useWallet((s) => s.coins);
  const setActiveRoom = useRoomStore((s) => s.setActiveRoom);

  useEffect(() => {
    let cancelled = false;
    fetchRooms()
      .then((rooms) => {
        if (!cancelled && rooms.length > 0) setLiveRooms(rooms);
      })
      .catch(() => {
        if (!cancelled) setLiveRooms(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rooms = liveRooms ?? MOCK_ROOMS;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-[#0d0d12] text-white">
      <header className="sticky top-0 z-10 border-b border-white/5 bg-[#0d0d12]/90 px-4 pb-3 pt-5 backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-white/40">Live audio, all night</p>
            <h1 className="text-2xl font-extrabold tracking-tight">VibeRoom</h1>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1.5 text-sm font-semibold text-amber-200">
            <Coins size={15} />
            <span>{coins.toLocaleString()}</span>
          </div>
        </div>
        <nav className="mt-4 grid grid-cols-3 gap-2" aria-label="Primary">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center justify-center gap-1.5 rounded-2xl py-2.5 text-sm font-semibold transition ${
                  active ? "bg-white text-black" : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon size={15} />
                {t.label}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="flex-1 space-y-3 px-4 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-widest text-white/50">Live now</h2>
          <span className="flex items-center gap-1 text-xs text-emerald-300">
            <span className="live-dot inline-block h-2 w-2 rounded-full bg-emerald-400" />
            {rooms.length} rooms{liveRooms ? "" : " · preview"}
          </span>
        </div>

        {rooms.map((room) => (
          <Link
            key={room.id}
            href={`/room?slug=${room.slug}`}
            onClick={() => setActiveRoom(room.slug)}
            className="block overflow-hidden rounded-3xl border border-white/8 bg-[#15151d] transition hover:border-white/20 active:scale-[0.99]"
          >
            <div className="flex gap-3 p-4">
              <div
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl"
                style={{ backgroundColor: room.coverColor }}
                aria-hidden
              >
                <Mic size={26} className="text-white/90" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-bold">{room.title}</h3>
                <p className="truncate text-sm text-white/55">{room.description}</p>
                <p className="mt-1 text-xs text-white/40">Hosted by {room.hostName} · {room.category}</p>
                <div className="mt-2 flex items-center gap-3 text-xs text-white/60">
                  <span className="flex items-center gap-1">
                    <Users size={13} />
                    {formatCount(room.listenerCount)} listening
                  </span>
                  <span className="flex items-center gap-1">
                    <Mic size={13} />
                    {room.speakerCount} on mic
                  </span>
                </div>
              </div>
            </div>
          </Link>
        ))}

        <div className="rounded-3xl border border-white/8 bg-gradient-to-br from-violet-500/20 to-fuchsia-500/10 p-4">
          <h3 className="font-bold">Start your own room</h3>
          <p className="mt-1 text-sm text-white/60">Invite friends, open 8 speaker seats, and go live in seconds.</p>
          <Link
            href="/room?slug=late-check-in"
            onClick={() => setActiveRoom("late-check-in")}
            className="mt-3 inline-block rounded-2xl bg-white px-4 py-2.5 text-sm font-bold text-black transition hover:bg-white/85"
          >
            Preview demo room
          </Link>
        </div>
      </main>

      <footer className="sticky bottom-0 border-t border-white/5 bg-[#0d0d12]/95 px-6 py-3 text-center text-xs text-white/35 backdrop-blur">
        Web-first audio party · Pages + Workers + D1 + Cloudflare Realtime
      </footer>
      <DailyRewardModal />
    </div>
  );
}
