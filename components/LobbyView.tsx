"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Mic, Plus, RefreshCw, Search, Users } from "lucide-react";
import { MOCK_ROOMS, formatCount, type LobbyRoom } from "@/lib/rooms";
import { fetchRooms } from "@/lib/api";
import { EmptyState, Spinner } from "@/components/bits";

const CATEGORIES = ["All", "Chill", "Music", "Karaoke", "Games", "Community", "Chat"] as const;

export default function LobbyView() {
  const [rooms, setRooms] = useState<LobbyRoom[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await fetchRooms();
      setRooms(data);
      setLive(true);
    } catch {
      // Keep empty — rooms only opened by users (no fake seeded rooms)
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  const q = query.trim().toLowerCase();
  const filtered = rooms.filter(
    (r) =>
      (category === "All" || r.category === category) &&
      (q === "" || r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q))
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black tracking-tight md:text-3xl">Live voice parties</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-white/50">
            <span className="live-dot inline-block h-2 w-2 rounded-full bg-emerald-400" />
            {live ? `${rooms.length} rooms live now` : "Connecting to live rooms…"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setLoading(true);
              void load();
            }}
            aria-label="Refresh rooms"
            className="rounded-full bg-white/5 p-2.5 text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
          <Link
            href="/create"
            className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2.5 text-sm font-bold text-black transition hover:bg-white/85"
          >
            <Plus size={15} /> Go live
          </Link>
        </div>
      </div>

      <div className="relative mt-4">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search rooms…"
          maxLength={40}
          className="w-full rounded-2xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-white/30 focus:border-violet-400/60 focus:outline-none"
        />
      </div>

      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Categories">
        {CATEGORIES.map((c) => (
          <button
            key={c}
            role="tab"
            aria-selected={category === c}
            onClick={() => setCategory(c)}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${
              category === c ? "bg-white text-black" : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={rooms.length === 0 ? "No live rooms yet" : "No rooms match"}
            hint={rooms.length === 0 ? "No empty rooms are left open — be the first to open one for others to join." : "Try another search or category."}
          />
          <Link
            href="/create"
            className="mt-3 block rounded-2xl bg-white py-3 text-center text-sm font-bold text-black transition hover:bg-white/85"
          >
            Create a room
          </Link>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((room) => (
            <Link
              key={room.id}
              href={`/room?slug=${room.slug}`}
              className="group overflow-hidden rounded-3xl border border-white/10 bg-[#15151d] transition hover:border-violet-400/40 active:scale-[0.99]"
            >
              <div className="relative flex h-24 items-center justify-center overflow-hidden" style={{ background: `linear-gradient(135deg, ${room.coverColor}, #15151d)` }}>
                <Mic size={30} className="text-white/80 transition group-hover:scale-110" />
                <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-white">
                  <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-white" /> Live
                </span>
                <span className="absolute bottom-3 right-3 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-bold text-white/85">
                  {room.category}
                </span>
              </div>
              <div className="p-4">
                <h3 className="truncate text-base font-extrabold">{room.title}</h3>
                <p className="truncate text-sm text-white/55">{room.description}</p>
                <p className="mt-1 text-xs text-white/40">Hosted by {room.hostName}</p>
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
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
