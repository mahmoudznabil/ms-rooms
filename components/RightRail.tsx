"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Coins, Trophy, Dices, ChevronRight } from "lucide-react";
import { leaderboard } from "@/lib/api";
import { levelProgress } from "@/lib/levels";
import { useSession } from "@/stores/useSession";
import { UserAvatar } from "@/components/bits";

interface BoardRow {
  display_name?: string;
  username?: string;
  avatar_url?: string | null;
  score?: number;
}

export default function RightRail() {
  const user = useSession((s) => s.user);
  const [rows, setRows] = useState<BoardRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    leaderboard("contributors", "weekly")
      .then((b) => {
        if (!cancelled) setRows((b.rows as BoardRow[]).slice(0, 5));
      })
      .catch(() => {
        // Rail stays useful without the board.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user) return null;
  const prog = levelProgress(user.xp);

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-white/10 bg-[#15151d] p-4">
        <div className="flex items-center gap-3">
          <UserAvatar name={user.display_name} avatarUrl={user.avatar_url} xp={user.xp} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold">{user.display_name}</p>
            <p className="text-xs text-white/45">
              Lv.{prog.level} · {user.xp.toLocaleString()} XP
            </p>
          </div>
          <Link href="/profile" aria-label="Profile" className="text-white/40 transition hover:text-white">
            <ChevronRight size={18} />
          </Link>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
            style={{ width: `${prog.pct}%` }}
          />
        </div>
        <div className="mt-3 flex items-center justify-between rounded-2xl bg-amber-300/10 px-3 py-2">
          <span className="flex items-center gap-1.5 text-sm font-bold text-amber-200">
            <Coins size={15} /> {user.coins.toLocaleString()}
          </span>
          <Link href="/wallet" className="text-xs font-bold text-amber-200/80 underline-offset-2 hover:underline">
            Top up
          </Link>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-[#15151d] p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-white/50">
            <Trophy size={13} /> Top gifters
          </h3>
          <Link href="/rankings" className="text-xs font-bold text-violet-300 hover:underline">
            All
          </Link>
        </div>
        {rows.length === 0 ? (
          <p className="py-3 text-center text-xs text-white/40">Be the first on the board — send a gift.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r, i) => (
              <li key={`${r.username ?? i}`} className="flex items-center gap-2.5">
                <span className="w-4 text-center text-xs font-black text-white/40">{i + 1}</span>
                <UserAvatar name={r.display_name ?? r.username ?? "?"} avatarUrl={r.avatar_url} size={28} showFrame={false} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white/80">
                  {r.display_name ?? r.username}
                </span>
                <span className="text-xs font-bold text-amber-200">{Number(r.score ?? 0).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Link
        href="/wallet"
        className="flex items-center gap-3 rounded-3xl border border-fuchsia-400/20 bg-gradient-to-br from-fuchsia-500/15 to-violet-500/10 p-4 transition hover:border-fuchsia-400/40"
      >
        <span className="rounded-2xl bg-fuchsia-500/20 p-2.5 text-fuchsia-200">
          <Dices size={20} />
        </span>
        <span>
          <span className="block text-sm font-extrabold">Lucky Spin</span>
          <span className="block text-xs text-white/55">20 coins a spin — win up to 300.</span>
        </span>
      </Link>
    </div>
  );
}
