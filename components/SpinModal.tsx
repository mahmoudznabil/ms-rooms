"use client";

import { useState } from "react";
import { Coins, Dices } from "lucide-react";
import { spin } from "@/lib/api";
import { useSession } from "@/stores/useSession";
import { Modal } from "@/components/bits";

const SEGMENTS = [0, 10, 30, 60, 150, 300];
const COLORS = ["#334155", "#7c3aed", "#db2777", "#f59e0b", "#10b981", "#0ea5e9"];

export default function SpinModal({ onClose }: { onClose: () => void }) {
  const user = useSession((s) => s.user);
  const refresh = useSession((s) => s.refresh);
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<{ prize: number; net: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  const doSpin = async () => {
    if (spinning) return;
    setError(null);
    setResult(null);
    setSpinning(true);
    try {
      const r = await spin(user.id);
      const idx = SEGMENTS.indexOf(r.prize);
      // Rotate so the winning segment lands on top (5 full turns + offset).
      setAngle((a) => a + 1800 + (360 - (idx * 60 + 30)) - ((a + 1800 + (360 - (idx * 60 + 30))) % 360));
      setTimeout(() => {
        setResult({ prize: r.prize, net: r.net });
        setSpinning(false);
        void refresh();
      }, 3300);
    } catch (e) {
      setSpinning(false);
      setError(e instanceof Error ? e.message : "Spin failed. Try again.");
    }
  };

  return (
    <Modal title="Lucky Spin" onClose={onClose}>
      <div className="flex flex-col items-center">
        <div className="relative">
          <span className="spin-tick">▼</span>
          <div
            className="spin-wheel relative h-56 w-56 overflow-hidden rounded-full border-4 border-amber-300/60"
            style={{
              transform: `rotate(${angle}deg)`,
              background: `conic-gradient(${SEGMENTS.map(
                (s, i) => `${COLORS[i]} ${i * 60}deg ${(i + 1) * 60}deg`
              ).join(",")})`,
            }}
          >
            {SEGMENTS.map((s, i) => (
              <span
                key={s}
                className="absolute left-1/2 top-1/2 text-sm font-black text-white"
                style={{
                  transform: `rotate(${i * 60 + 30}deg) translateY(-88px)`,
                  textShadow: "0 1px 4px rgba(0,0,0,0.7)",
                }}
              >
                {s}
              </span>
            ))}
            <span className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[#17171f] text-amber-300">
              <Dices size={24} />
            </span>
          </div>
        </div>

        <p className="mt-3 flex items-center gap-1 text-sm text-white/60">
          <Coins size={14} className="text-amber-300" /> 20 coins per spin · prizes up to 300
        </p>

        {result && (
          <p className={`mt-2 text-lg font-black ${result.prize > 0 ? "text-amber-300" : "text-white/50"}`}>
            {result.prize > 0 ? `You won ${result.prize} coins!` : "No luck this time — spin again!"}
          </p>
        )}
        {error && (
          <p className="mt-2 rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300">{error}</p>
        )}

        <button
          onClick={() => void doSpin()}
          disabled={spinning || user.coins < 20}
          className="mt-3 w-full rounded-2xl bg-amber-400 py-3 text-sm font-bold text-black transition hover:bg-amber-300 active:scale-[0.98] disabled:opacity-40"
        >
          {spinning ? "Spinning…" : user.coins < 20 ? "Need 20 coins" : "Spin for 20 coins"}
        </button>
      </div>
    </Modal>
  );
}
