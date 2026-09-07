"use client";

import { useEffect, useState } from "react";
import { Swords, Trophy } from "lucide-react";

interface PKBattleBarProps {
  roomA: { name: string; score: number };
  roomB: { name: string; score: number };
  endsAt: number;
  onEnd?: (winner: "A" | "B" | "draw") => void;
}

export default function PKBattleBar({ roomA, roomB, endsAt, onEnd }: PKBattleBarProps) {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));

  useEffect(() => {
    const t = setInterval(() => {
      const l = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setLeft(l);
      if (l <= 0) {
        clearInterval(t);
        const winner = roomA.score === roomB.score ? "draw" : roomA.score > roomB.score ? "A" : "B";
        onEnd?.(winner);
      }
    }, 500);
    return () => clearInterval(t);
  }, [endsAt, roomA.score, roomB.score, onEnd]);

  const total = Math.max(1, roomA.score + roomB.score);
  const pctA = (roomA.score / total) * 100;
  const pctB = 100 - pctA;
  const leading = roomA.score === roomB.score ? null : roomA.score > roomB.score ? "A" : "B";

  return (
    <div className="rounded-3xl border border-amber-300/20 bg-gradient-to-br from-violet-500/10 via-fuchsia-500/10 to-amber-500/10 p-3">
      <div className="flex items-center justify-between text-xs font-black uppercase tracking-widest text-white/60">
        <span className="flex items-center gap-1.5 text-amber-200"><Swords size={13} /> PK Battle</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${left <= 10 ? "bg-red-500 text-white animate-pulse" : "bg-white/10 text-white/70"}`}>
          {left}s left
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-bold">
        <div className={`rounded-2xl px-3 py-2 ${leading === "A" ? "bg-white text-black" : "bg-white/5 text-white/70"}`}>
          <p className="truncate">{roomA.name}</p>
          <p className="text-sm font-black">{roomA.score.toLocaleString()} pts</p>
        </div>
        <div className={`rounded-2xl px-3 py-2 text-right ${leading === "B" ? "bg-white text-black" : "bg-white/5 text-white/70"}`}>
          <p className="truncate">{roomB.name}</p>
          <p className="text-sm font-black">{roomB.score.toLocaleString()} pts</p>
        </div>
      </div>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all" style={{ width: `${pctA}%` }} />
        <div className="h-full bg-gradient-to-l from-amber-400 to-orange-500 transition-all" style={{ width: `${pctB}%` }} />
      </div>
      <p className="mt-1.5 text-center text-xs text-white/50">
        {left > 0 ? (leading ? `${leading === "A" ? roomA.name : roomB.name} leads!` : "Tie — send gifts to break it!") : <span className="flex items-center justify-center gap-1 text-amber-200"><Trophy size={12} /> Battle ended</span>}
      </p>
    </div>
  );
}
