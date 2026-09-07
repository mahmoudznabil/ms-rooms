"use client";

import { useState } from "react";
import { Dices, Zap } from "lucide-react";

type GameType = "ludo" | "reaction";

export default function MiniGamePanel() {
  const [game, setGame] = useState<GameType>("ludo");
  const [dice, setDice] = useState(1);
  const [rolling, setRolling] = useState(false);
  const [score, setScore] = useState(0);
  const [reactionStart, setReactionStart] = useState<number | null>(null);
  const [reactionMsg, setReactionMsg] = useState("Tap Start, then tap as fast as you can when it turns green!");

  const roll = () => {
    if (rolling) return;
    setRolling(true);
    let n = 0;
    const t = setInterval(() => {
      setDice(1 + Math.floor(Math.random() * 6));
      n++;
      if (n > 10) {
        clearInterval(t);
        const final = 1 + Math.floor(Math.random() * 6);
        setDice(final);
        setRolling(false);
        setScore((s) => s + final);
      }
    }, 60);
  };

  const startReaction = () => {
    setReactionMsg("Wait for green…");
    setReactionStart(null);
    const delay = 800 + Math.random() * 2200;
    setTimeout(() => {
      setReactionStart(Date.now());
      setReactionMsg("TAP NOW!");
    }, delay);
  };

  const tapReaction = () => {
    if (reactionStart === null) {
      if (reactionMsg === "TAP NOW!") return;
      setReactionMsg("Too soon! Tap Start again.");
      return;
    }
    const ms = Date.now() - reactionStart;
    setReactionMsg(`⚡ ${ms}ms — ${ms < 200 ? "Lightning!" : ms < 350 ? "Nice!" : "Keep practicing!"}`);
    setReactionStart(null);
    setScore((s) => s + Math.max(1, 10 - Math.floor(ms / 100)));
  };

  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#121218]">
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2.5">
        <button
          onClick={() => setGame("ludo")}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${game === "ludo" ? "bg-white text-black" : "bg-white/5 text-white/60 hover:bg-white/10"}`}
        >
          <Dices size={13} /> Ludo Roll
        </button>
        <button
          onClick={() => setGame("reaction")}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${game === "reaction" ? "bg-white text-black" : "bg-white/5 text-white/60 hover:bg-white/10"}`}
        >
          <Zap size={13} /> Reaction
        </button>
        <span className="ml-auto text-xs font-bold text-amber-200">{score} pts</span>
      </div>
      <div className="p-4">
        {game === "ludo" ? (
          <div className="text-center">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-white text-4xl font-black text-black shadow-inner">
              {dice}
            </div>
            <button
              onClick={roll}
              disabled={rolling}
              className="mt-3 w-full rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {rolling ? "Rolling…" : "Roll Dice"}
            </button>
            <p className="mt-2 text-xs text-white/40">Turn-based — roll, move your token, pass the turn. Scores sync locally without breaking the mobile frame.</p>
          </div>
        ) : (
          <div className="text-center">
            <div
              onClick={tapReaction}
              className={`mx-auto flex h-20 w-full cursor-pointer items-center justify-center rounded-2xl text-sm font-black transition ${reactionStart !== null ? "bg-emerald-400 text-black" : "bg-white/5 text-white/60"}`}
            >
              {reactionMsg}
            </div>
            <button
              onClick={startReaction}
              className="mt-3 w-full rounded-2xl bg-white py-2.5 text-sm font-bold text-black transition hover:bg-white/85"
            >
              Start Round
            </button>
            <p className="mt-2 text-xs text-white/40">Quick reaction — state lives in the pane and never overflows the phone frame.</p>
          </div>
        )}
      </div>
    </div>
  );
}
