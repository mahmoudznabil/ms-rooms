"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Crown, Mic, Users } from "lucide-react";
import { leaderboard, type BoardPeriod, type BoardType } from "@/lib/api";
import { EmptyState, Spinner, UserAvatar } from "@/components/bits";

type Row = Record<string, unknown>;

const TYPES: Array<{ id: BoardType; label: string }> = [
  { id: "contributors", label: "Top gifters" },
  { id: "hosts", label: "Star hosts" },
  { id: "rooms", label: "Hot rooms" },
];
const PERIODS: Array<{ id: BoardPeriod; label: string }> = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "all", label: "All time" },
];

const MEDALS = ["🥇", "🥈", "🥉"];

export default function RankingsPage() {
  const [type, setType] = useState<BoardType>("contributors");
  const [period, setPeriod] = useState<BoardPeriod>("weekly");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const b = await leaderboard(type, period);
      setRows(b.rows as Row[]);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [type, period]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
        <Crown size={22} className="text-amber-300" /> Leaderboards
      </h1>
      <p className="mt-0.5 text-sm text-white/50">Gifting crowns the community. Updated live from the ledger.</p>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {TYPES.map((t) => (
          <button key={t.id} onClick={() => setType(t.id)}
            className={`rounded-2xl py-2.5 text-sm font-bold transition ${type === t.id ? "bg-white text-black" : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        {PERIODS.map((p) => (
          <button key={p.id} onClick={() => setPeriod(p.id)}
            className={`flex-1 rounded-full py-1.5 text-xs font-bold transition ${period === p.id ? "bg-violet-500/25 text-violet-200" : "bg-white/5 text-white/50 hover:bg-white/10"}`}>
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="No ranks yet" hint="Send a gift in any live room to claim the crown." />
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((r, i) => (
            <li key={String(r.id ?? r.slug ?? i)} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#15151d] p-3">
              <span className="w-7 text-center text-lg font-black">
                {i < 3 ? MEDALS[i] : <span className="text-sm text-white/40">{i + 1}</span>}
              </span>
              {type === "rooms" ? (
                <>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/10">
                    <Mic size={17} className="text-white/70" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <Link prefetch={false} href={`/room?slug=${String(r.slug)}`} className="block truncate text-sm font-extrabold hover:underline">
                      {String(r.title)}
                    </Link>
                    <span className="flex items-center gap-1 text-xs text-white/45">
                      <Users size={11} /> {Number(r.listener_count ?? 0).toLocaleString()} listening
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <UserAvatar name={String(r.display_name ?? r.username ?? "?")} avatarUrl={(r.avatar_url as string) ?? null} size={38} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-extrabold">{String(r.display_name ?? r.username)}</span>
                    <span className="block text-xs text-white/45">@{String(r.username)}</span>
                  </span>
                  <span className="text-sm font-black text-amber-200">{Number(r.score ?? 0).toLocaleString()}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
